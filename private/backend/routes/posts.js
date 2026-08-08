const { Router } = require('express');
const sanitizeHtml = require('sanitize-html');
const content = require('../db/content.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');

const router = Router();

function sanitizePostBody(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'img'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
    },
  });
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

router.get(
  '/api/admin/posts',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await content.listPosts(req.query.type ? { type: req.query.type } : {}));
  }, 'Unable to load posts.')
);

router.post(
  '/api/admin/posts',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const payload = { ...req.body, body: sanitizePostBody(req.body.body) };
    res.status(201).json(await content.createPost(payload));
  }, 'Unable to create post.')
);

router.put(
  '/api/admin/posts/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const updates = { ...req.body };
    if (updates.body) updates.body = sanitizePostBody(updates.body);
    const post = await content.updatePost(req.params.id, updates);
    if (!post) return res.status(404).json({ error: 'Not found.' });
    res.json(post);
  }, 'Unable to update post.')
);

router.delete(
  '/api/admin/posts/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await content.deletePost(req.params.id);
    res.status(204).end();
  }, 'Unable to delete post.')
);

module.exports = router;
