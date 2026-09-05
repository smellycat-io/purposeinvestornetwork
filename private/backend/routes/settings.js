const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { getEffectiveNotifyEmail, updateNotifyEmail } = require('../db/settings.js');
const { updateOwnPassword } = require('../db/users.js');

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get(
  '/api/admin/settings',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json({ notifyEmail: await getEffectiveNotifyEmail() });
  }, 'Unable to load settings.')
);

router.put(
  '/api/admin/settings/notify-email',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    await updateNotifyEmail(email);
    captureMessage(`Notification email updated to "${email}"`, 'info');
    res.json({ success: true, notifyEmail: email });
  }, 'Unable to update notification email.')
);

router.put(
  '/api/admin/settings/password',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    // Only real accounts (Users table) can self-service change a password —
    // the bootstrap ADMIN_USER/ADMIN_PASS fallback has no record to attach
    // one to. Set up a proper account via the Users tab instead.
    if (!req.session.userId) {
      return res.status(400).json({ error: 'Password changes aren’t available for the bootstrap account. Set up a user account via the Users tab instead.' });
    }
    const result = await updateOwnPassword(req.session.userId, currentPassword, newPassword);
    if (result.error) {
      captureMessage('Admin password change rejected — current password did not match.', 'warning');
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    captureMessage('Admin password updated successfully.', 'info');
    res.json({ success: true });
  }, 'Unable to update password.')
);

module.exports = router;
