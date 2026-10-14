const { Router } = require('express');
const content = require('../db/content.js');
const campaignsDb = require('../db/campaigns.js');
const { requireRole, roundtableArrayContains } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SITE_WIDE_TYPES = ['survey', 'waitlist', 'newsletter'];

// Idempotently backfills a campaign for every Roundtable/Initiative that
// predates this feature (or was created on a session that errored out
// after the content write but before the campaign-ensure call) — a
// campaign's own creation (routes/roundtables.js, routes/initiatives.js)
// already does this going forward, so on a healthy system this is a
// no-op every time (every ensureCampaign call below hits the
// already-exists branch). Low content volume (dozens, not thousands) is
// what makes doing this on every request acceptable, same assumption
// db/repository.js's scan-everything already makes.
async function ensureAllCampaigns() {
  await campaignsDb.ensureSiteWideCampaigns();
  const [roundtables, initiatives] = await Promise.all([content.listRoundtables(), content.listInitiatives()]);
  await Promise.all([
    ...roundtables.map((rt) => campaignsDb.ensureRoundtableCampaign(rt.id, rt.name, null)),
    ...initiatives.map((i) => campaignsDb.ensureInitiativeCampaign(i.id, i.title, null)),
  ]);
  return { initiatives };
}

// A Chair sees the three site-wide campaigns, their own Roundtable's
// campaign, and any Initiative campaign whose Initiative's roundtableIds
// contains their Roundtable — same containment check as GET
// /api/admin/initiatives (routes/initiatives.js). Admin sees everything.
function isVisible(campaign, role, chairRoundtableId, initiativeRoundtableIdsById) {
  if (role === 'admin') return true;
  if (SITE_WIDE_TYPES.includes(campaign.type)) return true;
  if (campaign.type === 'roundtable-interest') return campaign.roundtableId === chairRoundtableId;
  if (campaign.type === 'initiative-interest') {
    return roundtableArrayContains(initiativeRoundtableIdsById.get(campaign.initiativeId) || [], chairRoundtableId);
  }
  return false;
}

router.get(
  '/api/admin/campaigns',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    const { initiatives } = await ensureAllCampaigns();
    const initiativeRoundtableIdsById = new Map(initiatives.map((i) => [i.id, i.roundtableIds || []]));

    const all = await campaignsDb.listCampaigns();
    const includeArchived = req.session.role === 'admin' && req.query.archived === '1';
    const visible = all.filter((c) => {
      if (!includeArchived && c.archived) return false;
      return isVisible(c, req.session.role, req.session.roundtableId, initiativeRoundtableIdsById);
    });

    const withEffective = await Promise.all(
      visible.map(async (c) => ({ ...c, effectiveResultsEmails: await campaignsDb.resolveResultsEmails(c) }))
    );
    res.json(withEffective);
  }, 'Unable to load campaigns.', { verbose: true })
);

router.get(
  '/api/admin/campaigns/:id/entries',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    const campaign = await campaignsDb.getCampaignById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found.' });

    if (req.session.role !== 'admin') {
      let initiativeRoundtableIds = [];
      if (campaign.type === 'initiative-interest') {
        const initiative = await content.getInitiativeById(campaign.initiativeId);
        initiativeRoundtableIds = (initiative && initiative.roundtableIds) || [];
      }
      const initiativeRoundtableIdsById = new Map([[campaign.initiativeId, initiativeRoundtableIds]]);
      if (!isVisible(campaign, req.session.role, req.session.roundtableId, initiativeRoundtableIdsById)) {
        return res.status(403).json({ error: 'Not authorized.' });
      }
    }

    const entries = campaign.id === 'survey'
      ? await campaignsDb.listLegacySurveyEntries()
      : await campaignsDb.listEntriesForCampaign(campaign.id);
    res.json({ campaign, entries });
  }, 'Unable to load campaign entries.', { verbose: true })
);

// Admin only — resultsEmails is an override of who gets notified
// (null returns to the derived default), notifyOnEntry toggles whether
// new entries email anyone at all, archived hides a campaign from the
// default (non-archived) view without touching its entries.
router.patch(
  '/api/admin/campaigns/:id',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const campaign = await campaignsDb.getCampaignById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found.' });

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'resultsEmails')) {
      const { resultsEmails } = req.body;
      if (resultsEmails === null) {
        updates.resultsEmails = null;
      } else if (
        Array.isArray(resultsEmails) &&
        resultsEmails.length > 0 &&
        resultsEmails.every((e) => EMAIL_PATTERN.test(String(e || '').trim()))
      ) {
        updates.resultsEmails = [...new Set(resultsEmails.map((e) => String(e).trim().toLowerCase()))];
      } else {
        return res.status(400).json({ error: 'resultsEmails must be a non-empty array of valid email addresses, or null.' });
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'notifyOnEntry')) {
      updates.notifyOnEntry = !!req.body.notifyOnEntry;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'archived')) {
      updates.archived = !!req.body.archived;
    }

    const updated = await campaignsDb.updateCampaign(req.params.id, updates);
    res.json({ ...updated, effectiveResultsEmails: await campaignsDb.resolveResultsEmails(updated) });
  }, 'Unable to update campaign.', { verbose: true })
);

module.exports = router;
