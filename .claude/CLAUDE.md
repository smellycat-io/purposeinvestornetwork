# Purpose Investor Network — Project Standards

This file is read automatically by Claude Code at the start of every session in this
project. Keep it up to date as decisions change — it's the source of truth for how
this codebase should be built, not just a one-time note.

## Project Overview

The Purpose Investor Network (PIN) website: a static front-end plus a Node/Express
backend running as a single Lambda behind API Gateway and CloudFront. No frontend
framework — plain HTML/CSS/JS pages sharing a `shared/` component library.

- **Frontend**: static HTML pages in `front-end/`, shared components/styles in `shared/`
  (copied into `front-end/` at deploy time — see `docs/ARCHITECTURE.md`'s Deploy flow
  section)
- **Backend**: Express app (`private/backend/index.js`) wrapped for Lambda via
  `serverless-http` (`private/backend/lambda.js`)
- **Database**: DynamoDB — one table per content type (Roundtables, Initiatives, Posts,
  Press, Investments, Events, Images, Users, Sessions, Settings, Campaigns, Campaign
  Entries), not a single-table design. See `docs/DATA-MODEL.md` for schema and the
  table-name env vars.
- **Auth**: `express-session` + a Users table (email/password, invite links, password
  reset). No third-party auth provider. Every protected route is role-gated
  (Admin/Chair/Member via `req.session.role`), see `docs/DATA-MODEL.md`.
- **Monitoring**: Sentry (`@sentry/aws-serverless`), Plausible + PostHog analytics.

See `docs/ARCHITECTURE.md` for the AWS stack, deploy flow, staging setup, and known
platform gotchas. See `docs/DATA-MODEL.md` for the DynamoDB schema and API endpoints.

## Folder Structure

```
front-end/          # static pages served to the public — one .html file per page
  imgs/
shared/              # component library shared between front-end and admin dashboard;
                      # copied into front-end/ at deploy time (see .github/workflows/deploy.yml)
  component/         # banner.js, card.js, archive.js, list-page.js, detail-page.js, etc.
  sentry/
private/
  backend/
    index.js          # Express app definition (routes mounted here)
    lambda.js          # serverless-http wrapper — Lambda entry point
    db/                # one file per table/concern: repository.js (generic CRUD),
                        # content.js (Roundtables/Initiatives/Posts/etc.), users.js,
                        # campaigns.js, sessions.js, settings.js, store.js, dynamoClient.js
    routes/            # one file per resource, matching db/ where it exists
                        # (roundtables.js, initiatives.js, users.js, auth.js,
                        # member.js, ...)
    shared/             # cross-cutting helpers: auth.js (requireRole), access.js
                        # (memberOnly gating), asyncRoute.js, config.js, email.js,
                        # passwords.js, s3Client.js, sanitizeHtml.js
    admin/              # admin dashboard UI (html/css/js) — separate from front-end/
    member/             # role-gated member pages (html/css/js), served by the
                        # Lambda — separate from front-end/ the same way admin/ is
    sentry/
  infra/                # CloudFormation templates + CloudFront Functions
scripts/                # build/packaging scripts (generate-backend-package.js)
docs/                   # ARCHITECTURE.md, DATA-MODEL.md (see below)
```

New backend code goes in the matching `db/` + `routes/` pair for its resource. If a new
concern doesn't obviously fit an existing file, ask rather than inventing a new one ad
hoc — this codebase is small enough that a wrong split is expensive to unwind later.

**Sub-grouping within a folder.** Once a folder (e.g. `routes/`) grows enough that
distinct concerns are visible in the file list, group like files into subfolders by
concern — not by file type (no generic `Utils/`/`Helpers/` buckets). Don't
pre-emptively create subfolders for a folder that's still small (a handful of files) —
flat is fine until grouping actually earns its keep.

## Naming Conventions

- **Files**: camelCase for backend modules (`dynamoClient.js`, `asyncRoute.js`), matching
  the existing codebase; kebab-case for front-end HTML pages (`roundtables-detail.html`)
- **Functions, variables**: camelCase throughout (`listRoundtables`, `findUserByEmail`)
- **Classes**: PascalCase (`Repository`)
- **Env vars**: `AWS_<THING>_TABLE` for DynamoDB table names (`AWS_ROUNDTABLES_TABLE`,
  `AWS_USERS_TABLE`), `SCREAMING_SNAKE_CASE` generally
- **DynamoDB fields**: camelCase (`createdAt`, `memberOnly`, `roundtableIds`)

## Architecture Patterns

### Repository pattern for DynamoDB tables

`db/repository.js` exports a generic `Repository` class (scan/list/get/create/update/
delete) shared across every content table. Entity-specific defaults and validation stay
in `db/content.js`'s `createX()` functions — `Repository` only owns persistence
mechanics and the handful of things that vary per table (slug field, slug uniqueness
suffix, re-slug-on-update, sort order). **New content table → instantiate `Repository`,
don't hand-roll scan/put logic.**

### Type-differentiated tables (Posts)

Posts is one table covering blog posts, initiative updates, education content, and
announcements, differentiated by a `type` field (`POST_TYPES` in `content.js`). Reuse
this pattern before creating a new table when a new content kind is close enough to an
existing one (shares most fields, just needs filtering).

### Member-only content gating

`shared/access.js` is the single place membership auth plugs into content visibility —
`canSeeFull(item, req)` currently always returns `false` (a stated TODO). Every route
that respects `memberOnly` already calls through this file, so wiring up real membership
checks is a one-function change, not a route-by-route hunt. **Do not add ad hoc
`memberOnly` checks in route handlers — route them through `access.js`.**

### Invite + token pattern (Users)

`db/users.js` generates invite/reset tokens as random hex, emails the raw token, but only
stores its SHA-256 hash — a DB read or leak alone can't be replayed as a usable link.
Follow this pattern for any future token-based flow (e.g. chair-issued member invites):
generate, hash for storage, compare with `crypto.timingSafeEqual`.

### Session auth

`req.session.loggedIn` marks any authenticated session; `req.session.role` and
`req.session.roundtableId` (set at login in `routes/auth.js`) carry the Admin/Chair/
Member distinction on top of it. Every protected route names its allowed roles
explicitly through `shared/auth.js`'s `requireRole(...roles)` (checks
`req.session.role` against an allowlist; JSON 401/403 for `/api/*` routes) — there is
no flat, login-only gate left in this codebase. For page routes, no session redirects
to `/login`; a session with the wrong role redirects to `roleHome(role)` instead
(`/member` for Member, `/admin` for Admin/Chair) — never back to `/login`, which would
just bounce it straight back. Login itself redirects to `roleHome(role)` the same way.
A new `/api/admin` or `/admin` route with no `requireRole` call is a bug:
`shared/routeRoleGates.test.js` walks the live Express router and fails the build if
one ever appears un-gated. Don't scatter role logic inline in route handlers —
centralize it in `shared/auth.js` the way `requireRole` already is.

**The bootstrap `ADMIN_USER`/`ADMIN_PASS` login must stay reachable and functional
independent of the Users table, DynamoDB, or any GSI's health.** It's the
account-recovery path of last resort — if a Users-table lookup can ever block it,
there's no way back in when that table or its indexes break. `routes/auth.js`'s login
handler enforces this by wrapping only the `findUserByEmail` call in its own
try/catch, falling through to the bootstrap check on failure exactly as if no user
record existed. **Never make the bootstrap path depend on a successful database call
first** — a failed index or table lookup once locked out the last-resort login. Any
future change to this handler must preserve the try/catch split.

### Role-gated pages are served by the Lambda

Anything in `front-end/` is public. A new gated path lives under `private/backend/`,
is mounted with `requireRole`, must be added to `BACKEND_PATH_PATTERNS` in
`private/infra/patch-cloudfront-distribution.js`, and the patch must be applied to the
stage and production distributions before the code deploys. Without the behavior the
path falls through to S3 and returns `AccessDenied`.

### Error handling

`shared/asyncRoute.js` wraps route handlers so every route doesn't repeat try/catch →
`captureException` → 500 JSON boilerplate. Handlers still return their own status codes
for expected failures (400s, 404s). **Every new route goes through `asyncRoute`, not a
bare async handler.** Pass `{ verbose: true }` as the third argument to fold the raw
`error.message` into the 500 response as `detail`, on top of the Sentry report every
route already gets — but only for a route reachable after authenticating (behind
`requireRole`). Never pass it on a public route (accept-invite,
forgot/reset-password, subscribe, survey): an unauthenticated caller could otherwise
use a 500's detail to probe internals a generic message deliberately hides.

## Docs Sync

Whenever a schema, route, permission, or architecture decision is finalized — a new
DynamoDB table or field, a new role/permission boundary, a new env var, a change to the
deploy flow — it should be written into `docs/DATA-MODEL.md` or `docs/ARCHITECTURE.md`
before or alongside the code that implements it. If Claude Code is asked to build
something and the relevant decision isn't yet documented there, it should ask rather
than guess — exact role boundaries (what a Chair can and can't do to a Member under
their roundtable, exactly), field shapes, and permission edge cases are decisions, not
implementation details, and shouldn't be invented silently.

When a decision ships, update the relevant section to describe the current state
directly — as if the design had always been this way — rather than appending a status
label ("proposed" → "shipped"), a stage/PR reference, or narrative commentary about
when or how it changed. If a part of the design isn't built yet, say so plainly (e.g.
"not yet implemented") as a structural fact about the current codebase, not as a stage
number or changelog entry. The test: someone reading this doc for the first time should
learn the system as it stands, not the sequence of PRs that produced it.

`README.md` carries its own version of this: a **Status** section stating what's built
vs. in progress, with open questions logged there rather than silently resolved by
whoever happens to be implementing. Update Status whenever a major feature ships or a
new open question surfaces — it's the fastest way for anyone (including a future Claude
Code session) to tell whether the repo's docs match its actual state.

**Periodic Staleness Check.** When working in an area of the repo — `infra/`, a given
route file, a doc — briefly check whether adjacent files in that area still reflect
reality: an unused CloudFormation template, a config file superseded by a workflow
script, a comment describing behavior that's since changed. Flag what's found rather
than silently trusting a file's presence as proof it's current. This isn't a scheduled
audit and shouldn't turn into one — it's triggered by working in that area, not run on
a timer or against the whole repo at once.

## Things to Avoid

- No hand-rolled DynamoDB scan/put logic outside `Repository` — extend it if it's
  missing a capability, don't bypass it
- No `memberOnly` or role checks inline in route handlers — route through
  `shared/access.js` / `shared/auth.js`
- Don't store raw invite or reset tokens — hash before persisting (see Users pattern
  above)
- Don't trust `req.get('host')` for building absolute URLs — CloudFront's origin-request
  policy rewrites the Host header; use `config.SITE_URL` (see `shared/config.js`)
- Don't assume a GitHub secret update takes effect immediately — it only applies on the
  next deploy-triggered commit
- Don't merge into `stage` or `main` directly or via automation — always a manual merge
  after testing on the feature branch (see Git Workflow)
- No magic numbers or scattered inline constants for anything configurable — env vars
  and shared constants belong in `shared/config.js`, not hardcoded per route handler

## Avoiding Duplicate Code & Bloat

- Before adding a new DB table or route file, check whether an existing content type
  (esp. Posts' `type` field) already covers the shape you need
- If the same validation, gating, or formatting logic shows up in two route files, pull
  it into `shared/` before a third copy appears
- Delete dead code rather than commenting it out — git history is the safety net
- Periodically ask Claude Code to review recently added files for duplication against
  the existing codebase — cheap to do, and catches drift early before it compounds
- Watch for "one-off" scripts or quick prototypes that quietly become permanent — either
  clean them up to match project standards or remove them, don't let temporary code
  linger alongside the real systems

## Git Workflow

- All changes on feature/working branches — no direct commits to `stage` or `main`
- Manual merge only: feature branch → `stage` (test) → `main` (production). No
  automated or Claude-initiated merges into either branch.
- **Every PR's base branch is `stage`, never `main`.** `gh pr create` defaults to the
  repo's default branch — pass `--base stage` explicitly every time, since the default
  will otherwise be wrong. The one exception is the recurring `stage` → `main`
  promotion PR itself, which is base `main` / head `stage` by definition — that's the
  only PR that should ever target `main` directly.
- `deploy.yml` runs on push to `main` (production); `deploy-stage.yml` on push to
  `stage`
- **Branch naming**: `feature/short-description` for new functionality
  (`feature/chair-invite-flow`), `fix/short-description` for bug fixes,
  `refactor/short-description` for cleanup with no behavior change
- **One branch per logical unit of work.** Don't let a single branch accumulate
  multiple unrelated changes (e.g. don't build the role/permission system and an
  unrelated content-page fix in the same branch) — keeps diffs reviewable and isolates
  what broke if something did
- **Before merging feature → `stage`:**
  1. The app runs locally without errors
  2. Any tests written for the change (see Testing below) pass
  3. A quick read-through of the diff for duplication/bloat per the section above
- Commit messages: short present-tense summary line (`Add chair invite endpoint`, `Fix
  CloudFront routing for stage`); body only when the "why" isn't obvious from the diff
- Tag or note stable milestones (e.g. "role system live in production") so there are
  clear rollback points as the project grows
- Claude Code should create a new branch itself before starting new work if one isn't
  already checked out and appropriately named — don't build directly on `stage` or
  `main` even if not explicitly told to branch first
- **Local guardrails enforce the rules above, not just document them.**
  `.githooks/pre-commit` rejects a commit made directly on `main` or `stage`;
  `.githooks/pre-push` rejects a push whose remote ref is `refs/heads/main` or
  `refs/heads/stage` — both only change through a GitHub PR. `npm install`'s
  `prepare` script enables them (`git config core.hooksPath .githooks`), guarded so
  it no-ops rather than fails when there's no `.git` directory (CI, packaged Lambda
  builds). `.claude/settings.json` separately denies `git push --force`/`-f` outright
  and a `git push` whose command text names `main`/`stage` as the target — a
  text-pattern match, not a true parse of the target ref, so it's a second layer
  alongside the hook, not a replacement for it. It matches command text only: a push
  like `git push origin HEAD:main` isn't caught by it. The pre-push hook is the real
  control for that — GitHub's own branch protection is the other one, currently
  enabled on `main` (PR review required, force-push and deletion blocked) but not yet
  on `stage`.
  `ALLOW_PROTECTED_BRANCH=1` is read only by the hooks, not the deny rules — it's for
  Elise to set by hand, for a deliberate exception. Claude Code never sets it, never
  includes it in a command, and never suggests bypassing a hook. If a hook blocks a
  commit or push, stop and tell Elise which branch rule blocked it.

## Reporting Back

- **Final output goes in a copy-paste format.** When wrapping up a task in the
  terminal/chat — a summary of what shipped, exact commands or values Elise needs to
  act on (AWS CLI commands, env var names/values, URLs) — present it as a fenced code
  block rather than plain prose or GitHub-flavored markdown with inline bold/bullets.
  Prose formatting doesn't paste cleanly outside GitHub; a code block does.
- **Every PR description has a Stage Testing section.** A checklist, one GitHub task
  item (`- [ ] ...`) per test, so Elise can tick them off while testing on
  staging.purposeinvestornetwork.org.
  - Each item names the account or role to use, the action, and the exact result to
    expect. Example: `- [ ] Log in as a Chair: the tab bar shows Campaigns, Posts,
    Content, Investments & Events, Settings, Users and no Press tab.`
  - Order the items in the order to run them.
  - If the change needs manual AWS work, the first items are the infra steps
    (`- [ ] Applied the <command> to the stage <resource>`), with the exact commands
    in a copy-paste block directly above the checklist.
  - Include a negative check for anything that must not be possible (a Chair calling
    an Admin-only route returns 403).
  - If no staging pass is needed (docs or config only), the section says so in one
    line with the reason, and has no checklist.
  The PR description itself uses GitHub task-list markdown so the boxes render and can
  be ticked. The checklist lives there only — the chat-facing report doesn't repeat it
  (see the next bullet).
- **The chat-facing report adds a mini summary and a prompt identifier — it doesn't
  replace the PR's own full summary.** When wrapping up a task in the terminal/chat,
  give a short summary of what shipped, then quote back the first few lines of the
  prompt/instructions this work was built from — enough to identify it, not the whole
  thing. Lets Elise confirm at a glance that the request and the delivery match,
  without opening the PR. The PR description still gets its full summary as already
  required above — this chat-facing mini summary is an addition for quick
  confirmation, not a shorter replacement for it.
- **Infra before deploy.** Any change that needs manual AWS work (new tables, GSIs,
  CloudFront behaviors, secrets) lists the exact commands in the PR description in a
  copy-paste block, and they are applied to an environment before that environment's
  deploy. One line of rationale, no incident narrative.

## Comments & Documentation

This codebase already comments *why*, not *what* — see the header comments in
`repository.js`, `access.js`, and `users.js` for the standard to match. Any workaround
for a CloudFront/Lambda/DynamoDB quirk gets a comment explaining the constraint (see
`config.js`'s `SITE_URL` comment as the model) so it doesn't get "cleaned up" by
accident later.

Exported functions and classes that aren't self-explanatory get a short comment
explaining intent, not just restating the signature — e.g. `Repository`'s constructor
options (`slugSuffix`, `reslugOnUpdate`) are exactly the kind of non-obvious behavior
worth a line explaining *why* a table would opt in or out.

## Testing

- **Framework**: Jest + Supertest (already in `devDependencies`)
- Prioritize testing anything with conditional branching that's easy to get subtly
  wrong: `access.js` gating logic, token hashing/expiry in `users.js`, slug generation
  in `repository.js`, and role/roundtable-scoping logic for Chairs
- Tests should fail loudly and specifically — assert the actual expected value (the
  exact role, the exact filtered list), not just "no exception thrown" — so a broken
  test tells you what's wrong, not just that something is
