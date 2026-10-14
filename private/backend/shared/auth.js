// Every protected route names its allowed roles explicitly through
// requireRole — there is no flat, login-only gate left in this codebase.
// A new /api/admin or /admin route with no requireRole call is a bug (see
// shared/routeRoleGates.test.js, which walks the live Express router and
// fails the build if one ever appears un-gated).
//
// requireRole returns JSON 401/403 for /api/* callers (a role-gated
// fetch() call needs a real error to branch on) and redirects to /login
// for page routes.
function requireRole(...roles) {
  function guard(req, res, next) {
    const isApiRoute = req.path.startsWith('/api/');

    if (!req.session || !req.session.loggedIn) {
      if (isApiRoute) return res.status(401).json({ error: 'Not logged in.' });
      return res.redirect('/login');
    }

    if (!roles.includes(req.session.role)) {
      if (isApiRoute) return res.status(403).json({ error: 'Not authorized.' });
      return res.redirect('/login');
    }

    return next();
  }
  // Each call to requireRole(...) returns a distinct closure, so this
  // marker — not function identity — is how shared/routeRoleGates.test.js
  // recognizes "this handler is a role gate" while walking the router.
  guard.isRoleGate = true;
  return guard;
}

// Chair-to-single-item equality check, for an item with one `roundtableId`
// field rather than an array. Used by `PUT /api/admin/roundtables/:id`,
// the one content type whose own id *is* the single roundtableId being
// compared against. `!!chairRoundtableId` guards against a
// null-matches-null false positive: an Admin (or anyone else with no
// roundtableId) must never "match" an item that also has no roundtableId
// set.
function matchesRoundtable(chairRoundtableId, targetRoundtableId) {
  return !!chairRoundtableId && chairRoundtableId === targetRoundtableId;
}

// Chair-to-array-of-roundtables check — a Member's roundtableIds, or an
// Initiative/Investment's, can include several Roundtables; a Chair
// matches if their one Roundtable is among them. Used both for Chair-scoped
// Member list/management (routes/users.js) and Chair-scoped content reads
// and writes on Initiatives, Posts, and Investments (routes/initiatives.js,
// routes/posts.js, routes/investments.js).
function roundtableArrayContains(roundtableIds, chairRoundtableId) {
  return !!chairRoundtableId && Array.isArray(roundtableIds) && roundtableIds.includes(chairRoundtableId);
}

module.exports = { requireRole, matchesRoundtable, roundtableArrayContains };
