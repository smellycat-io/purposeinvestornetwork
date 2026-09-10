// Generic DynamoDB CRUD for the content tables (Roundtables, Initiatives,
// Posts, Press, Investments, Events). Every one of those was hand-rolling
// the same scan-find-merge-put; this centralizes it. Scan-all is fine at
// this scale (a nonprofit's content volume is dozens, not thousands) —
// revisit with Query + a GSI only if that ever changes.
//
// Entity-specific field defaults and conditional logic stay in content.js's
// createX() functions — this class only owns the persistence mechanics and
// the handful of things that genuinely vary per table: which field the slug
// derives from, whether create appends a uniqueness suffix, whether update
// re-derives the slug, and default list sort order.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const AWS_REGION = process.env.AWS_REGION || undefined;

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

class Repository {
  constructor(tableName, options = {}) {
    this.tableName = tableName;
    this.slugField = options.slugField || null;
    // Append `-${Date.now().toString(36)}` to the create-time slug so
    // same-titled rows don't collide (Posts / Investments / Events do this;
    // Roundtables / Initiatives don't).
    this.slugSuffix = options.slugSuffix || false;
    // Re-derive the slug when slugField changes on update. Defaults true;
    // Posts opts out to keep permalinks stable across title edits.
    this.reslugOnUpdate = options.reslugOnUpdate !== false;
    this.sortBy = options.sortBy || null;
  }

  async scanAll() {
    if (!this.tableName) return [];
    const result = await getDocClient().send(new ScanCommand({ TableName: this.tableName }));
    return result.Items || [];
  }

  async list(filterFn) {
    let items = await this.scanAll();
    if (filterFn) items = items.filter(filterFn);
    if (this.sortBy) items = items.slice().sort(this.sortBy);
    return items;
  }

  async getById(id) {
    const items = await this.scanAll();
    return items.find((i) => i.id === id) || null;
  }

  async getBySlug(slug) {
    const items = await this.scanAll();
    return items.find((i) => i.slug === slug) || null;
  }

  // `fields` is the fully-formed entity body (its own timestamp field
  // included — createdAt vs publishedAt vs uploadedAt varies per table).
  // This adds `id`, and `slug` when slugField is configured.
  async create(fields) {
    const item = { id: makeId(), ...fields };
    if (this.slugField) {
      let slug = slugify(fields[this.slugField]);
      if (this.slugSuffix) slug += `-${Date.now().toString(36)}`;
      item.slug = slug;
    }
    await getDocClient().send(new PutCommand({ TableName: this.tableName, Item: item }));
    return item;
  }

  async update(id, updates) {
    const existing = await this.getById(id);
    if (!existing) return null;
    const item = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
    if (this.slugField && this.reslugOnUpdate && updates[this.slugField]) {
      item.slug = slugify(updates[this.slugField]);
    }
    await getDocClient().send(new PutCommand({ TableName: this.tableName, Item: item }));
    return item;
  }

  async delete(id) {
    if (!this.tableName) return;
    await getDocClient().send(new DeleteCommand({ TableName: this.tableName, Key: { id } }));
  }
}

module.exports = { Repository, slugify, makeId };
