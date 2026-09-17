const { requireAdmin, requireRole, matchesRoundtable, roundtableArrayContains } = require('./auth.js');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.redirect = jest.fn(() => res);
  return res;
}

describe('requireAdmin', () => {
  test('calls next when logged in', () => {
    const req = { session: { loggedIn: true } };
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects to /login when there is no session', () => {
    const req = { session: null };
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login');
  });
});

describe('requireRole', () => {
  test('calls next when logged in with an allowed role', () => {
    const req = { session: { loggedIn: true, role: 'chair' }, path: '/api/admin/users/invite' };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin', 'chair')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('returns JSON 401 on an /api/* route when not logged in', () => {
    const req = { session: null, path: '/api/admin/users/invite' };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin', 'chair')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not logged in.' });
  });

  test('redirects to /login on a page route when not logged in', () => {
    const req = { session: null, path: '/admin' };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  test('returns JSON 403 on an /api/* route when logged in with a disallowed role', () => {
    const req = { session: { loggedIn: true, role: 'member' }, path: '/api/admin/users/invite' };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin', 'chair')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authorized.' });
  });

  test('redirects to /login on a page route when logged in with a disallowed role', () => {
    const req = { session: { loggedIn: true, role: 'member' }, path: '/admin' };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login');
  });
});

describe('matchesRoundtable', () => {
  test('true when both ids are set and equal', () => {
    expect(matchesRoundtable('rt-1', 'rt-1')).toBe(true);
  });

  test('false when the ids differ', () => {
    expect(matchesRoundtable('rt-1', 'rt-2')).toBe(false);
  });

  // The important case: a null-vs-null "match" would let an Admin (or any
  // account with no roundtableId) match an item that also has none set.
  test('false when chairRoundtableId is null, even if targetRoundtableId is also null', () => {
    expect(matchesRoundtable(null, null)).toBe(false);
  });

  test('false when chairRoundtableId is undefined', () => {
    expect(matchesRoundtable(undefined, 'rt-1')).toBe(false);
  });
});

describe('roundtableArrayContains', () => {
  test('true when the roundtableId is in the array', () => {
    expect(roundtableArrayContains(['rt-1', 'rt-2'], 'rt-2')).toBe(true);
  });

  test('false when it is not in the array', () => {
    expect(roundtableArrayContains(['rt-1'], 'rt-2')).toBe(false);
  });

  test('false for an empty array', () => {
    expect(roundtableArrayContains([], 'rt-1')).toBe(false);
  });

  test('false when chairRoundtableId is null', () => {
    expect(roundtableArrayContains(['rt-1'], null)).toBe(false);
  });

  test('false when roundtableIds is not an array', () => {
    expect(roundtableArrayContains(undefined, 'rt-1')).toBe(false);
    expect(roundtableArrayContains(null, 'rt-1')).toBe(false);
  });
});
