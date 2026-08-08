const { Router } = require('express');
const { join } = require('path');
const { captureMessage } = require('@sentry/aws-serverless');
const content = require('../db/content.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');

const router = Router();

router.get('/roundtables', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/roundtables.html'));
});

router.get('/roundtables/:slug', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/roundtable.html'));
});

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
    res.status(201).json(await content.createRoundtable(req.body));
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
    res.json(roundtable);
  }, 'Unable to update roundtable.')
);

router.delete(
  '/api/admin/roundtables/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await content.deleteRoundtable(req.params.id);
    res.status(204).end();
  }, 'Unable to delete roundtable.')
);

module.exports = router;
