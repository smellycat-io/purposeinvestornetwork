// Wraps a route handler so every route doesn't repeat the same
// try/catch -> captureException -> 500 JSON boilerplate. The handler is
// still free to return its own status codes (404s, validation errors, etc)
// for anything that isn't an unexpected failure.
const { captureException } = require('@sentry/aws-serverless');

function asyncRoute(handler, errorMessage) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      captureException(error);
      res.status(500).json({ error: errorMessage });
    }
  };
}

module.exports = { asyncRoute };
