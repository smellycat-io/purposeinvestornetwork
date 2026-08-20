// CloudFront Function (runtime cloudfront-js-2.0) for the STAGE distribution's
// Lambda-routed cache behaviors (/login, /admin, /admin/*, /api/*, /env.js,
// /sentry-test). Basic Auth only — no URL rewriting needed here since these
// paths already go straight to the Lambda origin. Kept as a separate function
// from cloudfront-stage-static-routing-auth.js so the rewrite logic there
// never runs against API paths.
import cf from 'cloudfront';

async function handler(event) {
  var request = event.request;
  var headers = request.headers;

  var expected = '';
  try {
    var kvsHandle = cf.kvs();
    expected = await kvsHandle.get('authHeader');
  } catch (e) {
    expected = '';
  }

  var provided = headers.authorization ? headers.authorization.value : '';
  if (!expected || provided !== expected) {
    return {
      statusCode: 401,
      statusDescription: 'Unauthorized',
      headers: {
        'www-authenticate': { value: 'Basic realm="PIN Staging"' },
      },
    };
  }

  return request;
}
