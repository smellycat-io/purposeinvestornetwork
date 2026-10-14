// AWS_S3_BUCKET is deliberately left unset (blanked by test/setupEnv.js) so
// shared/s3Client.js's s3Client stays null at require time — a separate
// file from images-s3-configured.test.js for exactly that reason: whether
// S3 is configured is captured once, at require time, so the two states
// need two fresh module registries, not a single file juggling
// jest.resetModules()/isolateModules() (which would also hand the
// freshly-required code a *different* @aws-sdk/client-s3 module than
// whatever a mockClient() call already patched).
process.env.DB_FILE = ':memory:';
process.env.AWS_USERS_TABLE = 'test-users-table';

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
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { hashPassword } = require('../shared/passwords.js');

const ddbMock = mockClient(DynamoDBDocumentClient);
const PASSWORD = 'correct-horse-battery-staple';

const admin1 = {
  id: 'admin-1',
  email: 'admin@example.com',
  status: 'active',
  passwordHash: hashPassword(PASSWORD),
  role: 'admin',
  roundtableId: null,
  roundtableIds: [],
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(QueryCommand).callsFake((input) => ({
    Items: [admin1].filter((u) => u.email === input.ExpressionAttributeValues[':email']),
  }));
});

const { app } = require('../index');

async function loginAsAdmin() {
  const agent = request.agent(app);
  const res = await agent.post('/login').send({ email: admin1.email, password: PASSWORD });
  expect(res.status).toBe(302);
  return agent;
}

describe('POST /api/admin/uploads — S3 unconfigured', () => {
  test('returns 503 with a message, and never reaches S3', async () => {
    const agent = await loginAsAdmin();

    const res = await agent
      .post('/api/admin/uploads')
      .send({ filename: 'photo.png', contentType: 'image/png', dataBase64: 'AA==' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Image uploads are not configured.' });
  });
});
