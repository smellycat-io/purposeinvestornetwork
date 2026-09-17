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

## API Endpoints

Every route under `/api/admin/*` and the `/admin` page is gated by `requireAdmin` (a
flat `req.session.loggedIn` check, no role distinction) except the Users endpoints,
which use the role-aware `requireRole` middleware — see Role & Permission Model below
for exactly which roles reach which Users endpoint and how Chair access is scoped.
Roundtables, Initiatives, Posts, Press, Investments, Events, and Images are not yet
migrated to role-aware access; every session that reaches them is treated as equally
privileged.

| Resource | Public | Admin / role-gated |
|---|---|---|
| Roundtables | `GET /api/roundtables`, `GET /api/roundtables/:slug` | `POST/PUT/DELETE /api/admin/roundtables[/:id]` (requireAdmin) |
| Initiatives | `GET /api/initiatives/:slug` | `GET/POST/PUT/DELETE /api/admin/initiatives[/:id]` (requireAdmin) |
| Posts | `GET /api/posts[/:slug]`, `GET /api/education[/:slug]`, `GET /api/book`, `GET /api/updates[/:slug]` | `GET/POST/PUT/DELETE /api/admin/posts[/:id]` (requireAdmin) |
| Press | `GET /api/press` | `GET/POST/PUT/DELETE /api/admin/press[/:id]` (requireAdmin) |
| Investments | `GET /api/investments[/:slug]` | `GET/POST/PUT/DELETE /api/admin/investments[/:id]` (requireAdmin) |
| Events | `GET /api/events[/:slug]` | `GET/POST/PUT/DELETE /api/admin/events[/:id]` (requireAdmin) |
| Images | — | `POST /api/admin/uploads`, `GET /api/admin/images`, `GET /api/admin/stock-images` (requireAdmin) |
| Users | `POST /api/accept-invite`, `POST /api/forgot-password`, `POST /api/reset-password` | `GET/PATCH/DELETE /api/admin/users[/:id]`, `POST /api/admin/users/invite` — Admin or Chair, scoped per Role & Permission Model below; `PATCH /api/users/me` — any logged-in role |
| Auth | `GET/POST /login`, `GET /logout` | `GET /admin` (dashboard page, requireAdmin) |

## Role & Permission Model

Three roles share the Users table (see the Users table above for exact field shapes and
defaulting rules):
- **Admin** — full access to everything and everyone; can invite a Chair or a Member.
- **Chair** — assigned to exactly one Roundtable (`roundtableId`); manages Members
  under that Roundtable (view, invite, edit that Member's membership in their own
  Roundtable, remove from their own Roundtable).
- **Member** — belongs to zero, one, or several Roundtables (`roundtableIds`, an array
  since a Member can belong to more than one, unlike a Chair's singular
  `roundtableId`).

**Session claims.** `routes/auth.js`'s login handler sets `req.session.role` and
`req.session.roundtableId` from the logged-in user's record, alongside the existing
`req.session.loggedIn`/`userId`. Accounts created before roles existed have no `role`
field, so a missing `role` defaults to `admin` both here and in `createInvite` —
existing PIN staff keep working without a migration step. The bootstrap
`ADMIN_USER`/`ADMIN_PASS` env-var login path (no Users-table record at all) is also
always treated as `admin`. Login always redirects to `/admin` regardless of role; there
is no role-based redirect or role-aware UI in the admin dashboard today (see "Not yet
implemented" below).

**Auth middleware (`shared/auth.js`).** Role-aware middleware sits alongside
`requireAdmin`, not in place of it — most routes still use `requireAdmin` (see API
Endpoints above):
- `requireRole(...roles)` — checks `req.session.role` is one of the listed roles.
  Unlike `requireAdmin` (which always redirects, even for `/api/*` callers),
  `requireRole` returns JSON 401 (not logged in) or 403 (wrong role) for `/api/*`
  routes and redirects to `/login` for page routes, since a role-gated `fetch()` call
  needs a real error to branch on.
- `roundtableArrayContains(roundtableIds, chairRoundtableId)` — Chair-to-Member
  array-contains check (a Member's `roundtableIds` can include several Roundtables; a
  Chair matches if their one Roundtable is among them). Used by the Users routes below.
- `matchesRoundtable(chairRoundtableId, targetRoundtableId)` — Chair-to-single-item
  equality check, for scoping a Chair's write access to one Roundtable's own content.
  Implemented and unit-tested but not yet called from any route — see "Not yet
  implemented" below.

**Invites (`POST /api/admin/users/invite`, `requireRole('admin', 'chair')`).** An Admin
can invite a Chair (any `roundtableId`) or a Member (any `roundtableIds`, including
none) — not another Admin; there's no path for that. A Chair can only invite a Member,
and only onto their own Roundtable: the request body's `role`/`roundtableId`/
`roundtableIds` are ignored once the requester is a Chair, rather than trusted, since
this is a permission boundary rather than a client-side convenience. `createInvite`
(`db/users.js`) re-derives `roundtableId`/`roundtableIds` from `role` regardless of
what a caller passes, so a Chair's `roundtableId` is always `null` and a Member's
`roundtableIds` is always `[]` for any role but `member`, even if a future caller
forgets to enforce that itself.

**Listing Users (`GET /api/admin/users`, `requireRole('admin', 'chair')`).** Admin sees
every user. A Chair sees only `role: 'member'` users whose `roundtableIds` contains the
Chair's own `roundtableId` (`roundtableArrayContains`). Filtering happens in the route
handler, not `listUsers()`, keeping `db/users.js` role-agnostic — the same split
`shared/access.js` uses to keep `memberOnly` visibility filtering out of the db layer.

**Editing a user (`PATCH /api/admin/users/:id`, `requireRole('admin', 'chair')`).** An
Admin can change any of `updateUser`'s fields (`firstName`, `lastName`, `phone`,
`address`, `role`, `roundtableId`, `roundtableIds`) on any user; changing `role`
re-derives `roundtableId`/`roundtableIds` the same way `createInvite` does, so an edit
can't leave a stale `roundtableId` on a user who's no longer a Chair. A Chair may act
only on a Member under their own Roundtable (403 otherwise, via
`roundtableArrayContains`) and may submit only `roundtableIds` in the body — any other
key, or a `roundtableIds` change that adds or removes a Roundtable other than the
Chair's own, is rejected with 400 rather than silently dropped, since a partial silent
failure on a permission boundary would let a client believe an edit fully succeeded
when it didn't.

**Removing a user (`DELETE /api/admin/users/:id`, `requireRole('admin', 'chair')`).**
For an Admin, this deletes the account outright. For a Chair, "removing" a Member means
dropping the Chair's own Roundtable from that Member's `roundtableIds` — never deleting
the account — even if it's the Member's only Roundtable. A Member can belong to several
Roundtables, and a Chair has no authority over any but their own; full account deletion
stays an Admin-only action via this same endpoint.

**Self-service profile (`PATCH /api/users/me`, `requireRole('admin', 'chair',
'member')`).** Any logged-in user edits their own `firstName`/`lastName`/`phone`/
`address`. `role`/`roundtableId`/`roundtableIds` are silently ignored if present in the
body — no legitimate self-edit would ever include them, so there's no permission
boundary worth surfacing an error for (unlike the Chair-on-Member PATCH above, where a
disallowed field is rejected outright). The target is always `req.session.userId`,
never a body/param-supplied id, so this endpoint can never edit anyone else's record.

**Not yet implemented:**
- Chair write access to their own Roundtable's Initiatives, Posts, and Investments —
  Initiatives, Posts, and Investments all still use flat `requireAdmin` (see API
  Endpoints above). Initiatives and Investments already carry `roundtableIds`, so
  scoping would be a direct array-contains/`matchesRoundtable` check against the
  Chair's `roundtableId`; Posts don't carry a Roundtable reference directly (only
  `initiativeId`), so scoping a Chair's write to a Post would mean resolving
  `post.initiativeId` → that Initiative's `roundtableIds` → contains the Chair's
  `roundtableId`, mirroring the existing `listPostsForRoundtable` join logic rather
  than adding a redundant field to Posts.
- A Member-facing area (e.g. `front-end/member/`, distinct from the public `front-end/`
  pages and the admin dashboard in `private/backend/admin/`): profile (would reuse
  `PATCH /api/users/me` above), education content, an events calendar, and a member
  news feed (`update`-type Posts via `listPostsForRoundtable`, filtered to a Member's
  `roundtableIds`; a Member with an empty `roundtableIds` would see `announcement`-type
  Posts only, not a blank feed). Today every logged-in session lands on the same
  `/admin` dashboard regardless of role.
- Role-aware member-content visibility: `shared/access.js`'s `canSeeFull` still always
  returns `false`, so on the public `GET /api/education[/:slug]`, `GET
  /api/investments[/:slug]`, and `GET /api/events[/:slug]` endpoints, no visitor —
  including a logged-in Member — currently sees full `memberOnly` content; every viewer
  gets the same redacted preview or hidden item a logged-out visitor would. (The admin
  dashboard's own CRUD endpoints don't route through `access.js` and are unaffected.)
