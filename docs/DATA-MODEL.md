# Data Model & API

DynamoDB, table-per-entity (not a single-table design) — each table is a `Repository`
instance (see `db/repository.js`) with scan-based reads. Table names come from env vars
(`AWS_<THING>_TABLE`, set per environment). Entity-specific create/update logic lives in
`db/content.js` and `db/users.js`.

## Tables (as currently implemented)

### Roundtables
`AWS_ROUNDTABLES_TABLE` — slug derived from `name`, no suffix, re-slugs on update.

| field | type | notes |
|---|---|---|
| `id` | string | |
| `slug` | string | derived from `name` |
| `name` | string | |
| `description` | string | |
| `imageUrl` | string \| null | |
| `createdAt` | ISO string | |

### Initiatives
`AWS_INITIATIVES_TABLE` — slug derived from `title`, no suffix, re-slugs on update.
Many-to-many with Roundtables via `roundtableIds`.

| field | type | notes |
|---|---|---|
| `id` | string | |
| `slug` | string | derived from `title` |
| `title` | string | |
| `description` | string | |
| `roundtableIds` | string[] | which roundtable(s) this initiative belongs to |
| `imageUrl` | string \| null | |
| `createdAt` | ISO string | |

### Posts
`AWS_POSTS_TABLE` — unified table for blog posts, initiative updates, education
content, announcements, and book promo, differentiated by `type`. Slug derived from
`title`, unique-suffixed, **does not** re-slug on update (permalinks stay stable).

| field | type | notes |
|---|---|---|
| `id` | string | |
| `slug` | string | suffixed, stable across edits |
| `title` | string | |
| `body` | string | |
| `type` | `blog` \| `update` \| `education` \| `announcement` \| `book` | `POST_TYPES` in `content.js` |
| `initiativeId` | string \| null | only set when `type === 'update'` |
| `author` | string \| null | |
| `publishedAt` | ISO string | |
| `memberOnly` | boolean | only `education` posts can set `true`; every other type is forced `false` |
| `excerpt` | string \| null | |
| `imageUrl` | string \| null | |
| `purchaseUrl` | string \| null | `book` type only |
| `price` | string \| null | `book` type only |

A Roundtable's feed = `update`-type Posts whose `initiativeId` belongs to that
Roundtable's Initiatives (`listPostsForRoundtable`).

### Press
`AWS_PRESS_TABLE` — always public; `memberOnly` is hardcoded `false` on every write so
`shared/access.js` never needs a type-specific branch.

| field | type | notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `source` | string | |
| `publishedDate` | ISO string | |
| `externalUrl` | string | |
| `excerpt` | string \| null | |
| `memberOnly` | boolean | always `false` |
| `createdAt` | ISO string | |

### Investments
`AWS_INVESTMENTS_TABLE` — v1 is display/portfolio only, not a funding mechanism. Slug
derived from `title`, suffixed.

| field | type | notes |
|---|---|---|
| `id` | string | |
| `slug` | string | |
| `title` | string | |
| `initiativeId` | string \| null | |
| `roundtableIds` | string[] | |
| `status` | `open` \| `completed` | |
| `description` | string | |
| `outcomeSummary` | string \| null | |
| `imageUrl` | string \| null | |
| `memberOnly` | boolean | binary hide (not preview+paywall like Posts) |
| `createdAt` | ISO string | |

### Events
`AWS_EVENTS_TABLE` — calendar listing, no RSVP/capacity in v1. Slug derived from
`title`, suffixed.

| field | type | notes |
|---|---|---|
| `id` | string | |
| `slug` | string | |
| `title` | string | |
| `startsAt` | ISO string | |
| `endsAt` | ISO string \| null | |
| `location` | string \| null | |
| `virtualLink` | string \| null | |
| `description` | string | |
| `memberOnly` | boolean | |
| `isConference` | boolean | flags the flagship Conference series |
| `imageUrl` | string \| null | |
| `createdAt` | ISO string | |

### Images
`AWS_IMAGES_TABLE` — reusable upload library so admins can browse/reuse past uploads.

| field | type | notes |
|---|---|---|
| `id` | string | |
| `url` | string | |
| `filename` | string \| null | |
| `contentType` | string \| null | |
| `size` | number \| null | |
| `uploadedAt` | ISO string | |

### Users
`AWS_USERS_TABLE` — currently PIN staff/admin accounts only (invite-based, email is the
login identity). Invite and reset tokens: high-entropy random hex, emailed raw, only
the SHA-256 hash stored. Reads are scan-all today (`db/users.js`'s own comment notes
this holds because it's "a small table"); with Members expected to reach the thousands,
an email-lookup GSI should be added as part of the role rollout rather than deferred —
`findUserByEmail`/`acceptInvite`/password-reset all currently scan-and-filter by email,
which is the specific query pattern the GSI would replace.

| field | type | notes |
|---|---|---|
| `id` | string | |
| `email` | string | login identity |
| `firstName` / `lastName` | string \| null | set on invite acceptance, not at invite time |
| `phone` / `address` | string \| null | |
| `passwordHash` | string | set on invite acceptance |
| `status` | `pending` \| `active` | |
| `inviteTokenHash` / `inviteTokenExpiresAt` | string \| null | cleared on acceptance |
| `resetTokenHash` / `resetTokenExpiresAt` | string \| null | |
| `createdAt` / `updatedAt` | ISO string | |

### Sessions
`AWS_SESSIONS_TABLE` — `express-session` store backed by DynamoDB (`db/sessions.js`),
not the app's own session logic. Necessary because Lambda can route concurrent
requests to different execution environments, each with separate process memory — the
default in-memory session store would bounce an already-logged-in admin back to
`/login`. Expires via DynamoDB TTL on `expiresAt`.

| field | type | notes |
|---|---|---|
| `id` | string | session ID (cookie value) |
| `data` | string | JSON-serialized session object |
| `expiresAt` | number | unix seconds, TTL attribute |

## API Endpoints (as currently implemented)

All `/api/admin/*` and `/admin` routes are gated by `requireAdmin` — currently a flat
check (`req.session.loggedIn`), not role-aware.

| Resource | Public | Admin (requireAdmin) |
|---|---|---|
| Roundtables | `GET /api/roundtables`, `GET /api/roundtables/:slug` | `POST/PUT/DELETE /api/admin/roundtables[/:id]` |
| Initiatives | `GET /api/initiatives/:slug` | `GET/POST/PUT/DELETE /api/admin/initiatives[/:id]` |
| Posts | `GET /api/posts[/:slug]`, `GET /api/education[/:slug]`, `GET /api/book`, `GET /api/updates[/:slug]` | `GET/POST/PUT/DELETE /api/admin/posts[/:id]` |
| Press | `GET /api/press` | `GET/POST/PUT/DELETE /api/admin/press[/:id]` |
| Investments | `GET /api/investments[/:slug]` | `GET/POST/PUT/DELETE /api/admin/investments[/:id]` |
| Events | `GET /api/events[/:slug]` | `GET/POST/PUT/DELETE /api/admin/events[/:id]` |
| Images | — | `POST /api/admin/uploads`, `GET /api/admin/images`, `GET /api/admin/stock-images` |
| Users | `POST /api/accept-invite`, `POST /api/forgot-password`, `POST /api/reset-password` | `GET /api/admin/users`, `POST /api/admin/users/invite`, `DELETE /api/admin/users/:id` |
| Auth | `GET/POST /login`, `GET /logout` | `GET /admin` (dashboard page) |

## Role & Permission Model — in progress

**Goal** (per Elise, current spec): three roles on the same Users table.
- **Admin**: full access to everything and everyone; sends invites (chair or member type).
- **Chair**: assigned to one Roundtable; manages (view/invite/edit/remove) Members under
  that Roundtable, and edits that Roundtable's own Initiatives and Posts.
- **Member**: belongs to zero, one, or several Roundtables; logs into a dedicated
  member area (profile, education content, events calendar, member news) rather than
  the admin dashboard.

**Proposed schema change** — add to the Users item:

| field | type | notes |
|---|---|---|
| `role` | `admin` \| `chair` \| `member` | new |
| `roundtableId` | string \| null | set for `chair` only (their one assigned roundtable); always `null` for `admin`/`member` |
| `roundtableIds` | string[] | set for `member` only — zero, one, or many roundtables; always empty for `admin`/`chair` |

Two separate fields rather than reusing one, since Chair is deliberately singular
(assigned to exactly one Roundtable) while Member is deliberately variable (can belong
to several or none) — collapsing them into one shape would blur that distinction and
make scoping checks branch on role anyway.

`createInvite` extends to accept `role` and `roundtableId`/`roundtableIds`, carried onto
the invite item so `acceptInvite` sets them on the resulting user record without the
invitee choosing their own role.

**Proposed auth change** — `shared/auth.js` gets role-aware middleware alongside
`requireAdmin`, not replacing it:
- `requireRole('admin')` — Admin-only actions (inviting Chairs, full user list)
- `requireRole('admin', 'chair')` — actions a Chair can also do, but scoped
- A scoping helper (e.g. `scopeToRoundtable(req, users)`) that Chair-accessible routes
  call to filter results/writes to `user.roundtableId === req.session.roundtableId`

**Proposed endpoint changes:**
- `POST /api/admin/users/invite` — body gains `role` + `roundtableId` (chair) or
  `roundtableIds` (member, can be `[]`). Server validates the requester can issue that
  role: Admin can invite `chair` (any roundtable) or `member` (any roundtables or none);
  Chair can only invite `member`, and the invite is forced to include the Chair's own
  `roundtableId` in the new member's `roundtableIds` regardless of what's submitted.
- `GET /api/admin/users` — Admin sees all; Chair sees only Members whose `roundtableIds`
  array contains the Chair's own `roundtableId` (array-contains, not equality, since a
  Member can belong to several Roundtables).
- `DELETE /api/admin/users/:id` (and a new edit endpoint, since Chairs need to manage,
  not just remove) — same array-contains scoping: a Chair can only act on a Member whose
  `roundtableIds` includes the Chair's Roundtable, 403 otherwise. Editing (not just
  viewing) a Member's `roundtableIds` should let a Chair add/remove *their own*
  Roundtable from the list, not touch other Roundtables the Member also belongs to.
- New: `PATCH /api/users/me` — any logged-in user (any role) edits their own profile
  fields (`firstName`, `lastName`, `phone`, `address`), replacing the implicit
  admin-only assumption in the current Users routes.
- **Chair content permissions on their own Roundtable:** `requireRole('admin',
  'chair')`-gated write access to that Roundtable's Initiatives, Posts, **and
  Investments**, scoped the same way as Users:
  - Initiatives and Investments already carry `roundtableIds` — scoping is a direct
    array-contains check against the Chair's `roundtableId`.
  - Posts don't carry a Roundtable reference directly (only `initiativeId`) — scoping a
    Chair's write to a Post requires resolving `post.initiativeId` → that Initiative's
    `roundtableIds` → contains the Chair's `roundtableId`, mirroring the existing
    `listPostsForRoundtable` join logic rather than adding a redundant field to Posts.
- **New — Member-facing area** (`front-end/member/` or similar, distinct from
  `front-end/` public pages and `private/backend/admin/`):
  - Profile: reuses `PATCH /api/users/me` above
  - Education: `GET /api/education[/:slug]` already exists — once `shared/access.js`'s
    `canSeeFull` is wired to check `req.session.role` (any logged-in role, not just
    `member`, should see full `memberOnly` content), Members get the full body instead
    of the redacted preview automatically, no new endpoint needed
  - Calendar: `GET /api/events` already exists and isn't Roundtable-scoped in the
    current schema, so this is just the existing public events list, no new endpoint
  - Member news: reuses `update`-type Posts via `listPostsForRoundtable`, filtered to
    the Roundtables in the Member's `roundtableIds` — a Member with an empty
    `roundtableIds` sees `announcement`-type Posts only (general PIN news), not a
    blank feed

## Decisions & Open Questions

Per the Docs Sync rule in `CLAUDE.md` — resolved decisions are recorded here rather than
only living in chat history, and remaining questions are flagged rather than guessed at.

**Resolved:**
- A Member can belong to multiple Roundtables, or none — hence `roundtableIds: string[]`
  on Users rather than a singular field (a Chair stays singular: `roundtableId`).
- Members land in a dedicated member-only area on login (profile, education, events
  calendar, member news) — not the existing `/admin` dashboard.
- A Chair also gets content-editing permissions for their own Roundtable's Initiatives
  and Posts, not just Member management.
- Chair content-editing extends to Investments too, same `roundtableIds` array-contains
  scoping as Initiatives.
- A Member with an empty `roundtableIds` sees `announcement`-type Posts only in their
  member news feed — no Roundtable-specific updates, not a blank feed.
- Member volume is expected to reach the thousands, so the Users table gets an
  email-lookup GSI as part of the role rollout rather than deferred until scan-all
  becomes a problem in practice.

No open questions remain on this design — implementation can proceed.
