// db/store.js still checks for the sentinel value `':memory:'` (see its own
// comment) — it's no longer literally SQLite, but it's still the correct,
// supported way to keep these tests from writing survey.db/analytics files
// to disk. This is not the stale part of the old test setup; see the
// sqliteId note below for what actually was.
process.env.DB_FILE = ':memory:';

// Fixed bootstrap admin credentials for the "logged in" cases below.
// Set explicitly (rather than relying on whatever a local .env happens to
// have) so these tests are deterministic and don't depend on real
// credentials being present — see test/setupEnv.js for why that matters.
process.env.ADMIN_USER = 'test-admin@example.com';
process.env.ADMIN_PASS = 'test-admin-password';

// The real DynamoDBSessionStore no-ops on every operation when
// AWS_SESSIONS_TABLE isn't configured (see db/sessions.js) — a session set
// on one request is never actually retrievable on the next, which makes it
// impossible to test a real login/session flow without a real table.
// Swap in a same-process in-memory Store for these tests only, so a login
// via `request.agent(app)` persists across requests the way it would in
// production against a real table.
jest.mock('./db/sessions.js', () => {
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

const request = require('supertest');
const { app } = require('./index');

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('GET /login', () => {
  test('returns the admin login page', async () => {
    const response = await request(app).get('/login');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Admin Login');
  });
});

describe('POST /api/survey', () => {
  test('stores the response and returns its current shape', async () => {
    const response = await request(app)
      .post('/api/survey')
      .send({ answers: { name: 'Jane Doe', email: 'jane@example.com', favorite: 'impact' } })
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    // `sqliteId` is a stale field *name* left over from the SQLite era —
    // it's actually db/store.js's local JSON-store numeric id now — but the
    // field itself is still genuinely returned today, so it's asserted
    // here as-is. (The old test's failure was asserting `typeof === 'number'`
    // happened to still pass; what actually broke was the DB_FILE setup
    // implying SQLite semantics that no longer apply — the field survives.)
    expect(response.body).toEqual({
      success: true,
      sqliteId: expect.any(Number),
      dynamoId: expect.any(String),
      alreadyOnWaitlist: false,
    });
  });
});

describe('GET /logout', () => {
  test('destroys the session and redirects to /login', async () => {
    const response = await request(app).get('/logout');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });
});

describe('requireAdmin-gated routes', () => {
  test('GET /admin redirects to /login when logged out', async () => {
    const response = await request(app).get('/admin');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  test('GET /api/admin/survey-responses redirects to /login when logged out', async () => {
    const response = await request(app).get('/api/admin/survey-responses');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  test('both routes succeed once logged in', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/login')
      .send({ email: 'test-admin@example.com', password: 'test-admin-password' });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/admin');

    const adminPage = await agent.get('/admin');
    expect(adminPage.status).toBe(200);

    const surveyResponses = await agent.get('/api/admin/survey-responses');
    expect(surveyResponses.status).toBe(200);
    expect(Array.isArray(surveyResponses.body)).toBe(true);
  });
});
