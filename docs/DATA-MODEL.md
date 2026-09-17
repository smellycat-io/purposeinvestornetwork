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
`AWS_USERS_TABLE` — Admin, Chair, and Member accounts (invite-based, email is the login
identity). Invite and reset tokens: high-entropy random hex, emailed raw, only the
SHA-256 hash stored. `findUserByEmail` queries the `email-index` GSI (hash key `email`)
rather than scanning — Member volume is expected to reach the thousands. **The GSI
itself is an infra prerequisite, not something this schema change provisions** — see
`docs/ARCHITECTURE.md`'s Users-table GSI note for the exact command; it must exist on a
table before code that queries it is deployed against that table. Every other lookup
here (invite/reset token matching, in `listAllRaw`) stays scan-and-filter — tokens
aren't a queryable key, and invite/reset volume stays low regardless of Member count.

| field | type | notes |
|---|---|---|
| `id` | string | |
| `email` | string | login identity, always stored lowercase (so the GSI query is a plain equality match) |
| `role` | `admin` \| `chair` \| `member` | defaults to `admin` when omitted — every account created before roles existed has no `role` field, and `routes/auth.js`'s login handler falls back to `'admin'` for exactly that reason |
| `roundtableId` | string \| null | set for `chair` only (their one assigned roundtable); always `null` for `admin`/`member`, enforced in `createInvite` regardless of what's passed in |
| `roundtableIds` | string[] | set for `member` only; always `[]` for `admin`/`chair`, same enforcement |
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

All `/api/admin/*` and `/admin` routes are gated by `requireAdmin` (a flat
`req.session.loggedIn` check) except the Users routes below, which are role-aware
(`requireRole`, scoped per Role & Permission Model above) as of Stage 1/2. Everything
else stays on `requireAdmin` until deliberately migrated in Stage 3.

| Resource | Public | Admin (requireAdmin) |
|---|---|---|
| Roundtables | `GET /api/roundtables`, `GET /api/roundtables/:slug` | `POST/PUT/DELETE /api/admin/roundtables[/:id]` |
| Initiatives | `GET /api/initiatives/:slug` | `GET/POST/PUT/DELETE /api/admin/initiatives[/:id]` |
| Posts | `GET /api/posts[/:slug]`, `GET /api/education[/:slug]`, `GET /api/book`, `GET /api/updates[/:slug]` | `GET/POST/PUT/DELETE /api/admin/posts[/:id]` |
| Press | `GET /api/press` | `GET/POST/PUT/DELETE /api/admin/press[/:id]` |
| Investments | `GET /api/investments[/:slug]` | `GET/POST/PUT/DELETE /api/admin/investments[/:id]` |
| Events | `GET /api/events[/:slug]` | `GET/POST/PUT/DELETE /api/admin/events[/:id]` |
| Images | — | `POST /api/admin/uploads`, `GET /api/admin/images`, `GET /api/admin/stock-images` |
| Users | `POST /api/accept-invite`, `POST /api/forgot-password`, `POST /api/reset-password`, `PATCH /api/users/me` (any logged-in role, not admin-only — see above) | `GET/POST /api/admin/users[/invite]`, `PATCH/DELETE /api/admin/users/:id` (all Chair-scoped per Role & Permission Model) |
| Auth | `GET/POST /login`, `GET /logout` | `GET /admin` (dashboard page) |

## Role & Permission Model — Stage 1 & 2 shipped, content-scoping in progress

**Goal** (per Elise, current spec): three roles on the same Users table.
- **Admin**: full access to everything and everyone; sends invites (chair or member type).
- **Chair**: assigned to one Roundtable; manages (view/invite/edit/remove) Members under
  that Roundtable, and edits that Roundtable's own Initiatives and Posts.
- **Member**: belongs to zero, one, or several Roundtables; logs into a dedicated
  member area (profile, education content, events calendar, member news) rather than
  the admin dashboard.

**Stage 1 — schema + auth foundation (shipped):**
- Users item gains `role` / `roundtableId` / `roundtableIds` — see the Users table
  above for the exact shape and defaulting rules.
- `createInvite(email, { role, roundtableId, roundtableIds })` carries those fields
  onto the pending-invite item so `acceptInvite` sets them on the resulting user record
  unchanged — the invitee never chooses their own role.
- `shared/auth.js` gets role-aware middleware and scoping helpers alongside
  `requireAdmin`, not replacing it (other routes keep using `requireAdmin` until
  deliberately migrated in Stage 2/3):
  - `requireRole(...roles)` — checks `req.session.role`; unlike `requireAdmin` (which
    always redirects, even for `/api/*` callers), this returns JSON 401/403 for `/api/*`
    routes and redirects to `/login` for page routes, since a role-gated `fetch()` call
    needs a real error to branch on.
  - `matchesRoundtable(chairRoundtableId, targetRoundtableId)` — Chair-to-single-item
    equality check (Initiatives/Posts/Investments scoping, Stage 2/3).
  - `roundtableArrayContains(roundtableIds, chairRoundtableId)` — Chair-to-Member
    array-contains check (Stage 2/3's Chair-scoped member list/management).
- Login (`routes/auth.js`) sets `req.session.role` and `req.session.roundtableId`
  alongside the existing `req.session.loggedIn`/`userId`.
- `POST /api/admin/users/invite` is role-aware (`requireRole('admin', 'chair')`, not
  `requireAdmin`) — see the API Endpoints table's Users row and the endpoint bullet
  below, which is now current-state rather than proposed.

**Stage 2 — Chair-scoped Users management + self-service profile (shipped):**
- `db/users.js` gains `updateUser(id, fields)` — a restricted whitelist
  (`firstName`/`lastName`/`phone`/`address`/`role`/`roundtableId`/`roundtableIds`),
  re-applying the same admin/chair/member invariant `createInvite` enforces whenever
  `role` is part of the update. Returns the same safe public shape `listUsers()` does
  (never `passwordHash` or a token field) — both now share one `toPublicUser` mapper.
- `GET /api/admin/users` — `requireRole('admin', 'chair')`. Admin sees everyone; a
  Chair sees only users with `role: 'member'` whose `roundtableIds` contains the
  Chair's own `roundtableId` (`roundtableArrayContains`, from `shared/auth.js`).
  Filtering happens in the route handler, not `listUsers()` itself — keeps `db/users.js`
  role-agnostic, matching how `shared/access.js` keeps visibility filtering out of the
  db layer.
- `PATCH /api/admin/users/:id` (new) — `requireRole('admin', 'chair')`. Admin can
  change any of `updateUser`'s fields. A Chair may act only on a target whose `role` is
  `member` and whose `roundtableIds` already contains the Chair's own `roundtableId`
  (403 otherwise), and may submit only `roundtableIds` — any other key in the body is
  rejected (400), not silently dropped, since a partial silent success on a permission
  boundary is worse than an explicit error. Within that, a Chair may add/remove only
  *their own* Roundtable — changing any other Roundtable's membership on that user is
  also rejected (400).
- `DELETE /api/admin/users/:id` — same `requireRole`/scoping as the edit endpoint.
  **Decision**: for a Chair, "remove" means removing the Member from the Chair's own
  Roundtable (an edit to `roundtableIds`), never deleting the account outright — even
  when it's the Member's only Roundtable. A Member can belong to several Roundtables,
  and a Chair has no authority over that Member's standing with any Roundtable but
  their own; full account deletion stays Admin-only, via the same endpoint. This wasn't
  spelled out explicitly above, so it's recorded as a decision here rather than left
  implicit in the code.
- `PATCH /api/users/me` (new) — `requireRole('admin', 'chair', 'member')`, any logged-in
  user edits their own `firstName`/`lastName`/`phone`/`address`. `role`/`roundtableId`/
  `roundtableIds` are silently ignored if present rather than rejected (there's no
  legitimate reason a self-edit would ever include them, unlike the Chair-boundary
  cases above where an out-of-scope field signals an actual permission violation worth
  surfacing). Always targets `req.session.userId`, never a body/param id.

**Still proposed (Stage 3/5 — content + Member-facing area, not yet built):**
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
