// Optional email notifications via AWS SES. The client is gated on
// SES_FROM_EMAIL (a verified sender identity — an infra/deploy-time concern,
// not admin-editable). The destination address is resolved fresh on every
// send from getEffectiveNotifyEmail() (settings-table override, else the
// NOTIFY_EMAIL env var it was bootstrapped from) so an admin changing it via
// the settings page takes effect immediately, with no redeploy.
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { captureException } = require('@sentry/aws-serverless');
const config = require('./config.js');
const { getEffectiveNotifyEmail } = require('../db/settings.js');

let sesClient = null;
if (config.SES_FROM_EMAIL) {
  sesClient = new SESClient({ region: config.AWS_REGION || undefined });
  console.log('Email notifications enabled (sender: %s).', config.SES_FROM_EMAIL);
}

// Awaited by callers (rather than fire-and-forget) since Lambda can freeze
// the execution environment right after the HTTP response is sent, which
// would silently drop an in-flight SES call.
async function sendNotification(subject, bodyText) {
  if (!sesClient) return;
  try {
    const notifyEmail = await getEffectiveNotifyEmail();
    if (!notifyEmail) return;

    await sesClient.send(new SendEmailCommand({
      Source: config.SES_FROM_EMAIL,
      Destination: { ToAddresses: [notifyEmail] },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: bodyText } },
      },
    }));
  } catch (err) {
    // A failed notification shouldn't fail the request that triggered it.
    captureException(err);
  }
}

module.exports = { sendNotification };
