// Quick script to trigger an intentional error and flush to Sentry.
require('./instrument.js');
const Sentry = require('@sentry/node');

(async () => {
  try {
    // intentional ReferenceError
    foo();
  } catch (e) {
    console.log('Captured locally, sending to Sentry...');
    Sentry.captureException(e);
    try {
      await Sentry.flush(2000);
      console.log('Flushed to Sentry (or timed out).');
    } catch (flushErr) {
      console.error('Flush failed:', flushErr);
    }
  }
})();
