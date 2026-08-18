// Local JSON-file fallback store for survey responses, analytics events, and
// newsletter subscribers. Survey responses are always written here in
// parallel with DynamoDB (see routes/survey-responses.js) so admin reads
// still work if Dynamo isn't configured; analytics events and subscribers
// only ever live here.
//
// Note: in Lambda this file lives at /tmp, which is wiped on cold start —
// subscriber signups aren't guaranteed durable in production unless this
// gets backed by DynamoDB too (same tradeoff survey responses already made).
const fs = require('fs');
const { join } = require('path');

const dbFile =
  process.env.DB_FILE ||
  (process.env.LAMBDA_TASK_ROOT ? join('/tmp', 'survey-store.json') : join(__dirname, '..', 'survey.db'));

const EMPTY_STORE = { surveyResponses: [], analyticsEvents: [], subscribers: [] };

function loadStore() {
  if (dbFile === ':memory:') {
    return { ...EMPTY_STORE };
  }

  const storePath = dbFile;
  const storeDir = join(storePath, '..');
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    const initialStore = { ...EMPTY_STORE };
    fs.writeFileSync(storePath, JSON.stringify(initialStore, null, 2));
    return initialStore;
  }

  try {
    const contents = fs.readFileSync(storePath, 'utf8');
    return { ...EMPTY_STORE, ...JSON.parse(contents) };
  } catch (err) {
    console.error('Unable to read store file:', err);
    return { ...EMPTY_STORE };
  }
}

const store = loadStore();

function persistStore() {
  if (dbFile === ':memory:') return;
  fs.writeFileSync(dbFile, JSON.stringify(store, null, 2));
}

function createStoreId() {
  return Date.now() + Math.floor(Math.random() * 1000000);
}

function saveSurveyResponseToStore(createdAt, email, payload) {
  const id = createStoreId();
  store.surveyResponses.push({ id, created_at: createdAt, email, payload });
  persistStore();
  return id;
}

function saveAnalyticsEventToStore(createdAt, event, properties, distinctId) {
  store.analyticsEvents.push({ created_at: createdAt, event, properties, distinct_id: distinctId });
  persistStore();
}

function saveSubscriberToStore(createdAt, email, source) {
  const id = createStoreId();
  store.subscribers.push({ id, created_at: createdAt, email, source: source || 'newsletter' });
  persistStore();
  return id;
}

module.exports = {
  store,
  saveSurveyResponseToStore,
  saveAnalyticsEventToStore,
  saveSubscriberToStore,
};
