#!/usr/bin/env node
/**
 * Patches an existing CloudFront distribution config (already fetched via
 * `aws cloudfront get-distribution-config`) to:
 *   - add an API Gateway origin plus path-based cache behaviors for the
 *     small, stable set of routes that genuinely need the Lambda backend
 *   - attach the static-routing CloudFront Function (see
 *     cloudfront-static-routing.js) to the default (S3) cache behavior,
 *     so clean content URLs resolve to the right static file
 *   - remove cache behaviors for paths that used to need Lambda routing
 *     but are now plain static files served by the default S3 behavior
 *     (every content-type page — Roundtables, Press, Investments, Events,
 *     Conference, Education, Updates — moved to static hosting; only the
 *     truly dynamic/admin-gated routes below still need Lambda)
 *
 * This does NOT call AWS directly — it only transforms a JSON file you
 * already fetched, and prints the result. You still run `update-distribution`
 * yourself. That keeps this safe to re-run / inspect before touching
 * anything live.
 *
 * Usage:
 *   node private/infra/patch-cloudfront-distribution.js <dist-config.json> <api-domain> [function-arn] > dist-config-updated.json
 *
 * Where <api-domain> is just the hostname, e.g.
 *   abc123xyz.execute-api.us-east-1.amazonaws.com
 * (no https://, no trailing slash — use the ApiDomainOnly stack output)
 *
 * <function-arn> is the published CloudFront Function ARN (from
 * `aws cloudfront publish-function`), only needed once to wire it up.
 */

const fs = require('fs');

const CACHING_DISABLED_POLICY = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'; // Managed-CachingDisabled
const ALL_VIEWER_EXCEPT_HOST_POLICY = 'b689b0a8-53d0-40ab-baf2-68738e2966ac'; // Managed-AllViewerExceptHostHeader
const API_ORIGIN_ID = 'ApiBackendOrigin';

// Genuinely dynamic / admin-gated routes — the only ones that still need
// to hit the Lambda backend. Content pages are static now; adding a new
// content type never requires touching this list.
const BACKEND_PATH_PATTERNS = [
  '/login',
  '/logout',
  '/admin',
  '/admin/*',
  '/api/*',
  '/env.js',
  '/sentry-test',
];

// Cache behaviors that predate the static-hosting migration and are no
// longer needed — every one of these paths is now a static file resolved
// via the default behavior + the static-routing CloudFront Function.
const OBSOLETE_PATH_PATTERNS = [
  '/roundtables',
  '/roundtables/*',
  '/press',
  '/investments',
  '/investments/*',
  '/events',
  '/events/*',
  '/conference',
  '/education',
  '/education/*',
  '/updates',
  '/updates/*',
];

const [, , configPath, apiDomain, functionArn] = process.argv;

if (!configPath || !apiDomain) {
  console.error('Usage: node patch-cloudfront-distribution.js <dist-config.json> <api-domain> [function-arn]');
  process.exit(1);
}

if (apiDomain.includes('://')) {
  console.error('apiDomain should be a bare hostname (no https://). Got:', apiDomain);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// AWS's API omits the "Items" key entirely when Quantity is 0, rather than
// returning an empty array — normalize that so the rest of this script
// doesn't have to special-case it.
if (!config.Origins.Items) config.Origins.Items = [];
if (!config.CacheBehaviors) config.CacheBehaviors = { Quantity: 0 };
if (!config.CacheBehaviors.Items) config.CacheBehaviors.Items = [];

// Add the API origin if it's not already there (safe to re-run)
const hasApiOrigin = config.Origins.Items.some((o) => o.Id === API_ORIGIN_ID);
if (!hasApiOrigin) {
  config.Origins.Items.push({
    Id: API_ORIGIN_ID,
    DomainName: apiDomain,
    OriginPath: '',
    CustomHeaders: { Quantity: 0 },
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'https-only',
      OriginSslProtocols: { Quantity: 1, Items: ['TLSv1.2'] },
      OriginReadTimeout: 30,
      OriginKeepaliveTimeout: 5,
    },
    ConnectionAttempts: 3,
    ConnectionTimeout: 10,
    OriginShield: { Enabled: false },
  });
  config.Origins.Quantity = config.Origins.Items.length;
} else {
  console.error(`Note: origin "${API_ORIGIN_ID}" already present, leaving Origins unchanged.`);
}

function makeBackendBehavior(pathPattern) {
  return {
    PathPattern: pathPattern,
    TargetOriginId: API_ORIGIN_ID,
    ViewerProtocolPolicy: 'redirect-to-https',
    AllowedMethods: {
      Quantity: 7,
      Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
      CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] },
    },
    SmoothStreaming: false,
    Compress: true,
    LambdaFunctionAssociations: { Quantity: 0 },
    FunctionAssociations: { Quantity: 0 },
    FieldLevelEncryptionId: '',
    CachePolicyId: CACHING_DISABLED_POLICY,
    OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST_POLICY,
    TrustedSigners: { Enabled: false, Quantity: 0 },
    TrustedKeyGroups: { Enabled: false, Quantity: 0 },
  };
}

const beforeCount = config.CacheBehaviors.Items.length;
config.CacheBehaviors.Items = config.CacheBehaviors.Items.filter(
  (b) => !OBSOLETE_PATH_PATTERNS.includes(b.PathPattern)
);
const removedCount = beforeCount - config.CacheBehaviors.Items.length;
if (removedCount > 0) {
  console.error(`Removed ${removedCount} obsolete cache behavior(s) for now-static content paths.`);
}

const existingPatterns = new Set(config.CacheBehaviors.Items.map((b) => b.PathPattern));
for (const pattern of BACKEND_PATH_PATTERNS) {
  if (!existingPatterns.has(pattern)) {
    config.CacheBehaviors.Items.push(makeBackendBehavior(pattern));
  } else {
    console.error(`Note: behavior for "${pattern}" already present, leaving it unchanged.`);
  }
}
config.CacheBehaviors.Quantity = config.CacheBehaviors.Items.length;

if (functionArn) {
  config.DefaultCacheBehavior.FunctionAssociations = {
    Quantity: 1,
    Items: [{ EventType: 'viewer-request', FunctionARN: functionArn }],
  };
} else {
  console.error('Note: no function-arn given, leaving DefaultCacheBehavior.FunctionAssociations unchanged.');
}

process.stdout.write(JSON.stringify(config, null, 2));
