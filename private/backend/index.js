// IMPORTANT: Initialize Sentry before anything else
require('./sentry/instrument.js');

const { captureMessage, setupExpressErrorHandler } = require('@sentry/aws-serverless');
const express = require('express');
const session = require('express-session');
const { join } = require('path');
const config = require('./shared/config.js');

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 },
}));

app.use(express.static(join(__dirname, '../../shared')));
app.use(express.static(join(__dirname, '../../front-end')));

app.use(require('./routes/auth.js'));
app.use(require('./routes/admin.js'));
app.use(require('./routes/roundtables.js'));
app.use(require('./routes/initiatives.js'));
app.use(require('./routes/posts.js'));
app.use(require('./routes/survey-responses.js'));
app.use(require('./routes/images.js'));
app.use(require('./routes/analytics.js'));
app.use(require('./routes/subscribers.js'));
app.use(require('./routes/system.js'));

// Catch-all for API/admin requests that don't match any route at all.
// Express's default 404 handling never reaches Sentry's error middleware
// (it's not a thrown error), so without this, a routing gap here is
// invisible to Sentry — this is the actual blind spot for a 404 caused by
// a client calling a URL/method that isn't wired up, vs. business-logic
// "not found" responses (which already report individually in each route).
app.use(['/api', '/admin'], (req, res) => {
  const authed = !!(req.session && req.session.loggedIn);
  captureMessage(`Unmatched route 404: ${req.method} ${req.originalUrl} (authenticated: ${authed})`, 'warning');
  res.status(404).json({ error: 'Not found.' });
});

setupExpressErrorHandler(app);

// Fallback JSON error handler (e.g. oversized request bodies rejected by
// body-parser before a route ever runs) so clients get a clean error
// instead of Express's default HTML error page.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  res.status(err.status || 500).json({ error: 'Something went wrong.' });
});

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`Server listening on http://localhost:${config.PORT}`);
  });
}

module.exports = { app };
