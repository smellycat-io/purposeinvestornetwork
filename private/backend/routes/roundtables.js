const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const content = require('../db/content.js');
const { requireRole, matchesRoundtable } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const campaignsDb = require('../db/campaigns.js');
const { notifyCampaign } = require('../shared/email.js');

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get(
  '/api/roundtables',
  asyncRoute(async (req, res) => {
    res.json(await content.listRoundtables());
  }, 'Unable to load roundtables.')
);

router.get(
  '/api/roundtables/:slug',
  asyncRoute(async (req, res) => {
    const roundtable = await content.getRoundtableBySlug(req.params.slug);
    if (!roundtable) return res.status(404).json({ error: 'Not found.' });
    const [initiatives, updates] = await Promise.all([
      content.listInitiativesForRoundtable(roundtable.id),
      content.listPostsForRoundtable(roundtable.id),
    ]);
    res.json({
      roundtable,
      initiatives,
      updates,
      interest: { consentText: campaignsDb.composeConsentText(roundtable.name) },
    });
  }, 'Unable to load roundtable.')
);

// Public, always-on interest capture — no requireRole. `website` is a
// honeypot: a real visitor never sees or fills that field (shared/
// component/interest-form.js keeps it visually hidden), so a filled value
// means a bot filled in every field blindly. Responding 201 without
// writing anything gives the bot no signal it was caught, rather than a
// 400 it could use to learn the field name doesn't belong.
router.post(
  '/api/roundtables/:slug/interest',
  asyncRoute(async (req, res) => {
    const roundtable = await content.getRoundtableBySlug(req.params.slug);
    if (!roundtable) return res.status(404).json({ error: 'Not found.' });

    const body = req.body || {};
    if (String(body.website || '').trim()) {
      return res.status(201).json({ success: true });
    }

    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    const name = body.name ? String(body.name).trim().slice(0, 200) : null;
    const message = body.message ? String(body.message).trim().slice(0, 500) : null;

    await campaignsDb.ensureRoundtableCampaign(roundtable.id, roundtable.name, null);
    const campaign = await campaignsDb.getCampaignById(campaignsDb.roundtableCampaignId(roundtable.id));
    const { isNew, consentText } = await campaignsDb.recordInterestEntry(campaign, {
      email, name, message, consent: body.consent,
    });

    if (isNew && campaign.notifyOnEntry) {
      await notifyCampaign(campaign, `New interest in ${campaign.name}`, [
        `Email: ${email}`,
        `Name: ${name || '(not provided)'}`,
        `Message: ${message || '(not provided)'}`,
        `Consent: ${body.consent ? 'yes' : 'no'}`,
      ].join('\n'));
    }

    res.status(201).json({ success: true, consentText });
  }, 'Unable to submit your interest right now.')
);

// Creating a new Roundtable is an organizational decision, not something a
// Chair (assigned to one existing Roundtable) does — Admin-only, no Chair
// path at all, unlike Initiatives/Posts/Investments.
router.post(
  '/api/admin/roundtables',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const roundtable = await content.createRoundtable(req.body);
    await campaignsDb.ensureRoundtableCampaign(roundtable.id, roundtable.name, req.session.userId || null);
    captureMessage(`Roundtable created — id: ${roundtable.id}, name: "${roundtable.name}"`, 'info');
    res.status(201).json(roundtable);
  }, 'Unable to create roundtable.')
);

// A Chair may edit only their own Roundtable's own fields (name,
// description, image) — matchesRoundtable is a direct id comparison here
// (no fetch needed for the auth check itself, unlike Initiatives/
// Investments where ownership lives in a roundtableIds array on a
// *different* item) — the first route in the codebase to use it.
router.put(
  '/api/admin/roundtables/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    if (req.session.role === 'chair' && !matchesRoundtable(req.session.roundtableId, req.params.id)) {
      return res.status(403).json({ error: 'Not authorized to edit this Roundtable.' });
    }
    const roundtable = await content.updateRoundtable(req.params.id, req.body);
    if (!roundtable) {
      captureMessage(
        `Roundtable update 404: id "${req.params.id}" not found (body keys: ${Object.keys(req.body || {}).join(', ')})`,
        'warning'
      );
      return res.status(404).json({ error: 'Not found.' });
    }
    captureMessage(`Roundtable updated — id: ${roundtable.id}, name: "${roundtable.name}"`, 'info');
    res.json(roundtable);
  }, 'Unable to update roundtable.')
);

// Deleting a Roundtable entirely is a structural, organization-level
// decision beyond a single Chair's authority — Admin-only, same as full
// Users account deletion (see routes/users.js), not something a Chair
// "owning" the Roundtable can trigger themselves.
//
// Its campaign is archived, not deleted — the entries it already
// collected (consent included) stay queryable in the Campaigns tab even
// after the Roundtable itself is gone.
router.delete(
  '/api/admin/roundtables/:id',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    await content.deleteRoundtable(req.params.id);
    await campaignsDb.archiveCampaign(campaignsDb.roundtableCampaignId(req.params.id));
    captureMessage(`Roundtable deleted — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to delete roundtable.')
);

module.exports = router;
