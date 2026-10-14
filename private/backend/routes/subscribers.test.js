// Regression coverage for removing membership-tier pricing (see
// docs/DATA-MODEL.md / the become-a-member.html pricing removal): a `tier`
// in the request body must be ignored, not merely unused by the front-end
// — the saved entry should never carry one. Also covers the free-month
// link (db/campaigns.js's DynamoDB-backed version — see its own header
// comment for why this replaced db/store.js's local-store version).
process.env.DB_FILE = ':memory:';
process.env.AWS_CAMPAIGNS_TABLE = 'test-campaigns-table';
process.env.AWS_CAMPAIGN_ENTRIES_TABLE = 'test-campaign-entries-table';

const request = require('supertest');
const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddbMock = mockClient(DynamoDBDocumentClient);

const db = {
  'test-campaigns-table': [],
  'test-campaign-entries-table': [],
};

beforeEach(() => {
  ddbMock.reset();
  db['test-campaigns-table'] = [];
  db['test-campaign-entries-table'] = [];

  ddbMock.on(GetCommand).callsFake((input) => {
    const table = db[input.TableName] || [];
    const match = Object.prototype.hasOwnProperty.call(input.Key, 'email')
      ? table.find((i) => i.campaignId === input.Key.campaignId && i.email === input.Key.email)
      : table.find((i) => i.id === input.Key.id);
    return { Item: match };
  });

  ddbMock.on(PutCommand).callsFake((input) => {
    const table = db[input.TableName] || (db[input.TableName] = []);
    const matcher = Object.prototype.hasOwnProperty.call(input.Item, 'email') && Object.prototype.hasOwnProperty.call(input.Item, 'campaignId')
      ? (i) => i.campaignId === input.Item.campaignId && i.email === input.Item.email
      : (i) => i.id === input.Item.id;
    const idx = table.findIndex(matcher);
    if (idx >= 0) table[idx] = input.Item;
    else table.push(input.Item);
    return {};
  });

  ddbMock.on(ScanCommand).callsFake((input) => ({ Items: db[input.TableName] || [] }));
});

const { app } = require('../index');

function findEntry(campaignId, email) {
  return db['test-campaign-entries-table'].find((e) => e.campaignId === campaignId && e.email === email);
}

describe('POST /api/subscribe', () => {
  test('a tier in the request body is ignored — the saved entry has no tier field', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .send({
        email: 'waitlist@example.com',
        name: 'Jane Doe',
        phone: '555-0100',
        address: '123 Main St, Springfield, IL 00000',
        tier: 'Vetted Investor',
        source: 'membership-waitlist',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });

    const saved = findEntry('waitlist', 'waitlist@example.com');
    expect(saved).toMatchObject({
      campaignId: 'waitlist',
      email: 'waitlist@example.com',
      name: 'Jane Doe',
      phone: '555-0100',
      address: '123 Main St, Springfield, IL 00000',
      consent: true,
      consentText: 'Joined membership waitlist',
    });
    expect(saved.tier).toBeUndefined();
    expect(saved.freeMonthEarned).toBeFalsy();
  });

  test('a waitlist signup after an existing survey response earns the free month immediately', async () => {
    // Seed a legacy survey response by email via the public POST /api/survey
    // route, so this exercises the real save path rather than hand-seeding
    // the local store directly.
    await request(app).post('/api/survey').send({ answers: { email: 'both@example.com', favorite: 'impact' } });

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'Both@Example.com', source: 'membership-waitlist' });

    expect(res.status).toBe(201);
    const saved = findEntry('waitlist', 'both@example.com');
    expect(saved.freeMonthEarned).toBe(true);
    expect(saved.surveyResponseId).toBeTruthy();
  });
});
