// Shared Sentry browser initialization. Depends on /env.js (sets window.ENV)
// and the Sentry CDN bundle having been loaded first.
function initBrowserSentry(pageTag) {
  if (!window.ENV || !window.ENV.SENTRY_BROWSER_DSN) return;

  Sentry.init({
    dsn: window.ENV.SENTRY_BROWSER_DSN,
    environment: window.ENV.SENTRY_ENVIRONMENT,
    release: window.ENV.SENTRY_RELEASE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: window.ENV.SENTRY_TRACES_SAMPLE_RATE || 0,
  });
  Sentry.setTag('page', pageTag);
}
