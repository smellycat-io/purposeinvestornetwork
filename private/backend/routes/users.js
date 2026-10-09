const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const config = require('../shared/config.js');
const { requireRole, roundtableArrayContains } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { sendEmail } = require('../shared/email.js');
const {
  listUsers,
  getUserById,
  toPublicUser,
  findUserByEmail,
  createInvite,
  acceptInvite,
  createPasswordReset,
  resetPassword,
  updateUser,
  deleteUser,
} = require('../db/users.js');

const VALID_ROLES = ['admin', 'chair', 'member'];

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SITE_URL is authoritative in deployed environments (see shared/config.js
// for why the request's Host header can't be trusted behind CloudFront);
// falling back to it lets local dev keep working without setting it.
function siteUrl(req) {
  return config.SITE_URL || `${req.protocol}://${req.get('host')}`;
}

// --- Admin-only: manage users ---

// Admin sees everyone; a Chair sees only Members under their own
// Roundtable. Filtering happens here rather than adding a filter param to
// listUsers() — keeps db/users.js role-agnostic, matching how
// shared/access.js keeps visibility filtering out of the db layer rather
// than baking it into each table's own read function.
router.get(
  '/api/admin/users',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    const all = await listUsers();
    if (req.session.role === 'chair') {
      const chairRoundtableId = req.session.roundtableId;
      return res.json(all.filter((u) => u.role === 'member' && roundtableArrayContains(u.roundtableIds, chairRoundtableId)));
    }
    res.json(all);
  }, 'Unable to load users.')
);

// Admin can invite a Chair (any roundtableId) or a Member (any
// roundtableIds, including none) — not another Admin; there's no Stage 1
// path for that yet (see docs/DATA-MODEL.md, which specifies this same
// boundary). A Chair can only invite a Member, and only onto their own
// Roundtable — the request body's role/roundtableId/roundtableIds are
// ignored rather than trusted once the requester is a Chair, since this is
// a permission boundary, not a client-side convenience.
router.post(
  '/api/admin/users/invite',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (await findUserByEmail(email)) {
      return res.status(400).json({ error: 'That email has already been invited.' });
    }

    const requesterRole = req.session.role;
    let role;
    let roundtableId = null;
    let roundtableIds = [];

    if (requesterRole === 'chair') {
      role = 'member';
      roundtableIds = [req.session.roundtableId];
    } else {
      role = String((req.body || {}).role || '').trim();
      if (!['chair', 'member'].includes(role)) {
        return res.status(400).json({ error: 'Role must be "chair" or "member".' });
      }
      if (role === 'chair') {
        roundtableId = (req.body || {}).roundtableId || null;
        if (!roundtableId) {
          return res.status(400).json({ error: 'A Chair invite requires a roundtableId.' });
        }
      } else {
        roundtableIds = Array.isArray((req.body || {}).roundtableIds) ? req.body.roundtableIds : [];
      }
    }

    const { user, token } = await createInvite(email, { role, roundtableId, roundtableIds });
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

// Admin can change any of updateUser's fields on any user. A Chair may
// only touch `roundtableIds`, and only to add/remove *their own*
// Roundtable — every other key in the body (role, firstName, another
// Roundtable's membership, ...) is a permission boundary, not a client
// convenience, so it's rejected outright (400) rather than silently
// dropped: silently ignoring it would let a client believe an edit
// succeeded when part of it didn't.
router.patch(
  '/api/admin/users/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    const target = await getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const body = req.body || {};
    let updates;

    if (req.session.role === 'chair') {
      const chairRoundtableId = req.session.roundtableId;
      if (target.role !== 'member' || !roundtableArrayContains(target.roundtableIds, chairRoundtableId)) {
        return res.status(403).json({ error: 'Not authorized to edit this user.' });
      }

      const submittedKeys = Object.keys(body);
      const disallowedKeys = submittedKeys.filter((key) => key !== 'roundtableIds');
      if (disallowedKeys.length > 0) {
        return res.status(400).json({ error: `Chairs cannot edit: ${disallowedKeys.join(', ')}.` });
      }
      if (!Array.isArray(body.roundtableIds)) {
        return res.status(400).json({ error: 'roundtableIds must be an array.' });
      }

      const currentOtherRoundtables = (target.roundtableIds || []).filter((rt) => rt !== chairRoundtableId);
      const submittedOtherRoundtables = body.roundtableIds.filter((rt) => rt !== chairRoundtableId);
      const otherRoundtablesUnchanged =
        currentOtherRoundtables.length === submittedOtherRoundtables.length &&
        currentOtherRoundtables.every((rt) => submittedOtherRoundtables.includes(rt));
      if (!otherRoundtablesUnchanged) {
        return res.status(400).json({ error: 'Chairs can only add or remove their own Roundtable.' });
      }

      updates = { roundtableIds: body.roundtableIds };
    } else {
      updates = {};
      ['firstName', 'lastName', 'phone', 'address', 'role', 'roundtableId', 'roundtableIds'].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key];
      });
      if (Object.prototype.hasOwnProperty.call(updates, 'role') && !VALID_ROLES.includes(updates.role)) {
        return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
      }
    }

    const updated = await updateUser(req.params.id, updates);
    captureMessage(`User updated — id: ${req.params.id}, by role: ${req.session.role}`, 'info');
    res.json({ success: true, user: updated });
  }, 'Unable to update user.')
);

// A Chair "removing" a Member means removing them from the Chair's own
// Roundtable, not deleting their account outright — a Member can belong to
// several Roundtables (docs/DATA-MODEL.md), and a Chair has no authority
// over that Member's standing with any Roundtable but their own. This
// holds even if it's the Member's only Roundtable: full account deletion
// stays an Admin-only action via this same endpoint, not something
// removing someone from their last Roundtable can trigger for a Chair.
router.delete(
  '/api/admin/users/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    if (req.session.role === 'chair') {
      const target = await getUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'User not found.' });

      const chairRoundtableId = req.session.roundtableId;
      if (target.role !== 'member' || !roundtableArrayContains(target.roundtableIds, chairRoundtableId)) {
        return res.status(403).json({ error: 'Not authorized to remove this user.' });
      }

      const remaining = (target.roundtableIds || []).filter((rt) => rt !== chairRoundtableId);
      await updateUser(req.params.id, { roundtableIds: remaining });
      captureMessage(`User removed from roundtable — id: ${req.params.id}, roundtableId: ${chairRoundtableId}`, 'info');
      return res.status(204).end();
    }

    await deleteUser(req.params.id);
    captureMessage(`User removed — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to remove user.')
);

// Self-service: any logged-in user reads their own profile — role and
// roundtableId/roundtableIds included, since the admin dashboard needs
// these to adapt its own UI to the logged-in user (e.g. hiding invite
// controls a Chair's submission would just have overridden anyway), not
// just to have them enforced server-side. Always targets
// req.session.userId, same "never anyone else's record" guarantee as the
// PATCH below. Goes through toPublicUser like every other Users read, so
// passwordHash/token fields can never leak here even if someone adds a
// field to the raw item later.
router.get(
  '/api/users/me',
  requireRole('admin', 'chair', 'member'),
  asyncRoute(async (req, res) => {
    if (!req.session.userId) {
      return res.status(404).json({ error: 'No profile for this session.' });
    }
    const user = await getUserById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(toPublicUser(user));
  }, 'Unable to load your profile.')
);

// Self-service: any logged-in user edits their own profile. role/
// roundtableId/roundtableIds are never accepted here, regardless of role —
// silently dropped rather than rejected (mirrors how a Chair-initiated
// PATCH on someone *else's* record ignores fields it shouldn't touch,
// except here there's no legitimate reason a self-edit would ever include
// them, so there's no boundary worth surfacing an error for). Always
// targets req.session.userId — never a body/param-supplied id, so this can
// never edit anyone else's record.
router.patch(
  '/api/users/me',
  requireRole('admin', 'chair', 'member'),
  asyncRoute(async (req, res) => {
    if (!req.session.userId) {
      return res.status(404).json({ error: 'No profile to update for this session.' });
    }

    const body = req.body || {};
    const updates = {};
    ['firstName', 'lastName', 'phone', 'address'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key];
    });

    const updated = await updateUser(req.session.userId, updates);
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, user: updated });
  }, 'Unable to update your profile.')
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
