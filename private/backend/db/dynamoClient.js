// DynamoDB client for the survey-responses table. Stays null when
// unconfigured so routes can fall back to the local JSON store (db/store.js).
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const config = require('../shared/config.js');

let dynamoDbDocClient = null;
if (config.DYNAMODB_TABLE) {
  const dynamoClient = new DynamoDBClient({ region: config.AWS_REGION || undefined });
  dynamoDbDocClient = DynamoDBDocumentClient.from(dynamoClient);
  console.log('DynamoDB enabled. Table:', config.DYNAMODB_TABLE);
}

module.exports = {
  dynamoDbDocClient,
  DYNAMODB_TABLE: config.DYNAMODB_TABLE,
};
