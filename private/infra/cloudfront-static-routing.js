// CloudFront Function (runtime cloudfront-js-2.0), attached to the default
// (catch-all) cache behavior's viewer-request event — i.e. only requests
// that don't already match a more specific behavior (/api/*, /admin*,
// /login, etc., which go straight to the Lambda origin) ever reach this.
//
// Rewrites clean content URLs onto the actual static file in the S3
// origin, since S3 has no concept of "serve this file for any slug":
//   /<type>                -> /<type>.html            (list pages)
//   /<type>/<slug>         -> /<type>-detail.html      (detail pages)
//   /roundtables/initiatives/<slug> -> /initiative.html (one-off nesting)
//
// Deliberately written by pattern, not a hardcoded type list — adding a
// new content type that follows this convention needs zero edits here.
// Anything that's already a real file (has a "." in the last segment) or
// doesn't match one of these shapes passes through untouched.

function handler(event) {
  var request = event.request;
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
