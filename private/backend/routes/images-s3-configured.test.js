// AWS_S3_BUCKET must be set *before* shared/s3Client.js is first required
// (it decides once, at require time, whether to construct a real S3Client)
// — see images-unconfigured.test.js for why that split needs its own file
// rather than jest.resetModules()/isolateModules().
process.env.DB_FILE = ':memory:';
process.env.AWS_USERS_TABLE = 'test-users-table';
process.env.AWS_IMAGES_TABLE = 'test-images-table';
process.env.AWS_S3_BUCKET = 'test-bucket';

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
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { hashPassword } = require('../shared/passwords.js');

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
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
  ddbMock.on(PutCommand).resolves({});
  s3Mock.reset();
});

const { app } = require('../index');

async function loginAsAdmin() {
  const agent = request.agent(app);
  const res = await agent.post('/login').send({ email: admin1.email, password: PASSWORD });
  expect(res.status).toBe(302);
  return agent;
}

describe('POST /api/admin/uploads — S3 throws', () => {
  test('returns 500 with the real error folded into detail (route is behind requireRole)', async () => {
    s3Mock.on(PutObjectCommand).rejects(new Error('Access Denied'));
    const agent = await loginAsAdmin();

    const res = await agent
      .post('/api/admin/uploads')
      .send({ filename: 'photo.png', contentType: 'image/png', dataBase64: 'AA==' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to upload image.', detail: 'Access Denied' });
  });

  test('a successful upload still returns 201 with the image record', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const agent = await loginAsAdmin();

    const res = await agent
      .post('/api/admin/uploads')
      .send({ filename: 'photo.png', contentType: 'image/png', dataBase64: 'AA==' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ filename: 'photo.png', contentType: 'image/png' });
  });
});
