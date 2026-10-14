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
| `inviteSentAt` | ISO string \| null | set on invite creation; updated on resend (`reissueInvite`) |
| `resetTokenHash` / `resetTokenExpiresAt` | string \| null | |
| `createdAt` / `updatedAt` | ISO string | |

The public shape returned to API callers (`toPublicUser`, in `db/users.js`) is never the
raw item above — `passwordHash` and every token hash are stripped by construction, and
two fields are renamed for clarity: `inviteTokenExpiresAt` becomes `inviteExpiresAt`,
and `inviteSentAt` passes through unchanged. Neither is secret; the admin dashboard uses
them to show invite status (Pending vs. Expired) and when an invite was last sent.

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

### Campaigns
`AWS_CAMPAIGNS_TABLE` — one row per campaign: the three site-wide ones (`survey`,
`waitlist`, `newsletter` — fixed ids, created once) plus one per Roundtable
(`roundtable:<id>`) and Initiative (`initiative:<id>`), created on demand. Deterministic
ids make creation idempotent — `db/campaigns.js`'s `ensureCampaign` is a conditional put
(`attribute_not_exists(id)`) that's a no-op, not an error, when the row already exists,
so every Roundtable/Initiative campaign is backfilled on every `GET
/api/admin/campaigns` call without ever overwriting an Admin's own edits to it.

| field | type | notes |
|---|---|---|
| `id` | string | `survey` \| `waitlist` \| `newsletter` \| `roundtable:<id>` \| `initiative:<id>` |
| `name` | string | the Roundtable's `name` / Initiative's `title` for those two types |
| `type` | `survey` \| `waitlist` \| `newsletter` \| `roundtable-interest` \| `initiative-interest` | |
| `roundtableId` / `initiativeId` | string \| null | set for exactly one type each; null for the three site-wide campaigns |
| `ownerUserId` | string \| null | the Admin/Chair who created it; null for a bootstrap-session creator (no Users-table record) or a backfilled pre-existing Roundtable/Initiative |
| `resultsEmails` | string[] \| null | an explicit Admin override (`PATCH /api/admin/campaigns/:id`); `null` means derived — see Recipient resolution below |
| `notifyOnEntry` | boolean | whether a new entry sends an email at all; defaults `true` for `survey`/`waitlist`/both interest types, `false` for `newsletter` |
| `archived` | boolean | set when the underlying Roundtable/Initiative is deleted; entries are kept |
| `createdAt` / `updatedAt` | ISO string | |

### Campaign entries
`AWS_CAMPAIGN_ENTRIES_TABLE` — composite key (`campaignId` HASH, `email` RANGE), not a
generic `id`, so every entry for a campaign is a native `Query` with no GSI, and a
second submission from the same email upserts the one row instead of creating a
duplicate. `survey` is the one campaign with no rows here at all — see "Survey entries"
below.

| field | type | notes |
|---|---|---|
| `campaignId` | string | partition key — matches a Campaigns row's `id` |
| `email` | string | sort key, always lowercased |
| `name` / `phone` / `address` / `message` | string \| null | which fields apply depends on the campaign type (see the API Endpoints table) |
| `consent` | boolean | OR'd with whatever was already stored on upsert, never overwritten to `false` — this form has no way to revoke consent, only to (re-)affirm it |
| `consentText` | string | the exact wording shown next to the checkbox at the time of this entry, composed by `db/campaigns.js`'s `composeConsentText` (interest campaigns) or recorded directly (`newsletter`/`waitlist`, which have no checkbox — see the Role & Permission Model note below) |
| `surveyResponseId` / `freeMonthEarned` | string \| null / boolean | `waitlist` entries only — see "Free-month linking" below |
| `createdAt` | ISO string | kept from the first submission, never updated |
| `updatedAt` | ISO string | bumped on every submission, including a resubmit |

**Survey entries.** The `survey` campaign's entries are never written to this table —
survey responses still save exactly where they did before Campaigns existed (the legacy
`AWS_DYNAMODB_TABLE`, or the local JSON store when that's unset; see `POST /api/survey`
in `routes/survey-responses.js`, unchanged). `GET /api/admin/campaigns/survey/entries`
reads through an adapter (`db/campaigns.js`'s `listLegacySurveyEntries`) straight from
those same legacy sources instead. Entries already sitting in Lambda's ephemeral `/tmp`
local store were never durable and aren't migrated.

**Free-month linking.** A `waitlist` entry gets `surveyResponseId`/`freeMonthEarned` set
once the same email has a survey response, regardless of which happened first: a
waitlist save checks the legacy survey sources by email (`findLegacySurveyRecordIdByEmail`),
and a survey save checks for a `waitlist` entry by email and updates it in place
(`linkSurveyToWaitlistEntry`). Both are DynamoDB reads now — this replaced an
equivalent local-store-only version that didn't survive a cold start.

## API Endpoints

Every content and Users route under `/api/admin/*`, plus the `/admin` dashboard page,
its static assets, and the `/member` page, uses the role-aware `requireRole`
middleware — see Role & Permission Model below for exactly which roles reach which
endpoint and how Chair access is scoped. `shared/routeRoleGates.test.js` walks the
live Express router and fails the build if any `/api/admin/*`, `/admin`, or `/member`
route is ever added without a `requireRole` call.

| Resource | Public | Admin / role-gated |
|---|---|---|
| Roundtables | `GET /api/roundtables`, `GET /api/roundtables/:slug` | `POST/DELETE /api/admin/roundtables[/:id]` — Admin only; `PUT /api/admin/roundtables/:id` — Admin or Chair, Chair limited to their own Roundtable |
| Initiatives | `GET /api/initiatives/:slug` | `GET/POST/PUT/DELETE /api/admin/initiatives[/:id]` — Admin or Chair, scoped per Role & Permission Model below |
| Posts | `GET /api/posts[/:slug]`, `GET /api/education[/:slug]`, `GET /api/book`, `GET /api/updates[/:slug]` | `GET/POST/PUT/DELETE /api/admin/posts[/:id]` — Admin or Chair, scoped per Role & Permission Model below |
| Press | `GET /api/press` | `GET/POST/PUT/DELETE /api/admin/press[/:id]` — Admin only, no Chair path |
| Investments | `GET /api/investments[/:slug]` | `GET/POST/PUT/DELETE /api/admin/investments[/:id]` — Admin or Chair, scoped per Role & Permission Model below |
| Events | `GET /api/events[/:slug]` | `GET/POST/PUT/DELETE /api/admin/events[/:id]` — Admin only, no Chair path |
| Images | — | `POST /api/admin/uploads`, `GET /api/admin/images`, `GET /api/admin/stock-images` — Admin or Chair, unscoped (shared library, no per-item ownership) |
| Users | `POST /api/accept-invite`, `POST /api/forgot-password`, `POST /api/reset-password` | `GET/PATCH/DELETE /api/admin/users[/:id]`, `POST /api/admin/users/invite`, `POST /api/admin/users/:id/resend-invite` — Admin or Chair, scoped per Role & Permission Model below; `POST /api/admin/users/:id/send-reset` — Admin only; `GET/PATCH /api/users/me` — any logged-in role |
| Campaigns | `POST /api/survey`, `POST /api/subscribe`, `POST /api/roundtables/:slug/interest`, `POST /api/initiatives/:slug/interest` | `GET /api/admin/campaigns`, `GET /api/admin/campaigns/:id/entries` — Admin or Chair, scoped per Role & Permission Model below; `PATCH /api/admin/campaigns/:id` — Admin only |
| Settings | — | `PUT /api/admin/settings/password` — any logged-in role (self-service password change) |
| Auth | `GET/POST /login`, `GET /logout` | `GET /admin` (dashboard page) — Admin or Chair; `GET /member` (member coming-soon page) — any logged-in role, Admin/Chair as a preview |

## Role & Permission Model

Three roles share the Users table (see the Users table above for exact field shapes and
defaulting rules):
- **Admin** — full access to everything and everyone; can invite another Admin, a
  Chair, or a Member.
- **Chair** — assigned to exactly one Roundtable (`roundtableId`); manages Members
  under that Roundtable (view, invite, edit that Member's membership in their own
  Roundtable, remove from their own Roundtable) and has write access to that
  Roundtable's own Initiatives, Posts, and Investments.
- **Member** — belongs to zero, one, or several Roundtables (`roundtableIds`, an array
  since a Member can belong to more than one, unlike a Chair's singular
  `roundtableId`).

**Session claims.** `routes/auth.js`'s login handler sets `req.session.role` and
`req.session.roundtableId` from the logged-in user's record, alongside the existing
`req.session.loggedIn`/`userId`. Accounts created before roles existed have no `role`
field, so a missing `role` defaults to `admin` both here and in `createInvite` —
existing PIN staff keep working without a migration step. The bootstrap
`ADMIN_USER`/`ADMIN_PASS` env-var login path (no Users-table record at all) is also
always treated as `admin`.

**Role homes (`shared/auth.js`'s `roleHome(role)`).** Login redirects to each role's
own home instead of a single shared landing page: a Member goes to `/member`, an Admin
or Chair goes to `/admin`. `GET /login` for an already-logged-in session redirects the
same way, and `requireRole` redirects a logged-in session with the wrong role to its
`roleHome` rather than back to `/login` (which would just bounce it straight back) —
see the `requireRole` bullet below.

**Auth middleware (`shared/auth.js`).** Every admin/content route uses the role-aware
`requireRole`:
- `requireRole(...roles)` — checks `req.session.role` is one of the listed roles, and
  that a session exists at all. For `/api/*` routes, returns JSON 401 (not logged in)
  or 403 (wrong role), since a role-gated `fetch()` call needs a real error to branch
  on. For page routes, no session redirects to `/login`; a session with the wrong role
  redirects to `roleHome(role)` instead.
- `roundtableArrayContains(roundtableIds, chairRoundtableId)` — array-contains check (an
  item's `roundtableIds`, or a Member's, can include several Roundtables; a Chair
  matches if their one Roundtable is among them). Used by the Users routes below and by
  Initiatives/Posts/Investments scoping (both reads and writes).
- `matchesRoundtable(chairRoundtableId, targetRoundtableId)` — Chair-to-single-item
  equality check, for an item with a single `roundtableId` rather than an array. Used
  by `PUT /api/admin/roundtables/:id`, the one content type whose own id *is* the
  single roundtableId being compared against, with no separate item to fetch first.

**Invites (`POST /api/admin/users/invite`, `requireRole('admin', 'chair')`).** An Admin
can invite another Admin (no `roundtableId`/`roundtableIds`), a Chair (any
`roundtableId`), or a Member (any `roundtableIds`, including none). A Chair can only
invite a Member, and only onto their own Roundtable: the request body's
`role`/`roundtableId`/`roundtableIds` are ignored once the requester is a Chair, rather
than trusted, since this is a permission boundary rather than a client-side
convenience. `createInvite`
(`db/users.js`) re-derives `roundtableId`/`roundtableIds` from `role` regardless of
what a caller passes, so a Chair's `roundtableId` is always `null` and a Member's
`roundtableIds` is always `[]` for any role but `member`, even if a future caller
forgets to enforce that itself. The request body may also include a `note` (trimmed,
capped at 500 characters) — it's included in the invite email body via
`sendInviteEmail` (`shared/email.js`) and never persisted anywhere.

**Resending an invite (`POST /api/admin/users/:id/resend-invite`, `requireRole('admin',
'chair')`).** Pending users only (400 for an already-active target, 404 for an unknown
one); same Admin/Chair scoping as every other per-user Users action — a Chair may only
resend a pending Member's invite under their own Roundtable (`roundtableArrayContains`),
403 otherwise. `reissueInvite` (`db/users.js`) replaces the stored token hash, expiry,
and `inviteSentAt` outright, so the previous invite link stops working the moment this
runs — it isn't superseded by a second valid link, it's the only valid link from then
on.

**Listing Users (`GET /api/admin/users`, `requireRole('admin', 'chair')`).** Admin sees
every user. A Chair sees only `role: 'member'` users whose `roundtableIds` contains the
Chair's own `roundtableId` (`roundtableArrayContains`). Filtering happens in the route
handler, not `listUsers()`, keeping `db/users.js` role-agnostic — the same split
`shared/access.js` uses to keep `memberOnly` visibility filtering out of the db layer.

**Editing a user (`PATCH /api/admin/users/:id`, `requireRole('admin', 'chair')`).** An
Admin can change any of `updateUser`'s fields (`firstName`, `lastName`, `phone`,
`address`, `role`, `roundtableId`, `roundtableIds`) on any user; changing `role`
re-derives `roundtableId`/`roundtableIds` the same way `createInvite` does, so an edit
can't leave a stale `roundtableId` on a user who's no longer a Chair. The route itself
additionally rejects (400) any result that would leave `role: 'chair'` with no
`roundtableId` — a Chair with no Roundtable is a meaningless state — checked against
the *effective* role/roundtableId (the submitted value if present, else the target's
existing one), so this also catches an Admin nulling an existing Chair's `roundtableId`
without changing their role away from `'chair'` in the same request. A Chair may act
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

**Admin-triggered password reset (`POST /api/admin/users/:id/send-reset`,
`requireRole('admin')`).** Admin-only, unlike every other per-user Users action above —
a Chair has no business initiating a password change on a Member's account. The target
must be `active` (400 otherwise; a pending user has no password to reset). Reuses the
exact same `createPasswordReset` call and 1-hour link as the public
`POST /api/forgot-password` flow below, just triggered by an Admin on the user's behalf
(e.g. a Member who's locked out and can't reach their own email) rather than by the
user themselves.

**Self-service profile (`GET/PATCH /api/users/me`, both `requireRole('admin', 'chair',
'member')`).** `GET` returns the current session's own public user record — role,
`roundtableId`/`roundtableIds`, and profile fields included, since the admin dashboard
uses this to adapt its own UI to the logged-in user's role (e.g. hiding invite/edit
controls a Chair's submission would just have been overridden or rejected anyway), not
just to have permissions enforced server-side. The bootstrap `ADMIN_USER`/`ADMIN_PASS`
session (see Session claims above) has no Users-table record and thus no `userId` to
look up — `GET` reports `{ role: 'admin', bootstrap: true }` for that case rather than
404ing, since a missing profile and "nothing to fetch for this legitimate session" are
different things. `PATCH` lets any logged-in user edit their own `firstName`/
`lastName`/`phone`/`address`; `role`/`roundtableId`/`roundtableIds` are silently ignored
if present in the body — no legitimate self-edit would ever include them, so there's no
permission boundary worth surfacing an error for (unlike the Chair-on-Member PATCH
above, where a disallowed field is rejected outright). Both always target
`req.session.userId`, never a body/param-supplied id, so neither endpoint can ever
touch anyone else's record.

**Chair content access — Initiatives and Investments (`GET/POST/PUT/DELETE
/api/admin/initiatives[/:id]`, `GET/POST/PUT/DELETE /api/admin/investments[/:id]`, all
`requireRole('admin', 'chair')`).** Both tables carry `roundtableIds` directly. A Chair
has no authority over any Roundtable but their own, on create or afterward: on create,
there's no existing item to check yet, so a Chair is authorized by the `roundtableIds`
they submit — that array must be exactly their own Roundtable, not their own plus
others. On edit and delete, authorization checks the *existing* item's current
`roundtableIds` (`roundtableArrayContains`), never the request body — a PUT body could
otherwise move an item a Chair doesn't own into scope, or omit `roundtableIds` and be
treated as unrestricted. If an edit's body touches `roundtableIds` at all, the same
rule the "Editing a user" endpoint above applies to a Member's `roundtableIds` applies
here too: a Chair may add or remove only their own Roundtable, never another
Roundtable's presence on the item (rejected with 400, not silently dropped). The `GET`
list endpoint on both tables is scoped the same way as `GET /api/admin/users` — Admin
sees every item, a Chair sees only ones whose `roundtableIds` contains their own.

**Chair content access — Posts (`GET/POST/PUT/DELETE /api/admin/posts[/:id]`,
`requireRole('admin', 'chair')`).** Posts don't carry a Roundtable reference directly,
only `initiativeId`, so a Chair's access is authorized by resolving
`post.initiativeId` → that Initiative's `roundtableIds` → contains the Chair's
`roundtableId`, mirroring the `listPostsForRoundtable` join logic already used for
public reads rather than adding a redundant field to Posts. Only `type: 'update'` Posts
are tied to an Initiative at all (`createPost` forces `initiativeId` to `null` for every
other type), so a Chair can create, edit, delete, or list only `update`-type Posts on an
Initiative in their scope — never a `blog`/`education`/`announcement`/`book` Post,
which has no Roundtable to scope against, and the `GET` list excludes them entirely for
a Chair (Admin still sees every type). On edit, a Chair's body may not change `type`
away from `update`, and may not move `initiativeId` to an Initiative outside their own
Roundtable — both rejected with 400, for the same reason a Chair can't touch another
Roundtable's `roundtableIds` on an Initiative/Investment edit.

**Chair content access — Roundtables (`PUT /api/admin/roundtables/:id`,
`requireRole('admin', 'chair')`).** A Chair may edit only their own Roundtable's own
fields (name, description, image) — `matchesRoundtable` compares `req.params.id`
directly against the Chair's `roundtableId`, with no item to fetch first, since the
Roundtable's own id *is* the value being matched. `POST /api/admin/roundtables`
(creating a new Roundtable) and `DELETE /api/admin/roundtables/:id` (deleting one
outright) are Admin-only with no Chair path: creating a new Roundtable is an
organizational decision a Chair (assigned to one existing Roundtable) doesn't make, and
deleting one is a structural decision beyond a single Chair's authority — the same
reasoning that keeps full Users account deletion Admin-only even though a Chair can
unenroll a Member from their own Roundtable.

**Images (`POST /api/admin/uploads`, `GET /api/admin/images`,
`GET /api/admin/stock-images`, all `requireRole('admin', 'chair')`).** Unscoped — the
image library has no per-item ownership or Roundtable concept (`listImages()` already
returns every upload regardless of who added it), and a Chair needs it to attach images
to the Initiatives/Posts/Investments they already have write access to within their own
Roundtable; gating it Admin-only would silently break their image picker for content
they're otherwise allowed to edit.

**Press and Events (`GET/POST/PUT/DELETE /api/admin/press[/:id]`,
`GET/POST/PUT/DELETE /api/admin/events[/:id]`, both `requireRole('admin')`).**
Admin-only, no Chair path. Press is org-wide third-party media coverage with no
Roundtable concept to scope against. Events carry no `roundtableId`/`roundtableIds`
field in the schema at all (see the Events table above), so there's nothing for a
Chair's access to scope against without a schema change.

**Campaigns (`GET /api/admin/campaigns`, `GET /api/admin/campaigns/:id/entries`, both
`requireRole('admin', 'chair')`; `PATCH /api/admin/campaigns/:id`,
`requireRole('admin')`).** `GET /api/admin/campaigns` idempotently ensures the three
site-wide campaigns and backfills one for every existing Roundtable/Initiative before
returning the visible set, so a campaign created before this feature shipped, or a
Roundtable/Initiative created without ever hitting this endpoint, always catches up.
Admin sees every campaign (plus archived ones, with `?archived=1`). A Chair sees the
three site-wide campaigns, their own Roundtable's campaign, and any Initiative
campaign whose Initiative's `roundtableIds` contains their Roundtable
(`roundtableArrayContains`, resolved by joining against `content.listInitiatives()` —
the Campaign row itself only stores `initiativeId`, not a copy of that Initiative's
`roundtableIds`). `GET .../:id/entries` applies the identical visibility check to a
single campaign, 403 outside it, and returns the entries unpaged. `PATCH` (Admin only)
updates `resultsEmails` (a non-empty array of valid emails, or `null` to return to the
derived default), `notifyOnEntry`, and `archived`.

**Recipient resolution (`db/campaigns.js`'s `resolveResultsEmails`).** Lowercased and
deduped, in order: (1) the campaign's `resultsEmails`, if an Admin has set one; (2) for
a `roundtable-interest` campaign, every active Chair of that Roundtable
(`listChairsForRoundtable`) plus the campaign's `ownerUserId`; (3) for an
`initiative-interest` campaign, just the `ownerUserId` — an Initiative can span several
Roundtables, so there's no single Chair to resolve to; (4) `NOTIFY_EMAIL` as a last
resort. If every step comes up empty, the entry is still saved; nothing is sent.
`shared/email.js`'s `notifyCampaign(campaign, subject, body)` sends to each resolved
recipient and is only called when the campaign's `notifyOnEntry` is true and the entry
being saved is new (a resubmission from the same email never re-notifies).

**Consent (`consentText`, both site-wide signup forms and the interest form).** The
newsletter and waitlist signup forms (`become-a-member.html`'s waitlist form, the
footer newsletter form) have no checkbox — consent is recorded as `true` with a basis
string (`"Subscribed via newsletter form"` / `"Joined membership waitlist"`) reflecting
that submitting the form is itself the opt-in. This is a product/legal framing decision
carried over as-is from how these two forms already worked before Campaigns existed,
not a new determination made here — worth Elise's explicit confirmation rather than
assuming it's settled. The interest form (Roundtables/Initiatives) is the one with a
real unchecked-by-default checkbox, labeled with `composeConsentText(campaign.name)` —
`"Yes, email me updates about <name>."` — the same function used for both the stored
value and `GET /api/roundtables/:slug` / `GET /api/initiatives/:slug`'s
`interest.consentText`, so the two can't drift.

**Admin dashboard UI, per role.** The backend gates and scopes every route above; the
dashboard (`private/backend/admin/`) only adapts what it shows on top of that — the
server remains the enforcement either way. `admin.js`'s `isAdminSession()`/
`isChairSession()` read the session's own `GET /api/users/me` result (fetched once,
cached as `currentUserPromise`) to decide; the pure role → visibility rules themselves
live in `admin/dashboardVisibility.js`, kept separate from the DOM-touching rest of
`admin.js` so they're assertable directly in Jest. Admin-only static markup (the Press
tab, its panel, the Events column, "New Roundtable") carries an `admin-only` class,
hidden by default via `body:not([data-role="admin"]) .admin-only` until `admin.js`
confirms the role — fails closed, so there's nothing to flash while that confirmation
is in flight. The bootstrap `ADMIN_USER`/`ADMIN_PASS` session sees exactly what an
Admin sees (its `GET /api/users/me` result is `{ role: 'admin', bootstrap: true }`, same
`role` the checks above key on) — the one difference is the header, which reads
"Signed in as admin" instead of resolving a name.

| Area | Admin | Chair |
|---|---|---|
| Tabs | All seven | All but Press |
| Roundtables list | Every roundtable; New and Delete available | Only their own roundtable; Edit only, no New/Delete |
| Initiative/Investment roundtable picker | Every roundtable, freely chosen | Locked to their own roundtable, pre-checked |
| New Post | Any type | Type locked to `update`; Initiative required, limited to their in-scope initiatives |
| Investments & Events tab | Both sections | Investments only — Events column hidden, `GET /api/admin/events` not even requested |
| Settings tab | Change Password | Change Password (identical — there's nothing else in this tab for either role yet) |
| Users tab | Full edit, Level/Roundtable on invite, resend, send-reset, full delete | No edit form, no Level/Roundtable on invite (always Member on their own roundtable), resend, "Remove from roundtable" instead of delete |

**Not yet implemented:**
- The real Member-facing area. `GET /member` (`private/backend/member/member.html`,
  distinct from the public `front-end/` pages and the admin dashboard in
  `private/backend/admin/`) is a coming-soon shell today — a welcome message and a list
  of what's planned, nothing interactive. The actual features still to build: profile
  editing (would reuse `PATCH /api/users/me` above), education content, an events
  calendar, and a member news feed (`update`-type Posts via `listPostsForRoundtable`,
  filtered to a Member's `roundtableIds`; a Member with an empty `roundtableIds` would
  see `announcement`-type Posts only, not a blank feed).
- Role-aware member-content visibility: `shared/access.js`'s `canSeeFull` still always
  returns `false`, so on the public `GET /api/education[/:slug]`, `GET
  /api/investments[/:slug]`, and `GET /api/events[/:slug]` endpoints, no visitor —
  including a logged-in Member — currently sees full `memberOnly` content; every viewer
  gets the same redacted preview or hidden item a logged-out visitor would. (The admin
  dashboard's own CRUD endpoints don't route through `access.js` and are unaffected.)
- Campaigns tab: CSV export and bulk sending. The Copy Emails button (a
  comma-separated, deduped, lowercased list via the clipboard) is the only
  results-handling built so far — exporting to a file or sending a batch email
  directly from the dashboard are both still manual, outside-the-app steps.
