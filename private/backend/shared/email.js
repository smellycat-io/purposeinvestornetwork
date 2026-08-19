// Optional email notifications via AWS SES. Stays disabled until both
// NOTIFY_EMAIL and SES_FROM_EMAIL are configured — same graceful-degradation
// convention as the S3/DynamoDB clients (see shared/s3Client.js, db/dynamoClient.js).
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { captureException } = require('@sentry/aws-serverless');
const config = require('./config.js');

let sesClient = null;
if (config.NOTIFY_EMAIL && config.SES_FROM_EMAIL) {
  sesClient = new SESClient({ region: config.AWS_REGION || undefined });
  console.log('Email notifications enabled. Notifying:', config.NOTIFY_EMAIL);
}

// Awaited by callers (rather than fire-and-forget) since Lambda can freeze
// the execution environment right after the HTTP response is sent, which
// would silently drop an in-flight SES call.
async function sendNotification(subject, bodyText) {
  if (!sesClient) return;
  try {
    await sesClient.send(new SendEmailCommand({
      Source: config.SES_FROM_EMAIL,
      Destination: { ToAddresses: [config.NOTIFY_EMAIL] },
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
