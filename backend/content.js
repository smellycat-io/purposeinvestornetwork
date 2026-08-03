const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const AWS_REGION = process.env.AWS_REGION || undefined;
const ROUNDTABLES_TABLE = process.env.AWS_ROUNDTABLES_TABLE || null;
const INITIATIVES_TABLE = process.env.AWS_INITIATIVES_TABLE || null;
const POSTS_TABLE = process.env.AWS_POSTS_TABLE || null;

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

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Scan-all is fine at this scale (a nonprofit's roundtables/initiatives/posts
// volume is small — dozens, not thousands). Revisit with a Query + GSI if
// that ever changes.
async function scanAll(tableName) {
  if (!tableName) return [];
  const client = getDocClient();
  const result = await client.send(new ScanCommand({ TableName: tableName }));
  return result.Items || [];
}

// --- Roundtables ---

async function listRoundtables() {
  return scanAll(ROUNDTABLES_TABLE);
}

async function getRoundtableBySlug(slug) {
  const items = await scanAll(ROUNDTABLES_TABLE);
  return items.find((r) => r.slug === slug) || null;
}

async function createRoundtable({ name, description }) {
  const item = {
    id: makeId(),
    name,
    slug: slugify(name),
    description: description || '',
    createdAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: ROUNDTABLES_TABLE, Item: item }));
  return item;
}

async function updateRoundtable(id, updates) {
  const items = await scanAll(ROUNDTABLES_TABLE);
  const existing = items.find((r) => r.id === id);
  if (!existing) return null;
  const item = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
  if (updates.name) item.slug = slugify(updates.name);
  await getDocClient().send(new PutCommand({ TableName: ROUNDTABLES_TABLE, Item: item }));
  return item;
}

async function deleteRoundtable(id) {
  await getDocClient().send(new DeleteCommand({ TableName: ROUNDTABLES_TABLE, Key: { id } }));
}

// --- Initiatives (many-to-many with roundtables via roundtableIds) ---

async function listInitiatives() {
  return scanAll(INITIATIVES_TABLE);
}

async function getInitiativeBySlug(slug) {
  const items = await scanAll(INITIATIVES_TABLE);
  return items.find((i) => i.slug === slug) || null;
}

async function listInitiativesForRoundtable(roundtableId) {
  const items = await scanAll(INITIATIVES_TABLE);
  return items.filter((i) => Array.isArray(i.roundtableIds) && i.roundtableIds.includes(roundtableId));
}

async function createInitiative({ title, description, roundtableIds }) {
  const item = {
    id: makeId(),
    title,
    slug: slugify(title),
    description: description || '',
    roundtableIds: Array.isArray(roundtableIds) ? roundtableIds : [],
    createdAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: INITIATIVES_TABLE, Item: item }));
  return item;
}

async function updateInitiative(id, updates) {
  const items = await scanAll(INITIATIVES_TABLE);
  const existing = items.find((i) => i.id === id);
  if (!existing) return null;
  const item = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
  if (updates.title) item.slug = slugify(updates.title);
  await getDocClient().send(new PutCommand({ TableName: INITIATIVES_TABLE, Item: item }));
  return item;
}

async function deleteInitiative(id) {
  await getDocClient().send(new DeleteCommand({ TableName: INITIATIVES_TABLE, Key: { id } }));
}

// --- Posts (unified: blog posts + initiative updates, distinguished by "type") ---

async function listPosts({ type, initiativeId } = {}) {
  let items = await scanAll(POSTS_TABLE);
  if (type) items = items.filter((p) => p.type === type);
  if (initiativeId) items = items.filter((p) => p.initiativeId === initiativeId);
  return items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

// A roundtable's feed = updates from every initiative linked to it
async function listPostsForRoundtable(roundtableId) {
  const initiatives = await listInitiativesForRoundtable(roundtableId);
  const initiativeIds = new Set(initiatives.map((i) => i.id));
  const items = await scanAll(POSTS_TABLE);
  return items
    .filter((p) => p.type === 'update' && initiativeIds.has(p.initiativeId))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

async function getPostBySlug(slug) {
  const items = await scanAll(POSTS_TABLE);
  return items.find((p) => p.slug === slug) || null;
}

async function createPost({ title, body, type, initiativeId, author }) {
  const postType = type === 'update' ? 'update' : 'blog';
  const item = {
    id: makeId(),
    title,
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    body: body || '',
    type: postType,
    initiativeId: postType === 'update' ? initiativeId || null : null,
    author: author || null,
    publishedAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: POSTS_TABLE, Item: item }));
  return item;
}

async function updatePost(id, updates) {
  const items = await scanAll(POSTS_TABLE);
  const existing = items.find((p) => p.id === id);
  if (!existing) return null;
  const item = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
  await getDocClient().send(new PutCommand({ TableName: POSTS_TABLE, Item: item }));
  return item;
}

async function deletePost(id) {
  await getDocClient().send(new DeleteCommand({ TableName: POSTS_TABLE, Key: { id } }));
}

module.exports = {
  listRoundtables,
  getRoundtableBySlug,
  createRoundtable,
  updateRoundtable,
  deleteRoundtable,
  listInitiatives,
  getInitiativeBySlug,
  listInitiativesForRoundtable,
  createInitiative,
  updateInitiative,
  deleteInitiative,
  listPosts,
  listPostsForRoundtable,
  getPostBySlug,
  createPost,
  updatePost,
  deletePost,
};
