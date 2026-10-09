// User accounts — invites, login lookup, and password reset — for Admin,
// Chair, and Member roles (see docs/DATA-MODEL.md's Role & Permission
// Model). Email is the login identity (no separate username).
//
// Invite and reset tokens are generated as high-entropy random hex, emailed
// as the raw value, but only their SHA-256 hash is ever stored here — a
// DynamoDB read (or leak) alone can't be replayed as a usable link.
//
// Login lookup (findUserByEmail) queries the `email-index` GSI rather than
// scanning — Member volume is expected to reach the thousands, unlike the
// handful of PIN staff this table originally held. Every other lookup here
// (invite/reset token matching) stays scan-and-filter: tokens aren't a
// queryable key, and invite/reset volume stays low regardless of Member
// count. **The GSI must exist on the table before this code is deployed**
// (see docs/ARCHITECTURE.md's Users-table GSI note for the exact command) —
// querying a nonexistent index throws, and this is the login path.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  DeleteCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('../shared/passwords.js');

const AWS_REGION = process.env.AWS_REGION || undefined;
const USERS_TABLE = process.env.AWS_USERS_TABLE || null;
const EMAIL_INDEX = 'email-index';

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

// Emails are always stored lowercase (enforced here, at the one place a
// user item is first created) so the email-index GSI query below is a
// plain equality match — the old scan-and-filter did the case-folding at
// read time instead, which a Query against an index can't do.
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// The public shape of a user record — never includes passwordHash or any
// token field. listUsers/updateUser both return through this so that stays
// true by construction instead of by remembering to strip it at each call
// site (same reasoning as listUsers's original passwordHash omission).
function toPublicUser(u) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName || null,
    lastName: u.lastName || null,
    phone: u.phone || null,
    address: u.address || null,
    status: u.status,
    role: u.role || null,
    roundtableId: u.roundtableId || null,
    roundtableIds: u.roundtableIds || [],
    createdAt: u.createdAt,
  };
}

async function listUsers() {
  if (!USERS_TABLE) return [];
  const result = await getDocClient().send(new ScanCommand({ TableName: USERS_TABLE }));
  return (result.Items || []).map(toPublicUser);
}

async function getUserById(id) {
  if (!USERS_TABLE || !id) return null;
  const result = await getDocClient().send(new GetCommand({ TableName: USERS_TABLE, Key: { id } }));
  return result.Item || null;
}

async function findUserByEmail(email) {
  if (!USERS_TABLE) return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await getDocClient().send(new QueryCommand({
    TableName: USERS_TABLE,
    IndexName: EMAIL_INDEX,
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': normalized },
    Limit: 1,
  }));
  return (result.Items && result.Items[0]) || null;
}

async function listAllRaw() {
  if (!USERS_TABLE) return [];
  const result = await getDocClient().send(new ScanCommand({ TableName: USERS_TABLE }));
  return result.Items || [];
}

// Creates a pending invite. Personal info is deliberately not set here —
// the invitee fills it in themselves when they accept. `role` defaults to
// 'admin' when omitted, matching every account created before roles
// existed — callers created going forward (routes/users.js) always pass
// role explicitly. roundtableId/roundtableIds are normalized here (not
// trusted from the caller) so the admin/chair/member invariant from
// docs/DATA-MODEL.md — a Chair's roundtableId is always null for other
// roles, a Member's roundtableIds is always empty for other roles — holds
// regardless of what a caller passes.
async function createInvite(email, { role = 'admin', roundtableId = null, roundtableIds = [] } = {}) {
  const token = makeToken();
  const item = {
    id: makeId(),
    email: normalizeEmail(email),
    role,
    roundtableId: role === 'chair' ? roundtableId : null,
    roundtableIds: role === 'member' ? (roundtableIds || []) : [],
    status: 'pending',
    inviteTokenHash: hashToken(token),
    inviteTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(), // 7 days
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: USERS_TABLE, Item: item }));
  return { user: item, token };
}

async function acceptInvite(token, { firstName, lastName, phone, address, password }) {
  const candidateHash = hashToken(token);
  const items = await listAllRaw();
  const user = items.find((u) => u.status === 'pending' && tokenMatches(candidateHash, u.inviteTokenHash));
  if (!user) return { error: 'invalid_or_expired' };
  if (new Date(user.inviteTokenExpiresAt).getTime() < Date.now()) return { error: 'invalid_or_expired' };

  const item = {
    ...user,
    firstName,
    lastName,
    phone: phone || null,
    address: address || null,
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

// The only fields any caller (Admin editing another user, a Chair editing
// a Member's roundtableIds, or a user editing their own profile) is ever
// allowed to touch — status/tokens/passwordHash all have their own
// dedicated functions above and are deliberately not editable here.
// Route-level code (routes/users.js) decides which subset of *these* a
// given requester's role may actually submit; this is the outer bound, not
// the permission check itself.
const UPDATABLE_FIELDS = ['firstName', 'lastName', 'phone', 'address', 'role', 'roundtableId', 'roundtableIds'];

async function updateUser(id, fields) {
  const existing = await getUserById(id);
  if (!existing) return null;

  const updates = {};
  for (const key of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) updates[key] = fields[key];
  }

  // Same admin/chair/member invariant createInvite enforces at creation —
  // re-applied here only when `role` is actually part of *this* update, so
  // an unrelated field edit (e.g. just `phone`) can't silently wipe an
  // existing roundtableId/roundtableIds.
  if (Object.prototype.hasOwnProperty.call(updates, 'role')) {
    if (updates.role !== 'chair') updates.roundtableId = null;
    if (updates.role !== 'member') updates.roundtableIds = [];
  }

  const item = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
  await getDocClient().send(new PutCommand({ TableName: USERS_TABLE, Item: item }));
  return toPublicUser(item);
}

module.exports = {
  listUsers,
  getUserById,
  toPublicUser,
  findUserByEmail,
  createInvite,
  acceptInvite,
  createPasswordReset,
  resetPassword,
  updateOwnPassword,
  updateUser,
  deleteUser,
};
