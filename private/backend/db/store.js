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

// Free-month tracking: a waitlist subscriber (source:'membership-waitlist')
// who also completes the survey earns a free month. The two actions can
// happen in either order, so both save paths check for the other:
//   - saveSubscriberToStore checks for an existing survey response by email.
//   - linkSurveyToWaitlistSubscriber (called after a survey save) checks for
//     an existing waitlist subscriber by email.
function saveSubscriberToStore(createdAt, email, source, details) {
  const id = createStoreId();
  const extra = details || {};
  const resolvedSource = source || 'newsletter';
  const existingSurveyId = resolvedSource === 'membership-waitlist' ? findSurveyResponseIdByEmail(email) : null;
  store.subscribers.push({
    id,
    created_at: createdAt,
    email,
    source: resolvedSource,
    name: extra.name || null,
    phone: extra.phone || null,
    address: extra.address || null,
    tier: extra.tier || null,
    surveyResponseId: existingSurveyId,
    freeMonthEarned: !!existingSurveyId,
  });
  persistStore();
  return id;
}

function linkSurveyToWaitlistSubscriber(email, surveyResponseId) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  let linked = false;
  store.subscribers.forEach((sub) => {
    if (normalizeEmail(sub.email) === normalized && sub.source === 'membership-waitlist' && !sub.surveyResponseId) {
      sub.surveyResponseId = surveyResponseId;
      sub.freeMonthEarned = true;
      linked = true;
    }
  });
  if (linked) persistStore();
  return linked;
}

module.exports = {
  store,
  saveSurveyResponseToStore,
  saveAnalyticsEventToStore,
  saveSubscriberToStore,
  linkSurveyToWaitlistSubscriber,
};
