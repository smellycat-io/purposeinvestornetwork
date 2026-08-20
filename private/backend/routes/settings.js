const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const {
  getEffectiveNotifyEmail,
  updateNotifyEmail,
  updateAdminPassword,
  checkAdminPassword,
} = require('../db/settings.js');

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
    if (!(await checkAdminPassword(currentPassword))) {
      captureMessage('Admin password change rejected — current password did not match.', 'warning');
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    await updateAdminPassword(newPassword);
    captureMessage('Admin password updated successfully.', 'info');
    res.json({ success: true });
  }, 'Unable to update password.')
);

module.exports = router;
