const express = require('express');
const { join } = require('path');
const { requireRole } = require('../shared/auth.js');

const router = express.Router();

// Any logged-in role, not just Admin/Chair — a Member has nowhere else to
// land yet (the Member-facing area is not yet implemented; see
// docs/DATA-MODEL.md) and login always redirects to /admin regardless of
// role, so excluding Member here would break their post-login experience
// outright rather than just limiting what they can do once there.
router.get('/admin', requireRole('admin', 'chair', 'member'), (req, res) => {
  res.sendFile(join(__dirname, '..', 'admin/admin.html'));
});

router.use('/admin/assets', requireRole('admin', 'chair', 'member'), express.static(join(__dirname, '..', 'admin')));

module.exports = router;
