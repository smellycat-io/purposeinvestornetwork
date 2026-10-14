const { Router } = require('express');
const { captureException, captureMessage } = require('@sentry/aws-serverless');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { s3Client, S3_BUCKET } = require('../shared/s3Client.js');
const { dynamoDbDocClient, DYNAMODB_TABLE } = require('../db/dynamoClient.js');
const { saveSurveyResponseToStore } = require('../db/store.js');
const campaignsDb = require('../db/campaigns.js');
const { notifyCampaign } = require('../shared/email.js');

const router = Router();

// GET /api/admin/survey-responses is gone — the Campaigns tab reads survey
// entries through GET /api/admin/campaigns/survey/entries instead (see
// routes/campaigns.js, backed by db/campaigns.js's legacy-survey adapter,
// which also fixes the old 200-row cap this route used to have).

router.post('/api/survey', asyncRoute(async (req, res) => {
  const answers = req.body.answers || {};
  const email = (answers.email || '').trim() || null;
  const payload = JSON.stringify(answers);
  const createdAt = new Date().toISOString();
  const recordId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const sqlitePromise = Promise.resolve(saveSurveyResponseToStore(createdAt, email, payload, recordId));

  const dynamoPromise = dynamoDbDocClient
    ? dynamoDbDocClient.send(new PutCommand({
        TableName: DYNAMODB_TABLE,
        Item: {
          id: recordId,
          createdAt,
          email,
          answers,
        },
      }))
    : Promise.resolve(null);

  const responses = await Promise.allSettled([sqlitePromise, dynamoPromise]);
  const sqliteResult = responses[0].status === 'fulfilled' ? responses[0].value : null;
  const dynamoResult = responses[1].status === 'fulfilled' ? responses[1].value : null;

  // Report each failed write even when the other succeeds — a silently
  // broken DynamoDB path is worth knowing about, not just a total outage.
  if (responses[0].status === 'rejected') captureException(responses[0].reason);
  if (responses[1].status === 'rejected') captureException(responses[1].reason);

  if (!sqliteResult && !dynamoResult) {
    const saveError = new Error('Unable to save survey response');
    captureException(saveError);
    return res.status(500).json({ success: false, error: 'Unable to save survey response' });
  }

  // Free-month tracking: if this email already has a waitlist entry, credit
  // it now (DynamoDB-backed — see db/campaigns.js's note on why this
  // replaced the old local-store version). If not, `alreadyOnWaitlist`
  // comes back false so the front-end knows to prompt them to go join the
  // waitlist (they took the survey first).
  const alreadyOnWaitlist = email ? await campaignsDb.linkSurveyToWaitlistEntry(email, recordId) : false;

  captureMessage(
    `Survey response saved — email: "${email || '(not provided)'}", id: ${recordId}, alreadyOnWaitlist: ${alreadyOnWaitlist}`,
    'info'
  );

  await campaignsDb.ensureSiteWideCampaigns();
  const surveyCampaign = await campaignsDb.getCampaignById('survey');
  if (surveyCampaign && surveyCampaign.notifyOnEntry) {
    await notifyCampaign(
      surveyCampaign,
      'New PIN survey response',
      [
        `Email: ${email || '(not provided)'}`,
        `Already on membership waitlist: ${alreadyOnWaitlist ? 'yes' : 'no'}`,
        '',
        'Full answers:',
        JSON.stringify(answers, null, 2),
      ].join('\n')
    );
  }

  if (s3Client) {
    const key = `responses/${Date.now()}-${Math.floor(Math.random() * 100000)}.json`;
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: payload,
      ContentType: 'application/json',
    });

    try {
      await s3Client.send(command);
      return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId, alreadyOnWaitlist, s3Key: key });
    } catch (s3Err) {
      console.error('Failed to upload to S3:', s3Err);
      return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId, alreadyOnWaitlist, s3Error: 'upload failed' });
    }
  }

  return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId, alreadyOnWaitlist });
}, 'Unable to save survey response.'));

module.exports = router;
