// Pure role -> dashboard-visibility rules used by admin.js to decide which
// tabs and controls a session sees. The backend already gates and scopes
// every route (see routes/posts.js, routes/investments.js, routes/
// roundtables.js, routes/initiatives.js, routes/events.js, routes/press.js)
// — these functions only describe what the UI should show on top of that,
// so they stay plain data-in/data-out and are testable without a DOM. Kept
// in its own file, separate from admin.js (which touches `document`/
// `window` throughout), so Jest can require it directly.
(function (root) {
  'use strict';

  const ALL_TABS = ['campaigns', 'posts', 'content', 'press', 'investments-events', 'settings', 'users'];

  // Press is org-wide third-party coverage with no Roundtable to scope to
  // (requireRole('admin'), no Chair path) — the one tab a Chair never has a
  // use for. Every other tab stays, scoped internally by its own controls
  // instead of being hidden outright.
  function visibleTabs(role) {
    return role === 'chair' ? ALL_TABS.filter((tab) => tab !== 'press') : ALL_TABS.slice();
  }

  // Always the first tab the session can see, so a hidden tab (Press, for a
  // Chair) is never left selected as the active one.
  function defaultTab(role) {
    return visibleTabs(role)[0];
  }

  // Events (requireRole('admin'), no Chair path) is the one Admin-only
  // section inside the shared Investments & Events tab.
  function canSeeEvents(role) {
    return role === 'admin';
  }

  // Deleting a Roundtable outright is Admin-only — a Chair may still edit
  // their own Roundtable's fields (PUT /api/admin/roundtables/:id).
  function canDeleteRoundtable(role) {
    return role === 'admin';
  }

  // A Chair's Roundtables list never shows another Roundtable, even
  // read-only.
  function visibleRoundtables(role, allRoundtables, chairRoundtableId) {
    if (role !== 'chair') return allRoundtables;
    return allRoundtables.filter((rt) => rt.id === chairRoundtableId);
  }

  // The one Roundtable a Chair's Initiative/Investment form checkboxes lock
  // to and pre-check — null for Admin, where every Roundtable stays a free
  // choice.
  function lockedRoundtableId(role, chairRoundtableId) {
    return role === 'chair' ? chairRoundtableId : null;
  }

  // 'update' is the only Post type tied to an Initiative (routes/posts.js's
  // isPostInChairScope) — the one a Chair can ever reach, so it isn't a
  // choice to make. null for Admin, where every type stays a choice.
  function lockedPostType(role) {
    return role === 'chair' ? 'update' : null;
  }

  const api = {
    visibleTabs,
    defaultTab,
    canSeeEvents,
    canDeleteRoundtable,
    visibleRoundtables,
    lockedRoundtableId,
    lockedPostType,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DashboardVisibility = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
