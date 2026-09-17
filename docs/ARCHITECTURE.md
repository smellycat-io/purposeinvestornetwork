# Architecture

## Stack overview

- **Frontend**: static HTML/CSS/JS in `front-end/`, served from S3 behind CloudFront.
  `shared/` (component library) is copied into `front-end/` at deploy time — it isn't a
  build step, just a `cp -r` before the S3 sync.
- **Backend**: single Express app (`private/backend/index.js`), wrapped for Lambda via
  `serverless-http` (`private/backend/lambda.js`), fronted by an API Gateway HTTP API.
- **Database**: DynamoDB, one table per content type — see `docs/DATA-MODEL.md`.
- **Email**: AWS SES, one verified sender identity (`SES_FROM_EMAIL`), used for
  notification emails and (once wired) invite/reset links.
- **Monitoring**: Sentry (backend via `@sentry/aws-serverless`, browser via a separate
  DSN), Plausible + PostHog analytics.
- **DNS**: Cloudflare, DNS-only (non-proxied) mode — Cloudflare just points records at
  CloudFront/API Gateway, it isn't in the request path.

## Environments

### Production
| Resource | Value |
|---|---|
| Domain | `purposeinvestornetwork.org` |
| CloudFront distribution | `E20BW0W9XR1KU3` |
| Lambda function | `purpose-investor-network-backend-pin-backend` |
| IAM role | `purpose-investor-network-backend-role` |
| DynamoDB tables | `purpose-investor-network-{roundtables,initiatives,posts,images,press,investments,events,settings,sessions,users}` |

### Staging
A fully parallel, non-public environment — every resource `-stage`-suffixed, no shared
buckets/tables/Lambda/role/distribution with production. Built via direct AWS CLI calls,
same pattern the production deploy pipeline itself uses (not CloudFormation, except the
API Gateway stack).

| Resource | Value |
|---|---|
| Domain | `staging.purposeinvestornetwork.org` |
| CloudFront distribution | `E11ZV5H45NVWDX` |
| Lambda function | `purpose-investor-network-backend-pin-backend-stage` |
| IAM role | `purpose-investor-network-backend-role-stage` |
| Frontend bucket | `purposeinvestornetwork-stage` (OAC-only, no public-read policy) |
| Backend bucket | `purposeinvestornetwork-private-stage` |
| API Gateway | CloudFormation stack `pin-api-stage`, from `infra/cloudfront.yml` |
| Access control | HTTP Basic Auth via a CloudFront Function + KeyValueStore (see below) — this is what keeps it non-public |

Full resource inventory, one-time manual setup steps (Cloudflare CNAME, GitHub secrets),
and how to rotate the Basic Auth credential live in `private/infra/STAGE-SETUP.md`.

## Deploy flow

Two GitHub Actions workflows, both push-triggered: `deploy.yml` on `main` → production,
`deploy-stage.yml` on `stage` → staging. Same shape in both; staging reuses several
production secrets directly by design (Sentry, SES) so the email flow and error
reporting are genuinely tested against real infrastructure, not stubbed.

**Frontend job:**
1. Copy `shared/` into `front-end/`
2. Sync `front-end/` to the environment's S3 bucket (`--delete`, excluding `.env*`)
3. Invalidate the CloudFront distribution (`/*`)

**Backend job:**
1. Validate required GitHub secrets are present (fails fast with a clear message if not)
2. Pull a private `.env` file from the backend's own S3 bucket (`private/.env`) if one
   exists — this is how ad hoc env vars survive redeploys without a matching GitHub
   secret (see Env vars below)
3. Generate `private/backend/package.json` from root `package.json` (`scripts/generate-backend-package.js`), `npm install --production`, zip into `backend.zip`
4. **Apply environment variables to Lambda** — reads the Lambda's *current* env via
   `get-function-configuration`, merges in workflow-provided values (workflow value wins
   if set, otherwise the current value is preserved), then writes the merged result back
   via `update-function-configuration`. This merge-not-replace behavior means a variable
   set manually in the AWS console and never added to the workflow persists across every
   future deploy.
5. Upload `.env` back to the backend bucket, upload `backend.zip` to the backend bucket
6. **Create Lambda if missing** — bootstraps the IAM role, attaches
   `AWSLambdaBasicExecutionRole`, sets initial env vars. Only runs the creation path if
   `get-function` fails; otherwise a no-op.
7. **Reconcile IAM policies** — DynamoDB (scan/query/get/put/delete on every content
   table) and SES (`SendEmail`/`SendRawEmail`) inline policies are (re-)applied via
   `put-role-policy` on *every* deploy, idempotently. This is the actual source of truth
   for the Lambda's permissions — not any CloudFormation template (see below).
8. Poll `get-function` until `Configuration.State` is `Active`, then
   `update-function-code` — handles the eventual-consistency window right after Lambda
   creation.

## Infra-as-code status — read before touching `private/infra/`

The CloudFormation templates in `private/infra/` are **not** all in active use:

- **`backend.yml` and `dynamodb-table.yml` are dead** — leftover from an earlier
  iteration of this project tied to an abandoned stack (`purpose-investor-network-live`).
  They don't reflect the current multi-table schema, current env vars, or how the Lambda
  is actually configured. `STAGE-SETUP.md` states this explicitly. **Don't use them as a
  reference for the current Lambda/role/env var setup.**
- **`content-tables.yml`** matches the real, current table names and is a correct
  reference for the schema — but `deploy.yml`/`deploy-stage.yml` never run
  `aws cloudformation deploy` against it. It was most likely applied once, manually, to
  create the tables. The Lambda's actual DynamoDB access is granted by the deploy
  workflow's own `put-role-policy` step (see above), independent of this template.
- **`cloudfront.yml`** is the one template genuinely reused — the same parameterized
  template backs both production's and staging's API Gateway stack.

**Planned: Users-table email GSI.** The Admin/Chair/Member role rollout (see
`docs/DATA-MODEL.md`'s Users section) adds an email-lookup GSI to the Users table to
replace `findUserByEmail`/`acceptInvite`/password-reset's current scan-and-filter.
Since `content-tables.yml` isn't applied by the deploy pipeline (see above), this GSI
needs an explicit manual `aws dynamodb update-table` (or a `content-tables.yml` edit
applied by hand) against both the production and staging tables when that work ships —
it won't appear just because `docs/DATA-MODEL.md` documents it.

Net effect: the real infrastructure state (Lambda config, IAM policies) lives in AWS,
reconciled imperatively by the deploy workflows' inline scripts — there's no single
checked-in CFN stack you could diff against to see current infra state. Treat
`.github/workflows/deploy*.yml` as the closest thing to source-of-truth for backend
infra config, not `private/infra/*.yml` (`cloudfront.yml` excepted).

## CloudFront routing

Two layers, both CloudFront Functions (runtime `cloudfront-js-2.0`):

1. **Clean-URL rewrite** (`cloudfront-static-routing.js`, attached to the default/
   catch-all cache behavior — `/api/*`, `/admin*`, `/login` etc. are separate behaviors
   that route straight to the Lambda origin and never reach this function). Rewrites by
   URL *shape*, not a hardcoded content-type list, so a new content type following the
   existing convention needs zero routing changes:
   - `/<type>` → `/<type>.html` (list pages)
   - `/<type>/<slug>` → `/<type>-detail.html` (detail pages)
   - `/roundtables/initiatives/<slug>` → `/initiative.html` (one-off nesting)
   - Anything already a real file (has a `.` in the last path segment) passes through
2. **Staging Basic Auth** (`pin-stage-static-routing-auth` on the default behavior,
   `pin-stage-api-auth` on Lambda-routed behaviors) — checks a credential stored in a
   CloudFront KeyValueStore (`pin-stage-auth-store`, key `authHeader`), not in function
   source or any repo file. Rotating it is a `cloudfront-keyvaluestore put-key` call
   (see `STAGE-SETUP.md`) and takes effect immediately, no function republish needed.

**Known gotcha**: `aws cloudfront update-distribution` requires both the patched config
JSON *and* the distribution's current ETag via `--if-match`. A zero-quantity field (e.g.
no custom error responses configured) must omit the `Items` key entirely rather than
send an empty array — sending `Items: []` where AWS expects the key absent causes the
patch to fail or silently misapply. `patch-cloudfront-distribution.js` exists specifically
to normalize this before patching.

## Env vars & secrets

No `.env` file is committed. Two layers manage configuration:

1. **GitHub repo secrets** — `ADMIN_PASS`, `SESSION_SECRET`, Sentry keys, SES config,
   bucket names — read directly into the workflow's env blocks.
2. **A private `.env` in the backend's own S3 bucket** (`private/.env`) — downloaded
   before build, merged with workflow-set values, re-uploaded after. This is the escape
   hatch for a var that needs to exist on the Lambda without a matching GitHub secret.

Two variables are deliberately hardcoded in the workflow YAML instead of GitHub secrets,
each after a real incident:

- **`ADMIN_USER`** is the literal string `admin`. Once set to a real email, it silently
  shadowed `ADMIN_PASS` as the login check for that address — a lockout. It must never
  be set to an address that could match a real Users-table account.
- **`SENTRY_DSN`** is hardcoded directly. A DSN is write-only/ingest-only (worst-case
  exposure is spam events, not data access), and its value repeatedly got corrupted
  through the GitHub Secrets web UI (once literally became the string `"SENTRY_DSN"`).
  Get the current value from Sentry project settings if it ever needs to change.

The deploy script validates both before applying — a regex check on `SENTRY_DSN`'s
shape and a check that `ADMIN_USER` is non-empty and contains no `@` — and fails the
deploy loudly rather than silently shipping a value that looks like either past mistake.

Full current env var list (production Lambda): `ADMIN_USER`, `ADMIN_PASS`,
`SESSION_SECRET`, `SENTRY_DSN`, `SENTRY_BROWSER_DSN`, `SENTRY_ENVIRONMENT`,
`SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, `AWS_S3_BUCKET`, `AWS_BACKEND_BUCKET`,
one `AWS_<THING>_TABLE` per table (see `docs/DATA-MODEL.md`), `SITE_URL`,
`NOTIFY_EMAIL`, `SES_FROM_EMAIL`.

## Known gotchas / platform quirks

- CloudFront patch requires ETag + `--if-match`; zero-quantity fields omit `Items`
  entirely (see CloudFront routing above).
- A GitHub secret update doesn't take effect on the running Lambda until the next
  deploy-triggered commit — env vars are only applied during a deploy run, not on save.
- `req.get('host')` can't be trusted for absolute URLs in emails/links — CloudFront's
  origin-request policy rewrites the Host header before it reaches API Gateway/Lambda.
  Use `config.SITE_URL` instead (already enforced in `shared/config.js`, documented in
  `CLAUDE.md`'s Things to Avoid).
- **Sentry browser trace sample rate** — `shared/config.js` currently falls back
  `SENTRY_BROWSER_TRACES_SAMPLE_RATE` → `SENTRY_TRACES_SAMPLE_RATE` → `0.0`, which looks
  like it resolves the previously-noted issue of browser traces silently defaulting to
  0 from a variable-name mismatch. Worth a quick live check in Sentry to confirm traces
  are actually flowing now that this fallback exists in code, rather than assuming it's
  fixed from reading the source alone.

## Open / needs confirmation

- AWS SES production access + domain verification for `purposeinvestornetwork.org` —
  last known status was pending. Not verifiable from source; confirm current state in
  the SES console.
- Whether the CloudFront distribution's *live* behavior configuration actually matches
  `cloudfront-static-routing.js` as checked into the repo — function code and the live
  distribution's attached-function config can drift if one is updated without the other.