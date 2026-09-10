// Shared rich-text sanitizer config for admin-authored HTML (post bodies,
// investment/event descriptions). Was copy-pasted verbatim across three
// route files.
const sanitizeHtml = require('sanitize-html');

function sanitizeRichText(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'img'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
    },
  });
}

module.exports = { sanitizeRichText };
