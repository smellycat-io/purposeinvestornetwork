// Wraps a route handler so every route doesn't repeat the same
// try/catch -> captureException -> 500 JSON boilerplate. The handler is
// still free to return its own status codes (404s, validation errors, etc)
// for anything that isn't an unexpected failure.
//
// `verbose: true` adds the raw error.message to the response as `detail`,
// on top of the always-sent Sentry report — pass it only for routes a
// caller reaches only after authenticating (admin/chair/member session),
// never for a public route (accept-invite, forgot/reset-password,
// subscribe, survey): an unauthenticated caller could otherwise use the
// detail of an unexpected 500 to probe internals (table names, AWS error
// shapes) that the generic message deliberately hides.
const { captureException } = require('@sentry/aws-serverless');

function asyncRoute(handler, errorMessage, { verbose = false } = {}) {
  const wrapped = async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      captureException(error);
      const body = { error: errorMessage };
      if (verbose) body.detail = error.message;
      res.status(500).json(body);
    }
  };
  // Marks the returned closure the same way shared/auth.js's requireRole
  // marks its own guard (`isRoleGate`) — lets
  // shared/routeRoleGates.test.js walk the live router and fail the build
  // if a public route (no requireRole in its chain) is ever given
  // `verbose: true`, rather than relying on every future route author to
  // remember the "never on a public route" rule above by hand.
  wrapped.isVerboseRoute = verbose;
  return wrapped;
}

module.exports = { asyncRoute };
