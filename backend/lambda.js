const { wrapHandler } = require('@sentry/aws-serverless');
const serverless = require('serverless-http');
const { app } = require('./index');

module.exports.handler = wrapHandler(serverless(app));