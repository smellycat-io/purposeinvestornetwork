# Stage environment — setup reference

A fully parallel, non-public staging environment. Every resource below is
`-stage` suffixed and isolated from production — no shared buckets, tables,
Lambda, role, or CloudFront distribution. Built via direct AWS CLI calls
(not CloudFormation, except the API Gateway — see below), matching the
pattern production's own deploy pipeline actually uses.

Never commit real secret values to this file or anywhere in the repo.

## Resources already created

| Resource | Name / ID |
|---|---|
| Frontend bucket | `purposeinvestornetwork-stage` (OAC-only, no public-read policy) |
| Backend bucket | `purposeinvestornetwork-private-stage` |
| DynamoDB tables | `purpose-investor-network-{roundtables,initiatives,posts,images,press,investments,events,settings,survey-responses}-stage` |
| IAM role | `purpose-investor-network-backend-role-stage` |
| Lambda | `purpose-investor-network-backend-pin-backend-stage` (placeholder code until first `deploy-stage.yml` run) |
| API Gateway stack | CloudFormation stack `pin-api-stage`, deployed from `cloudfront.yml` (the same template prod's API Gateway uses — genuinely reusable, parameterized by Lambda ARN/name) |
| API Gateway domain | `o4cz57nrje.execute-api.us-east-1.amazonaws.com` |
| ACM certificate | `staging.purposeinvestornetwork.org`, ARN ends `.../certificate/cf261c56-fc28-4ec7-a21a-aef33b74f023`, us-east-1, DNS-validated |
| CloudFront KeyValueStore | `pin-stage-auth-store` — holds the Basic Auth credential the two functions below check against, key `authHeader` |
| CloudFront Function (default behavior) | `pin-stage-static-routing-auth` — Basic Auth + the same clean-URL rewrite as prod's `cloudfront-static-routing.js` |
| CloudFront Function (Lambda-routed behaviors) | `pin-stage-api-auth` — Basic Auth only |
| CloudFront distribution | `E11ZV5H45NVWDX`, domain `d3fq3tqp394mhr.cloudfront.net`, alias `staging.purposeinvestornetwork.org` |

**Note:** `private/infra/backend.yml` in this same directory is dead/unused
infrastructure from an earlier iteration of this project (tied to an
abandoned stack, `purpose-investor-network-live`) — it is not what
production or stage actually use for the Lambda/role/env vars. Don't use
it as a reference.

## Manual steps required (one-time)

### 1. Cloudflare DNS

Add a CNAME record in the `purposeinvestornetwork.org` zone:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `staging` | `d3fq3tqp394mhr.cloudfront.net` | DNS only (grey cloud) |

### 2. GitHub repo secrets

Add these under repo Settings → Secrets and variables → Actions:

| Secret | What it should be |
|---|---|
| `AWS_S3_BUCKET_STAGE` | `purposeinvestornetwork-stage` |
| `AWS_BACKEND_BUCKET_STAGE` | `purposeinvestornetwork-private-stage` |
| `STAGE_CLOUDFRONT_DISTRIBUTION_ID` | `E11ZV5H45NVWDX` |
| `ADMIN_USER_STAGE` | any username for the `/admin` dashboard login on stage |
| `ADMIN_PASS_STAGE` | a strong password, distinct from prod's `ADMIN_PASS` |
| `SESSION_SECRET_STAGE` | a long random string (e.g. `openssl rand -hex 32`), distinct from prod's `SESSION_SECRET` |

`deploy-stage.yml` also reads these **existing** prod secrets directly (no
new stage-specific copies needed): `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `SENTRY_DSN`, `SENTRY_BROWSER_DSN`,
`SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, `NOTIFY_EMAIL`,
`SES_FROM_EMAIL` — by design, per this environment's setup decisions:
stage sends real emails to the same `NOTIFY_EMAIL` inbox (so the email
flow itself is testable) and reports to the same Sentry project tagged
`SENTRY_ENVIRONMENT=staging`.

### 3. First deploy

Push to the `stage` branch. `deploy-stage.yml` handles the rest (frontend
sync, Lambda code, IAM policy reconciliation) — same as `main` → prod.

## Rotating the Basic Auth credential later

The credential lives only in the KeyValueStore, not in any function source
or repo file:

```
aws cloudfront-keyvaluestore describe-key-value-store \
  --kvs-arn arn:aws:cloudfront::110695445537:key-value-store/264bfd98-cd0c-42ca-bb62-133ebc77083d
# use the returned ETag as --if-match below

aws cloudfront-keyvaluestore put-key \
  --kvs-arn arn:aws:cloudfront::110695445537:key-value-store/264bfd98-cd0c-42ca-bb62-133ebc77083d \
  --key authHeader \
  --value "Basic $(printf '%s' 'newusername:newpassword' | base64)" \
  --if-match <etag-from-above>
```

Takes effect immediately — no function republish needed.
