// Route-level tests for fix/close-requireadmin-gaps: the remaining flat
// requireAdmin gates (Roundtables, Press, Events, Images, the /admin page
// itself) migrated to the role-aware requireRole, each with whatever
// Chair scoping actually makes sense for that resource (or none, where it
// doesn't — see each route file's own comments for why). One consolidated
// file rather than one per resource, since none of these four route files
// had an existing test file to extend, and this is meant to be the
// systematic "does every admin route reject the roles it should" check
// future gap-closure work (e.g. Campaigns) can keep extending.
process.env.AWS_USERS_TABLE = 'test-users-table';
process.env.AWS_ROUNDTABLES_TABLE = 'test-roundtables-table';
process.env.AWS_PRESS_TABLE = 'test-press-table';
process.env.AWS_EVENTS_TABLE = 'test-events-table';
process.env.AWS_IMAGES_TABLE = 'test-images-table';
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
const { hashPassword } = require('../shared/passwords.js');

const ddbMock = mockClient(DynamoDBDocumentClient);

const db = {
  'test-users-table': [],
  'test-roundtables-table': [],
  'test-press-table': [],
  'test-events-table': [],
  'test-images-table': [],
};

function seedUsers(users) {
  db['test-users-table'] = users.map((u) => ({ ...u }));
}

function seedRoundtables(items) {
  db['test-roundtables-table'] = items.map((i) => ({ ...i }));
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

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(ScanCommand).callsFake((input) => ({ Items: db[input.TableName] || [] }));
  ddbMock.on(QueryCommand).callsFake((input) => {
    const email = input.ExpressionAttributeValues[':email'];
    return { Items: (db['test-users-table'] || []).filter((u) => u.email === email) };
  });
  ddbMock.on(GetCommand).callsFake((input) => ({ Item: (db[input.TableName] || []).find((i) => i.id === input.Key.id) }));
  ddbMock.on(PutCommand).callsFake((input) => {
    const table = db[input.TableName] || (db[input.TableName] = []);
    const idx = table.findIndex((i) => i.id === input.Item.id);
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

async function loginAs(email) {
  const agent = request.agent(app);
  const res = await agent.post('/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/admin');
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

describe('GET /admin (dashboard page) — any logged-in role, no Member area yet', () => {
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

  test('a Member reaches the page — no Member-facing area exists yet to send them to instead', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.get('/admin');

    expect(res.status).toBe(200);
  });

  test('a logged-out request is redirected to /login', async () => {
    seedUsers(freshRoster());

    const res = await request(app).get('/admin');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
