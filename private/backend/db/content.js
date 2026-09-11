// Content tables. CRUD mechanics live in db/repository.js (one Repository
// per table); this file keeps only the entity-specific bits: field
// defaults and conditional logic on create, and the cross-entity queries
// that compose two tables (a roundtable's feed = its initiatives' updates).
const { Repository } = require('./repository.js');

const POST_TYPES = ['blog', 'update', 'education', 'announcement', 'book'];

const byDateDesc = (field) => (a, b) => new Date(b[field]) - new Date(a[field]);
const byDateAsc = (field) => (a, b) => new Date(a[field]) - new Date(b[field]);

const roundtables = new Repository(process.env.AWS_ROUNDTABLES_TABLE || null, { slugField: 'name' });
const initiatives = new Repository(process.env.AWS_INITIATIVES_TABLE || null, { slugField: 'title' });
const posts = new Repository(process.env.AWS_POSTS_TABLE || null, {
  slugField: 'title',
  slugSuffix: true,
  reslugOnUpdate: false, // keep post permalinks stable across title edits
  sortBy: byDateDesc('publishedAt'),
});
const press = new Repository(process.env.AWS_PRESS_TABLE || null, { sortBy: byDateDesc('publishedDate') });
const investments = new Repository(process.env.AWS_INVESTMENTS_TABLE || null, {
  slugField: 'title',
  slugSuffix: true,
  sortBy: byDateDesc('createdAt'),
});
const events = new Repository(process.env.AWS_EVENTS_TABLE || null, {
  slugField: 'title',
  slugSuffix: true,
  sortBy: byDateAsc('startsAt'),
});
const images = new Repository(process.env.AWS_IMAGES_TABLE || null, { sortBy: byDateDesc('uploadedAt') });

// --- Roundtables ---

const listRoundtables = () => roundtables.list();
const getRoundtableBySlug = (slug) => roundtables.getBySlug(slug);
const createRoundtable = ({ name, description, imageUrl }) =>
  roundtables.create({
    name,
    description: description || '',
    imageUrl: imageUrl || null,
    createdAt: new Date().toISOString(),
  });
const updateRoundtable = (id, updates) => roundtables.update(id, updates);
const deleteRoundtable = (id) => roundtables.delete(id);

// --- Initiatives (many-to-many with roundtables via roundtableIds) ---

const listInitiatives = () => initiatives.list();
const getInitiativeBySlug = (slug) => initiatives.getBySlug(slug);
const listInitiativesForRoundtable = (roundtableId) =>
  initiatives.list((i) => Array.isArray(i.roundtableIds) && i.roundtableIds.includes(roundtableId));
const createInitiative = ({ title, description, roundtableIds, imageUrl }) =>
  initiatives.create({
    title,
    description: description || '',
    roundtableIds: Array.isArray(roundtableIds) ? roundtableIds : [],
    imageUrl: imageUrl || null,
    createdAt: new Date().toISOString(),
  });
const updateInitiative = (id, updates) => initiatives.update(id, updates);
const deleteInitiative = (id) => initiatives.delete(id);

// --- Posts (unified: blog posts + initiative updates, distinguished by "type") ---

function listPosts({ type, initiativeId } = {}) {
  return posts.list((p) => (!type || p.type === type) && (!initiativeId || p.initiativeId === initiativeId));
}

// A roundtable's feed = updates from every initiative linked to it
async function listPostsForRoundtable(roundtableId) {
  const rtInitiatives = await listInitiativesForRoundtable(roundtableId);
  const initiativeIds = new Set(rtInitiatives.map((i) => i.id));
  return posts.list((p) => p.type === 'update' && initiativeIds.has(p.initiativeId));
}

const getPostBySlug = (slug) => posts.getBySlug(slug);

function createPost({ title, body, type, initiativeId, author, memberOnly, excerpt, imageUrl, purchaseUrl, price }) {
  const postType = POST_TYPES.includes(type) ? type : 'blog';
  return posts.create({
    title,
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
  });
}

const updatePost = (id, updates) => posts.update(id, updates);
const deletePost = (id) => posts.delete(id);

// --- Press (third-party mentions — always public, no memberOnly gating,
// but the field is still present on every row so shared/access.js never
// needs a type-specific branch) ---

const listPress = () => press.list();
const createPress = ({ title, source, publishedDate, externalUrl, excerpt }) =>
  press.create({
    title,
    source,
    publishedDate: publishedDate || new Date().toISOString(),
    externalUrl,
    excerpt: excerpt || null,
    memberOnly: false,
    createdAt: new Date().toISOString(),
  });
const updatePress = (id, updates) => press.update(id, { ...updates, memberOnly: false });
const deletePress = (id) => press.delete(id);

// --- Investments (portfolio/showcase — v1 is display-only, not a funding
// mechanism. memberOnly:true rows are hidden entirely from public reads,
// same binary-hide convention as Events.) ---

const listInvestments = () => investments.list();
const getInvestmentBySlug = (slug) => investments.getBySlug(slug);
const createInvestment = ({ title, initiativeId, roundtableIds, status, description, outcomeSummary, imageUrl, memberOnly }) =>
  investments.create({
    title,
    initiativeId: initiativeId || null,
    roundtableIds: Array.isArray(roundtableIds) ? roundtableIds : [],
    status: status === 'completed' ? 'completed' : 'open',
    description: description || '',
    outcomeSummary: outcomeSummary || null,
    imageUrl: imageUrl || null,
    memberOnly: !!memberOnly,
    createdAt: new Date().toISOString(),
  });
const updateInvestment = (id, updates) => investments.update(id, updates);
const deleteInvestment = (id) => investments.delete(id);

// --- Events (calendar — no RSVP/capacity in v1, just listing info.
// isConference flags the flagship "Conference" series for its own page.) ---

const listEvents = () => events.list();
const getEventBySlug = (slug) => events.getBySlug(slug);
const createEvent = ({ title, startsAt, endsAt, location, virtualLink, description, memberOnly, isConference, imageUrl }) =>
  events.create({
    title,
    startsAt,
    endsAt: endsAt || null,
    location: location || null,
    virtualLink: virtualLink || null,
    description: description || '',
    memberOnly: !!memberOnly,
    isConference: !!isConference,
    imageUrl: imageUrl || null,
    createdAt: new Date().toISOString(),
  });
const updateEvent = (id, updates) => events.update(id, updates);
const deleteEvent = (id) => events.delete(id);

// --- Images (a reusable library of uploaded images, so admins can browse
// and reuse past uploads instead of re-uploading the same photo) ---

const listImages = () => images.list();
const createImage = ({ url, filename, contentType, size }) =>
  images.create({
    url,
    filename: filename || null,
    contentType: contentType || null,
    size: size || null,
    uploadedAt: new Date().toISOString(),
  });

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
