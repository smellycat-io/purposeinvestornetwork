const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const content = require('../db/content.js');
const { requireAdmin, requireRole, roundtableArrayContains } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { redactPost } = require('../shared/access.js');
const { sanitizeRichText } = require('../shared/sanitizeHtml.js');

const router = Router();

// Posts don't carry roundtableIds directly, only initiativeId — a Chair's
// write access to a Post is authorized by resolving that Initiative's own
// roundtableIds, mirroring the join listPostsForRoundtable already does for
// reads (see db/content.js) rather than adding a redundant field to Posts.
// Only 'update'-type Posts are tied to an Initiative at all (createPost
// forces initiativeId null for every other type), so a Chair can never
// write a blog/education/announcement/book Post — there's no Roundtable to
// scope those to.
async function isPostInChairScope(post, chairRoundtableId) {
  if (!post || post.type !== 'update' || !post.initiativeId) return false;
  const initiative = await content.getInitiativeById(post.initiativeId);
  return !!initiative && roundtableArrayContains(initiative.roundtableIds, chairRoundtableId);
}

router.get(
  '/api/posts',
  asyncRoute(async (req, res) => {
    res.json(await content.listPosts({ type: 'blog' }));
  }, 'Unable to load posts.')
);

router.get(
  '/api/posts/:slug',
  asyncRoute(async (req, res) => {
    const post = await content.getPostBySlug(req.params.slug);
    if (!post) return res.status(404).json({ error: 'Not found.' });
    res.json(post);
  }, 'Unable to load post.')
);

// --- Education (Posts type:'education' — preview + paywall via redactPost) ---

router.get(
  '/api/education',
  asyncRoute(async (req, res) => {
    const posts = await content.listPosts({ type: 'education' });
    res.json(posts.map((post) => redactPost(post, req)));
  }, 'Unable to load education articles.')
);

router.get(
  '/api/education/:slug',
  asyncRoute(async (req, res) => {
    const post = await content.getPostBySlug(req.params.slug);
    if (!post || post.type !== 'education') return res.status(404).json({ error: 'Not found.' });
    res.json(redactPost(post, req));
  }, 'Unable to load article.')
);

// The single "Buy the Book" module — Posts type:'book'. Not a collection,
// just the most recently published row (or null if none exists yet).
router.get(
  '/api/book',
  asyncRoute(async (req, res) => {
    const [book] = await content.listPosts({ type: 'book' });
    res.json(book || null);
  }, 'Unable to load book info.')
);

// --- PIN Updates (Posts type:'announcement' — always public) ---

router.get(
  '/api/updates',
  asyncRoute(async (req, res) => {
    res.json(await content.listPosts({ type: 'announcement' }));
  }, 'Unable to load updates.')
);

router.get(
  '/api/updates/:slug',
  asyncRoute(async (req, res) => {
    const post = await content.getPostBySlug(req.params.slug);
    if (!post || post.type !== 'announcement') return res.status(404).json({ error: 'Not found.' });
    res.json(post);
  }, 'Unable to load update.')
);

router.get(
  '/api/admin/posts',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await content.listPosts(req.query.type ? { type: req.query.type } : {}));
  }, 'Unable to load posts.')
);

// Create: there's no existing Post to check scope against yet, so a Chair
// is authorized by the submitted type/initiativeId — must be an 'update'
// aimed at an Initiative already in their scope.
router.post(
  '/api/admin/posts',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    if (req.session.role === 'chair') {
      const initiative = req.body.initiativeId ? await content.getInitiativeById(req.body.initiativeId) : null;
      if (req.body.type !== 'update' || !initiative || !roundtableArrayContains(initiative.roundtableIds, req.session.roundtableId)) {
        return res.status(403).json({ error: 'Chairs can only post updates to an Initiative under their own Roundtable.' });
      }
    }
    const payload = { ...req.body, body: sanitizeRichText(req.body.body) };
    const post = await content.createPost(payload);
    captureMessage(`Post created — id: ${post.id}, type: ${post.type}, title: "${post.title}"`, 'info');
    res.status(201).json(post);
  }, 'Unable to create post.')
);

// Edit: authorized against the *existing* Post's current type/initiativeId,
// not the request body. If the body tries to change `type` away from
// 'update' or move `initiativeId` to an Initiative outside the Chair's
// scope, that's rejected (400) rather than silently applied — same
// "don't let a PUT body move an item out from under the scoping check"
// concern the roundtableIds restriction on Initiatives/Investments guards
// against.
router.put(
  '/api/admin/posts/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    const existing = await content.getPostById(req.params.id);
    if (!existing) {
      captureMessage(`Post update 404: id "${req.params.id}" not found`, 'warning');
      return res.status(404).json({ error: 'Not found.' });
    }

    if (req.session.role === 'chair') {
      const chairRoundtableId = req.session.roundtableId;
      if (!(await isPostInChairScope(existing, chairRoundtableId))) {
        return res.status(403).json({ error: 'Not authorized to edit this Post.' });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'type') && req.body.type !== 'update') {
        return res.status(400).json({ error: "Chairs cannot change a Post's type." });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'initiativeId') && req.body.initiativeId !== existing.initiativeId) {
        const nextInitiative = req.body.initiativeId ? await content.getInitiativeById(req.body.initiativeId) : null;
        if (!nextInitiative || !roundtableArrayContains(nextInitiative.roundtableIds, chairRoundtableId)) {
          return res.status(400).json({ error: 'Chairs can only move a Post to an Initiative under their own Roundtable.' });
        }
      }
    }

    const updates = { ...req.body };
    if (updates.body) updates.body = sanitizeRichText(updates.body);
    const post = await content.updatePost(req.params.id, updates);
    captureMessage(`Post updated — id: ${post.id}, type: ${post.type}, title: "${post.title}"`, 'info');
    res.json(post);
  }, 'Unable to update post.')
);

router.delete(
  '/api/admin/posts/:id',
  requireRole('admin', 'chair'),
  asyncRoute(async (req, res) => {
    if (req.session.role === 'chair') {
      const existing = await content.getPostById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      if (!(await isPostInChairScope(existing, req.session.roundtableId))) {
        return res.status(403).json({ error: 'Not authorized to delete this Post.' });
      }
    }
    await content.deletePost(req.params.id);
    captureMessage(`Post deleted — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to delete post.')
);

module.exports = router;
