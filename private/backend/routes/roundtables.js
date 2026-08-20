const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const content = require('../db/content.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');

const router = Router();

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
    res.json({ roundtable, initiatives, updates });
  }, 'Unable to load roundtable.')
);

router.post(
  '/api/admin/roundtables',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const roundtable = await content.createRoundtable(req.body);
    captureMessage(`Roundtable created — id: ${roundtable.id}, name: "${roundtable.name}"`, 'info');
    res.status(201).json(roundtable);
  }, 'Unable to create roundtable.')
);

router.put(
  '/api/admin/roundtables/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
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

router.delete(
  '/api/admin/roundtables/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await content.deleteRoundtable(req.params.id);
    captureMessage(`Roundtable deleted — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to delete roundtable.')
);

module.exports = router;
