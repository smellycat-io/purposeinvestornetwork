const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const config = require('../shared/config.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { sendEmail } = require('../shared/email.js');
const {
  listUsers,
  findUserByEmail,
  createInvite,
  acceptInvite,
  createPasswordReset,
  resetPassword,
  deleteUser,
} = require('../db/users.js');

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SITE_URL is authoritative in deployed environments (see shared/config.js
// for why the request's Host header can't be trusted behind CloudFront);
// falling back to it lets local dev keep working without setting it.
function siteUrl(req) {
  return config.SITE_URL || `${req.protocol}://${req.get('host')}`;
}

// --- Admin-only: manage users ---

router.get(
  '/api/admin/users',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await listUsers());
  }, 'Unable to load users.')
);

router.post(
  '/api/admin/users/invite',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (await findUserByEmail(email)) {
      return res.status(400).json({ error: 'That email has already been invited.' });
    }

    const { user, token } = await createInvite(email);
    const link = `${siteUrl(req)}/accept-invite.html?token=${encodeURIComponent(token)}`;
    const emailed = await sendEmail(
      email,
      'You’ve been invited to the Purpose Investor Network admin dashboard',
      `You've been invited to join the PIN admin dashboard. Set up your account here:\n\n${link}\n\nThis link expires in 7 days.`
    );

    captureMessage(`User invited — email: "${email}", id: ${user.id}, emailed: ${emailed}`, 'info');
    res.status(201).json({ success: true, emailed });
  }, 'Unable to send invite.')
);

router.delete(
  '/api/admin/users/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await deleteUser(req.params.id);
    captureMessage(`User removed — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to remove user.')
);

// --- Public: accept an invite ---

router.post(
  '/api/accept-invite',
  asyncRoute(async (req, res) => {
    const { token, password } = req.body || {};
    const firstName = String((req.body || {}).firstName || '').trim();
    const lastName = String((req.body || {}).lastName || '').trim();
    const phone = String((req.body || {}).phone || '').trim();
    const address = String((req.body || {}).address || '').trim();
    if (!token || !firstName || !lastName || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'First name, last name, and a password of at least 8 characters are required.' });
    }

    const result = await acceptInvite(token, { firstName, lastName, phone, address, password });
    if (result.error) {
      captureMessage('Invite acceptance rejected — invalid or expired token.', 'warning');
      return res.status(400).json({ error: 'This invite link is invalid or has expired.' });
    }
    captureMessage(`Invite accepted — email: "${result.user.email}", id: ${result.user.id}`, 'info');
    res.json({ success: true });
  }, 'Unable to accept invite.')
);

// --- Public: forgot / reset password ---

router.post(
  '/api/forgot-password',
  asyncRoute(async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    // Always the same response whether or not the email matches — a
    // different response would let this endpoint be used to enumerate
    // registered emails.
    const genericResponse = { success: true, message: 'If that email is registered, a reset link has been sent.' };
    if (!email || !EMAIL_PATTERN.test(email)) {
      return res.json(genericResponse);
    }

    const result = await createPasswordReset(email);
    if (result) {
      const link = `${siteUrl(req)}/reset-password.html?token=${encodeURIComponent(result.token)}`;
      await sendEmail(
        email,
        'Reset your Purpose Investor Network admin password',
        `A password reset was requested for your PIN admin account. Reset it here:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`
      );
      captureMessage(`Password reset requested — email: "${email}"`, 'info');
    } else {
      captureMessage(`Password reset requested for unknown/inactive email: "${email}"`, 'info');
    }
    res.json(genericResponse);
  }, 'Unable to process password reset request.')
);

router.post(
  '/api/reset-password',
  asyncRoute(async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'A new password of at least 8 characters is required.' });
    }

    const result = await resetPassword(token, newPassword);
    if (result.error) {
      captureMessage('Password reset rejected — invalid or expired token.', 'warning');
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }
    captureMessage(`Password reset completed — id: ${result.user.id}`, 'info');
    res.json({ success: true });
  }, 'Unable to reset password.')
);

module.exports = router;
