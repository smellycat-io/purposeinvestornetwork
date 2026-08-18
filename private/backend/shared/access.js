// Central place for the memberOnly gating convention shared across Posts
// (education), Investments, and Events. `canSeeFull` is the one place
// membership auth plugs in later — every route already calls through here,
// so wiring up real auth later is a one-function change, not a route-by-route
// hunt.
//
// TODO(membership-auth): currently nobody is treated as a member. Replace
// this body once a membership/session system exists (e.g. check
// req.session.member or a member token).
function canSeeFull(item, req) {
  return false;
}

// For content types that hide memberOnly items entirely (Investments, Events, Press).
function filterVisible(items, req) {
  return items.filter((item) => !item.memberOnly || canSeeFull(item, req));
}

// For content types that use preview + paywall instead of hiding the item (Education).
function redactPost(post, req) {
  if (!post || !post.memberOnly || canSeeFull(post, req)) return post;
  const { body, ...rest } = post;
  return { ...rest, body: null, memberLocked: true };
}

module.exports = { canSeeFull, filterVisible, redactPost };
