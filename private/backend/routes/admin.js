const express = require('express');
const { join } = require('path');
const { requireAdmin } = require('../shared/auth.js');

const router = express.Router();

router.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(join(__dirname, '..', 'admin/admin.html'));
});

router.use('/admin/assets', requireAdmin, express.static(join(__dirname, '..', 'admin')));

module.exports = router;
