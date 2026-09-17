# Purpose Investor Network

The website for the Purpose Investor Network (PIN) — a philanthropic impact investing
organization mentoring the next generation of impact investors. Static front-end,
serverless Express backend, content managed through an admin dashboard.

## What this is

- **Public site** (`front-end/`) — Homepage, About, Roundtables & Initiatives,
  Education, Investments (portfolio/showcase), Events, Press/Updates, and a member
  questionnaire/survey.
- **Admin dashboard** (`private/backend/admin/`) — staff-only content management for
  every content type above, plus user invites.
- **Member area** — in progress; see `docs/DATA-MODEL.md`'s Role & Permission Model.

See `docs/ARCHITECTURE.md` for the full AWS stack, deploy flow, and staging setup. See
`docs/DATA-MODEL.md` for the DynamoDB schema and API reference. See `.claude/CLAUDE.md`
for coding standards and conventions this codebase follows.

## Tech stack

- **Frontend**: static HTML/CSS/JS, no framework, shared component library in `shared/`
- **Backend**: Express (`private/backend/`), wrapped for Lambda via `serverless-http`
- **Database**: DynamoDB — one table per content type
- **Auth**: `express-session` + a Users table (no third-party provider)
- **Hosting**: S3 + CloudFront (frontend), API Gateway + Lambda (backend)
- **Monitoring**: Sentry, Plausible, PostHog

Full details in `docs/ARCHITECTURE.md`.

## Local development

Requirements: Node.js 18+, npm.

```bash
npm install
npm start
```

Serves the site at `http://localhost:3000`. Copy `.env.example` to `.env` and fill in
values first — **note**: `.env.example` currently only covers session/admin-login and
Sentry vars. Without the `AWS_<THING>_TABLE` vars (see `docs/DATA-MODEL.md`) pointing at
real DynamoDB tables, content routes (Roundtables, Posts, etc.) return empty rather than
erroring, so the site will run but show no content locally unless those are set.

The one exception is survey responses: they always write to a local JSON file
(`private/backend/survey.db` in dev, `/tmp` in Lambda) in parallel with DynamoDB, so
that flow works out of the box.

```bash
npm test
```

Runs the Jest/Supertest suite — see `docs/ARCHITECTURE.md`'s Testing note in
`.claude/CLAUDE.md`: the existing test file predates the DynamoDB-only backend and needs
updating before it's a trustworthy regression check.

## Deploying

Push-triggered GitHub Actions handle deploys — `main` → production,
`stage` → staging. See `docs/ARCHITECTURE.md` for exactly what each deploy does
(frontend sync + CloudFront invalidation, Lambda packaging, env var reconciliation, IAM
policy setup).

## Repo flow

- All changes on feature/working branches — no direct commits to `stage` or `main`
- Manual merge only: feature branch → `stage` (test) → `main` (production)
- No automated or agent-initiated merges into either branch

Full conventions (branch naming, commit style, pre-merge checklist) in
`.claude/CLAUDE.md`.

## Status

**Built**: public site content areas (Homepage, About, Roundtables/Initiatives,
Education, Investments, Events, Press/Updates), admin dashboard CRUD for all of the
above, staff invite/login/password-reset flow, production + staging environments,
Sentry/Plausible/PostHog integration.

**In progress**: Admin/Chair/Member role differentiation (currently every logged-in
user is treated as a flat admin) and the Member-facing area. See `docs/DATA-MODEL.md`'s
Role & Permission Model section for the design, and its Decisions & Open Questions
section for what's still unresolved (Chair scoping on Investments, the empty-Roundtable
member news default, Users-table scale).

**Known gaps**: `.env.example` doesn't list every env var the app actually reads (see
Local development above) — needs updating alongside the role work. `server.test.js`
predates the current backend and needs a rewrite.