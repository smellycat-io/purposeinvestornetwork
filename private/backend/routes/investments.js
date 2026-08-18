const { Router } = require('express');
const { join } = require('path');
const sanitizeHtml = require('sanitize-html');
const content = require('../db/content.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { filterVisible, canSeeFull } = require('../shared/access.js');

const router = Router();

function sanitizeRichText(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'img'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
    },
  });
}

router.get('/investments', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/investments.html'));
});

router.get('/investments/:slug', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/investment.html'));
});

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

router.post(
  '/api/admin/investments',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const payload = {
      ...req.body,
      description: sanitizeRichText(req.body.description),
      outcomeSummary: req.body.outcomeSummary ? sanitizeRichText(req.body.outcomeSummary) : null,
    };
    res.status(201).json(await content.createInvestment(payload));
  }, 'Unable to create investment.')
);

router.put(
  '/api/admin/investments/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const updates = { ...req.body };
    if (updates.description) updates.description = sanitizeRichText(updates.description);
    if (updates.outcomeSummary) updates.outcomeSummary = sanitizeRichText(updates.outcomeSummary);
    const investment = await content.updateInvestment(req.params.id, updates);
    if (!investment) return res.status(404).json({ error: 'Not found.' });
    res.json(investment);
  }, 'Unable to update investment.')
);

router.delete(
  '/api/admin/investments/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await content.deleteInvestment(req.params.id);
    res.status(204).end();
  }, 'Unable to delete investment.')
);

module.exports = router;
