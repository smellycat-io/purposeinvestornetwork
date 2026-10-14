// Covers db/campaigns.js's legacy-survey adapter on its Dynamo-configured
// path specifically — a separate file (rather than a describe block in
// campaigns.test.js) because dynamoDbDocClient is captured as a
// module-level constant at require time (db/dynamoClient.js), so
// AWS_DYNAMODB_TABLE must be set before db/campaigns.js is ever required
// in this process. Jest gives every test file its own fresh module
// registry, which is a clean way to get that without
// jest.resetModules()/isolateModules() — either of which would also hand
// the freshly-required code a *different* @aws-sdk/lib-dynamodb module
// than whatever mockClient() already patched in this file.
process.env.AWS_DYNAMODB_TABLE = 'test-legacy-survey-table';
process.env.AWS_CAMPAIGNS_TABLE = '';
process.env.AWS_CAMPAIGN_ENTRIES_TABLE = '';
process.env.AWS_USERS_TABLE = '';
process.env.AWS_SETTINGS_TABLE = '';
process.env.DB_FILE = ':memory:';

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const campaignsDb = require('./campaigns.js');

describe('legacy survey entries adapter — Dynamo-configured path', () => {
  test('pages through LastEvaluatedKey, returning every response across all pages', async () => {
    ddbMock.on(ScanCommand)
      .resolvesOnce({
        Items: [{ id: 'rec-1', email: 'first@example.com', answers: {}, createdAt: '2026-01-01T00:00:00.000Z' }],
        LastEvaluatedKey: { id: 'rec-1' },
      })
      .resolvesOnce({
        Items: [{ id: 'rec-2', email: 'second@example.com', answers: {}, createdAt: '2026-01-02T00:00:00.000Z' }],
      });

    const entries = await campaignsDb.listLegacySurveyEntries();

    expect(entries.map((e) => e.id).sort()).toEqual(['rec-1', 'rec-2']);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(2);
  });

  test('findLegacySurveyRecordIdByEmail matches case-insensitively, by scanning all pages client-side', async () => {
    ddbMock.on(ScanCommand)
      .resolvesOnce({
        Items: [{ id: 'rec-1', email: 'first@example.com', answers: {}, createdAt: '2026-01-01T00:00:00.000Z' }],
        LastEvaluatedKey: { id: 'rec-1' },
      })
      .resolvesOnce({
        Items: [{ id: 'rec-2', email: 'SECOND@Example.com', answers: {}, createdAt: '2026-01-02T00:00:00.000Z' }],
      });

    const found = await campaignsDb.findLegacySurveyRecordIdByEmail('second@example.com');

    expect(found).toBe('rec-2');
  });

  test('returns null when no response matches the email', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ id: 'rec-1', email: 'someone@example.com', answers: {}, createdAt: '2026-01-01T00:00:00.000Z' }] });

    const found = await campaignsDb.findLegacySurveyRecordIdByEmail('nobody@example.com');

    expect(found).toBeNull();
  });
});
