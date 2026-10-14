const { Router } = require('express');
const { join } = require('path');
const { requireRole } = require('../shared/auth.js');

const router = Router();

// Admin and Chair can preview the page; a Member is the only role that
// actually lands here on login (see shared/auth.js's roleHome).
router.get('/member', requireRole('member', 'chair', 'admin'), (req, res) => {
  res.sendFile(join(__dirname, '..', 'member/member.html'));
});

module.exports = router;
