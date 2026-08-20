// CloudFront Function (runtime cloudfront-js-2.0) for the STAGE distribution's
// default (S3) cache behavior. Combines two responsibilities:
//   1. HTTP Basic Auth gate — stage is not public, every request must present
//      valid credentials or gets a 401. Expected credential lives in the
//      associated Key Value Store (pin-stage-auth-store, key "authHeader"),
//      never hardcoded here, so it can be rotated without republishing.
//   2. The same clean-URL rewrite as prod's pin-static-content-routing (see
//      cloudfront-static-routing.js) — kept in sync manually since CloudFront
//      Functions don't support shared imports across functions.
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

  var uri = request.uri;
  var parts = uri.split('/').filter(function (p) { return p.length > 0; });
  if (parts.length === 0) return request;

  var last = parts[parts.length - 1];
  if (last.indexOf('.') !== -1) return request;

  if (parts.length === 3 && parts[0] === 'roundtables' && parts[1] === 'initiatives') {
    request.uri = '/initiative.html';
    return request;
  }

  if (parts.length === 1) {
    request.uri = '/' + parts[0] + '.html';
    return request;
  }

  if (parts.length === 2) {
    request.uri = '/' + parts[0] + '-detail.html';
    return request;
  }

  return request;
}
