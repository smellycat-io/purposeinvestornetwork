const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
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

router.get(
  '/api/events',
  asyncRoute(async (req, res) => {
    let events = await content.listEvents();
    if (req.query.conference === 'true') events = events.filter((e) => e.isConference);
    res.json(filterVisible(events, req));
  }, 'Unable to load events.')
);

router.get(
  '/api/events/:slug',
  asyncRoute(async (req, res) => {
    const event = await content.getEventBySlug(req.params.slug);
    if (!event) return res.status(404).json({ error: 'Not found.' });
    if (event.memberOnly && !canSeeFull(event, req)) {
      return res.status(404).json({ error: 'Not found.' });
    }
    res.json(event);
  }, 'Unable to load event.')
);

router.get(
  '/api/admin/events',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await content.listEvents());
  }, 'Unable to load events.')
);

router.post(
  '/api/admin/events',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const payload = { ...req.body, description: sanitizeRichText(req.body.description) };
    const event = await content.createEvent(payload);
    captureMessage(`Event created — id: ${event.id}, title: "${event.title}"`, 'info');
    res.status(201).json(event);
  }, 'Unable to create event.')
);

router.put(
  '/api/admin/events/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const updates = { ...req.body };
    if (updates.description) updates.description = sanitizeRichText(updates.description);
    const event = await content.updateEvent(req.params.id, updates);
    if (!event) {
      captureMessage(`Event update 404: id "${req.params.id}" not found`, 'warning');
      return res.status(404).json({ error: 'Not found.' });
    }
    captureMessage(`Event updated — id: ${event.id}, title: "${event.title}"`, 'info');
    res.json(event);
  }, 'Unable to update event.')
);

router.delete(
  '/api/admin/events/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await content.deleteEvent(req.params.id);
    captureMessage(`Event deleted — id: ${req.params.id}`, 'info');
    res.status(204).end();
  }, 'Unable to delete event.')
);

module.exports = router;
