const { Router } = require('express');
const { captureException } = require('@sentry/aws-serverless');
const config = require('../shared/config.js');
const { saveAnalyticsEventToStore } = require('../db/store.js');

const router = Router();

router.post('/api/track', async (req, res) => {
  const { event, properties, distinct_id } = req.body || {};
  if (!event) return res.status(400).json({ success: false, error: 'Missing event' });
  const createdAt = new Date().toISOString();
  const props = properties ? JSON.stringify(properties) : null;

  // Save to the local JSON store
  try {
    saveAnalyticsEventToStore(createdAt, event, props, distinct_id || null);
  } catch (error) {
    captureException(error);
  }

  // Optionally forward to PostHog if configured
  if (config.POSTHOG_API_KEY) {
    try {
      await fetch(`${config.POSTHOG_HOST}/capture/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: config.POSTHOG_API_KEY,
          event,
          properties: properties || {},
          distinct_id: distinct_id || null,
        }),
      });
    } catch (err) {
      console.error('Failed to forward event to PostHog:', err);
    }
  }

  return res.json({ success: true });
});

module.exports = router;
