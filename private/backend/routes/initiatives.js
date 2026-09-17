const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const content = require('../db/content.js');
const { requireAdmin, requireRole, roundtableArrayContains } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');

const router = Router();

// A Chair has no authority over any Roundtable but their own — on create,
// that means their submitted roundtableIds must be exactly their own
// Roundtable, not their own plus others. (Admin is unrestricted; only Chair
// callers are checked against this.)
function isOwnRoundtableOnly(roundtableIds, chairRoundtableId) {
  return Array.isArray(roundtableIds) && roundtableIds.length > 0 && roundtableIds.every((rt) => rt === chairRoundtableId);
}

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

// Create: there's no existing item to check scope against yet, so a Chair
// is authorized by the roundtableIds they submit — a Chair has no
// authority over any Roundtable but their own, so the submitted array must
// be exactly their own Roundtable, not their own plus others.
router.post(
  '/api/admin/initiatives',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    if (req.session.role === 'chair' && !isOwnRoundtableOnly(req.body.roundtableIds, req.session.roundtableId)) {
      return res.status(403).json({ error: 'Not authorized to create an Initiative outside your Roundtable.' });
    }
    const initiative = await content.createInitiative(req.body);
    captureMessage(`Initiative created — id: ${initiative.id}, title: "${initiative.title}"`, 'info');
    res.status(201).json(initiative);
  }, 'Unable to create initiative.')
);

// Edit: authorized against the *existing* item's current roundtableIds,
// not whatever the request body claims — otherwise a PUT body could move
// an Initiative a Chair doesn't own into scope, or omit roundtableIds
// entirely and be treated as unrestricted. If the body touches
// roundtableIds at all, the same rule Stage 2 established for Users
// applies: a Chair may add/remove only their own Roundtable, never another
// Roundtable's presence on the item (rejected with 400, not silently
// dropped, for the same "ambiguity on a permission boundary is a bug"
// reasoning as routes/users.js).
router.put(
  '/api/admin/initiatives/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    const existing = await content.getInitiativeById(req.params.id);
    if (!existing) {
      captureMessage(`Initiative update 404: id "${req.params.id}" not found`, 'warning');
      return res.status(404).json({ error: 'Not found.' });
    }

    if (req.session.role === 'chair') {
      const chairRoundtableId = req.session.roundtableId;
      if (!roundtableArrayContains(existing.roundtableIds, chairRoundtableId)) {
        return res.status(403).json({ error: 'Not authorized to edit this Initiative.' });
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

    const initiative = await content.updateInitiative(req.params.id, req.body);
    captureMessage(`Initiative updated — id: ${initiative.id}, title: "${initiative.title}"`, 'info');
    res.json(initiative);
  }, 'Unable to update initiative.')
);

router.delete(
  '/api/admin/initiatives/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    if (req.session.role === 'chair') {
      const existing = await content.getInitiativeById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      if (!roundtableArrayContains(existing.roundtableIds, req.session.roundtableId)) {
        return res.status(403).json({ error: 'Not authorized to delete this Initiative.' });
      }
    }
    await content.deleteInitiative(req.params.id);
    captureMessage(`Initiative deleted — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to delete initiative.')
);

module.exports = router;
