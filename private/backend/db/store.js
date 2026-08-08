// Local JSON-file fallback store for survey responses and analytics events.
// Survey responses are always written here in parallel with DynamoDB (see
// routes/survey-responses.js) so admin reads still work if Dynamo isn't
// configured; analytics events only ever live here.
const fs = require('fs');
const { join } = require('path');

const dbFile =
  process.env.DB_FILE ||
  (process.env.LAMBDA_TASK_ROOT ? join('/tmp', 'survey-store.json') : join(__dirname, '..', 'survey.db'));

function loadStore() {
  if (dbFile === ':memory:') {
    return { surveyResponses: [], analyticsEvents: [] };
  }

  const storePath = dbFile;
  const storeDir = join(storePath, '..');
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    const initialStore = { surveyResponses: [], analyticsEvents: [] };
    fs.writeFileSync(storePath, JSON.stringify(initialStore, null, 2));
    return initialStore;
  }

  try {
    const contents = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(contents);
  } catch (err) {
    console.error('Unable to read store file:', err);
    return { surveyResponses: [], analyticsEvents: [] };
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

module.exports = { store, saveSurveyResponseToStore, saveAnalyticsEventToStore };
