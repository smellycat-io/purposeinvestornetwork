// Campaigns: one durable home for every "someone gave us their email"
// capture point — the survey, the newsletter, the membership waitlist, and
// now an always-on interest form on every Roundtable and Initiative page.
// Two tables:
//   - Campaigns (`AWS_CAMPAIGNS_TABLE`): HASH `id`. One row per campaign —
//     the three site-wide ones ('survey', 'waitlist', 'newsletter') plus
//     one per Roundtable/Initiative, created on demand. Repository-backed.
//   - Campaign entries (`AWS_CAMPAIGN_ENTRIES_TABLE`): HASH `campaignId`,
//     RANGE `email`. Keyed this way (not a generic `id`) so "every entry
//     for this campaign" is a native Query with no GSI, and so a second
//     submission from the same person updates one row instead of piling
//     up duplicates. Composite-key access doesn't fit Repository's
//     single-`id` assumption, so this table is hand-rolled below.
//
// Survey entries are the one exception: they're never written here at all
// (see routes/survey-responses.js — POST /api/survey's own save path is
// unchanged) and are instead read through an adapter at the bottom of this
// file, straight from the pre-Campaigns legacy sources (the Dynamo table
// or the local store). Migrating years of existing survey rows into this
// table wasn't worth doing just to make one admin tab's data source
// uniform.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { Repository } = require('./repository.js');
const { getUserById, listChairsForRoundtable } = require('./users.js');
const { getEffectiveNotifyEmail } = require('./settings.js');
const { dynamoDbDocClient, DYNAMODB_TABLE } = require('./dynamoClient.js');
const { store, findSurveyResponseIdByEmail } = require('./store.js');
const config = require('../shared/config.js');

const AWS_REGION = process.env.AWS_REGION || undefined;
const ENTRIES_TABLE = process.env.AWS_CAMPAIGN_ENTRIES_TABLE || null;

const campaigns = new Repository(process.env.AWS_CAMPAIGNS_TABLE || null);

let docClient = null;
function getDocClient() {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
  }
  return docClient;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function dedupeLowercased(emails) {
  return [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
}

const roundtableCampaignId = (roundtableId) => `roundtable:${roundtableId}`;
const initiativeCampaignId = (initiativeId) => `initiative:${initiativeId}`;

// The exact wording shown next to the consent checkbox, and the only
// place that composes it — used both for GET /api/roundtables/:slug and
// GET /api/initiatives/:slug's `interest.consentText` (what the visitor
// sees) and for the value stored on the entry at submission time, so the
// two can never drift apart.
function composeConsentText(name) {
  return `Yes, email me updates about ${name}.`;
}

// --- Campaigns table ---

async function getCampaignById(id) {
  return campaigns.getById(id);
}

async function listCampaigns() {
  return campaigns.list();
}

async function updateCampaign(id, updates) {
  return campaigns.update(id, updates);
}

async function archiveCampaign(id) {
  return campaigns.update(id, { archived: true });
}

async function ensureCampaign(id, fields) {
  const now = new Date().toISOString();
  return campaigns.createWithId(id, { ...fields, archived: false, createdAt: now, updatedAt: now });
}

// Idempotent by construction (ensureCampaign's conditional put): called on
// every GET /api/admin/campaigns, this only actually seeds resultsEmails
// the very first time each site-wide campaign is created. After that,
// PATCH /api/admin/campaigns/:id (an explicit Admin edit) is the only
// thing that changes it — this function never reads the settings notify
// email again once the row exists.
async function ensureSiteWideCampaigns() {
  const notifyEmail = await getEffectiveNotifyEmail();
  const seededEmails = notifyEmail ? [notifyEmail] : null;
  await Promise.all([
    ensureCampaign('survey', {
      name: 'Survey', type: 'survey', roundtableId: null, initiativeId: null,
      ownerUserId: null, resultsEmails: seededEmails, notifyOnEntry: true,
    }),
    ensureCampaign('waitlist', {
      name: 'Membership Waitlist', type: 'waitlist', roundtableId: null, initiativeId: null,
      ownerUserId: null, resultsEmails: seededEmails, notifyOnEntry: true,
    }),
    ensureCampaign('newsletter', {
      name: 'Newsletter', type: 'newsletter', roundtableId: null, initiativeId: null,
      ownerUserId: null, resultsEmails: seededEmails, notifyOnEntry: false,
    }),
  ]);
}

async function ensureRoundtableCampaign(roundtableId, name, ownerUserId) {
  return ensureCampaign(roundtableCampaignId(roundtableId), {
    name, type: 'roundtable-interest', roundtableId, initiativeId: null,
    ownerUserId: ownerUserId || null, resultsEmails: null, notifyOnEntry: true,
  });
}

async function ensureInitiativeCampaign(initiativeId, name, ownerUserId) {
  return ensureCampaign(initiativeCampaignId(initiativeId), {
    name, type: 'initiative-interest', roundtableId: null, initiativeId,
    ownerUserId: ownerUserId || null, resultsEmails: null, notifyOnEntry: true,
  });
}

// Recipient resolution — lowercased, deduped. `campaign.resultsEmails` is
// an explicit Admin override (set via PATCH); anything else is derived:
//   1. resultsEmails, if an Admin has set one
//   2. roundtable-interest: every active Chair of that Roundtable, plus
//      the campaign's owner (the Admin/Chair who created it)
//   3. initiative-interest: just the owner — an Initiative can span
//      several Roundtables, so there's no single "its Chair" to resolve to
//   4. config.NOTIFY_EMAIL as a last resort; if that's empty too, this
//      returns [] and the caller skips sending (the entry is still saved)
async function resolveResultsEmails(campaign) {
  if (Array.isArray(campaign.resultsEmails) && campaign.resultsEmails.length > 0) {
    return dedupeLowercased(campaign.resultsEmails);
  }

  const emails = [];
  if (campaign.type === 'roundtable-interest') {
    const chairs = await listChairsForRoundtable(campaign.roundtableId);
    emails.push(...chairs.map((c) => c.email));
    if (campaign.ownerUserId) {
      const owner = await getUserById(campaign.ownerUserId);
      if (owner && owner.email) emails.push(owner.email);
    }
  } else if (campaign.type === 'initiative-interest') {
    if (campaign.ownerUserId) {
      const owner = await getUserById(campaign.ownerUserId);
      if (owner && owner.email) emails.push(owner.email);
    }
  }

  if (emails.length === 0 && config.NOTIFY_EMAIL) {
    emails.push(config.NOTIFY_EMAIL);
  }

  return dedupeLowercased(emails);
}

// --- Campaign entries table (composite key: campaignId + email) ---

async function getEntry(campaignId, email) {
  if (!ENTRIES_TABLE) return null;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const result = await getDocClient().send(new GetCommand({
    TableName: ENTRIES_TABLE,
    Key: { campaignId, email: normalizedEmail },
  }));
  return result.Item || null;
}

async function listEntriesForCampaign(campaignId) {
  if (!ENTRIES_TABLE) return [];
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await getDocClient().send(new QueryCommand({
      TableName: ENTRIES_TABLE,
      KeyConditionExpression: 'campaignId = :campaignId',
      ExpressionAttributeValues: { ':campaignId': campaignId },
      ExclusiveStartKey,
    }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// Upsert on (campaignId, email): a second submission from the same person
// updates the one row instead of creating a duplicate. Every field except
// `consent` takes the latest non-empty value submitted (an omitted field
// on a resubmit keeps whatever was there before, rather than blanking it
// out) — `fields` only needs to carry what this particular submission
// actually provided. `consent` is the one deliberate exception: OR'd with
// whatever was already stored, never overwritten, because this form has
// no way to revoke consent, only to (re-)affirm it — an unchecked box on a
// later resubmission must not silently undo an earlier yes.
async function upsertEntry(campaignId, email, fields) {
  if (!ENTRIES_TABLE) throw new Error('Campaign entries table is not configured.');
  const normalizedEmail = normalizeEmail(email);
  const existing = await getEntry(campaignId, normalizedEmail);
  const now = new Date().toISOString();

  const merged = { ...existing };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'consent') continue;
    if (value !== null && value !== undefined && value !== '') {
      merged[key] = value;
    } else if (!(key in merged)) {
      merged[key] = value === undefined ? null : value;
    }
  }

  const item = {
    ...merged,
    campaignId,
    email: normalizedEmail,
    consent: !!(existing && existing.consent) || !!fields.consent,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  await getDocClient().send(new PutCommand({ TableName: ENTRIES_TABLE, Item: item }));
  return { entry: item, isNew: !existing };
}

// Shared by POST /api/roundtables/:slug/interest and POST
// /api/initiatives/:slug/interest — the only two callers, but the
// orchestration (compose consentText, upsert the entry) is identical for
// both, so it lives here rather than being copy-pasted between the two
// route files. Notification (notifyCampaign, if isNew && notifyOnEntry) is
// left to the caller, since it needs shared/email.js and the two routes'
// subject lines differ only by campaign.name, already resolved here.
async function recordInterestEntry(campaign, { email, name, message, consent }) {
  const consentText = composeConsentText(campaign.name);
  const { isNew } = await upsertEntry(campaign.id, email, {
    name: name || null,
    message: message || null,
    consent: !!consent,
    consentText,
  });
  return { isNew, consentText };
}

// --- Free-month linking (waitlist <-> survey), DynamoDB-backed ---
//
// Replaces db/store.js's old local-store version, which only worked when
// the JSON store file was actually durable (never true in Lambda, where it
// lives at /tmp and is wiped on cold start). The two save paths each check
// the other's current data directly, since either order is possible:
//   - A waitlist signup checks the legacy survey sources by email.
//   - A survey save checks the 'waitlist' campaign's entry by (campaignId,
//     email) and updates it in place.

// Called after a new survey response is saved (POST /api/survey, unchanged
// otherwise) — if this email already has a waitlist entry, credit it now.
async function linkSurveyToWaitlistEntry(email, surveyResponseId) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !surveyResponseId) return false;
  const existing = await getEntry('waitlist', normalizedEmail);
  if (!existing) return false;
  if (existing.surveyResponseId) return true; // already linked

  await getDocClient().send(new PutCommand({
    TableName: ENTRIES_TABLE,
    Item: { ...existing, surveyResponseId, freeMonthEarned: true, updatedAt: new Date().toISOString() },
  }));
  return true;
}

// --- Legacy survey entries adapter ("survey" is a campaign in the admin
// UI, but its rows live in the pre-Campaigns storage — see file header) ---

async function listLegacySurveyEntries() {
  if (dynamoDbDocClient) {
    const items = [];
    let ExclusiveStartKey;
    do {
      // No Limit here deliberately — the old GET /api/admin/survey-responses
      // capped at 200 and silently dropped the rest. Paging through
      // LastEvaluatedKey returns every response instead.
      const result = await dynamoDbDocClient.send(new ScanCommand({ TableName: DYNAMODB_TABLE, ExclusiveStartKey }));
      items.push(...(result.Items || []));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    return items
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((item) => ({ id: item.id, email: item.email || null, answers: item.answers, createdAt: item.createdAt }));
  }

  return store.surveyResponses
    .slice()
    .sort((a, b) => b.id - a.id)
    .map((row) => ({
      id: row.record_id || row.id,
      email: row.email || null,
      answers: JSON.parse(row.payload || '{}'),
      createdAt: row.created_at,
    }));
}

// Email matching is done client-side (not a DynamoDB FilterExpression)
// because survey emails were never lowercased at save time — the same
// case-insensitive comparison db/store.js's old local-store-only version
// used, now applied uniformly to both storage paths via
// listLegacySurveyEntries above.
async function findLegacySurveyRecordIdByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  if (!dynamoDbDocClient) return findSurveyResponseIdByEmail(normalizedEmail);
  const entries = await listLegacySurveyEntries();
  const match = entries.find((e) => normalizeEmail(e.email) === normalizedEmail);
  return match ? match.id : null;
}

module.exports = {
  roundtableCampaignId,
  initiativeCampaignId,
  composeConsentText,
  getCampaignById,
  listCampaigns,
  updateCampaign,
  archiveCampaign,
  ensureSiteWideCampaigns,
  ensureRoundtableCampaign,
  ensureInitiativeCampaign,
  resolveResultsEmails,
  recordInterestEntry,
  getEntry,
  listEntriesForCampaign,
  upsertEntry,
  linkSurveyToWaitlistEntry,
  listLegacySurveyEntries,
  findLegacySurveyRecordIdByEmail,
};
