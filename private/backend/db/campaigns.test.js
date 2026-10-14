process.env.AWS_CAMPAIGNS_TABLE = 'test-campaigns-table';
process.env.AWS_CAMPAIGN_ENTRIES_TABLE = 'test-campaign-entries-table';
process.env.AWS_USERS_TABLE = 'test-users-table';
process.env.AWS_SETTINGS_TABLE = 'test-settings-table';
process.env.DB_FILE = ':memory:';
// AWS_DYNAMODB_TABLE deliberately left unset here, so db/campaigns.js's
// legacy-survey adapter takes the local-store path by default — the
// Dynamo-table path (and its LastEvaluatedKey paging) is exercised
// separately below via jest.isolateModules, since dynamoClient.js caches
// whether Dynamo is configured at require time.

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ConditionalCheckFailedException } = require('@aws-sdk/client-dynamodb');
const { hashPassword } = require('../shared/passwords.js');

const ddbMock = mockClient(DynamoDBDocumentClient);

const db = {
  'test-campaigns-table': [],
  'test-campaign-entries-table': [],
  'test-users-table': [],
  'test-settings-table': [],
};

function resetDb() {
  Object.keys(db).forEach((key) => { db[key] = []; });
}

function isEntryKey(obj) {
  return obj && Object.prototype.hasOwnProperty.call(obj, 'campaignId') && Object.prototype.hasOwnProperty.call(obj, 'email');
}

beforeEach(() => {
  ddbMock.reset();
  resetDb();

  ddbMock.on(GetCommand).callsFake((input) => {
    const table = db[input.TableName] || [];
    const match = isEntryKey(input.Key)
      ? table.find((i) => i.campaignId === input.Key.campaignId && i.email === input.Key.email)
      : table.find((i) => i.id === input.Key.id);
    return { Item: match };
  });

  ddbMock.on(PutCommand).callsFake((input) => {
    const table = db[input.TableName] || (db[input.TableName] = []);
    const matcher = isEntryKey(input.Item)
      ? (i) => i.campaignId === input.Item.campaignId && i.email === input.Item.email
      : (i) => i.id === input.Item.id;
    const idx = table.findIndex(matcher);

    if (input.ConditionExpression === 'attribute_not_exists(id)' && idx >= 0) {
      throw new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
    }

    if (idx >= 0) table[idx] = input.Item;
    else table.push(input.Item);
    return {};
  });

  ddbMock.on(QueryCommand).callsFake((input) => {
    const table = db[input.TableName] || [];
    const campaignId = input.ExpressionAttributeValues[':campaignId'];
    return { Items: table.filter((i) => i.campaignId === campaignId) };
  });

  ddbMock.on(ScanCommand).callsFake((input) => ({ Items: db[input.TableName] || [] }));
});

const campaignsDb = require('./campaigns.js');
const config = require('../shared/config.js');

function makeUser({ id, email, role, roundtableId = null, status = 'active' }) {
  return { id, email, role, roundtableId, status, passwordHash: hashPassword('x') };
}

describe('ensureCampaign / idempotent ensure', () => {
  test('creates the item on the first call', async () => {
    const created = await campaignsDb.ensureSiteWideCampaigns().then(() => campaignsDb.getCampaignById('survey'));
    expect(created).toMatchObject({ id: 'survey', type: 'survey', name: 'Survey', notifyOnEntry: true });
  });

  test('a second ensure call is a no-op, not an error, and does not overwrite the existing row', async () => {
    await campaignsDb.ensureRoundtableCampaign('rt-1', 'Education', 'owner-1');
    const firstResult = await campaignsDb.getCampaignById('roundtable:rt-1');

    // Calling again with different fields must not change anything already stored.
    await campaignsDb.ensureRoundtableCampaign('rt-1', 'A Totally Different Name', 'someone-else');
    const secondResult = await campaignsDb.getCampaignById('roundtable:rt-1');

    expect(secondResult).toEqual(firstResult);
    expect(secondResult.name).toBe('Education');
    expect(secondResult.ownerUserId).toBe('owner-1');
  });

  test('roundtable and initiative campaigns use deterministic ids', async () => {
    await campaignsDb.ensureRoundtableCampaign('rt-1', 'Education', null);
    await campaignsDb.ensureInitiativeCampaign('init-1', 'Scholarship Fund', null);

    expect(campaignsDb.roundtableCampaignId('rt-1')).toBe('roundtable:rt-1');
    expect(campaignsDb.initiativeCampaignId('init-1')).toBe('initiative:init-1');
    expect(await campaignsDb.getCampaignById('roundtable:rt-1')).toMatchObject({ type: 'roundtable-interest', roundtableId: 'rt-1' });
    expect(await campaignsDb.getCampaignById('initiative:init-1')).toMatchObject({ type: 'initiative-interest', initiativeId: 'init-1' });
  });
});

describe('ensureSiteWideCampaigns — seeding resultsEmails', () => {
  test('seeds resultsEmails from getEffectiveNotifyEmail on first creation', async () => {
    db['test-settings-table'] = [{ id: 'singleton', notifyEmail: 'ops@example.com' }];

    await campaignsDb.ensureSiteWideCampaigns();

    const survey = await campaignsDb.getCampaignById('survey');
    const waitlist = await campaignsDb.getCampaignById('waitlist');
    const newsletter = await campaignsDb.getCampaignById('newsletter');
    expect(survey.resultsEmails).toEqual(['ops@example.com']);
    expect(waitlist.resultsEmails).toEqual(['ops@example.com']);
    expect(newsletter.resultsEmails).toEqual(['ops@example.com']);
    expect(survey.notifyOnEntry).toBe(true);
    expect(waitlist.notifyOnEntry).toBe(true);
    expect(newsletter.notifyOnEntry).toBe(false);
  });

  test('never re-seeds after the row already exists, even if the settings value later changes', async () => {
    db['test-settings-table'] = [{ id: 'singleton', notifyEmail: 'first@example.com' }];
    await campaignsDb.ensureSiteWideCampaigns();

    db['test-settings-table'] = [{ id: 'singleton', notifyEmail: 'changed@example.com' }];
    await campaignsDb.ensureSiteWideCampaigns();

    const survey = await campaignsDb.getCampaignById('survey');
    expect(survey.resultsEmails).toEqual(['first@example.com']);
  });

  test('seeds null (not an empty array) when there is no notify email configured anywhere', async () => {
    await campaignsDb.ensureSiteWideCampaigns();
    const survey = await campaignsDb.getCampaignById('survey');
    expect(survey.resultsEmails).toBeNull();
  });
});

describe('resolveResultsEmails', () => {
  test('an explicit resultsEmails override wins, lowercased and deduped', async () => {
    const campaign = { type: 'newsletter', resultsEmails: ['Ops@Example.com', 'ops@example.com', 'second@example.com'] };
    expect(await campaignsDb.resolveResultsEmails(campaign)).toEqual(['ops@example.com', 'second@example.com']);
  });

  test('roundtable-interest with no override resolves to every active Chair of that Roundtable plus the owner', async () => {
    db['test-users-table'] = [
      makeUser({ id: 'chair-a', email: 'chair-a@example.com', role: 'chair', roundtableId: 'rt-1' }),
      makeUser({ id: 'chair-b', email: 'chair-b@example.com', role: 'chair', roundtableId: 'rt-OTHER' }),
      makeUser({ id: 'pending-chair', email: 'pending@example.com', role: 'chair', roundtableId: 'rt-1', status: 'pending' }),
      makeUser({ id: 'owner-1', email: 'owner@example.com', role: 'admin' }),
    ];
    const campaign = { type: 'roundtable-interest', roundtableId: 'rt-1', ownerUserId: 'owner-1', resultsEmails: null };

    const emails = await campaignsDb.resolveResultsEmails(campaign);

    expect(emails.sort()).toEqual(['chair-a@example.com', 'owner@example.com'].sort());
  });

  test('initiative-interest with no override resolves to just the owner, not any Chair', async () => {
    db['test-users-table'] = [
      makeUser({ id: 'chair-a', email: 'chair-a@example.com', role: 'chair', roundtableId: 'rt-1' }),
      makeUser({ id: 'owner-1', email: 'owner@example.com', role: 'admin' }),
    ];
    const campaign = { type: 'initiative-interest', initiativeId: 'init-1', ownerUserId: 'owner-1', resultsEmails: null };

    expect(await campaignsDb.resolveResultsEmails(campaign)).toEqual(['owner@example.com']);
  });

  test('falls back to config.NOTIFY_EMAIL when nothing else resolves', async () => {
    // config.NOTIFY_EMAIL is captured once at require time from
    // process.env — mutating the already-loaded config object directly
    // (rather than process.env + a re-require) avoids resetting Jest's
    // module registry, which would also hand db/campaigns.js's dependency
    // tree a *different* @aws-sdk/lib-dynamodb module than the one
    // mockClient() patched above.
    const original = config.NOTIFY_EMAIL;
    config.NOTIFY_EMAIL = 'fallback@example.com';
    try {
      const campaign = { type: 'newsletter', resultsEmails: null };
      expect(await campaignsDb.resolveResultsEmails(campaign)).toEqual(['fallback@example.com']);
    } finally {
      config.NOTIFY_EMAIL = original;
    }
  });

  test('returns an empty array (not a throw) when nothing resolves at all', async () => {
    const campaign = { type: 'initiative-interest', initiativeId: 'init-1', ownerUserId: null, resultsEmails: null };
    expect(await campaignsDb.resolveResultsEmails(campaign)).toEqual([]);
  });
});

describe('upsertEntry', () => {
  test('a first submission is new, with createdAt equal to updatedAt', async () => {
    const { entry, isNew } = await campaignsDb.upsertEntry('waitlist', 'Person@Example.com', {
      name: 'Pat', phone: null, address: null, consent: true, consentText: 'Joined membership waitlist',
    });

    expect(isNew).toBe(true);
    expect(entry.email).toBe('person@example.com'); // lowercased
    expect(entry.createdAt).toBe(entry.updatedAt);
    expect(entry.consent).toBe(true);
  });

  test('a resubmit keeps the original createdAt, updates updatedAt, and is not new', async () => {
    const first = await campaignsDb.upsertEntry('waitlist', 'person@example.com', {
      name: 'Pat', consent: false, consentText: 'Joined membership waitlist',
    });

    const second = await campaignsDb.upsertEntry('waitlist', 'person@example.com', {
      name: 'Patricia', consent: false, consentText: 'Joined membership waitlist',
    });

    expect(second.isNew).toBe(false);
    expect(second.entry.createdAt).toBe(first.entry.createdAt);
    expect(second.entry.name).toBe('Patricia');
  });

  test('an omitted or empty field on a resubmit keeps the previous value rather than blanking it', async () => {
    await campaignsDb.upsertEntry('waitlist', 'person@example.com', {
      name: 'Pat', phone: '555-1234', consent: true, consentText: 'x',
    });

    const { entry } = await campaignsDb.upsertEntry('waitlist', 'person@example.com', {
      name: '', phone: null, consent: true, consentText: 'x',
    });

    expect(entry.name).toBe('Pat');
    expect(entry.phone).toBe('555-1234');
  });

  test('consent is OR-ed with the existing value and is never revoked by a later unchecked submission', async () => {
    await campaignsDb.upsertEntry('waitlist', 'person@example.com', { consent: false, consentText: 'x' });
    const afterOptIn = await campaignsDb.upsertEntry('waitlist', 'person@example.com', { consent: true, consentText: 'x' });
    expect(afterOptIn.entry.consent).toBe(true);

    const afterUncheckedResubmit = await campaignsDb.upsertEntry('waitlist', 'person@example.com', { consent: false, consentText: 'x' });
    expect(afterUncheckedResubmit.entry.consent).toBe(true);
  });
});

describe('listEntriesForCampaign — pages through LastEvaluatedKey', () => {
  test('returns every entry across multiple Query pages', async () => {
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [{ campaignId: 'waitlist', email: 'a@example.com' }], LastEvaluatedKey: { email: 'a@example.com' } })
      .resolvesOnce({ Items: [{ campaignId: 'waitlist', email: 'b@example.com' }] });

    const entries = await campaignsDb.listEntriesForCampaign('waitlist');

    expect(entries.map((e) => e.email).sort()).toEqual(['a@example.com', 'b@example.com']);
  });
});

describe('free-month linking', () => {
  test('linkSurveyToWaitlistEntry updates an existing waitlist entry and returns true', async () => {
    await campaignsDb.upsertEntry('waitlist', 'person@example.com', { consent: true, consentText: 'x' });

    const linked = await campaignsDb.linkSurveyToWaitlistEntry('person@example.com', 'survey-record-1');

    expect(linked).toBe(true);
    const entry = await campaignsDb.getEntry('waitlist', 'person@example.com');
    expect(entry.surveyResponseId).toBe('survey-record-1');
    expect(entry.freeMonthEarned).toBe(true);
  });

  test('returns false when there is no waitlist entry for that email yet (survey-first order)', async () => {
    const linked = await campaignsDb.linkSurveyToWaitlistEntry('nobody@example.com', 'survey-record-1');
    expect(linked).toBe(false);
  });

  test('findLegacySurveyRecordIdByEmail finds a local-store survey response by email, case-insensitively', async () => {
    const { store, saveSurveyResponseToStore } = require('./store.js');
    saveSurveyResponseToStore(new Date().toISOString(), 'Person@Example.com', '{}', 'rec-1');

    const found = await campaignsDb.findLegacySurveyRecordIdByEmail('person@example.com');

    expect(found).toBe('rec-1');
    expect(store.surveyResponses.length).toBeGreaterThan(0); // sanity: this test actually wrote something
  });

  test('waitlist-first then survey: the waitlist entry starts unlinked and is linked once the survey is saved', async () => {
    const waitlistSave = await campaignsDb.upsertEntry('waitlist', 'person@example.com', {
      consent: true, consentText: 'x', surveyResponseId: null, freeMonthEarned: false,
    });
    expect(waitlistSave.entry.freeMonthEarned).toBe(false);

    const linked = await campaignsDb.linkSurveyToWaitlistEntry('person@example.com', 'rec-2');
    expect(linked).toBe(true);

    const entry = await campaignsDb.getEntry('waitlist', 'person@example.com');
    expect(entry.freeMonthEarned).toBe(true);
    expect(entry.surveyResponseId).toBe('rec-2');
  });
});

// The Dynamo-configured path for the legacy survey adapter (rather than
// the local-store path exercised above) needs AWS_DYNAMODB_TABLE set
// *before* db/campaigns.js and its dependency tree are first required —
// see db/campaigns-legacy-survey-dynamo.test.js, a separate file for
// exactly that reason (a fresh module registry per test file, no
// jest.resetModules()/isolateModules() needed or risked).
