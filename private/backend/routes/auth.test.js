// Regression coverage for the 2026-09-17 incident: the Users-table
// email-index GSI wasn't provisioned before the role rollout deployed,
// findUserByEmail threw on every login attempt, and the single try/catch
// then wrapping the whole POST /login handler treated that as a hard
// failure — locking out the bootstrap ADMIN_USER/ADMIN_PASS admin along
// with every real account, since it had no other way in. See CLAUDE.md's
// Architecture Patterns → Session auth for the invariant this file checks:
// the bootstrap login must stay reachable independent of the Users table's
// health.
process.env.DB_FILE = ':memory:';
process.env.ADMIN_USER = 'test-admin@example.com';
process.env.ADMIN_PASS = 'test-admin-password';

jest.mock('../db/sessions.js', () => {
  const { Store } = require('express-session');
  class InMemorySessionStore extends Store {
    constructor() {
      super();
      this.sessions = new Map();
    }
    get(sid, callback) {
      callback(null, this.sessions.get(sid) || null);
    }
    set(sid, session, callback) {
      this.sessions.set(sid, session);
      callback && callback();
    }
    destroy(sid, callback) {
      this.sessions.delete(sid);
      callback && callback();
    }
  }
  return { DynamoDBSessionStore: InMemorySessionStore };
});

// findUserByEmail needs to be a controllable mock per test (resolving null,
// or rejecting to simulate the GSI-not-provisioned failure) — the other
// db/users.js exports aren't exercised by anything this file calls.
jest.mock('../db/users.js', () => ({
  findUserByEmail: jest.fn(),
}));

const request = require('supertest');
const Sentry = require('@sentry/aws-serverless');

// routes/auth.js destructures captureException from this module at require
// time (`const { captureException } = require('@sentry/aws-serverless')`),
// so the spy must exist *before* '../index' (which requires routes/auth.js)
// is first required below — spying on the module afterward would leave
// auth.js holding the original, un-spied function reference.
const captureExceptionSpy = jest.spyOn(Sentry, 'captureException');

const { findUserByEmail } = require('../db/users.js');
const { app } = require('../index');

beforeEach(() => {
  findUserByEmail.mockReset();
  captureExceptionSpy.mockClear();
});

describe('POST /login — bootstrap fallback resilience', () => {
  test('a correct bootstrap login succeeds when findUserByEmail throws (the 2026-09-17 failure mode)', async () => {
    const dbError = new Error('email-index GSI not provisioned');
    findUserByEmail.mockRejectedValueOnce(dbError);

    const res = await request(app)
      .post('/login')
      .send({ email: 'test-admin@example.com', password: 'test-admin-password' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin');
    expect(captureExceptionSpy).toHaveBeenCalledWith(dbError);
  });

  test('an incorrect bootstrap login still reports invalid credentials (not a 500) when findUserByEmail throws', async () => {
    findUserByEmail.mockRejectedValueOnce(new Error('email-index GSI not provisioned'));

    const res = await request(app)
      .post('/login')
      .send({ email: 'test-admin@example.com', password: 'wrong-password' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid credentials');
  });

  test('a genuinely unexpected error elsewhere in the handler still hits the outer catch', async () => {
    // Sanity check that splitting the try/catch didn't remove error
    // handling outright: an error the inner catch doesn't cover (here,
    // verifyPassword throwing because passwordHash isn't a string —
    // .split() is not a function on a number) should still be reported as
    // "something went wrong," not surfaced as an unhandled rejection or a
    // misleading "invalid credentials."
    findUserByEmail.mockResolvedValueOnce({ id: 'u1', status: 'active', passwordHash: 12345, role: 'admin' });

    const res = await request(app).post('/login').send({ email: 'real@example.com', password: 'anything' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Something went wrong');
  });
});
