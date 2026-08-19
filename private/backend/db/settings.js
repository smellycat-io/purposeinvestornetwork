// Single-row app settings: the admin notification email override and the
// admin password hash. Deliberately its own DynamoDB table rather than
// content.js's scan-all tables or the local JSON store — this is one row,
// not a collection, and (unlike a subscriber signup) losing a password
// change to Lambda's ephemeral /tmp would actually lock the admin out.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');
const config = require('../shared/config.js');

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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// Read-only access degrades gracefully when the table isn't configured
// (matches content.js's scanAll convention) — writes below intentionally
// don't, since a silently-failed settings save is worse than a loud error.
async function getSettings() {
  if (!SETTINGS_TABLE) return {};
  const result = await getDocClient().send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { id: SETTINGS_ID } }));
  return result.Item || {};
}

async function updateNotifyEmail(email) {
  if (!SETTINGS_TABLE) throw new Error('Settings table is not configured.');
  const current = await getSettings();
  const item = { ...current, id: SETTINGS_ID, notifyEmail: email, updatedAt: new Date().toISOString() };
  await getDocClient().send(new PutCommand({ TableName: SETTINGS_TABLE, Item: item }));
  return item;
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
  updateNotifyEmail,
  updateAdminPassword,
  verifyPassword,
  checkAdminPassword,
  getEffectiveNotifyEmail,
};
