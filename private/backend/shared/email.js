// Email via AWS SES. The client is gated on SES_FROM_EMAIL (a verified
// sender identity — an infra/deploy-time concern, not admin-editable).
//
// sendEmail() is the primitive — any recipient, used by invite/reset-
// password emails where the destination is the target user, not the site
// owner. sendNotification() is a thin wrapper over it for the "notify the
// site owner" case (survey/waitlist signups), resolving the destination
// fresh on every send from getEffectiveNotifyEmail() (settings-table
// override, else the NOTIFY_EMAIL env var) so an admin changing it via the
// settings page takes effect immediately, with no redeploy.
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
// would silently drop an in-flight SES call. Returns true/false rather than
// throwing — a failed send shouldn't fail the request that triggered it
// (the invite/reset token is still valid either way), but callers may want
// to say so in their response.
async function sendEmail(toAddress, subject, bodyText) {
  if (!sesClient || !toAddress) return false;
  try {
    await sesClient.send(new SendEmailCommand({
      Source: config.SES_FROM_EMAIL,
      Destination: { ToAddresses: [toAddress] },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: bodyText } },
      },
    }));
    return true;
  } catch (err) {
    captureException(err);
    return false;
  }
}

async function sendNotification(subject, bodyText) {
  const notifyEmail = await getEffectiveNotifyEmail();
  if (!notifyEmail) return false;
  return sendEmail(notifyEmail, subject, bodyText);
}

module.exports = { sendEmail, sendNotification };
