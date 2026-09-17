// Route-level tests for the Chair-scoping boundary added in Stage 3 of the
// role rollout (see docs/DATA-MODEL.md) — POST/PUT/DELETE
// /api/admin/initiatives[/:id]. Same pattern as routes/users.test.js: an
// in-memory stand-in per table, keyed by TableName so Users (for login) and
// Initiatives can be mocked through the same DynamoDBDocumentClient.
process.env.AWS_USERS_TABLE = 'test-users-table';
process.env.AWS_INITIATIVES_TABLE = 'test-initiatives-table';
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

// Keyed by TableName so both Users (login) and Initiatives (the resource
// under test) can be driven through the same mocked client — see
// routes/users.test.js's comment on why a real-enough Put/Get/Delete round
// trip matters within a single test.
const db = {
  'test-users-table': [],
  'test-initiatives-table': [],
};

function seedUsers(users) {
  db['test-users-table'] = users.map((u) => ({ ...u }));
}

function seedInitiatives(items) {
  db['test-initiatives-table'] = items.map((i) => ({ ...i }));
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

function makeInitiative({ id, title = 'Test Initiative', roundtableIds = [] }) {
  return {
    id,
    slug: `${id}-slug`,
    title,
    description: 'desc',
    roundtableIds,
    imageUrl: null,
    createdAt: new Date().toISOString(),
  };
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
const memberA1 = makeUser({ id: 'member-a1', email: 'member-a1@example.com', role: 'member', roundtableIds: ['rt-A'] });

function freshRoster() {
  return [admin1, chairA, memberA1];
}

describe('POST /api/admin/initiatives', () => {
  test('Admin can create with any roundtableIds', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.post('/api/admin/initiatives').send({ title: 'New Initiative', roundtableIds: ['rt-B'] });

    expect(res.status).toBe(201);
    expect(res.body.roundtableIds).toEqual(['rt-B']);
  });

  test("a Chair can create within their own Roundtable", async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.post('/api/admin/initiatives').send({ title: 'Chair Initiative', roundtableIds: ['rt-A'] });

    expect(res.status).toBe(201);
    expect(res.body.roundtableIds).toEqual(['rt-A']);
  });

  test('a Chair can include other Roundtables alongside their own', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent
      .post('/api/admin/initiatives')
      .send({ title: 'Joint Initiative', roundtableIds: ['rt-A', 'rt-B'] });

    expect(res.status).toBe(201);
    expect(res.body.roundtableIds).toEqual(['rt-A', 'rt-B']);
  });

  test('a Chair cannot create outside their own Roundtable — 403', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.post('/api/admin/initiatives').send({ title: 'Not Mine', roundtableIds: ['rt-B'] });

    expect(res.status).toBe(403);
  });

  test('a Member is not authorized to create', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.post('/api/admin/initiatives').send({ title: 'Nope', roundtableIds: ['rt-A'] });

    expect(res.status).toBe(403);
  });

  test('a logged-out request is rejected', async () => {
    seedUsers(freshRoster());

    const res = await request(app).post('/api/admin/initiatives').send({ title: 'Nope' });

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/admin/initiatives/:id', () => {
  test('Admin can edit any Initiative, including its roundtableIds', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.put('/api/admin/initiatives/init-1').send({ title: 'Renamed', roundtableIds: ['rt-C'] });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
    expect(res.body.roundtableIds).toEqual(['rt-C']);
  });

  test('a Chair can edit an Initiative within their own Roundtable', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/initiatives/init-1').send({ title: 'Chair Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Chair Renamed');
  });

  test('a Chair can remove their own Roundtable from a multi-Roundtable Initiative', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-A', 'rt-B'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/initiatives/init-1').send({ roundtableIds: ['rt-B'] });

    expect(res.status).toBe(200);
    expect(res.body.roundtableIds).toEqual(['rt-B']);
  });

  test('a Chair cannot add a different Roundtable to an Initiative under their own — 400', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/initiatives/init-1').send({ roundtableIds: ['rt-A', 'rt-C'] });

    expect(res.status).toBe(400);
  });

  test("a Chair cannot remove another Roundtable's presence on a multi-Roundtable Initiative — 400", async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-A', 'rt-B'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/initiatives/init-1').send({ roundtableIds: ['rt-A'] });

    expect(res.status).toBe(400);
  });

  test('a Chair cannot edit an Initiative outside their own Roundtable — 403', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-B'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/initiatives/init-1').send({ title: 'Hijacked' });

    expect(res.status).toBe(403);
  });

  test('404 for a nonexistent Initiative', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.put('/api/admin/initiatives/does-not-exist').send({ title: 'X' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/initiatives/:id', () => {
  test('Admin deletes any Initiative', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-B'] })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.delete('/api/admin/initiatives/init-1');

    expect(res.status).toBe(204);
    expect(db['test-initiatives-table'].find((i) => i.id === 'init-1')).toBeUndefined();
  });

  test('a Chair deletes an Initiative within their own Roundtable', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/initiatives/init-1');

    expect(res.status).toBe(204);
    expect(db['test-initiatives-table'].find((i) => i.id === 'init-1')).toBeUndefined();
  });

  test('a Chair cannot delete an Initiative outside their own Roundtable — 403, unchanged', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-1', roundtableIds: ['rt-B'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/initiatives/init-1');

    expect(res.status).toBe(403);
    expect(db['test-initiatives-table'].find((i) => i.id === 'init-1')).toBeDefined();
  });

  test('404 for a nonexistent Initiative when a Chair deletes', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/initiatives/does-not-exist');

    expect(res.status).toBe(404);
  });
});
