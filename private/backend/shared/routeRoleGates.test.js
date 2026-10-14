process.env.DB_FILE = ':memory:';

const { app } = require('../index.js');

// Every router in this app is mounted with no path prefix (see index.js —
// each `app.use(require('./routes/X.js'))` call), so a route's full path
// always lives directly in its own router.get/post/put/delete call. That
// means walking app._router.stack and recursing into any layer whose
// `.handle` is itself a sub-router (`layer.handle.stack`) reaches every
// real route's full path with no prefix-joining needed.
function collectRoutes(stack, routes, standaloneLayers) {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods);
      const isGated = layer.route.stack.some((l) => l.handle && l.handle.isRoleGate);
      routes.push({ path: layer.route.path, methods, isGated });
    } else if (layer.handle && layer.handle.stack) {
      collectRoutes(layer.handle.stack, routes, standaloneLayers);
    } else {
      standaloneLayers.push(layer);
    }
  }
}

const routes = [];
const standaloneLayers = [];
collectRoutes(app._router.stack, routes, standaloneLayers);

const adminRoutes = routes.filter(
  (r) => r.path === '/admin' || r.path === '/member' || r.path.startsWith('/api/admin')
);

describe('every /api/admin, /admin, and /member route carries a requireRole gate', () => {
  test('the walk actually found admin routes (guards against the walk itself silently finding nothing)', () => {
    expect(adminRoutes.length).toBeGreaterThan(0);
  });

  test.each(adminRoutes.map((r) => [r.methods.join(',').toUpperCase(), r.path, r.isGated]))(
    '%s %s is role-gated',
    (methods, path, isGated) => {
      expect(isGated).toBe(true);
    }
  );

  // routes/admin.js's static-asset mount is the one exception to the
  // router.get/post/put/delete pattern above — it's a router.use() call
  // with multiple handlers, which Express represents as one standalone
  // Layer per handler (no `.route`), all sharing one regexp derived from
  // the mount path. There's no `.path` to filter on until a real request
  // matches, so this checks the regexp directly instead.
  test('the /admin/assets static mount is role-gated', () => {
    const matching = standaloneLayers.filter((layer) => layer.regexp.test('/admin/assets/some-file.png'));
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.some((layer) => layer.handle && layer.handle.isRoleGate)).toBe(true);
  });
});
