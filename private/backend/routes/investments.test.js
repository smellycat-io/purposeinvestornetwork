// Route-level tests for the Chair-scoping boundary added in Stage 3 of the
// role rollout (see docs/DATA-MODEL.md) — POST/PUT/DELETE
// /api/admin/investments[/:id]. Same shape as routes/initiatives.test.js;
// see its header comment for the mocking pattern.
process.env.AWS_USERS_TABLE = 'test-users-table';
process.env.AWS_INVESTMENTS_TABLE = 'test-investments-table';
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
  'test-investments-table': [],
};

function seedUsers(users) {
  db['test-users-table'] = users.map((u) => ({ ...u }));
}

function seedInvestments(items) {
  db['test-investments-table'] = items.map((i) => ({ ...i }));
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

function makeInvestment({ id, title = 'Test Investment', roundtableIds = [] }) {
  return {
    id,
    slug: `${id}-slug`,
    title,
    initiativeId: null,
    roundtableIds,
    status: 'open',
    description: 'desc',
    outcomeSummary: null,
    imageUrl: null,
    memberOnly: false,
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

describe('POST /api/admin/investments', () => {
  test('Admin can create with any roundtableIds', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.post('/api/admin/investments').send({ title: 'New Investment', roundtableIds: ['rt-B'] });

    expect(res.status).toBe(201);
    expect(res.body.roundtableIds).toEqual(['rt-B']);
  });

  test('a Chair can create within their own Roundtable', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.post('/api/admin/investments').send({ title: 'Chair Investment', roundtableIds: ['rt-A'] });

    expect(res.status).toBe(201);
    expect(res.body.roundtableIds).toEqual(['rt-A']);
  });

  test('a Chair cannot include other Roundtables alongside their own — 403', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent
      .post('/api/admin/investments')
      .send({ title: 'Joint Investment', roundtableIds: ['rt-A', 'rt-B'] });

    expect(res.status).toBe(403);
  });

  test('a Chair cannot create outside their own Roundtable — 403', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.post('/api/admin/investments').send({ title: 'Not Mine', roundtableIds: ['rt-B'] });

    expect(res.status).toBe(403);
  });

  test('a Member is not authorized to create', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.post('/api/admin/investments').send({ title: 'Nope', roundtableIds: ['rt-A'] });

    expect(res.status).toBe(403);
  });

  test('a logged-out request is rejected', async () => {
    seedUsers(freshRoster());

    const res = await request(app).post('/api/admin/investments').send({ title: 'Nope' });

    expect(res.status).toBe(401);
  });

  test('description/outcomeSummary are still sanitized on a Chair-authored create', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent
      .post('/api/admin/investments')
      .send({ title: 'Chair Investment', roundtableIds: ['rt-A'], description: '<script>alert(1)</script>Safe text' });

    expect(res.status).toBe(201);
    expect(res.body.description).not.toContain('<script>');
    expect(res.body.description).toContain('Safe text');
  });
});

describe('PUT /api/admin/investments/:id', () => {
  test('Admin can edit any Investment, including its roundtableIds', async () => {
    seedUsers(freshRoster());
    seedInvestments([makeInvestment({ id: 'inv-1', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.put('/api/admin/investments/inv-1').send({ title: 'Renamed', roundtableIds: ['rt-C'] });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
    expect(res.body.roundtableIds).toEqual(['rt-C']);
  });

  test('a Chair can edit an Investment within their own Roundtable', async () => {
    seedUsers(freshRoster());
    seedInvestments([makeInvestment({ id: 'inv-1', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/investments/inv-1').send({ title: 'Chair Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Chair Renamed');
  });

  test('a Chair can remove their own Roundtable from a multi-Roundtable Investment', async () => {
    seedUsers(freshRoster());
    seedInvestments([makeInvestment({ id: 'inv-1', roundtableIds: ['rt-A', 'rt-B'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/investments/inv-1').send({ roundtableIds: ['rt-B'] });

    expect(res.status).toBe(200);
    expect(res.body.roundtableIds).toEqual(['rt-B']);
  });

  test('a Chair cannot add a different Roundtable to an Investment under their own — 400', async () => {
    seedUsers(freshRoster());
    seedInvestments([makeInvestment({ id: 'inv-1', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/investments/inv-1').send({ roundtableIds: ['rt-A', 'rt-C'] });

    expect(res.status).toBe(400);
  });

  test('a Chair cannot edit an Investment outside their own Roundtable — 403', async () => {
    seedUsers(freshRoster());
    seedInvestments([makeInvestment({ id: 'inv-1', roundtableIds: ['rt-B'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/investments/inv-1').send({ title: 'Hijacked' });

    expect(res.status).toBe(403);
  });

  test('404 for a nonexistent Investment', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.put('/api/admin/investments/does-not-exist').send({ title: 'X' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/investments/:id', () => {
  test('Admin deletes any Investment', async () => {
    seedUsers(freshRoster());
    seedInvestments([makeInvestment({ id: 'inv-1', roundtableIds: ['rt-B'] })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.delete('/api/admin/investments/inv-1');

    expect(res.status).toBe(204);
    expect(db['test-investments-table'].find((i) => i.id === 'inv-1')).toBeUndefined();
  });

  test('a Chair deletes an Investment within their own Roundtable', async () => {
    seedUsers(freshRoster());
    seedInvestments([makeInvestment({ id: 'inv-1', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/investments/inv-1');

    expect(res.status).toBe(204);
    expect(db['test-investments-table'].find((i) => i.id === 'inv-1')).toBeUndefined();
  });

  test('a Chair cannot delete an Investment outside their own Roundtable — 403, unchanged', async () => {
    seedUsers(freshRoster());
    seedInvestments([makeInvestment({ id: 'inv-1', roundtableIds: ['rt-B'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/investments/inv-1');

    expect(res.status).toBe(403);
    expect(db['test-investments-table'].find((i) => i.id === 'inv-1')).toBeDefined();
  });
});
