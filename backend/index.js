// IMPORTANT: Initialize Sentry before anything else
require('./instrument.js');

const { captureException, flush, setupExpressErrorHandler } = require('@sentry/node');
const express = require('express');
const { json, urlencoded, static: expressStatic } = express;
const session = require('express-session');
const { join } = require('path');
const sqlite3 = require('sqlite3').verbose();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const app = express();
const PORT = process.env.PORT || 3000;
const dbFile = process.env.DB_FILE || join(__dirname, 'survey.db');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-in-prod';
const AWS_REGION = process.env.AWS_REGION || null;
const DYNAMODB_TABLE = process.env.AWS_DYNAMODB_TABLE || null;
const SENTRY_BROWSER_DSN = process.env.SENTRY_BROWSER_DSN || null;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production';
const SENTRY_RELEASE = process.env.SENTRY_RELEASE || 'purpose-investor-network@latest';
const SENTRY_BROWSER_TRACES_SAMPLE_RATE = parseFloat(process.env.SENTRY_BROWSER_TRACES_SAMPLE_RATE || process.env.SENTRY_TRACES_SAMPLE_RATE || '0.0');

const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Unable to open database:', err);
    process.exit(1);
  }
});

// Optional S3 client (if AWS_S3_BUCKET is provided)
let s3Client = null;
const S3_BUCKET = process.env.AWS_S3_BUCKET || null;
if (S3_BUCKET) {
  s3Client = new S3Client({});
  console.log('S3 upload enabled. Bucket:', S3_BUCKET);
}

let dynamoDbDocClient = null;
if (DYNAMODB_TABLE) {
  const dynamoClient = new DynamoDBClient({ region: AWS_REGION || undefined });
  dynamoDbDocClient = DynamoDBDocumentClient.from(dynamoClient);
  console.log('DynamoDB enabled. Table:', DYNAMODB_TABLE);
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS survey_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      email TEXT,
      payload TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      event TEXT NOT NULL,
      properties TEXT,
      distinct_id TEXT
    )
  `);
});

app.use(json({ limit: '2mb' }));
app.use(urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));

function requireAdmin(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  return res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (req.session && req.session.loggedIn) {
    return res.redirect('/admin');
  }

  res.send(`
    <html>
      <head><title>PIN Admin Login</title></head>
      <body style="font-family:system-ui, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; background:#f5f3ef; margin:0;">
        <form method="POST" action="/login" style="background:#ffffff; padding:32px; border-radius:16px; box-shadow:0 16px 40px rgba(0,0,0,0.08); width:320px;">
          <h1 style="margin-bottom:20px;font-size:22px;">Admin Login</h1>
          <label style="display:block; margin-bottom:10px; font-weight:600;">Username</label>
          <input name="username" required style="width:100%;padding:10px;margin-bottom:16px;border:1px solid #ccc;border-radius:8px;" />
          <label style="display:block; margin-bottom:10px; font-weight:600;">Password</label>
          <input type="password" name="password" required style="width:100%;padding:10px;margin-bottom:24px;border:1px solid #ccc;border-radius:8px;" />
          <button type="submit" style="width:100%;background:#d70010;color:#fff;border:none;padding:12px 0;border-radius:999px;font-weight:700;cursor:pointer;">Sign In</button>
        </form>
      </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.redirect('/admin');
  }

  return res.send('<p>Invalid credentials. <a href="/login">Try again</a>.</p>');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/sentry-test', async (req, res) => {
  try {
    foo();
  } catch (e) {
    captureException(e);
    try {
      await flush(2000);
    } catch (flushErr) {
      console.error('Sentry flush failed:', flushErr);
    }
    res.send('Test error sent to Sentry');
  }
});

app.get('/env.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.ENV = {
    SENTRY_BROWSER_DSN: ${JSON.stringify(SENTRY_BROWSER_DSN)},
    SENTRY_ENVIRONMENT: ${JSON.stringify(SENTRY_ENVIRONMENT)},
    SENTRY_RELEASE: ${JSON.stringify(SENTRY_RELEASE)},
    SENTRY_BROWSER_TRACES_SAMPLE_RATE: ${SENTRY_BROWSER_TRACES_SAMPLE_RATE}
  };`);
});

async function listResponses() {
  if (dynamoDbDocClient) {
    const results = await dynamoDbDocClient.send(new ScanCommand({ TableName: DYNAMODB_TABLE, Limit: 200 }));
    return (results.Items || []).map(item => ({
      id: item.id,
      createdAt: item.createdAt,
      email: item.email,
      answers: item.answers
    }));
  }

  return new Promise((resolve, reject) => {
    db.all('SELECT id, created_at, email, payload FROM survey_responses ORDER BY id DESC LIMIT 200', (err, rows) => {
      if (err) return reject(err);
      return resolve(rows.map(row => ({
        id: row.id,
        createdAt: row.created_at,
        email: row.email,
        answers: JSON.parse(row.payload || '{}')
      })));
    });
  });
}

app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const responses = await listResponses();
    res.send(`
      <html>
        <head>
          <title>PIN Admin</title>
          <style>body{font-family:system-ui, sans-serif; background:#f5f3ef; margin:0; padding:24px;} .page{max-width:1080px;margin:0 auto;} table{width:100%;border-collapse:collapse;background:#fff;box-shadow:0 16px 40px rgba(0,0,0,0.06);} th,td{padding:14px 12px;border-bottom:1px solid #e6e2dc;text-align:left;vertical-align:top;} th{background:#f7f3ee;} pre{margin:0;font-family:ui-monospace,monospace;font-size:0.95rem;white-space:pre-wrap;word-break:break-word;}</style>
        </head>
        <body>
          <div class="page">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
              <div><h1 style="margin:0;">PIN Survey Responses</h1><p style="margin:4px 0 0;color:#6b6b60;">Showing up to 200 responses.</p></div>
              <a href="/logout" style="color:#d70010;font-weight:700;text-decoration:none;">Log out</a>
            </div>
            <table>
              <thead><tr><th>ID</th><th>Created</th><th>Email</th><th>Answers</th></tr></thead>
              <tbody>
                ${responses.map(response => `
                  <tr>
                    <td>${response.id}</td>
                    <td>${response.createdAt}</td>
                    <td>${response.email || '—'}</td>
                    <td><pre>${JSON.stringify(response.answers, null, 2)}</pre></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    captureException(error);
    console.error('Failed to load admin responses:', error);
    res.status(500).send('Unable to load responses.');
  }
});

app.use(expressStatic(join(__dirname, '../front-end')));

app.post('/api/survey', async (req, res) => {
  const answers = req.body.answers || {};
  const email = (answers.email || '').trim() || null;
  const payload = JSON.stringify(answers);
  const createdAt = new Date().toISOString();
  const recordId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const saveToSqlite = () => new Promise(resolve => {
    db.run(
      'INSERT INTO survey_responses (created_at, email, payload) VALUES (?, ?, ?)',
      [createdAt, email, payload],
      function (err) {
        if (err) {
          console.error('Failed to save survey response to SQLite:', err);
          return resolve(null);
        }
        return resolve(this.lastID);
      }
    );
  });

  const sqlitePromise = saveToSqlite();

  const dynamoPromise = dynamoDbDocClient
    ? dynamoDbDocClient.send(new PutCommand({
        TableName: DYNAMODB_TABLE,
        Item: {
          id: recordId,
          createdAt,
          email,
          answers
        }
      }))
    : Promise.resolve(null);

  const responses = await Promise.allSettled([sqlitePromise, dynamoPromise]);
  const sqliteResult = responses[0].status === 'fulfilled' ? responses[0].value : null;
  const dynamoResult = responses[1].status === 'fulfilled' ? responses[1].value : null;

  if (!sqliteResult && !dynamoResult) {
    const saveError = new Error('Unable to save survey response');
    captureException(saveError);
    return res.status(500).json({ success: false, error: 'Unable to save survey response' });
  }

  if (s3Client) {
    const key = `responses/${Date.now()}-${Math.floor(Math.random() * 100000)}.json`;
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: payload,
      ContentType: 'application/json',
    });

    try {
      await s3Client.send(command);
      return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId, s3Key: key });
    } catch (s3Err) {
      console.error('Failed to upload to S3:', s3Err);
      return res.status(500).json({ success: false, error: 'Saved locally; failed to upload to S3' });
    }
  }

  return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ── Analytics tracking endpoint ──
app.post('/api/track', async (req, res) => {
  const { event, properties, distinct_id } = req.body || {};
  if (!event) return res.status(400).json({ success: false, error: 'Missing event' });
  const createdAt = new Date().toISOString();
  const props = properties ? JSON.stringify(properties) : null;

  // Save to SQLite
  db.run('INSERT INTO analytics_events (created_at, event, properties, distinct_id) VALUES (?, ?, ?, ?)', [createdAt, event, props, distinct_id || null], function(err) {
    if (err) console.error('Failed to save analytics event to SQLite:', err);
  });

  // Optionally forward to PostHog if configured
  const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || null;
  const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com';
  if (POSTHOG_API_KEY) {
    try {
      await fetch(`${POSTHOG_HOST}/capture/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: POSTHOG_API_KEY, event, properties: properties || {}, distinct_id: distinct_id || null })
      });
    } catch (err) {
      console.error('Failed to forward event to PostHog:', err);
    }
  }

  return res.json({ success: true });
});

setupExpressErrorHandler(app);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, db };
