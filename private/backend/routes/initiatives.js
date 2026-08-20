const { Router } = require('express');
const { join } = require('path');
const { captureMessage } = require('@sentry/aws-serverless');
const content = require('../db/content.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');

const router = Router();

router.get('/roundtables/initiatives/:slug', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/initiative.html'));
});

router.get(
  '/api/initiatives/:slug',
  asyncRoute(async (req, res) => {
    const initiative = await content.getInitiativeBySlug(req.params.slug);
    if (!initiative) return res.status(404).json({ error: 'Not found.' });
    const updates = await content.listPosts({ type: 'update', initiativeId: initiative.id });
    res.json({ initiative, updates });
  }, 'Unable to load initiative.')
);

router.get(
  '/api/admin/initiatives',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await content.listInitiatives());
  }, 'Unable to load initiatives.')
);

router.post(
  '/api/admin/initiatives',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const initiative = await content.createInitiative(req.body);
    captureMessage(`Initiative created — id: ${initiative.id}, title: "${initiative.title}"`, 'info');
    res.status(201).json(initiative);
  }, 'Unable to create initiative.')
);

router.put(
  '/api/admin/initiatives/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const initiative = await content.updateInitiative(req.params.id, req.body);
    if (!initiative) {
      captureMessage(
        `Initiative update 404: id "${req.params.id}" not found (body keys: ${Object.keys(req.body || {}).join(', ')})`,
        'warning'
      );
      return res.status(404).json({ error: 'Not found.' });
    }
    captureMessage(`Initiative updated — id: ${initiative.id}, title: "${initiative.title}"`, 'info');
    res.json(initiative);
  }, 'Unable to update initiative.')
);

router.delete(
  '/api/admin/initiatives/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await content.deleteInitiative(req.params.id);
    captureMessage(`Initiative deleted — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to delete initiative.')
);

module.exports = router;
