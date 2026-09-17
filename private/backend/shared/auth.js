function requireAdmin(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  return res.redirect('/login');
}

// Role-aware, alongside requireAdmin rather than replacing it — routes not
// yet migrated (Stage 2/3) keep using requireAdmin as-is.
//
// requireAdmin always redirects, even for /api/* callers, since it predates
// there being any distinction worth making (every session was equally
// "admin"). That stops being reasonable once a role check can fail for a
// legitimately logged-in user (a Member hitting a Chair-only endpoint) —
// an admin dashboard's fetch() call needs a real JSON error it can branch
// on, not an opaque redirect response. So this distinguishes /api/* from
// page routes: JSON 401/403 for the former, redirect-to-login for the
// latter (matching requireAdmin's existing behavior there).
function requireRole(...roles) {
  return function (req, res, next) {
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
  };
}

// Chair-to-single-roundtable equality check — e.g. a Chair editing their
// own Roundtable's Initiatives/Posts (Stage 2/3). `!!chairRoundtableId`
// guards against a null-matches-null false positive: an Admin (or anyone
// else with no roundtableId) must never "match" an item that also has no
// roundtableId set.
function matchesRoundtable(chairRoundtableId, targetRoundtableId) {
  return !!chairRoundtableId && chairRoundtableId === targetRoundtableId;
}

// Chair-to-Member array-contains check — a Member's roundtableIds can
// include several Roundtables; a Chair matches if their one Roundtable is
// among them (Stage 2/3's Chair-scoped member list/management).
function roundtableArrayContains(roundtableIds, chairRoundtableId) {
  return !!chairRoundtableId && Array.isArray(roundtableIds) && roundtableIds.includes(chairRoundtableId);
}

module.exports = { requireAdmin, requireRole, matchesRoundtable, roundtableArrayContains };
