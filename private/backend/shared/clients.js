// Shared AWS clients for the survey-responses table and image uploads.
// Both stay null when unconfigured so routes can fall back gracefully
// (local JSON store instead of DynamoDB, upload endpoint disabled instead of S3).
const { S3Client } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const config = require('./config.js');

let s3Client = null;
if (config.S3_BUCKET) {
  s3Client = new S3Client({});
  console.log('S3 upload enabled. Bucket:', config.S3_BUCKET);
}

let dynamoDbDocClient = null;
if (config.DYNAMODB_TABLE) {
  const dynamoClient = new DynamoDBClient({ region: config.AWS_REGION || undefined });
  dynamoDbDocClient = DynamoDBDocumentClient.from(dynamoClient);
  console.log('DynamoDB enabled. Table:', config.DYNAMODB_TABLE);
}

module.exports = {
  s3Client,
  dynamoDbDocClient,
  S3_BUCKET: config.S3_BUCKET,
  DYNAMODB_TABLE: config.DYNAMODB_TABLE,
};
