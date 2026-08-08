function requireAdmin(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  return res.redirect('/login');
}

module.exports = { requireAdmin };
