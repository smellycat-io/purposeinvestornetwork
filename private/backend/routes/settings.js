const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const { requireRole } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { updateOwnPassword } = require('../db/users.js');

const router = Router();

// GET /api/admin/settings and PUT /api/admin/settings/notify-email are
// gone — the notification email is now per-campaign (resultsEmails on
// each Campaign row, edited from the Campaigns tab), not a single global
// setting. See db/campaigns.js's ensureSiteWideCampaigns, which seeds each
// site-wide campaign's resultsEmails once from the settings-table value
// this route used to read.

router.put(
  '/api/admin/settings/password',
  requireRole('admin', 'chair', 'member'),
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
  }, 'Unable to update password.', { verbose: true })
);

module.exports = router;
