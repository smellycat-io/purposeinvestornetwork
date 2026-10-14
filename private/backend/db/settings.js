// Single-row app settings. `notifyEmail` is a legacy field now: nothing
// writes it anymore (there's no admin UI for it — see routes/settings.js),
// and getEffectiveNotifyEmail is only still called once, by
// db/campaigns.js's ensureSiteWideCampaigns, to seed each site-wide
// Campaign's resultsEmails the first time it's ever created. After that
// one-time seed, notification recipients live on the Campaign rows
// themselves, not here. Deliberately its own DynamoDB table rather than
// content.js's scan-all tables or the local JSON store — this is one row,
// not a collection, and losing a value here to Lambda's ephemeral /tmp
// would be a worse failure mode than losing a typical subscriber signup.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const config = require('../shared/config.js');
const { hashPassword, verifyPassword } = require('../shared/passwords.js');

const AWS_REGION = process.env.AWS_REGION || undefined;
const SETTINGS_TABLE = process.env.AWS_SETTINGS_TABLE || null;
const SETTINGS_ID = 'singleton';

let docClient = null;
function getDocClient() {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
  }
  return docClient;
}

// Read-only access degrades gracefully when the table isn't configured
// (matches content.js's scanAll convention) — writes below intentionally
// don't, since a silently-failed settings save is worse than a loud error.
async function getSettings() {
  if (!SETTINGS_TABLE) return {};
  const result = await getDocClient().send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { id: SETTINGS_ID } }));
  return result.Item || {};
}

async function updateAdminPassword(newPassword) {
  if (!SETTINGS_TABLE) throw new Error('Settings table is not configured.');
  const current = await getSettings();
  const item = {
    ...current,
    id: SETTINGS_ID,
    adminPasswordHash: hashPassword(newPassword),
    updatedAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: SETTINGS_TABLE, Item: item }));
  return item;
}

// Once an admin sets a new password via the settings page, the stored hash
// takes over; until then, ADMIN_PASS (the GitHub-secret-configured value)
// is what bootstraps the very first login.
async function checkAdminPassword(candidate) {
  const settings = await getSettings();
  if (settings.adminPasswordHash) {
    return verifyPassword(candidate, settings.adminPasswordHash);
  }
  return candidate === config.ADMIN_PASS;
}

// The effective notify email — a stored override if one's been set via the
// settings page, otherwise the NOTIFY_EMAIL env var it was bootstrapped from.
async function getEffectiveNotifyEmail() {
  const settings = await getSettings();
  return settings.notifyEmail || config.NOTIFY_EMAIL || null;
}

module.exports = {
  getSettings,
  updateAdminPassword,
  verifyPassword,
  checkAdminPassword,
  getEffectiveNotifyEmail,
};
