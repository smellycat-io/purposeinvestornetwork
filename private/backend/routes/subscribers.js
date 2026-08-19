const { Router } = require('express');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { sendNotification } = require('../shared/email.js');
const { store, saveSubscriberToStore } = require('../db/store.js');

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_SOURCES = ['newsletter', 'membership-waitlist'];
const VALID_TIERS = ['Curious', 'Learning', 'Investor', 'Vetted Investor'];

router.post('/api/subscribe', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  const source = VALID_SOURCES.includes(body.source) ? body.source : 'newsletter';
  const details = {
    name: String(body.name || '').trim().slice(0, 200) || null,
    phone: String(body.phone || '').trim().slice(0, 40) || null,
    address: String(body.address || '').trim().slice(0, 300) || null,
    tier: VALID_TIERS.includes(body.tier) ? body.tier : null,
  };

  saveSubscriberToStore(new Date().toISOString(), email, source, details);

  if (source === 'membership-waitlist') {
    await sendNotification(
      'New PIN membership waitlist signup',
      [
        `Email: ${email}`,
        `Name: ${details.name || '(not provided)'}`,
        `Phone: ${details.phone || '(not provided)'}`,
        `Address: ${details.address || '(not provided)'}`,
        `Interested tier: ${details.tier || '(not selected)'}`,
      ].join('\n')
    );
  }

  res.status(201).json({ success: true });
}, 'Unable to save your email right now.'));

router.get('/api/admin/subscribers', requireAdmin, asyncRoute(async (req, res) => {
  res.json(store.subscribers.slice().sort((a, b) => b.id - a.id));
}, 'Unable to load subscribers.'));

module.exports = router;
