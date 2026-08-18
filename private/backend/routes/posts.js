const { Router } = require('express');
const { join } = require('path');
const sanitizeHtml = require('sanitize-html');
const content = require('../db/content.js');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { redactPost } = require('../shared/access.js');

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

// --- Education (Posts type:'education' — preview + paywall via redactPost) ---

router.get('/education', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/education.html'));
});

router.get('/education/:slug', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/education-article.html'));
});

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

router.get('/updates', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/updates.html'));
});

router.get('/updates/:slug', (req, res) => {
  res.sendFile(join(__dirname, '..', 'pages/update.html'));
});

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
