const { Router } = require('express');
const { captureException, captureMessage } = require('@sentry/aws-serverless');
const config = require('../shared/config.js');
const { verifyPassword } = require('../shared/passwords.js');
const { findUserByUsername } = require('../db/users.js');

const router = Router();

router.get('/login', (req, res) => {
  if (req.session && req.session.loggedIn) {
    return res.redirect('/admin');
  }

  res.send(`
    <html>
      <head><title>PIN Admin Login</title></head>
      <body style="font-family:system-ui, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; background:#f5f3ef; margin:0;">
        <form method="POST" action="/login" style="background:#ffffff; padding:32px; border-radius:16px; box-shadow:0 16px 40px rgba(0,0,0,0.08); width:320px;">
          <h1 style="margin-bottom:20px;font-size:22px;">Admin Login</h1>
          <label style="display:block; margin-bottom:10px; font-weight:600;">Username</label>
          <input name="username" required style="width:100%;padding:10px;margin-bottom:16px;border:1px solid #ccc;border-radius:8px;" />
          <label style="display:block; margin-bottom:10px; font-weight:600;">Password</label>
          <input type="password" name="password" required style="width:100%;padding:10px;margin-bottom:24px;border:1px solid #ccc;border-radius:8px;" />
          <button type="submit" style="width:100%;background:#d70010;color:#fff;border:none;padding:12px 0;border-radius:999px;font-weight:700;cursor:pointer;">Sign In</button>
        </form>
        <p style="text-align:center;margin-top:16px;"><a href="/forgot-password.html" style="color:#666;font-size:14px;">Forgot password?</a></p>
      </body>
    </html>
  `);
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Real accounts (Users table) are checked first; the bootstrap
    // ADMIN_USER/ADMIN_PASS env pair is a permanent fallback for when the
    // Users table is empty or unreachable, not something checked alongside
    // a real account of the same name — reporting *which* path a login was
    // checked against is the single most useful fact for diagnosing "my
    // password doesn't work," without ever logging the password itself.
    const user = await findUserByUsername(username);
    let loginOk;
    let checkedAgainst;

    if (user) {
      checkedAgainst = user.status === 'active' ? 'user account' : 'user account (invite not yet accepted)';
      loginOk = user.status === 'active' && verifyPassword(password, user.passwordHash);
    } else {
      checkedAgainst = 'bootstrap ADMIN_PASS env var';
      loginOk = username === config.ADMIN_USER && password === config.ADMIN_PASS;
    }

    if (loginOk) {
      req.session.loggedIn = true;
      if (user) req.session.userId = user.id;
      captureMessage(`Admin login succeeded — username: "${username}", checked against: ${checkedAgainst}`, 'info');
      return res.redirect('/admin');
    }

    captureMessage(`Admin login failed — username: "${username}", checked against: ${checkedAgainst}`, 'warning');
  } catch (err) {
    captureException(err);
    return res.send('<p>Something went wrong checking your credentials. <a href="/login">Try again</a>.</p>');
  }

  return res.send('<p>Invalid credentials. <a href="/login">Try again</a>.</p>');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
