// Route-level tests covering every /api/admin/* and /admin route's
// requireRole gate, each with whatever Chair scoping actually makes sense
// for that resource (or none, where it doesn't — see each route file's own
// comments for why). One consolidated file rather than one per resource,
// since most of these route files have no other existing test file to
// extend, and this is meant to be the systematic "does every admin route
// reject the roles it should" check future gap-closure work (e.g.
// Campaigns) can keep extending.
process.env.AWS_USERS_TABLE = 'test-users-table';
process.env.AWS_ROUNDTABLES_TABLE = 'test-roundtables-table';
process.env.AWS_INITIATIVES_TABLE = 'test-initiatives-table';
process.env.AWS_PRESS_TABLE = 'test-press-table';
process.env.AWS_EVENTS_TABLE = 'test-events-table';
process.env.AWS_IMAGES_TABLE = 'test-images-table';
process.env.AWS_SETTINGS_TABLE = 'test-settings-table';
process.env.AWS_CAMPAIGNS_TABLE = 'test-campaigns-table';
process.env.AWS_CAMPAIGN_ENTRIES_TABLE = 'test-campaign-entries-table';
process.env.DB_FILE = ':memory:';

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

const request = require('supertest');
const { mockClient } = require('aws-sdk-client-mock');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { ConditionalCheckFailedException } = require('@aws-sdk/client-dynamodb');
const { hashPassword } = require('../shared/passwords.js');
const { roleHome } = require('../shared/auth.js');

const ddbMock = mockClient(DynamoDBDocumentClient);

const db = {
  'test-users-table': [],
  'test-roundtables-table': [],
  'test-initiatives-table': [],
  'test-press-table': [],
  'test-events-table': [],
  'test-images-table': [],
  'test-settings-table': [],
  'test-campaigns-table': [],
  'test-campaign-entries-table': [],
};

function seedUsers(users) {
  db['test-users-table'] = users.map((u) => ({ ...u }));
}

function seedRoundtables(items) {
  db['test-roundtables-table'] = items.map((i) => ({ ...i }));
}

function seedInitiatives(items) {
  db['test-initiatives-table'] = items.map((i) => ({ ...i }));
}

function makeInitiative({ id, title = 'Test Initiative', roundtableIds = [] }) {
  return { id, slug: `${id}-slug`, title, description: '', roundtableIds, imageUrl: null, createdAt: new Date().toISOString() };
}

// Resets the Campaigns tables (and Initiatives, which GET /api/admin/
// campaigns also scans on every call to backfill) between tests that care
// about exact counts/seeding — most describe blocks below don't need this
// (campaigns just accumulate harmlessly across tests otherwise), but
// anything asserting an exact entries array or an exact ensure-once seeded
// value calls this first. Tests that need specific initiatives call
// seedInitiatives afterward; this just guarantees no previous test's
// initiatives are still sitting in the table.
function resetCampaignsTables() {
  db['test-campaigns-table'] = [];
  db['test-campaign-entries-table'] = [];
  db['test-initiatives-table'] = [];
}

function seedCampaigns(items) {
  db['test-campaigns-table'] = items.map((c) => ({ ...c }));
}

function makeCampaign({ id, name, type, roundtableId = null, initiativeId = null, ownerUserId = null, resultsEmails = null, notifyOnEntry = true, archived = false }) {
  const now = new Date().toISOString();
  return { id, name, type, roundtableId, initiativeId, ownerUserId, resultsEmails, notifyOnEntry, archived, createdAt: now, updatedAt: now };
}

const PASSWORD = 'correct-horse-battery-staple';

function makeUser({ id, role, roundtableId = null, roundtableIds = [], email }) {
  return {
    id,
    email,
    status: 'active',
    passwordHash: hashPassword(PASSWORD),
    role,
    roundtableId,
    roundtableIds,
    firstName: 'Test',
    lastName: role,
  };
}

function makeRoundtable({ id, name = 'Test Roundtable' }) {
  return { id, slug: `${id}-slug`, name, description: '', imageUrl: null, createdAt: new Date().toISOString() };
}

function isEntryKey(obj) {
  return obj && Object.prototype.hasOwnProperty.call(obj, 'campaignId') && Object.prototype.hasOwnProperty.call(obj, 'email');
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(ScanCommand).callsFake((input) => ({ Items: db[input.TableName] || [] }));
  ddbMock.on(QueryCommand).callsFake((input) => {
    if (input.TableName === 'test-campaign-entries-table') {
      const campaignId = input.ExpressionAttributeValues[':campaignId'];
      return { Items: (db[input.TableName] || []).filter((i) => i.campaignId === campaignId) };
    }
    const email = input.ExpressionAttributeValues[':email'];
    return { Items: (db['test-users-table'] || []).filter((u) => u.email === email) };
  });
  ddbMock.on(GetCommand).callsFake((input) => {
    const table = db[input.TableName] || [];
    const match = isEntryKey(input.Key)
      ? table.find((i) => i.campaignId === input.Key.campaignId && i.email === input.Key.email)
      : table.find((i) => i.id === input.Key.id);
    return { Item: match };
  });
  ddbMock.on(PutCommand).callsFake((input) => {
    const table = db[input.TableName] || (db[input.TableName] = []);
    const matcher = isEntryKey(input.Item)
      ? (i) => i.campaignId === input.Item.campaignId && i.email === input.Item.email
      : (i) => i.id === input.Item.id;
    const idx = table.findIndex(matcher);
    if (input.ConditionExpression === 'attribute_not_exists(id)' && idx >= 0) {
      throw new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
    }
    if (idx >= 0) table[idx] = input.Item;
    else table.push(input.Item);
    return {};
  });
  ddbMock.on(DeleteCommand).callsFake((input) => {
    db[input.TableName] = (db[input.TableName] || []).filter((i) => i.id !== input.Key.id);
    return {};
  });
});

const { app } = require('../index');

// Doesn't assert the redirect target here — it varies by role (see
// shared/auth.js's roleHome) and is covered by its own dedicated tests
// below ("POST /login redirects to each role's own home").
async function loginAs(email) {
  const agent = request.agent(app);
  const res = await agent.post('/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(302);
  return agent;
}

const admin1 = makeUser({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
const chairA = makeUser({ id: 'chair-a', email: 'chair-a@example.com', role: 'chair', roundtableId: 'rt-A' });
const chairB = makeUser({ id: 'chair-b', email: 'chair-b@example.com', role: 'chair', roundtableId: 'rt-B' });
const memberA1 = makeUser({ id: 'member-a1', email: 'member-a1@example.com', role: 'member', roundtableIds: ['rt-A'] });

function freshRoster() {
  return [admin1, chairA, chairB, memberA1];
}

describe('Roundtables — POST (Admin only, no Chair path)', () => {
  test('Admin can create', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.post('/api/admin/roundtables').send({ name: 'New Roundtable' });

    expect(res.status).toBe(201);
  });

  test('a Chair cannot create — 403', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.post('/api/admin/roundtables').send({ name: 'Nope' });

    expect(res.status).toBe(403);
  });

  test('a logged-out request is rejected', async () => {
    seedUsers(freshRoster());

    const res = await request(app).post('/api/admin/roundtables').send({ name: 'Nope' });

    expect(res.status).toBe(401);
  });
});

describe('Roundtables — PUT (Admin any, Chair own only)', () => {
  test('Admin can edit any Roundtable', async () => {
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A' })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.put('/api/admin/roundtables/rt-A').send({ name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
  });

  test('a Chair can edit their own Roundtable', async () => {
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/roundtables/rt-A').send({ name: 'Chair Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Chair Renamed');
  });

  test("a Chair cannot edit another Chair's Roundtable — 403", async () => {
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-B' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/roundtables/rt-B').send({ name: 'Hijacked' });

    expect(res.status).toBe(403);
  });

  test('a Member cannot edit — 403', async () => {
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A' })]);
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.put('/api/admin/roundtables/rt-A').send({ name: 'Nope' });

    expect(res.status).toBe(403);
  });
});

describe('Roundtables — DELETE (Admin only, no Chair path)', () => {
  test('Admin can delete', async () => {
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A' })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.delete('/api/admin/roundtables/rt-A');

    expect(res.status).toBe(204);
  });

  test('a Chair cannot delete even their own Roundtable — 403', async () => {
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/roundtables/rt-A');

    expect(res.status).toBe(403);
    expect(db['test-roundtables-table'].find((r) => r.id === 'rt-A')).toBeDefined();
  });
});

describe('Press — Admin only, no Chair path, on every route', () => {
  test.each([
    ['get', '/api/admin/press'],
    ['post', '/api/admin/press'],
    ['put', '/api/admin/press/p1'],
    ['delete', '/api/admin/press/p1'],
  ])('%s %s — Admin OK, Chair and Member 403, logged-out 401', async (method, path) => {
    seedUsers(freshRoster());

    const loggedOutRes = await request(app)[method](path);
    expect(loggedOutRes.status).toBe(401);

    const chairAgent = await loginAs('chair-a@example.com');
    const chairRes = await chairAgent[method](path).send({ title: 'x', source: 'x', externalUrl: 'https://x' });
    expect(chairRes.status).toBe(403);

    const memberAgent = await loginAs('member-a1@example.com');
    const memberRes = await memberAgent[method](path).send({ title: 'x', source: 'x', externalUrl: 'https://x' });
    expect(memberRes.status).toBe(403);

    const adminAgent = await loginAs('admin@example.com');
    const adminRes = await adminAgent[method](path).send({ title: 'x', source: 'x', externalUrl: 'https://x' });
    expect(adminRes.status).not.toBe(401);
    expect(adminRes.status).not.toBe(403);
  });
});

describe('Events — Admin only, no Chair path, on every route', () => {
  test.each([
    ['get', '/api/admin/events'],
    ['post', '/api/admin/events'],
    ['put', '/api/admin/events/e1'],
    ['delete', '/api/admin/events/e1'],
  ])('%s %s — Admin OK, Chair and Member 403, logged-out 401', async (method, path) => {
    seedUsers(freshRoster());

    const loggedOutRes = await request(app)[method](path);
    expect(loggedOutRes.status).toBe(401);

    const chairAgent = await loginAs('chair-a@example.com');
    const chairRes = await chairAgent[method](path).send({ title: 'x', startsAt: new Date().toISOString() });
    expect(chairRes.status).toBe(403);

    const memberAgent = await loginAs('member-a1@example.com');
    const memberRes = await memberAgent[method](path).send({ title: 'x', startsAt: new Date().toISOString() });
    expect(memberRes.status).toBe(403);

    const adminAgent = await loginAs('admin@example.com');
    const adminRes = await adminAgent[method](path).send({ title: 'x', startsAt: new Date().toISOString() });
    expect(adminRes.status).not.toBe(401);
    expect(adminRes.status).not.toBe(403);
  });
});

describe('Images — Admin and Chair, Member excluded', () => {
  test.each([
    ['get', '/api/admin/images'],
    ['get', '/api/admin/stock-images'],
  ])('%s %s — Admin and Chair OK, Member 403, logged-out 401', async (method, path) => {
    seedUsers(freshRoster());

    const loggedOutRes = await request(app)[method](path);
    expect(loggedOutRes.status).toBe(401);

    const memberAgent = await loginAs('member-a1@example.com');
    const memberRes = await memberAgent[method](path);
    expect(memberRes.status).toBe(403);

    const chairAgent = await loginAs('chair-a@example.com');
    const chairRes = await chairAgent[method](path);
    expect(chairRes.status).toBe(200);

    const adminAgent = await loginAs('admin@example.com');
    const adminRes = await adminAgent[method](path);
    expect(adminRes.status).toBe(200);
  });

  test('a Member cannot reach POST /api/admin/uploads — 403', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.post('/api/admin/uploads').send({ filename: 'x.png', contentType: 'image/png', dataBase64: 'AA==' });

    expect(res.status).toBe(403);
  });
});

describe('GET /admin (dashboard page) — Admin or Chair, Member sent to its own home', () => {
  test('Admin reaches the page', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.get('/admin');

    expect(res.status).toBe(200);
  });

  test('a Chair reaches the page', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.get('/admin');

    expect(res.status).toBe(200);
  });

  test('a Member is redirected to /member, not shown the dashboard', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.get('/admin');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/member');
  });

  test('a Member requesting /admin ends up on the real /member page within two redirect hops, not a loop', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.get('/admin').redirects(2);

    expect(res.status).toBe(200);
    expect(res.redirects).toEqual([expect.stringContaining('/member')]);
  });

  test('a logged-out request is redirected to /login', async () => {
    seedUsers(freshRoster());

    const res = await request(app).get('/admin');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

describe('GET /member (member coming-soon page) — any logged-in role, Admin/Chair as a preview', () => {
  test('a Member reaches the page', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.get('/member');

    expect(res.status).toBe(200);
  });

  test('a Chair can preview the page', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.get('/member');

    expect(res.status).toBe(200);
  });

  test('an Admin can preview the page', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.get('/member');

    expect(res.status).toBe(200);
  });

  test('a logged-out request is redirected to /login', async () => {
    seedUsers(freshRoster());

    const res = await request(app).get('/member');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

describe('Login redirects to each role\'s own home', () => {
  test.each([
    ['admin@example.com', 'admin', '/admin'],
    ['chair-a@example.com', 'chair', '/admin'],
    ['member-a1@example.com', 'member', '/member'],
  ])('POST /login for a %s (role: %s) redirects to %s', async (email, role, expectedLocation) => {
    seedUsers(freshRoster());
    expect(roleHome(role)).toBe(expectedLocation);

    const res = await request(app).post('/login').send({ email, password: PASSWORD });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(expectedLocation);
  });

  test('GET /login for an already-logged-in Member redirects to /member, not /admin', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.get('/login');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/member');
  });

  test('GET /login for an already-logged-in Admin redirects to /admin', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.get('/login');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin');
  });
});

// GET /api/admin/survey-responses and GET /api/admin/subscribers are gone
// — their old coverage here is replaced by the "Campaigns" describe blocks
// below (survey/subscriber data is now read through GET
// /api/admin/campaigns/:id/entries). GET /api/admin/settings and PUT
// /api/admin/settings/notify-email are gone too, for the same reason
// (notification email is per-campaign now) — this checks that removal
// held, as an Admin session (the only one that could previously reach
// either route) now gets a plain 404 from the catch-all, not some
// leftover partial behavior.
describe('Removed Settings routes return 404, not a stale response', () => {
  test.each([
    ['get', '/api/admin/settings'],
    ['put', '/api/admin/settings/notify-email'],
  ])('%s %s is gone', async (method, path) => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent[method](path).send({ email: 'ops@example.com' });

    expect(res.status).toBe(404);
  });
});

describe('Settings — password change is open to every logged-in role', () => {
  test('a logged-out request is rejected', async () => {
    seedUsers(freshRoster());

    const res = await request(app)
      .put('/api/admin/settings/password')
      .send({ currentPassword: PASSWORD, newPassword: 'a-new-password-1' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not logged in.' });
  });

  test.each([
    ['admin@example.com'],
    ['chair-a@example.com'],
    ['member-a1@example.com'],
  ])('%s can change their own password', async (email) => {
    seedUsers(freshRoster());
    const agent = await loginAs(email);

    const res = await agent
      .put('/api/admin/settings/password')
      .send({ currentPassword: PASSWORD, newPassword: 'a-new-password-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('rejects the wrong current password with 401, not the role gate', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent
      .put('/api/admin/settings/password')
      .send({ currentPassword: 'wrong-password', newPassword: 'a-new-password-1' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Current password is incorrect.' });
  });
});

describe('POST /api/roundtables/:slug/interest — public, always-on', () => {
  test('a valid submission is stored and returns the composed consentText', async () => {
    resetCampaignsTables();
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' })]);

    const res = await request(app)
      .post('/api/roundtables/rt-A-slug/interest')
      .send({ email: 'Visitor@Example.com', name: 'Vi Sitor', message: 'Tell me more', consent: true });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, consentText: 'Yes, email me updates about Education.' });

    const entry = db['test-campaign-entries-table'].find((e) => e.campaignId === 'roundtable:rt-A' && e.email === 'visitor@example.com');
    expect(entry).toMatchObject({
      name: 'Vi Sitor',
      message: 'Tell me more',
      consent: true,
      consentText: 'Yes, email me updates about Education.',
    });
  });

  test('an invalid email is rejected with 400 and nothing is written', async () => {
    resetCampaignsTables();
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' })]);

    const res = await request(app)
      .post('/api/roundtables/rt-A-slug/interest')
      .send({ email: 'not-an-email', consent: true });

    expect(res.status).toBe(400);
    expect(db['test-campaign-entries-table']).toHaveLength(0);
  });

  test('a filled honeypot returns 201 with no write', async () => {
    resetCampaignsTables();
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' })]);

    const res = await request(app)
      .post('/api/roundtables/rt-A-slug/interest')
      .send({ email: 'bot@example.com', consent: true, website: 'http://spam.example' });

    expect(res.status).toBe(201);
    expect(db['test-campaign-entries-table']).toHaveLength(0);
  });

  test('an unknown slug is 404', async () => {
    resetCampaignsTables();
    seedRoundtables([]);

    const res = await request(app)
      .post('/api/roundtables/no-such-roundtable/interest')
      .send({ email: 'visitor@example.com', consent: true });

    expect(res.status).toBe(404);
  });

  test('submitting with the consent box unchecked stores consent: false', async () => {
    resetCampaignsTables();
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' })]);

    const res = await request(app)
      .post('/api/roundtables/rt-A-slug/interest')
      .send({ email: 'visitor@example.com', consent: false });

    expect(res.status).toBe(201);
    const entry = db['test-campaign-entries-table'].find((e) => e.campaignId === 'roundtable:rt-A' && e.email === 'visitor@example.com');
    expect(entry.consent).toBe(false);
  });
});

describe('POST /api/initiatives/:slug/interest — public, always-on', () => {
  test('a valid submission is stored and returns the composed consentText', async () => {
    resetCampaignsTables();
    seedInitiatives([makeInitiative({ id: 'init-1', title: 'Scholarship Fund' })]);

    const res = await request(app)
      .post('/api/initiatives/init-1-slug/interest')
      .send({ email: 'visitor@example.com', consent: true });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, consentText: 'Yes, email me updates about Scholarship Fund.' });

    const entry = db['test-campaign-entries-table'].find((e) => e.campaignId === 'initiative:init-1' && e.email === 'visitor@example.com');
    expect(entry.consentText).toBe('Yes, email me updates about Scholarship Fund.');
  });

  test('an unknown slug is 404', async () => {
    resetCampaignsTables();
    seedInitiatives([]);

    const res = await request(app)
      .post('/api/initiatives/no-such-initiative/interest')
      .send({ email: 'visitor@example.com', consent: true });

    expect(res.status).toBe(404);
  });

  test('a filled honeypot returns 201 with no write', async () => {
    resetCampaignsTables();
    seedInitiatives([makeInitiative({ id: 'init-1', title: 'Scholarship Fund' })]);

    const res = await request(app)
      .post('/api/initiatives/init-1-slug/interest')
      .send({ email: 'bot@example.com', consent: true, website: 'filled' });

    expect(res.status).toBe(201);
    expect(db['test-campaign-entries-table']).toHaveLength(0);
  });
});

describe('POST /api/subscribe — writes to Campaign entries with the consent basis', () => {
  test('a newsletter signup is stored under the newsletter campaign with its consent basis', async () => {
    resetCampaignsTables();

    const res = await request(app).post('/api/subscribe').send({ email: 'reader@example.com', source: 'newsletter' });

    expect(res.status).toBe(201);
    const entry = db['test-campaign-entries-table'].find((e) => e.campaignId === 'newsletter' && e.email === 'reader@example.com');
    expect(entry).toMatchObject({ consent: true, consentText: 'Subscribed via newsletter form' });
  });

  test('a waitlist signup is stored under the waitlist campaign with its consent basis', async () => {
    resetCampaignsTables();

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'waitlisted@example.com', source: 'membership-waitlist', name: 'Wait Lister', phone: '555-0100' });

    expect(res.status).toBe(201);
    const entry = db['test-campaign-entries-table'].find((e) => e.campaignId === 'waitlist' && e.email === 'waitlisted@example.com');
    expect(entry).toMatchObject({
      consent: true,
      consentText: 'Joined membership waitlist',
      name: 'Wait Lister',
      phone: '555-0100',
    });
  });
});

describe('GET /api/admin/campaigns — visibility matrix', () => {
  test('a logged-out request is rejected — 401', async () => {
    resetCampaignsTables();
    const res = await request(app).get('/api/admin/campaigns');
    expect(res.status).toBe(401);
  });

  test('a Member is rejected — 403', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.get('/api/admin/campaigns');

    expect(res.status).toBe(403);
  });

  test('Admin sees the three site-wide campaigns plus every Roundtable/Initiative campaign', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' }), makeRoundtable({ id: 'rt-B', name: 'Health' })]);
    seedInitiatives([makeInitiative({ id: 'init-1', title: 'Scholarship Fund', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.get('/api/admin/campaigns');

    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.id).sort();
    expect(ids).toEqual(['initiative:init-1', 'newsletter', 'roundtable:rt-A', 'roundtable:rt-B', 'survey', 'waitlist'].sort());
  });

  test("a Chair sees only site-wide campaigns, their own Roundtable's campaign, and Initiative campaigns whose roundtableIds include theirs", async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' }), makeRoundtable({ id: 'rt-B', name: 'Health' })]);
    seedInitiatives([
      makeInitiative({ id: 'init-in-scope', title: 'In Scope', roundtableIds: ['rt-A'] }),
      makeInitiative({ id: 'init-out-of-scope', title: 'Out of Scope', roundtableIds: ['rt-B'] }),
    ]);
    const agent = await loginAs('chair-a@example.com'); // chair-a's roundtableId is rt-A

    const res = await agent.get('/api/admin/campaigns');

    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.id).sort();
    expect(ids).toEqual(['initiative:init-in-scope', 'newsletter', 'roundtable:rt-A', 'survey', 'waitlist'].sort());
  });

  test('archived campaigns are excluded by default, and only Admin can opt into seeing them', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' })]);
    const adminAgent = await loginAs('admin@example.com');
    await adminAgent.get('/api/admin/campaigns'); // ensures roundtable:rt-A's campaign exists first

    await adminAgent.delete('/api/admin/roundtables/rt-A'); // archives roundtable:rt-A's campaign

    const defaultView = await adminAgent.get('/api/admin/campaigns');
    expect(defaultView.body.map((c) => c.id)).not.toContain('roundtable:rt-A');

    const archivedView = await adminAgent.get('/api/admin/campaigns?archived=1');
    expect(archivedView.body.map((c) => c.id)).toContain('roundtable:rt-A');

    const chairAgent = await loginAs('chair-a@example.com');
    const chairArchivedAttempt = await chairAgent.get('/api/admin/campaigns?archived=1');
    expect(chairArchivedAttempt.body.map((c) => c.id)).not.toContain('roundtable:rt-A');
  });
});

describe('GET /api/admin/campaigns/:id/entries — scoped the same way as the list, 403 outside it', () => {
  test('a Chair gets entries for their own Roundtable campaign', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' })]);
    await request(app).post('/api/roundtables/rt-A-slug/interest').send({ email: 'visitor@example.com', consent: true });
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.get('/api/admin/campaigns/roundtable:rt-A/entries');

    expect(res.status).toBe(200);
    expect(res.body.campaign.id).toBe('roundtable:rt-A');
    expect(res.body.entries).toHaveLength(1);
  });

  test("a Chair gets 403 for another Chair's Roundtable campaign", async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-B', name: 'Health' })]);
    seedCampaigns([makeCampaign({ id: 'roundtable:rt-B', name: 'Health', type: 'roundtable-interest', roundtableId: 'rt-B' })]);
    const agent = await loginAs('chair-a@example.com'); // chair-a is on rt-A, not rt-B

    const res = await agent.get('/api/admin/campaigns/roundtable:rt-B/entries');

    expect(res.status).toBe(403);
  });

  test("a Chair gets 403 for an Initiative campaign outside their Roundtable", async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-B', name: 'Health' })]);
    seedInitiatives([makeInitiative({ id: 'init-1', title: 'Out of Scope', roundtableIds: ['rt-B'] })]);
    seedCampaigns([makeCampaign({ id: 'initiative:init-1', name: 'Out of Scope', type: 'initiative-interest', initiativeId: 'init-1' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.get('/api/admin/campaigns/initiative:init-1/entries');

    expect(res.status).toBe(403);
  });

  test('a Member is rejected — 403', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.get('/api/admin/campaigns/newsletter/entries');

    expect(res.status).toBe(403);
  });

  test('an unknown campaign id is 404', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.get('/api/admin/campaigns/no-such-campaign/entries');

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/campaigns/:id — Admin only', () => {
  test('a Chair is rejected — 403', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    seedRoundtables([makeRoundtable({ id: 'rt-A', name: 'Education' })]);
    await request(app).post('/api/roundtables/rt-A-slug/interest').send({ email: 'x@example.com', consent: true });
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.patch('/api/admin/campaigns/roundtable:rt-A').send({ notifyOnEntry: false });

    expect(res.status).toBe(403);
  });

  test('a logged-out request is rejected — 401', async () => {
    resetCampaignsTables();
    const res = await request(app).patch('/api/admin/campaigns/newsletter').send({ notifyOnEntry: false });
    expect(res.status).toBe(401);
  });

  test('Admin can set an explicit resultsEmails override, and clear it back to null (derived)', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');
    await agent.get('/api/admin/campaigns'); // ensures the site-wide campaigns exist first

    const setOverride = await agent.patch('/api/admin/campaigns/newsletter').send({ resultsEmails: ['One@Example.com', 'two@example.com'] });
    expect(setOverride.status).toBe(200);
    expect(setOverride.body.resultsEmails).toEqual(['one@example.com', 'two@example.com']);

    const clearOverride = await agent.patch('/api/admin/campaigns/newsletter').send({ resultsEmails: null });
    expect(clearOverride.status).toBe(200);
    expect(clearOverride.body.resultsEmails).toBeNull();
  });

  test('rejects an invalid email in resultsEmails with 400', async () => {
    resetCampaignsTables();
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');
    await agent.get('/api/admin/campaigns');

    const res = await agent.patch('/api/admin/campaigns/newsletter').send({ resultsEmails: ['not-an-email'] });

    expect(res.status).toBe(400);
  });
});
