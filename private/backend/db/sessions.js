// express-session store backed by DynamoDB. Deliberately its own table
// (like settings.js) rather than the ephemeral local JSON store — Lambda
// can route concurrent requests to different execution environments, each
// with its own separate process memory, so express-session's default
// MemoryStore only ever sees a login on whichever container handled it.
// Every other concurrent request lands on a different container that never
// saw that login, so an already-authenticated admin gets bounced back to
// /login mid-session. DynamoDB is shared across every execution
// environment, so every container sees the same session state.
//
// Sessions expire via DynamoDB TTL on the `expiresAt` attribute (must be
// enabled on the table once, outside this code) rather than being deleted
// here on read, since a lazily-expiring row is harmless and TTL cleanup is
// free.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { Store } = require('express-session');

const AWS_REGION = process.env.AWS_REGION || undefined;
const SESSIONS_TABLE = process.env.AWS_SESSIONS_TABLE || null;

let docClient = null;
function getDocClient() {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
  }
  return docClient;
}

class DynamoDBSessionStore extends Store {
  async get(sid, callback) {
    if (!SESSIONS_TABLE) return callback(null, null);
    try {
      const result = await getDocClient().send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { id: sid } }));
      if (!result.Item || (result.Item.expiresAt && result.Item.expiresAt * 1000 < Date.now())) {
        return callback(null, null);
      }
      callback(null, JSON.parse(result.Item.data));
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, session, callback) {
    if (!SESSIONS_TABLE) return callback && callback();
    try {
      const maxAgeMs = (session.cookie && session.cookie.maxAge) || 1000 * 60 * 60;
      const expiresAt = Math.floor((Date.now() + maxAgeMs) / 1000);
      await getDocClient().send(new PutCommand({
        TableName: SESSIONS_TABLE,
        Item: { id: sid, data: JSON.stringify(session), expiresAt },
      }));
      callback && callback();
    } catch (err) {
      callback && callback(err);
    }
  }

  async destroy(sid, callback) {
    if (!SESSIONS_TABLE) return callback && callback();
    try {
      await getDocClient().send(new DeleteCommand({ TableName: SESSIONS_TABLE, Key: { id: sid } }));
      callback && callback();
    } catch (err) {
      callback && callback(err);
    }
  }

  // Refreshes the expiry on each request so an active admin session doesn't
  // lapse mid-use — same maxAge sliding-window behavior MemoryStore gives
  // for free, just made explicit here since DynamoDB needs the write.
  async touch(sid, session, callback) {
    return this.set(sid, session, callback);
  }
}

module.exports = { DynamoDBSessionStore };
