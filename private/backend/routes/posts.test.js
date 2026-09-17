// Route-level tests for the Chair-scoping boundary added in Stage 3 of the
// role rollout (see docs/DATA-MODEL.md) — POST/PUT/DELETE
// /api/admin/posts[/:id]. Posts don't carry roundtableIds directly, so a
// Chair's write access is authorized by resolving initiativeId -> that
// Initiative's roundtableIds -> contains the Chair's roundtableId; this
// file needs three tables mocked (Users, Initiatives, Posts) rather than
// the two routes/initiatives.test.js and routes/investments.test.js need.
// Same mocking pattern as those — see routes/initiatives.test.js's header
// comment.
process.env.AWS_USERS_TABLE = 'test-users-table';
process.env.AWS_INITIATIVES_TABLE = 'test-initiatives-table';
process.env.AWS_POSTS_TABLE = 'test-posts-table';
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
  'test-initiatives-table': [],
  'test-posts-table': [],
};

function seedUsers(users) {
  db['test-users-table'] = users.map((u) => ({ ...u }));
}

function seedInitiatives(items) {
  db['test-initiatives-table'] = items.map((i) => ({ ...i }));
}

function seedPosts(items) {
  db['test-posts-table'] = items.map((p) => ({ ...p }));
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
  return { id, slug: `${id}-slug`, title, description: 'desc', roundtableIds, imageUrl: null, createdAt: new Date().toISOString() };
}

function makePost({ id, title = 'Test Post', type = 'update', initiativeId = null }) {
  return {
    id,
    slug: `${id}-slug`,
    title,
    body: 'body',
    type,
    initiativeId,
    author: null,
    publishedAt: new Date().toISOString(),
    memberOnly: false,
    excerpt: null,
    imageUrl: null,
    purchaseUrl: null,
    price: null,
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

describe('POST /api/admin/posts', () => {
  test('Admin can create any post type', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.post('/api/admin/posts').send({ title: 'Blog Post', type: 'blog', body: 'hi' });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('blog');
  });

  test('a Chair can post an update to an Initiative under their own Roundtable', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-a', roundtableIds: ['rt-A'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent
      .post('/api/admin/posts')
      .send({ title: 'RT Update', type: 'update', initiativeId: 'init-a', body: 'progress' });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('update');
    expect(res.body.initiativeId).toBe('init-a');
  });

  test('a Chair cannot create a non-update post type — 403', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.post('/api/admin/posts').send({ title: 'Blog Post', type: 'blog', body: 'hi' });

    expect(res.status).toBe(403);
  });

  test("a Chair cannot post an update to an Initiative outside their own Roundtable — 403", async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-b', roundtableIds: ['rt-B'] })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent
      .post('/api/admin/posts')
      .send({ title: 'Not Mine', type: 'update', initiativeId: 'init-b', body: 'progress' });

    expect(res.status).toBe(403);
  });

  test('a Chair cannot post an update with no initiativeId — 403', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.post('/api/admin/posts').send({ title: 'No Initiative', type: 'update', body: 'progress' });

    expect(res.status).toBe(403);
  });

  test('a Member is not authorized to create', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('member-a1@example.com');

    const res = await agent.post('/api/admin/posts').send({ title: 'Nope', type: 'blog' });

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/posts/:id', () => {
  test('Admin can edit any post', async () => {
    seedUsers(freshRoster());
    seedPosts([makePost({ id: 'post-1', type: 'blog', initiativeId: null })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.put('/api/admin/posts/post-1').send({ title: 'Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
  });

  test('a Chair can edit an update-type post whose Initiative is in scope', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-a', roundtableIds: ['rt-A'] })]);
    seedPosts([makePost({ id: 'post-1', type: 'update', initiativeId: 'init-a' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/posts/post-1').send({ title: 'Chair Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Chair Renamed');
  });

  test("a Chair cannot edit an update-type post whose Initiative is out of scope — 403", async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-b', roundtableIds: ['rt-B'] })]);
    seedPosts([makePost({ id: 'post-1', type: 'update', initiativeId: 'init-b' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/posts/post-1').send({ title: 'Hijacked' });

    expect(res.status).toBe(403);
  });

  test('a Chair cannot edit a non-update post — 403', async () => {
    seedUsers(freshRoster());
    seedPosts([makePost({ id: 'post-1', type: 'blog', initiativeId: null })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/posts/post-1').send({ title: 'Hijacked' });

    expect(res.status).toBe(403);
  });

  test("a Chair cannot change a post's type away from update — 400", async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-a', roundtableIds: ['rt-A'] })]);
    seedPosts([makePost({ id: 'post-1', type: 'update', initiativeId: 'init-a' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/posts/post-1').send({ type: 'blog' });

    expect(res.status).toBe(400);
  });

  test('a Chair cannot move a post to an Initiative outside their own Roundtable — 400', async () => {
    seedUsers(freshRoster());
    seedInitiatives([
      makeInitiative({ id: 'init-a', roundtableIds: ['rt-A'] }),
      makeInitiative({ id: 'init-b', roundtableIds: ['rt-B'] }),
    ]);
    seedPosts([makePost({ id: 'post-1', type: 'update', initiativeId: 'init-a' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/posts/post-1').send({ initiativeId: 'init-b' });

    expect(res.status).toBe(400);
  });

  test('a Chair can move a post to a different Initiative within their own Roundtable', async () => {
    seedUsers(freshRoster());
    seedInitiatives([
      makeInitiative({ id: 'init-a', roundtableIds: ['rt-A'] }),
      makeInitiative({ id: 'init-a2', roundtableIds: ['rt-A'] }),
    ]);
    seedPosts([makePost({ id: 'post-1', type: 'update', initiativeId: 'init-a' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.put('/api/admin/posts/post-1').send({ initiativeId: 'init-a2' });

    expect(res.status).toBe(200);
    expect(res.body.initiativeId).toBe('init-a2');
  });

  test('404 for a nonexistent post', async () => {
    seedUsers(freshRoster());
    const agent = await loginAs('admin@example.com');

    const res = await agent.put('/api/admin/posts/does-not-exist').send({ title: 'X' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/posts/:id', () => {
  test('Admin deletes any post', async () => {
    seedUsers(freshRoster());
    seedPosts([makePost({ id: 'post-1', type: 'blog', initiativeId: null })]);
    const agent = await loginAs('admin@example.com');

    const res = await agent.delete('/api/admin/posts/post-1');

    expect(res.status).toBe(204);
    expect(db['test-posts-table'].find((p) => p.id === 'post-1')).toBeUndefined();
  });

  test('a Chair deletes an update-type post whose Initiative is in scope', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-a', roundtableIds: ['rt-A'] })]);
    seedPosts([makePost({ id: 'post-1', type: 'update', initiativeId: 'init-a' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/posts/post-1');

    expect(res.status).toBe(204);
    expect(db['test-posts-table'].find((p) => p.id === 'post-1')).toBeUndefined();
  });

  test('a Chair cannot delete a post outside their own Roundtable — 403, unchanged', async () => {
    seedUsers(freshRoster());
    seedInitiatives([makeInitiative({ id: 'init-b', roundtableIds: ['rt-B'] })]);
    seedPosts([makePost({ id: 'post-1', type: 'update', initiativeId: 'init-b' })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/posts/post-1');

    expect(res.status).toBe(403);
    expect(db['test-posts-table'].find((p) => p.id === 'post-1')).toBeDefined();
  });

  test('a Chair cannot delete a non-update post — 403', async () => {
    seedUsers(freshRoster());
    seedPosts([makePost({ id: 'post-1', type: 'blog', initiativeId: null })]);
    const agent = await loginAs('chair-a@example.com');

    const res = await agent.delete('/api/admin/posts/post-1');

    expect(res.status).toBe(403);
    expect(db['test-posts-table'].find((p) => p.id === 'post-1')).toBeDefined();
  });
});
