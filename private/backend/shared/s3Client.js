// S3 client for image uploads and the survey-response JSON backup. Stays
// null when unconfigured so routes can disable/skip those features.
const { S3Client } = require('@aws-sdk/client-s3');
const config = require('./config.js');

let s3Client = null;
if (config.S3_BUCKET) {
  s3Client = new S3Client({});
  console.log('S3 upload enabled. Bucket:', config.S3_BUCKET);
}

module.exports = {
  s3Client,
  S3_BUCKET: config.S3_BUCKET,
};
