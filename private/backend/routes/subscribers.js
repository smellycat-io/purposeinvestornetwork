const { Router } = require('express');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { store, saveSubscriberToStore } = require('../db/store.js');

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_SOURCES = ['newsletter', 'membership-waitlist'];

router.post('/api/subscribe', asyncRoute(async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  const source = VALID_SOURCES.includes((req.body || {}).source) ? req.body.source : 'newsletter';

  saveSubscriberToStore(new Date().toISOString(), email, source);
  res.status(201).json({ success: true });
}, 'Unable to save your email right now.'));

router.get('/api/admin/subscribers', requireAdmin, asyncRoute(async (req, res) => {
  res.json(store.subscribers.slice().sort((a, b) => b.id - a.id));
}, 'Unable to load subscribers.'));

module.exports = router;
