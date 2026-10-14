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
- **Member area** (`private/backend/member/`) — a coming-soon page today; see
  `docs/DATA-MODEL.md`'s Role & Permission Model for what's still to come.

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
values first. Without the `AWS_<THING>_TABLE` vars (see `docs/DATA-MODEL.md`) pointing at
real DynamoDB tables, content routes (Roundtables, Posts, etc.) return empty rather than
erroring, so the site will run but show no content locally unless those are set.

The one exception is survey responses: they always write to a local JSON file
(`private/backend/survey.db` in dev, `/tmp` in Lambda) in parallel with DynamoDB, so
that flow works out of the box.

```bash
npm test
```

Runs the Jest/Supertest suite — see `.claude/CLAUDE.md`'s Testing section for what to
prioritize when adding to it.

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
above, production + staging environments, Sentry/Plausible/PostHog integration.
Admin/Chair/Member role differentiation: role-aware invites (with resend and an
Admin-triggered password reset), Chair-scoped Member management, Chair write and read
access to their own Roundtable's Initiatives/Posts/Investments, Chair access to their
own Roundtable's own fields and the shared image library, and role-aware gating on
every content route (Roundtables, Press, Events, Images included) and the admin
dashboard page itself. A `/member` coming-soon page, with each role landing on its own
home after login (Member → `/member`, Chair and Admin → `/admin`). Campaigns: durable
results storage for the survey, newsletter, and membership waitlist, plus an always-on
interest form on every Roundtable and Initiative page, with per-campaign results emails
and copy-paste email lists in the admin dashboard. See `docs/DATA-MODEL.md`'s Role &
Permission Model section for exactly how each role is scoped.

**In progress**: the Member area is a coming-soon shell today — profile editing,
education content, an events calendar, and a member news feed are still to come. The
admin dashboard UI's role-awareness for Chair sessions isn't built yet either (every
Chair session still sees every tab; where the backend now rejects or filters a Chair's
request, they just get a failed-to-load toast, not a tab hidden outright). Role-aware
`memberOnly` content visibility is also still open. See `docs/DATA-MODEL.md`'s "Not yet
implemented" list at the end of the Role & Permission Model section for the full detail
on both.

**Known gaps**: bulk email sending isn't built — Campaigns gives a copy-paste email
list per campaign instead of sending from the dashboard directly.