// IMPORTANT: Initialize Sentry before anything else
require('./instrument.js');

const { captureException, flush, setupExpressErrorHandler } = require('@sentry/aws-serverless');
const express = require('express');
const { json, urlencoded, static: expressStatic } = express;
const session = require('express-session');
const { join } = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const sanitizeHtml = require('sanitize-html');
const content = require('./content');

const app = express();
const PORT = process.env.PORT || 3000;
const dbFile = process.env.DB_FILE || (process.env.LAMBDA_TASK_ROOT ? join('/tmp', 'survey-store.json') : join(__dirname, 'survey.db'));
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-in-prod';
const AWS_REGION = process.env.AWS_REGION || null;
const DYNAMODB_TABLE = process.env.AWS_DYNAMODB_TABLE || null;
const SENTRY_BROWSER_DSN = process.env.SENTRY_BROWSER_DSN || null;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production';
const SENTRY_RELEASE = process.env.SENTRY_RELEASE || 'purpose-investor-network@latest';
const SENTRY_BROWSER_TRACES_SAMPLE_RATE = parseFloat(process.env.SENTRY_BROWSER_TRACES_SAMPLE_RATE || process.env.SENTRY_TRACES_SAMPLE_RATE || '0.0');

function loadStore() {
  if (dbFile === ':memory:') {
    return { surveyResponses: [], analyticsEvents: [] };
  }

  const storePath = dbFile;
  const storeDir = join(storePath, '..');
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    const initialStore = { surveyResponses: [], analyticsEvents: [] };
    fs.writeFileSync(storePath, JSON.stringify(initialStore, null, 2));
    return initialStore;
  }

  try {
    const contents = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(contents);
  } catch (err) {
    console.error('Unable to read store file:', err);
    return { surveyResponses: [], analyticsEvents: [] };
  }
}

const store = loadStore();

function persistStore() {
  if (dbFile === ':memory:') {
    return;
  }

  fs.writeFileSync(dbFile, JSON.stringify(store, null, 2));
}

function createStoreId() {
  return Date.now() + Math.floor(Math.random() * 1000000);
}

function saveSurveyResponseToStore(createdAt, email, payload) {
  const id = createStoreId();
  store.surveyResponses.push({ id, created_at: createdAt, email, payload });
  persistStore();
  return id;
}

function saveAnalyticsEventToStore(createdAt, event, properties, distinctId) {
  store.analyticsEvents.push({ created_at: createdAt, event, properties, distinct_id: distinctId });
  persistStore();
}

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

  return store.surveyResponses
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 200)
    .map(row => ({
      id: row.id,
      createdAt: row.created_at,
      email: row.email,
      answers: JSON.parse(row.payload || '{}')
    }));
}

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(join(__dirname, 'admin/admin.html'));
});

app.use('/admin/assets', requireAdmin, expressStatic(join(__dirname, 'admin')));

app.use(expressStatic(join(__dirname, '../front-end')));

function sanitizePostBody(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'img'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
    },
  });
}

// --- Public content pages (clean URLs, static HTML + client-side fetch) ---

app.get('/roundtables', (req, res) => {
  res.sendFile(join(__dirname, 'pages/roundtables.html'));
});

app.get('/roundtables/initiatives/:slug', (req, res) => {
  res.sendFile(join(__dirname, 'pages/initiative.html'));
});

app.get('/roundtables/:slug', (req, res) => {
  res.sendFile(join(__dirname, 'pages/roundtable.html'));
});

// --- Public reads ---

app.get('/api/roundtables', async (req, res) => {
  try {
    res.json(await content.listRoundtables());
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to load roundtables.' });
  }
});

app.get('/api/roundtables/:slug', async (req, res) => {
  try {
    const roundtable = await content.getRoundtableBySlug(req.params.slug);
    if (!roundtable) return res.status(404).json({ error: 'Not found.' });
    const [initiatives, updates] = await Promise.all([
      content.listInitiativesForRoundtable(roundtable.id),
      content.listPostsForRoundtable(roundtable.id),
    ]);
    res.json({ roundtable, initiatives, updates });
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to load roundtable.' });
  }
});

app.get('/api/initiatives/:slug', async (req, res) => {
  try {
    const initiative = await content.getInitiativeBySlug(req.params.slug);
    if (!initiative) return res.status(404).json({ error: 'Not found.' });
    const updates = await content.listPosts({ type: 'update', initiativeId: initiative.id });
    res.json({ initiative, updates });
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to load initiative.' });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    res.json(await content.listPosts({ type: 'blog' }));
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to load posts.' });
  }
});

app.get('/api/posts/:slug', async (req, res) => {
  try {
    const post = await content.getPostBySlug(req.params.slug);
    if (!post) return res.status(404).json({ error: 'Not found.' });
    res.json(post);
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to load post.' });
  }
});

// --- Admin reads (unfiltered/private data, for the dashboard) ---

app.get('/api/admin/survey-responses', requireAdmin, async (req, res) => {
  try {
    res.json(await listResponses());
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to load survey responses.' });
  }
});

app.get('/api/admin/initiatives', requireAdmin, async (req, res) => {
  try {
    res.json(await content.listInitiatives());
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to load initiatives.' });
  }
});

app.get('/api/admin/posts', requireAdmin, async (req, res) => {
  try {
    res.json(await content.listPosts(req.query.type ? { type: req.query.type } : {}));
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to load posts.' });
  }
});

// --- Admin writes ---

app.post('/api/admin/roundtables', requireAdmin, async (req, res) => {
  try {
    res.status(201).json(await content.createRoundtable(req.body));
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to create roundtable.' });
  }
});

app.put('/api/admin/roundtables/:id', requireAdmin, async (req, res) => {
  try {
    const roundtable = await content.updateRoundtable(req.params.id, req.body);
    if (!roundtable) return res.status(404).json({ error: 'Not found.' });
    res.json(roundtable);
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to update roundtable.' });
  }
});

app.delete('/api/admin/roundtables/:id', requireAdmin, async (req, res) => {
  try {
    await content.deleteRoundtable(req.params.id);
    res.status(204).end();
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to delete roundtable.' });
  }
});

app.post('/api/admin/initiatives', requireAdmin, async (req, res) => {
  try {
    res.status(201).json(await content.createInitiative(req.body));
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to create initiative.' });
  }
});

app.put('/api/admin/initiatives/:id', requireAdmin, async (req, res) => {
  try {
    const initiative = await content.updateInitiative(req.params.id, req.body);
    if (!initiative) return res.status(404).json({ error: 'Not found.' });
    res.json(initiative);
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to update initiative.' });
  }
});

app.delete('/api/admin/initiatives/:id', requireAdmin, async (req, res) => {
  try {
    await content.deleteInitiative(req.params.id);
    res.status(204).end();
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to delete initiative.' });
  }
});

app.post('/api/admin/posts', requireAdmin, async (req, res) => {
  try {
    const payload = { ...req.body, body: sanitizePostBody(req.body.body) };
    res.status(201).json(await content.createPost(payload));
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to create post.' });
  }
});

app.put('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.body) updates.body = sanitizePostBody(updates.body);
    const post = await content.updatePost(req.params.id, updates);
    if (!post) return res.status(404).json({ error: 'Not found.' });
    res.json(post);
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to update post.' });
  }
});

app.delete('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  try {
    await content.deletePost(req.params.id);
    res.status(204).end();
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Unable to delete post.' });
  }
});

app.post('/api/survey', async (req, res) => {
  const answers = req.body.answers || {};
  const email = (answers.email || '').trim() || null;
  const payload = JSON.stringify(answers);
  const createdAt = new Date().toISOString();
  const recordId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const sqlitePromise = Promise.resolve(saveSurveyResponseToStore(createdAt, email, payload));

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
      return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId, s3Error: 'upload failed' });
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

  // Save to the local JSON store
  saveAnalyticsEventToStore(createdAt, event, props, distinct_id || null);

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

module.exports = { app, store };
