const { Router } = require('express');
const { captureException, flush } = require('@sentry/aws-serverless');
const config = require('../shared/config.js');

const router = Router();

router.get('/env.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.ENV = {
    SENTRY_BROWSER_DSN: ${JSON.stringify(config.SENTRY_BROWSER_DSN)},
    SENTRY_ENVIRONMENT: ${JSON.stringify(config.SENTRY_ENVIRONMENT)},
    SENTRY_RELEASE: ${JSON.stringify(config.SENTRY_RELEASE)},
    SENTRY_BROWSER_TRACES_SAMPLE_RATE: ${config.SENTRY_BROWSER_TRACES_SAMPLE_RATE}
  };`);
});

router.get('/sentry-test', async (req, res) => {
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

router.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
