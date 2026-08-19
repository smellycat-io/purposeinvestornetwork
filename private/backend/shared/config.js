module.exports = {
  PORT: process.env.PORT || 3000,
  ADMIN_USER: process.env.ADMIN_USER,
  ADMIN_PASS: process.env.ADMIN_PASS,
  SESSION_SECRET: process.env.SESSION_SECRET || 'replace-this-in-prod',
  AWS_REGION: process.env.AWS_REGION || null,
  DYNAMODB_TABLE: process.env.AWS_DYNAMODB_TABLE || null,
  S3_BUCKET: process.env.AWS_S3_BUCKET || null,
  SENTRY_BROWSER_DSN: process.env.SENTRY_BROWSER_DSN || null,
  SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
  SENTRY_RELEASE: process.env.SENTRY_RELEASE || 'purpose-investor-network@latest',
  SENTRY_BROWSER_TRACES_SAMPLE_RATE: parseFloat(
    process.env.SENTRY_BROWSER_TRACES_SAMPLE_RATE || process.env.SENTRY_TRACES_SAMPLE_RATE || '0.0'
  ),
  POSTHOG_API_KEY: process.env.POSTHOG_API_KEY || null,
  POSTHOG_HOST: process.env.POSTHOG_HOST || 'https://app.posthog.com',
  // Email notifications (survey submissions, waitlist signups) via SES.
  // Both must be set — NOTIFY_EMAIL is where alerts go, SES_FROM_EMAIL must
  // be a verified sender identity in the AWS account's SES setup.
  NOTIFY_EMAIL: process.env.NOTIFY_EMAIL || null,
  SES_FROM_EMAIL: process.env.SES_FROM_EMAIL || null,
};
