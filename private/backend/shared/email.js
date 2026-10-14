// Email via AWS SES. The client is gated on SES_FROM_EMAIL (a verified
// sender identity — an infra/deploy-time concern, not admin-editable).
//
// sendEmail() is the primitive — any recipient, used by invite/reset-
// password emails where the destination is the target user, not the site
// owner. notifyCampaign() is the "tell whoever's results emails are
// registered for this campaign" case (survey/waitlist/newsletter/interest-
// form entries), resolving recipients fresh on every send via
// db/campaigns.js's resolveResultsEmails — an Admin's resultsEmails edit or
// a newly-assigned Chair takes effect on the very next entry, no redeploy.
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { captureException } = require('@sentry/aws-serverless');
const config = require('./config.js');
const { resolveResultsEmails } = require('../db/campaigns.js');

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

// Sends to every resolved recipient, awaited sequentially (not
// Promise.all) — same reasoning as sendEmail's own "awaited by callers"
// note above: Lambda can freeze the execution environment right after the
// response is sent, and a batch of unawaited in-flight sends is exactly
// the shape that would get silently dropped. Returns true if there was at
// least one recipient to send to, false if resolution came up empty (the
// entry itself is still saved either way — this only gates the email).
async function notifyCampaign(campaign, subject, bodyText) {
  const recipients = await resolveResultsEmails(campaign);
  for (const recipient of recipients) {
    await sendEmail(recipient, subject, bodyText);
  }
  return recipients.length > 0;
}

// Shared by routes/users.js's invite route, the resend route, and nowhere
// else yet — pulled out so a third call site (e.g. a future bulk-invite
// tool) doesn't have to re-duplicate the copy. Role-neutral on purpose: the
// invitee may be a Chair or a Member, not necessarily anyone who'd call
// this "the admin dashboard." `note` is an optional personal note from the
// inviter, included in the body only — never persisted anywhere.
async function sendInviteEmail(toAddress, link, { note } = {}) {
  const lines = [
    "You've been invited to join the Purpose Investor Network. Set up your account here:",
    '',
    link,
    '',
    'This link expires in 7 days.',
  ];
  if (note) lines.push('', `Personal note: ${note}`);
  return sendEmail(toAddress, 'You’ve been invited to the Purpose Investor Network', lines.join('\n'));
}

// Shared by the public /api/forgot-password route and the Admin-triggered
// /api/admin/users/:id/send-reset route — same link, same 1-hour expiry,
// same copy either way, since the recipient shouldn't be able to tell
// which one triggered it.
async function sendResetEmail(toAddress, link) {
  return sendEmail(
    toAddress,
    'Reset your Purpose Investor Network admin password',
    `A password reset was requested for your PIN admin account. Reset it here:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`
  );
}

module.exports = { sendEmail, notifyCampaign, sendInviteEmail, sendResetEmail };
