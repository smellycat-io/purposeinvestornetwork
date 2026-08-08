const { Router } = require('express');
const { captureException } = require('@sentry/aws-serverless');
const { PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { requireAdmin } = require('../shared/auth.js');
const { asyncRoute } = require('../shared/asyncRoute.js');
const { s3Client, S3_BUCKET } = require('../shared/s3Client.js');
const { dynamoDbDocClient, DYNAMODB_TABLE } = require('../db/dynamoClient.js');
const { store, saveSurveyResponseToStore } = require('../db/store.js');

const router = Router();

async function listResponses() {
  if (dynamoDbDocClient) {
    const results = await dynamoDbDocClient.send(new ScanCommand({ TableName: DYNAMODB_TABLE, Limit: 200 }));
    return (results.Items || []).map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      email: item.email,
      answers: item.answers,
    }));
  }

  return store.surveyResponses
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 200)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      email: row.email,
      answers: JSON.parse(row.payload || '{}'),
    }));
}

router.get(
  '/api/admin/survey-responses',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await listResponses());
  }, 'Unable to load survey responses.')
);

router.post('/api/survey', async (req, res) => {
  const answers = req.body.answers || {};
  const email = (answers.email || '').trim() || null;
  const payload = JSON.stringify(answers);
  const createdAt = new Date().toISOString();
  const recordId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const sqlitePromise = Promise.resolve(saveSurveyResponseToStore(createdAt, email, payload));

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
      return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId, s3Key: key });
    } catch (s3Err) {
      console.error('Failed to upload to S3:', s3Err);
      return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId, s3Error: 'upload failed' });
    }
  }

  return res.json({ success: true, sqliteId: sqliteResult, dynamoId: recordId });
});

module.exports = router;
