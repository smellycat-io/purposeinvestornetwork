const { Router } = require('express');
const { captureException } = require('@sentry/aws-serverless');
const config = require('../shared/config.js');
const { checkAdminPassword } = require('../db/settings.js');

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
      </body>
    </html>
  `);
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    if (username === config.ADMIN_USER && (await checkAdminPassword(password))) {
      req.session.loggedIn = true;
      return res.redirect('/admin');
    }
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
