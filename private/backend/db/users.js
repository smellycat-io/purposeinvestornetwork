// Admin user accounts — invites, login lookup, and password reset. Small
// table (a handful of PIN staff), so scan-all matches the convention already
// used by content.js/settings.js rather than needing a username/email index.
//
// Invite and reset tokens are generated as high-entropy random hex, emailed
// as the raw value, but only their SHA-256 hash is ever stored here — a
// DynamoDB read (or leak) alone can't be replayed as a usable link.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('../shared/passwords.js');

const AWS_REGION = process.env.AWS_REGION || undefined;
const USERS_TABLE = process.env.AWS_USERS_TABLE || null;

let docClient = null;
function getDocClient() {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
  }
  return docClient;
}

function makeId() {
  return crypto.randomUUID();
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function tokenMatches(candidateHash, storedHash) {
  if (!storedHash) return false;
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function listUsers() {
  if (!USERS_TABLE) return [];
  const result = await getDocClient().send(new ScanCommand({ TableName: USERS_TABLE }));
  return (result.Items || []).map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    status: u.status,
    createdAt: u.createdAt,
  }));
}

async function getUserById(id) {
  if (!USERS_TABLE) return null;
  const result = await getDocClient().send(new GetCommand({ TableName: USERS_TABLE, Key: { id } }));
  return result.Item || null;
}

async function findUserByUsername(username) {
  const items = await listAllRaw();
  return items.find((u) => u.username && u.username.toLowerCase() === String(username || '').toLowerCase()) || null;
}

async function findUserByEmail(email) {
  const items = await listAllRaw();
  return items.find((u) => u.email && u.email.toLowerCase() === String(email || '').toLowerCase()) || null;
}

async function listAllRaw() {
  if (!USERS_TABLE) return [];
  const result = await getDocClient().send(new ScanCommand({ TableName: USERS_TABLE }));
  return result.Items || [];
}

// Creates a pending invite. Username is deliberately not set here — the
// invitee picks their own when they accept.
async function createInvite(email) {
  const token = makeToken();
  const item = {
    id: makeId(),
    email,
    status: 'pending',
    inviteTokenHash: hashToken(token),
    inviteTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(), // 7 days
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: USERS_TABLE, Item: item }));
  return { user: item, token };
}

async function acceptInvite(token, username, password) {
  const candidateHash = hashToken(token);
  const items = await listAllRaw();
  const user = items.find((u) => u.status === 'pending' && tokenMatches(candidateHash, u.inviteTokenHash));
  if (!user) return { error: 'invalid_or_expired' };
  if (new Date(user.inviteTokenExpiresAt).getTime() < Date.now()) return { error: 'invalid_or_expired' };

  const item = {
    ...user,
    username,
    passwordHash: hashPassword(password),
    status: 'active',
    inviteTokenHash: null,
    inviteTokenExpiresAt: null,
    updatedAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: USERS_TABLE, Item: item }));
  return { user: item };
}

async function createPasswordReset(email) {
  const user = await findUserByEmail(email);
  if (!user || user.status !== 'active') return null;

  const token = makeToken();
  const item = {
    ...user,
    resetTokenHash: hashToken(token),
    resetTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // 1 hour
    updatedAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: USERS_TABLE, Item: item }));
  return { user: item, token };
}

async function resetPassword(token, newPassword) {
  const candidateHash = hashToken(token);
  const items = await listAllRaw();
  const user = items.find((u) => tokenMatches(candidateHash, u.resetTokenHash));
  if (!user) return { error: 'invalid_or_expired' };
  if (new Date(user.resetTokenExpiresAt).getTime() < Date.now()) return { error: 'invalid_or_expired' };

  const item = {
    ...user,
    passwordHash: hashPassword(newPassword),
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    updatedAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: USERS_TABLE, Item: item }));
  return { user: item };
}

async function updateOwnPassword(userId, currentPassword, newPassword) {
  const user = await getUserById(userId);
  if (!user) return { error: 'not_found' };
  if (!verifyPassword(currentPassword, user.passwordHash)) return { error: 'current_password_incorrect' };

  const item = { ...user, passwordHash: hashPassword(newPassword), updatedAt: new Date().toISOString() };
  await getDocClient().send(new PutCommand({ TableName: USERS_TABLE, Item: item }));
  return { user: item };
}

async function deleteUser(id) {
  if (!USERS_TABLE) return;
  await getDocClient().send(new DeleteCommand({ TableName: USERS_TABLE, Key: { id } }));
}

async function verifyLogin(username, password) {
  const user = await findUserByUsername(username);
  if (!user || user.status !== 'active') return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

module.exports = {
  listUsers,
  getUserById,
  findUserByUsername,
  findUserByEmail,
  createInvite,
  acceptInvite,
  createPasswordReset,
  resetPassword,
  updateOwnPassword,
  deleteUser,
  verifyLogin,
  hashToken,
};
