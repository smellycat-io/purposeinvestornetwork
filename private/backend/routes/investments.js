const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const content = require('../db/content.js');
const { requireAdmin, requireRole, roundtableArrayContains } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { filterVisible, canSeeFull } = require('../shared/access.js');
const { sanitizeRichText } = require('../shared/sanitizeHtml.js');

const router = Router();

// A Chair has no authority over any Roundtable but their own — on create,
// that means their submitted roundtableIds must be exactly their own
// Roundtable, not their own plus others. (Admin is unrestricted; only Chair
// callers are checked against this.)
function isOwnRoundtableOnly(roundtableIds, chairRoundtableId) {
  return Array.isArray(roundtableIds) && roundtableIds.length > 0 && roundtableIds.every((rt) => rt === chairRoundtableId);
}

router.get(
  '/api/investments',
  asyncRoute(async (req, res) => {
    const investments = await content.listInvestments();
    res.json(filterVisible(investments, req));
  }, 'Unable to load investments.')
);

router.get(
  '/api/investments/:slug',
  asyncRoute(async (req, res) => {
    const investment = await content.getInvestmentBySlug(req.params.slug);
    if (!investment) return res.status(404).json({ error: 'Not found.' });
    if (investment.memberOnly && !canSeeFull(investment, req)) {
      return res.status(404).json({ error: 'Not found.' });
    }
    res.json(investment);
  }, 'Unable to load investment.')
);

router.get(
  '/api/admin/investments',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await content.listInvestments());
  }, 'Unable to load investments.')
);

// Same create/edit/delete scoping shape as routes/initiatives.js — see its
// comments for why create checks the submitted roundtableIds are exactly
// the Chair's own, while edit/delete check the existing item's
// roundtableIds instead.
router.post(
  '/api/admin/investments',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    if (req.session.role === 'chair' && !isOwnRoundtableOnly(req.body.roundtableIds, req.session.roundtableId)) {
      return res.status(403).json({ error: 'Not authorized to create an Investment outside your Roundtable.' });
    }
    const payload = {
      ...req.body,
      description: sanitizeRichText(req.body.description),
      outcomeSummary: req.body.outcomeSummary ? sanitizeRichText(req.body.outcomeSummary) : null,
    };
    const investment = await content.createInvestment(payload);
    captureMessage(`Investment created — id: ${investment.id}, title: "${investment.title}"`, 'info');
    res.status(201).json(investment);
  }, 'Unable to create investment.')
);

router.put(
  '/api/admin/investments/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    const existing = await content.getInvestmentById(req.params.id);
    if (!existing) {
      captureMessage(`Investment update 404: id "${req.params.id}" not found`, 'warning');
      return res.status(404).json({ error: 'Not found.' });
    }

    if (req.session.role === 'chair') {
      const chairRoundtableId = req.session.roundtableId;
      if (!roundtableArrayContains(existing.roundtableIds, chairRoundtableId)) {
        return res.status(403).json({ error: 'Not authorized to edit this Investment.' });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'roundtableIds')) {
        if (!Array.isArray(req.body.roundtableIds)) {
          return res.status(400).json({ error: 'roundtableIds must be an array.' });
        }
        const currentOther = (existing.roundtableIds || []).filter((rt) => rt !== chairRoundtableId);
        const submittedOther = req.body.roundtableIds.filter((rt) => rt !== chairRoundtableId);
        const otherRoundtablesUnchanged =
          currentOther.length === submittedOther.length && currentOther.every((rt) => submittedOther.includes(rt));
        if (!otherRoundtablesUnchanged) {
          return res.status(400).json({ error: 'Chairs can only add or remove their own Roundtable.' });
        }
      }
    }

    const updates = { ...req.body };
    if (updates.description) updates.description = sanitizeRichText(updates.description);
    if (updates.outcomeSummary) updates.outcomeSummary = sanitizeRichText(updates.outcomeSummary);
    const investment = await content.updateInvestment(req.params.id, updates);
    captureMessage(`Investment updated — id: ${investment.id}, title: "${investment.title}"`, 'info');
    res.json(investment);
  }, 'Unable to update investment.')
);

router.delete(
  '/api/admin/investments/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    if (req.session.role === 'chair') {
      const existing = await content.getInvestmentById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      if (!roundtableArrayContains(existing.roundtableIds, req.session.roundtableId)) {
        return res.status(403).json({ error: 'Not authorized to delete this Investment.' });
      }
    }
    await content.deleteInvestment(req.params.id);
    captureMessage(`Investment deleted — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to delete investment.')
);

module.exports = router;
