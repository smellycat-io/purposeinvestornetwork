// Local JSON-file fallback store for survey responses and analytics
// events. Survey responses are always written here in parallel with
// DynamoDB (see routes/survey-responses.js) so admin reads still work if
// Dynamo isn't configured; analytics events only ever live here.
//
// Subscribers (newsletter/waitlist signups) used to live here too, but
// moved to the Campaigns tables (db/campaigns.js) — this file's /tmp
// storage is wiped on every Lambda cold start, which was a real durability
// gap for something as consequential as a membership waitlist signup.
//
// Note: survey responses themselves still have this same gap — they're
// not on this branch's scope to migrate (see docs/DATA-MODEL.md).
const fs = require('fs');
const { join } = require('path');

const dbFile =
  process.env.DB_FILE ||
  (process.env.LAMBDA_TASK_ROOT ? join('/tmp', 'survey-store.json') : join(__dirname, '..', 'survey.db'));

const EMPTY_STORE = { surveyResponses: [], analyticsEvents: [] };

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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// `recordId` is the string id also used as the DynamoDB item id (see
// routes/survey-responses.js) — stored alongside the local numeric `id` so
// the free-month linking below has one stable identifier to reference
// regardless of which persistence path (local store vs Dynamo) is active.
function saveSurveyResponseToStore(createdAt, email, payload, recordId) {
  const id = createStoreId();
  store.surveyResponses.push({ id, record_id: recordId || null, created_at: createdAt, email, payload });
  persistStore();
  return id;
}

// Used by db/campaigns.js's legacy-survey adapter to check for a matching
// survey response by email (the waitlist-signup side of free-month
// linking) when Dynamo isn't configured — the Dynamo-backed path does its
// own equivalent client-side matching, for the same reason (survey emails
// were never lowercased at save time, so an exact-match query would miss
// a differently-cased stored value).
function findSurveyResponseIdByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const match = store.surveyResponses.find((r) => normalizeEmail(r.email) === normalized);
  return match ? (match.record_id || match.id) : null;
}

function saveAnalyticsEventToStore(createdAt, event, properties, distinctId) {
  store.analyticsEvents.push({ created_at: createdAt, event, properties, distinct_id: distinctId });
  persistStore();
}

module.exports = {
  store,
  saveSurveyResponseToStore,
  saveAnalyticsEventToStore,
  findSurveyResponseIdByEmail,
};
