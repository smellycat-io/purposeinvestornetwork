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
the SHA-256 hash stored.

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

`db/users.js`'s `listUsers()` deliberately never returns `passwordHash` — any new
user-list endpoint (e.g. a Chair's scoped member list) should read through that
function rather than scanning the table directly, so this stays true by construction
instead of by remembering to strip it at each call site.

> **Known data artifact**: the original admin account (migrated from the old
> single-admin `ADMIN_USER`/`ADMIN_PASS` bootstrap scheme) still carries a leftover
> `username` field on its row from before email became the login identity. It's inert —
> nothing reads it — and no current code path writes a `username` field, so it won't
> appear on any other row. Not worth a migration on its own; worth cleaning up if that
> row is ever touched for another reason.

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
| Events | `GET /api/events[/:slug]` (`?conference=true` filters to the flagship series) | `GET/POST/PUT/DELETE /api/admin/events[/:id]` |
| Images | — | `POST /api/admin/uploads`, `GET /api/admin/images`, `GET /api/admin/stock-images` |
| Users | `POST /api/accept-invite`, `POST /api/forgot-password`, `POST /api/reset-password` | `GET /api/admin/users`, `POST /api/admin/users/invite`, `DELETE /api/admin/users/:id` |
| Auth | `GET/POST /login`, `GET /logout` | `GET /admin` (dashboard page) |

## Role & Permission Model — in progress

**Goal** (per Elise, current spec): three roles on the same Users table.
- **Admin**: full access to everything and everyone; sends invites (chair or member type).
- **Chair**: assigned to one Roundtable; manages (view/invite/edit/remove) Members under
  that Roundtable only.
- **Member**: logs in only to view educational material and edit their own profile.

**Proposed schema change** — add to the Users item:

| field | type | notes |
|---|---|---|
| `role` | `admin` \| `chair` \| `member` | new |
| `roundtableId` | string \| null | set for `chair` (their assigned roundtable) and `member` (see Open Questions — may need to be `roundtableIds: string[]` instead) |

`createInvite` extends to accept `role` and `roundtableId`, carried onto the invite item
so `acceptInvite` sets them on the resulting user record without the invitee choosing
their own role.

**Proposed auth change** — `shared/auth.js` gets role-aware middleware alongside
`requireAdmin`, not replacing it:
- `requireRole('admin')` — Admin-only actions (inviting Chairs, full user list)
- `requireRole('admin', 'chair')` — actions a Chair can also do, but scoped
- A scoping helper (e.g. `scopeToRoundtable(req, users)`) that Chair-accessible routes
  call to filter results/writes to `user.roundtableId === req.session.roundtableId`

**Proposed endpoint changes:**
- `POST /api/admin/users/invite` — body gains `role` + `roundtableId`. Server validates
  the requester can issue that role: Admin can invite `chair` (any roundtable) or
  `member`; Chair can only invite `member`, `roundtableId` forced to the Chair's own,
  ignoring any value they send.
- `GET /api/admin/users` — Admin sees all; Chair sees only users with matching
  `roundtableId`.
- `DELETE /api/admin/users/:id` (and a new edit endpoint, since Chairs need to manage,
  not just remove) — same scoping: Chair can only act on users under their own
  Roundtable, 403 otherwise.
- New: `PATCH /api/users/me` (or similar) — any logged-in user edits their own profile
  fields (`firstName`, `lastName`, `phone`, `address`), replacing the implicit
  admin-only assumption in the current Users routes.
- New: a Member-facing landing route distinct from `/admin` — see Open Questions.

## Open Questions

Per the Docs Sync rule in `CLAUDE.md` — these are decisions, not implementation
details, and shouldn't get guessed at mid-build:

1. **Can a Member belong to more than one Roundtable?** If yes, `roundtableId` on Users
   needs to be `roundtableIds: string[]` (matching the Initiatives/Investments pattern
   already used elsewhere), and Chair-scoping becomes an array-contains check instead of
   equality.
2. **Does Users staying a single scan-all table hold at Member scale?** `db/users.js`'s
   own comment states scan-all works because it's "a small table (a handful of PIN
   staff)." Members are the site's actual constituent base and could be a couple orders
   of magnitude larger. Worth deciding now whether Members share this table (needs an
   email GSI instead of scan-all once volume grows) or get their own table.
3. **Where does a Member land after login?** The current `/admin` dashboard and its
   `admin.html`/`admin.js` are built entirely for staff CRUD. A Member logging in needs
   a different landing experience (educational content + their own profile), which
   doesn't exist yet as a front-end area — separate route/page, not just a permission
   check on the existing dashboard.
4. **Does a Chair get any content permissions** (editing their Roundtable's Initiatives
   or Posts), or is Chair strictly people-management as specced? Current spec says
   "manage members" — nothing about content — but worth confirming before scoping
   `requireRole('chair')` only onto the Users routes.
