// Route-level tests for the Chair-scoping boundary added in Stage 2 of the
// role rollout (see docs/DATA-MODEL.md) — GET/PATCH/DELETE
// /api/admin/users[/:id] and PATCH /api/users/me. server.test.js covers
// generic route smoke tests; this file is scoped to the role/roundtable
// permission logic specifically, since it needs its own Users-table fixture
// data that server.test.js has no reason to carry.
process.env.AWS_USERS_TABLE = 'test-users-table';
process.env.DB_FILE = ':memory:';

// Same reasoning as server.test.js: the real DynamoDBSessionStore no-ops
// without a configured table, so a session set on one request is never
// retrievable on the next. Swap in an in-memory Store for real login flows.
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

// A tiny in-memory stand-in for the real Users table, wired so a
// PutCommand/DeleteCommand actually mutates what later Scan/Query/Get calls
// see — real enough to exercise a PATCH/DELETE against its own follow-up
// reads within one test, without depending on aws-sdk-client-mock's
// resolvesOnce() call-count ordering (each .on(Command) call resets its own
// counter — see db/users.test.js's comment on the same footgun).
let usersTable = [];

function seedUsers(users) {
  usersTable = users.map((u) => ({ ...u }));
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

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(ScanCommand).callsFake(() => ({ Items: usersTable }));
  ddbMock.on(QueryCommand).callsFake((input) => {
    const email = input.ExpressionAttributeValues[':email'];
    return { Items: usersTable.filter((u) => u.email === email) };
  });
  ddbMock.on(GetCommand).callsFake((input) => ({ Item: usersTable.find((u) => u.id === input.Key.id) }));
  ddbMock.on(PutCommand).callsFake((input) => {
    const idx = usersTable.findIndex((u) => u.id === input.Item.id);
    if (idx >= 0) usersTable[idx] = input.Item;
    else usersTable.push(input.Item);
    return {};
  });
  ddbMock.on(DeleteCommand).callsFake((input) => {
    usersTable = usersTable.filter((u) => u.id !== input.Key.id);
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
const memberAB = makeUser({ id: 'member-ab', email: 'member-ab@example.com', role: 'member', roundtableIds: ['rt-A', 'rt-B'] });
const memberB1 = makeUser({ id: 'member-b1', email: 'member-b1@example.com', role: 'member', roundtableIds: ['rt-B'] });

function freshRoster() {
  return [admin1, chairA, chairB, memberA1, memberAB, memberB1];
}

describe('GET /api/admin/users', () => {
  test('Admin sees everyone', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.get('/api/admin/users');

    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.id).sort()).toEqual(
      ['admin-1', 'chair-a', 'chair-b', 'member-a1', 'member-ab', 'member-b1'].sort()
    );
  });

  test('a Chair sees only Members whose roundtableIds includes their own Roundtable', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.get('/api/admin/users');

    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.id).sort()).toEqual(['member-a1', 'member-ab']);
  });

  test('a Member is not authorized to list users', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.get('/api/admin/users');

    expect(res.status).toBe(403);
  });

  test('a logged-out request is rejected', async () => {
    seedUsers(freshRoster());

    const res = await request(app).get('/api/admin/users');

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/admin/users/:id', () => {
  test("Admin can change any field, including role", async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.patch('/api/admin/users/member-b1').send({ firstName: 'Renamed', role: 'chair', roundtableId: 'rt-C' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Renamed');
    expect(res.body.user.role).toBe('chair');
    expect(res.body.user.roundtableId).toBe('rt-C');
    expect(res.body.user.roundtableIds).toEqual([]); // invariant enforced on role change
  });

  test('a Chair can remove their own Roundtable from a Member who belongs to more than one', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.patch('/api/admin/users/member-ab').send({ roundtableIds: ['rt-B'] });

    expect(res.status).toBe(200);
    expect(res.body.user.roundtableIds).toEqual(['rt-B']);
  });

  test('a Chair cannot add a different Roundtable to a Member under their own', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.patch('/api/admin/users/member-a1').send({ roundtableIds: ['rt-A', 'rt-C'] });

    expect(res.status).toBe(400);
  });

  test('a Chair cannot change role or other out-of-scope fields — rejected, not silently dropped', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.patch('/api/admin/users/member-a1').send({ role: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/);
  });

  test('a Chair cannot edit a Member outside their own Roundtable — 403', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.patch('/api/admin/users/member-b1').send({ roundtableIds: [] });

    expect(res.status).toBe(403);
  });

  test('a Chair cannot edit another Chair or an Admin, even by id guessing', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const chairRes = await agent.patch('/api/admin/users/chair-b').send({ roundtableIds: [] });
    const adminRes = await agent.patch('/api/admin/users/admin-1').send({ roundtableIds: [] });

    expect(chairRes.status).toBe(403);
    expect(adminRes.status).toBe(403);
  });

  test('404 for a nonexistent user', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.patch('/api/admin/users/does-not-exist').send({ firstName: 'X' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  test('Admin deletes the account outright', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.delete('/api/admin/users/member-b1');

    expect(res.status).toBe(204);
    expect(usersTable.find((u) => u.id === 'member-b1')).toBeUndefined();
  });

  test("a Chair removing a single-Roundtable Member removes them from the Roundtable, not the account", async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/users/member-a1');

    expect(res.status).toBe(204);
    const stillThere = usersTable.find((u) => u.id === 'member-a1');
    expect(stillThere).toBeDefined();
    expect(stillThere.roundtableIds).toEqual([]);
  });

  test('a Chair removing a multi-Roundtable Member only drops their own Roundtable', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/users/member-ab');

    expect(res.status).toBe(204);
    const stillThere = usersTable.find((u) => u.id === 'member-ab');
    expect(stillThere.roundtableIds).toEqual(['rt-B']);
  });

  test('a Chair cannot remove a Member outside their own Roundtable — 403, unchanged', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/users/member-b1');

    expect(res.status).toBe(403);
    expect(usersTable.find((u) => u.id === 'member-b1').roundtableIds).toEqual(['rt-B']);
  });

  test('a Chair cannot remove another Chair or an Admin', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const chairRes = await agent.delete('/api/admin/users/chair-b');
    const adminRes = await agent.delete('/api/admin/users/admin-1');

    expect(chairRes.status).toBe(403);
    expect(adminRes.status).toBe(403);
  });
});

describe('PATCH /api/users/me', () => {
  test('a Member can edit their own profile fields', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.patch('/api/users/me').send({ firstName: 'NewName', phone: '555-0100' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('NewName');
    expect(res.body.user.phone).toBe('555-0100');
  });

  test('role and roundtable fields are silently ignored, not applied and not errored', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent
      .patch('/api/users/me')
      .send({ firstName: 'NewName', role: 'admin', roundtableId: 'rt-Z', roundtableIds: ['rt-Z'] });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('NewName');
    expect(res.body.user.role).toBe('member');
    expect(res.body.user.roundtableIds).toEqual(['rt-A']);
  });

  test('a request cannot edit anyone else — always targets the session, never a body id', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.patch('/api/users/me').send({ id: 'member-b1', firstName: 'Hijacked' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('member-a1');
    expect(usersTable.find((u) => u.id === 'member-b1').firstName).not.toBe('Hijacked');
  });

  test('works the same for a Chair or Admin session', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.patch('/api/users/me').send({ firstName: 'ChairRenamed' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('ChairRenamed');
    expect(res.body.user.role).toBe('chair');
    expect(res.body.user.roundtableId).toBe('rt-A');
  });
});
