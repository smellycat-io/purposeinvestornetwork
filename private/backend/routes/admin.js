const express = require('express');
const { join } = require('path');
const { requireRole } = require('../shared/auth.js');

const router = express.Router();

// Admin and Chair only — a Member has its own home at /member (see
// routes/member.js and shared/auth.js's roleHome) and never reaches this
// page at all: requireRole redirects a wrong-role page request to
// roleHome(role) rather than here.
router.get('/admin', requireRole('admin', 'chair'), (req, res) => {
  res.sendFile(join(__dirname, '..', 'admin/admin.html'));
});

router.use('/admin/assets', requireRole('admin', 'chair'), express.static(join(__dirname, '..', 'admin')));

module.exports = router;
