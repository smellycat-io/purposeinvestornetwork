const { Router } = require('express');
const { captureException, captureMessage } = require('@sentry/aws-serverless');
const config = require('../shared/config.js');
const { verifyPassword } = require('../shared/passwords.js');
const { findUserByEmail } = require('../db/users.js');

const router = Router();

router.get('/login', (req, res) => {
  if (req.session && req.session.loggedIn) {
    return res.redirect('/admin');
  }

  res.send(`
    <html>
      <head>
        <title>PIN Admin Login</title>
        <link rel="stylesheet" href="/auth-card.css" />
      </head>
      <body class="auth-body">
        <div class="auth-card">
          <h1>Admin Login</h1>
          <form method="POST" action="/login">
            <label>Email</label>
            <input type="email" name="email" required />
            <label>Password</label>
            <input type="password" name="password" required />
            <button type="submit">Sign In</button>
          </form>
        </div>
        <p class="auth-link"><a href="/forgot-password.html">Forgot password?</a></p>
      </body>
    </html>
  `);
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  try {
    // Real accounts (Users table) are checked first; the bootstrap
    // ADMIN_USER/ADMIN_PASS env pair is a permanent fallback for when the
    // Users table is empty or unreachable, not something checked alongside
    // a real account of the same address — reporting *which* path a login
    // was checked against is the single most useful fact for diagnosing "my
    // password doesn't work," without ever logging the password itself.
    const user = await findUserByEmail(email);
    let loginOk;
    let checkedAgainst;

    if (user) {
      checkedAgainst = user.status === 'active' ? 'user account' : 'user account (invite not yet accepted)';
      loginOk = user.status === 'active' && verifyPassword(password, user.passwordHash);
    } else {
      checkedAgainst = 'bootstrap ADMIN_PASS env var';
      loginOk = email === config.ADMIN_USER && password === config.ADMIN_PASS;
    }

    if (loginOk) {
      req.session.loggedIn = true;
      if (user) req.session.userId = user.id;
      captureMessage(`Admin login succeeded — email: "${email}", checked against: ${checkedAgainst}`, 'info');
      return res.redirect('/admin');
    }

    captureMessage(`Admin login failed — email: "${email}", checked against: ${checkedAgainst}`, 'warning');
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
