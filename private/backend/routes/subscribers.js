const { Router } = require('express');
const { captureMessage } = require('@sentry/aws-serverless');
const { asyncRoute } = require('../shared/asyncRoute.js');
const campaignsDb = require('../db/campaigns.js');
const { notifyCampaign } = require('../shared/email.js');

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_SOURCES = ['newsletter', 'membership-waitlist'];

// The exact wording recorded as this entry's consent basis — there's no
// checkbox on either of these forms, so consent is implied by submitting
// the form at all, not an explicit opt-in choice the way the interest
// form's checkbox is. Flagged in the PR description as a product/legal
// call for Elise to confirm, not something settled unilaterally here.
const CONSENT_TEXT = {
  newsletter: 'Subscribed via newsletter form',
  'membership-waitlist': 'Joined membership waitlist',
};

router.post('/api/subscribe', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  const source = VALID_SOURCES.includes(body.source) ? body.source : 'newsletter';
  const campaignId = source === 'membership-waitlist' ? 'waitlist' : 'newsletter';
  const details = {
    name: String(body.name || '').trim().slice(0, 200) || null,
    phone: String(body.phone || '').trim().slice(0, 40) || null,
    address: String(body.address || '').trim().slice(0, 300) || null,
  };

  await campaignsDb.ensureSiteWideCampaigns();
  const campaign = await campaignsDb.getCampaignById(campaignId);

  const fields = { ...details, consent: true, consentText: CONSENT_TEXT[source] };
  if (campaignId === 'waitlist') {
    // Preserve the free-month link: a waitlist signup can arrive before or
    // after the person's survey response (see db/campaigns.js's own note
    // on this), so this always checks the legacy survey sources fresh on
    // every save. Flagged in the PR description as the piece of this
    // branch most likely to be reworked or removed once Campaigns fully
    // absorbs survey data too.
    const surveyResponseId = await campaignsDb.findLegacySurveyRecordIdByEmail(email);
    if (surveyResponseId) {
      fields.surveyResponseId = surveyResponseId;
      fields.freeMonthEarned = true;
    }
  }

  const { isNew } = await campaignsDb.upsertEntry(campaignId, email, fields);

  captureMessage(`Subscriber saved — email: "${email}", source: ${source}`, 'info');

  if (isNew && campaign && campaign.notifyOnEntry) {
    const subject = source === 'membership-waitlist' ? 'New PIN membership waitlist signup' : 'New PIN newsletter signup';
    await notifyCampaign(campaign, subject, [
      `Email: ${email}`,
      `Name: ${details.name || '(not provided)'}`,
      `Phone: ${details.phone || '(not provided)'}`,
      `Address: ${details.address || '(not provided)'}`,
    ].join('\n'));
  }

  res.status(201).json({ success: true });
}, 'Unable to save your email right now.'));

module.exports = router;
