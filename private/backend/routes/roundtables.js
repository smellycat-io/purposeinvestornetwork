const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const content = require('../db/content.js');
const { requireRole, matchesRoundtable } = require('../shared/auth.js');
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

// Creating a new Roundtable is an organizational decision, not something a
// Chair (assigned to one existing Roundtable) does — Admin-only, no Chair
// path at all, unlike Initiatives/Posts/Investments.
router.post(
  '/api/admin/roundtables',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const roundtable = await content.createRoundtable(req.body);
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
router.delete(
  '/api/admin/roundtables/:id',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    await content.deleteRoundtable(req.params.id);
    captureMessage(`Roundtable deleted — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to delete roundtable.')
);

module.exports = router;
