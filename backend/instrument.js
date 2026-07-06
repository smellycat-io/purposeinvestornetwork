// IMPORTANT: Make sure to import this file at the very top of your server entry point.
// This initializes Sentry before anything else runs.
// Load local env vars when present (development)
try {
  require('dotenv').config();
} catch (e) {
  // dotenv is optional in production
}

const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
  release: process.env.SENTRY_RELEASE || 'purpose-investor-network@latest',
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.0'),
  dataCollection: {
    // Optional: uncomment to disable sending user data and HTTP bodies
    // userInfo: false,
    // httpBodies: [],
  },
});
