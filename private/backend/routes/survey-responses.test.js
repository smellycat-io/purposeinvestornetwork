// POST /api/survey's own save path is unchanged (see routes/
// survey-responses.js's header note) — this covers what *did* change: the
// free-month link now checks/updates the 'waitlist' Campaign entry via
// DynamoDB (db/campaigns.js) instead of db/store.js's old local-store
// version, and notifications go through notifyCampaign, gated by the
// 'survey' campaign's own notifyOnEntry flag.
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

describe('POST /api/survey — free-month linking, waitlist-first order', () => {
  test('a survey response after an existing waitlist entry links that entry', async () => {
    await request(app).post('/api/subscribe').send({ email: 'person@example.com', source: 'membership-waitlist' });
    expect(findEntry('waitlist', 'person@example.com').freeMonthEarned).toBeFalsy();

    const res = await request(app)
      .post('/api/survey')
      .send({ answers: { email: 'person@example.com', favorite: 'impact' } });

    expect(res.status).toBe(200);
    expect(res.body.alreadyOnWaitlist).toBe(true);

    const waitlistEntry = findEntry('waitlist', 'person@example.com');
    expect(waitlistEntry.freeMonthEarned).toBe(true);
    expect(waitlistEntry.surveyResponseId).toBe(res.body.dynamoId);
  });

  test('alreadyOnWaitlist is false when there is no matching waitlist entry', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ answers: { email: 'nobody-waitlisted@example.com', favorite: 'impact' } });

    expect(res.status).toBe(200);
    expect(res.body.alreadyOnWaitlist).toBe(false);
  });
});
