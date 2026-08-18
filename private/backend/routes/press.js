const { Router } = require('express');
const { join } = require('path');
const content = require('../db/content.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');

const router = Router();

router.get('/press', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/press.html'));
});

router.get(
  '/api/press',
  asyncRoute(async (req, res) => {
    res.json(await content.listPress());
  }, 'Unable to load press mentions.')
);

// Admin read is identical to the public read (Press is never gated), but
// kept as its own endpoint for consistency with every other content type's
// admin dashboard wiring.
router.get(
  '/api/admin/press',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await content.listPress());
  }, 'Unable to load press mentions.')
);

router.post(
  '/api/admin/press',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.status(201).json(await content.createPress(req.body));
  }, 'Unable to create press mention.')
);

router.put(
  '/api/admin/press/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const press = await content.updatePress(req.params.id, req.body);
    if (!press) return res.status(404).json({ error: 'Not found.' });
    res.json(press);
  }, 'Unable to update press mention.')
);

router.delete(
  '/api/admin/press/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await content.deletePress(req.params.id);
    res.status(204).end();
  }, 'Unable to delete press mention.')
);

module.exports = router;
