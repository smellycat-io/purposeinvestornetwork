// Jest `setupFiles` entry — runs before every test file's own code, and
// critically before `sentry/instrument.js`'s `dotenv.config()` call (which
// only sets variables not already in `process.env`, so anything set here
// wins). Without this, `npm test` loads the real repo-root `.env` and
// exercises real AWS/SES/Sentry config: `POST /api/survey` in
// server.test.js was previously attempting a live S3 PutObject against the
// production bucket (and failing with a signature error, not "table
// doesn't exist" — worth knowing this was reaching AWS at all, not
// stopping short).
//
// Blank every table/bucket/DSN var here; individual test files that need a
// specific value (e.g. db/users.test.js needing AWS_USERS_TABLE set so its
// mocked calls actually run) set it locally, after setupFiles, which wins.
const VARS_TO_BLANK = [
  'AWS_S3_BUCKET',
  'AWS_BACKEND_BUCKET',
  'AWS_ROUNDTABLES_TABLE',
  'AWS_INITIATIVES_TABLE',
  'AWS_POSTS_TABLE',
  'AWS_IMAGES_TABLE',
  'AWS_PRESS_TABLE',
  'AWS_INVESTMENTS_TABLE',
  'AWS_EVENTS_TABLE',
  'AWS_SETTINGS_TABLE',
  'AWS_SESSIONS_TABLE',
  'AWS_USERS_TABLE',
  'AWS_DYNAMODB_TABLE',
  'SES_FROM_EMAIL',
  'NOTIFY_EMAIL',
  'SENTRY_DSN',
  'SENTRY_BROWSER_DSN',
  'POSTHOG_API_KEY',
];

// Set to '' rather than deleted: dotenv.config() only skips a key that's
// already *present* in process.env (even blank) — deleting it would leave
// the key absent, and dotenv would then happily fill it back in from the
// real .env file, defeating the whole point of this file.
VARS_TO_BLANK.forEach((key) => {
  process.env[key] = '';
});
