#!/usr/bin/env node
/**
 * Patches an existing CloudFront distribution config (already fetched via
 * `aws cloudfront get-distribution-config`) to add an API Gateway origin
 * plus path-based cache behaviors for the backend routes.
 *
 * This does NOT call AWS directly — it only transforms a JSON file you
 * already fetched, and prints the result. You still run `update-distribution`
 * yourself. That keeps this safe to re-run / inspect before touching
 * anything live.
 *
 * Usage:
 *   node infra/patch-cloudfront-distribution.js <dist-config.json> <api-domain> > dist-config-updated.json
 *
 * Where <api-domain> is just the hostname, e.g.
 *   abc123xyz.execute-api.us-east-1.amazonaws.com
 * (no https://, no trailing slash — use the ApiDomainOnly stack output)
 */

const fs = require('fs');

const CACHING_DISABLED_POLICY = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'; // Managed-CachingDisabled
const ALL_VIEWER_EXCEPT_HOST_POLICY = 'b689b0a8-53d0-40ab-baf2-68738e2966ac'; // Managed-AllViewerExceptHostHeader
const API_ORIGIN_ID = 'ApiBackendOrigin';

const BACKEND_PATH_PATTERNS = [
  '/login',
  '/logout',
  '/admin',
  '/admin/*',
  '/api/*',
  '/env.js',
  '/sentry-test',
];

const [, , configPath, apiDomain] = process.argv;

if (!configPath || !apiDomain) {
  console.error('Usage: node patch-cloudfront-distribution.js <dist-config.json> <api-domain>');
  process.exit(1);
}

if (apiDomain.includes('://')) {
  console.error('apiDomain should be a bare hostname (no https://). Got:', apiDomain);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

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

const existingPatterns = new Set(config.CacheBehaviors.Items.map((b) => b.PathPattern));
for (const pattern of BACKEND_PATH_PATTERNS) {
  if (!existingPatterns.has(pattern)) {
    config.CacheBehaviors.Items.push(makeBackendBehavior(pattern));
  } else {
    console.error(`Note: behavior for "${pattern}" already present, leaving it unchanged.`);
  }
}
config.CacheBehaviors.Quantity = config.CacheBehaviors.Items.length;

process.stdout.write(JSON.stringify(config, null, 2));
