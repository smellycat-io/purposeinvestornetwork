# Purpose Investor Network — Project Standards

This file is read automatically by Claude Code at the start of every session in this
project. Keep it up to date as decisions change — it's the source of truth for how
this codebase should be built, not just a one-time note.

## Project Overview

The Purpose Investor Network (PIN) website: a static front-end plus a Node/Express
backend running as a single Lambda behind API Gateway and CloudFront. No frontend
framework — plain HTML/CSS/JS pages sharing a `shared/` component library.

- **Frontend**: static HTML pages in `front-end/`, shared components/styles in `shared/`
  (copied into `front-end/` at deploy time — see Deploy below)
- **Backend**: Express app (`private/backend/index.js`) wrapped for Lambda via
  `serverless-http` (`private/backend/lambda.js`)
- **Database**: DynamoDB — one table per content type (Roundtables, Initiatives, Posts,
  Press, Investments, Events, Images, Users), not a single-table design. See
  `docs/DATA-MODEL.md` for schema and the table-name env vars.
- **Auth**: `express-session` + a Users table (email/password, invite links, password
  reset). No third-party auth provider. Currently flat — anyone with a valid session is
  treated as an admin (`req.session.loggedIn`); role differentiation (Admin/Chair/Member)
  is in progress, see `docs/DATA-MODEL.md`.
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
                        # sessions.js, settings.js, store.js, dynamoClient.js
    routes/            # one file per resource, matching db/ where it exists
                        # (roundtables.js, initiatives.js, users.js, auth.js, ...)
    shared/             # cross-cutting helpers: auth.js (requireAdmin), access.js
                        # (memberOnly gating), asyncRoute.js, config.js, email.js,
                        # passwords.js, s3Client.js, sanitizeHtml.js
    admin/              # admin dashboard UI (html/css/js) — separate from front-end/
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

### Session auth — currently flat

`shared/auth.js`'s `requireAdmin` only checks `req.session.loggedIn` — it does not
distinguish Admin from Chair from Member. Any role-aware route needs its own middleware
built alongside (not instead of) `requireAdmin`, checking a role/roundtable claim on the
session or user record. Don't scatter role checks inline in route handlers — centralize
them in `shared/auth.js` the way `requireAdmin` already is.

### Error handling

`shared/asyncRoute.js` wraps route handlers so every route doesn't repeat try/catch →
`captureException` → 500 JSON boilerplate. Handlers still return their own status codes
for expected failures (400s, 404s). **Every new route goes through `asyncRoute`, not a
bare async handler.**

## Docs Sync

Whenever a schema, route, permission, or architecture decision is finalized — a new
DynamoDB table or field, a new role/permission boundary, a new env var, a change to the
deploy flow — it should be written into `docs/DATA-MODEL.md` or `docs/ARCHITECTURE.md`
before or alongside the code that implements it. If Claude Code is asked to build
something and the relevant decision isn't yet documented there, it should ask rather
than guess — exact role boundaries (what a Chair can and can't do to a Member under
their roundtable, exactly), field shapes, and permission edge cases are decisions, not
implementation details, and shouldn't be invented silently.

`README.md` carries its own version of this: a **Status** section stating what's built
vs. in progress, with open questions logged there rather than silently resolved by
whoever happens to be implementing. Update Status whenever a major feature ships or a
new open question surfaces — it's the fastest way for anyone (including a future Claude
Code session) to tell whether the repo's docs match its actual state. Since
`README.md` is currently out of sync (see below), the first Docs Sync task is bringing
it in line with `docs/ARCHITECTURE.md` once that's written.

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
- `README.md` and `server.test.js` are currently out of date relative to the DynamoDB/
  Lambda architecture actually in use (they still describe the original SQLite
  prototype) — don't treat them as current-state documentation until they're updated
  (see Docs Sync above)

## Git Workflow

- All changes on feature/working branches — no direct commits to `stage` or `main`
- Manual merge only: feature branch → `stage` (test) → `main` (production). No
  automated or Claude-initiated merges into either branch.
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
- `server.test.js` currently tests against the old SQLite-backed `index.js` path and is
  stale relative to the DynamoDB-only backend — needs updating to reflect current routes
  before it's trustworthy as a regression check
- Prioritize testing anything with conditional branching that's easy to get subtly
  wrong: `access.js` gating logic, token hashing/expiry in `users.js`, slug generation
  in `repository.js`, and (once built) role/roundtable-scoping logic for Chairs
- Tests should fail loudly and specifically — assert the actual expected value (the
  exact role, the exact filtered list), not just "no exception thrown" — so a broken
  test tells you what's wrong, not just that something is