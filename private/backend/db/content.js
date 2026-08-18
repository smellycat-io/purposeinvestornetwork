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
const IMAGES_TABLE = process.env.AWS_IMAGES_TABLE || null;
const PRESS_TABLE = process.env.AWS_PRESS_TABLE || null;
const INVESTMENTS_TABLE = process.env.AWS_INVESTMENTS_TABLE || null;
const EVENTS_TABLE = process.env.AWS_EVENTS_TABLE || null;

const POST_TYPES = ['blog', 'update', 'education', 'announcement', 'book'];

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

async function createRoundtable({ name, description, imageUrl }) {
  const item = {
    id: makeId(),
    name,
    slug: slugify(name),
    description: description || '',
    imageUrl: imageUrl || null,
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

async function createInitiative({ title, description, roundtableIds, imageUrl }) {
  const item = {
    id: makeId(),
    title,
    slug: slugify(title),
    description: description || '',
    roundtableIds: Array.isArray(roundtableIds) ? roundtableIds : [],
    imageUrl: imageUrl || null,
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

async function createPost({ title, body, type, initiativeId, author, memberOnly, excerpt, imageUrl, purchaseUrl, price }) {
  const postType = POST_TYPES.includes(type) ? type : 'blog';
  const item = {
    id: makeId(),
    title,
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    body: body || '',
    type: postType,
    initiativeId: postType === 'update' ? initiativeId || null : null,
    author: author || null,
    publishedAt: new Date().toISOString(),
    // Only 'education' posts ever set memberOnly:true; every other type
    // stays public. Kept on every row (rather than type-specific) so gating
    // helpers (shared/access.js) never need a type-specific branch.
    memberOnly: postType === 'education' ? !!memberOnly : false,
    excerpt: excerpt || null,
    imageUrl: imageUrl || null,
    // 'book' type only — the "Buy the Book" module.
    purchaseUrl: postType === 'book' ? purchaseUrl || null : null,
    price: postType === 'book' ? price || null : null,
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

// --- Press (third-party mentions — always public, no memberOnly gating,
// but the field is still present on every row so shared/access.js never
// needs a type-specific branch) ---

async function listPress() {
  const items = await scanAll(PRESS_TABLE);
  return items.sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate));
}

async function createPress({ title, source, publishedDate, externalUrl, excerpt }) {
  const item = {
    id: makeId(),
    title,
    source,
    publishedDate: publishedDate || new Date().toISOString(),
    externalUrl,
    excerpt: excerpt || null,
    memberOnly: false,
    createdAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: PRESS_TABLE, Item: item }));
  return item;
}

async function updatePress(id, updates) {
  const items = await scanAll(PRESS_TABLE);
  const existing = items.find((p) => p.id === id);
  if (!existing) return null;
  const item = { ...existing, ...updates, id, memberOnly: false, updatedAt: new Date().toISOString() };
  await getDocClient().send(new PutCommand({ TableName: PRESS_TABLE, Item: item }));
  return item;
}

async function deletePress(id) {
  await getDocClient().send(new DeleteCommand({ TableName: PRESS_TABLE, Key: { id } }));
}

// --- Investments (portfolio/showcase — v1 is display-only, not a funding
// mechanism. memberOnly:true rows are hidden entirely from public reads,
// same binary-hide convention as Events.) ---

async function listInvestments() {
  const items = await scanAll(INVESTMENTS_TABLE);
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getInvestmentBySlug(slug) {
  const items = await scanAll(INVESTMENTS_TABLE);
  return items.find((i) => i.slug === slug) || null;
}

async function createInvestment({ title, initiativeId, roundtableIds, status, description, outcomeSummary, imageUrl, memberOnly }) {
  const item = {
    id: makeId(),
    title,
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    initiativeId: initiativeId || null,
    roundtableIds: Array.isArray(roundtableIds) ? roundtableIds : [],
    status: status === 'completed' ? 'completed' : 'open',
    description: description || '',
    outcomeSummary: outcomeSummary || null,
    imageUrl: imageUrl || null,
    memberOnly: !!memberOnly,
    createdAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: INVESTMENTS_TABLE, Item: item }));
  return item;
}

async function updateInvestment(id, updates) {
  const items = await scanAll(INVESTMENTS_TABLE);
  const existing = items.find((i) => i.id === id);
  if (!existing) return null;
  const item = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
  if (updates.title) item.slug = slugify(updates.title);
  await getDocClient().send(new PutCommand({ TableName: INVESTMENTS_TABLE, Item: item }));
  return item;
}

async function deleteInvestment(id) {
  await getDocClient().send(new DeleteCommand({ TableName: INVESTMENTS_TABLE, Key: { id } }));
}

// --- Events (calendar — no RSVP/capacity in v1, just listing info.
// isConference flags the flagship "Conference" series for its own page.) ---

async function listEvents() {
  const items = await scanAll(EVENTS_TABLE);
  return items.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

async function getEventBySlug(slug) {
  const items = await scanAll(EVENTS_TABLE);
  return items.find((e) => e.slug === slug) || null;
}

async function createEvent({ title, startsAt, endsAt, location, virtualLink, description, memberOnly, isConference, imageUrl }) {
  const item = {
    id: makeId(),
    title,
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    startsAt,
    endsAt: endsAt || null,
    location: location || null,
    virtualLink: virtualLink || null,
    description: description || '',
    memberOnly: !!memberOnly,
    isConference: !!isConference,
    imageUrl: imageUrl || null,
    createdAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: EVENTS_TABLE, Item: item }));
  return item;
}

async function updateEvent(id, updates) {
  const items = await scanAll(EVENTS_TABLE);
  const existing = items.find((e) => e.id === id);
  if (!existing) return null;
  const item = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
  if (updates.title) item.slug = slugify(updates.title);
  await getDocClient().send(new PutCommand({ TableName: EVENTS_TABLE, Item: item }));
  return item;
}

async function deleteEvent(id) {
  await getDocClient().send(new DeleteCommand({ TableName: EVENTS_TABLE, Key: { id } }));
}

// --- Images (a reusable library of uploaded images, so admins can browse
// and reuse past uploads instead of re-uploading the same photo) ---

async function listImages() {
  const items = await scanAll(IMAGES_TABLE);
  return items.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

async function createImage({ url, filename, contentType, size }) {
  const item = {
    id: makeId(),
    url,
    filename: filename || null,
    contentType: contentType || null,
    size: size || null,
    uploadedAt: new Date().toISOString(),
  };
  await getDocClient().send(new PutCommand({ TableName: IMAGES_TABLE, Item: item }));
  return item;
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
  listPress,
  createPress,
  updatePress,
  deletePress,
  listInvestments,
  getInvestmentBySlug,
  createInvestment,
  updateInvestment,
  deleteInvestment,
  listEvents,
  getEventBySlug,
  createEvent,
  updateEvent,
  deleteEvent,
  listImages,
  createImage,
};
