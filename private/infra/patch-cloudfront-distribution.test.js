const { patchConfig, BACKEND_PATH_PATTERNS, OBSOLETE_PATH_PATTERNS, API_ORIGIN_ID } = require('./patch-cloudfront-distribution.js');

function minimalConfig(overrides = {}) {
  return {
    Origins: { Quantity: 0, Items: [] },
    CacheBehaviors: { Quantity: 0, Items: [] },
    DefaultCacheBehavior: { FunctionAssociations: { Quantity: 0 } },
    ...overrides,
  };
}

describe('patchConfig — origin reuse by DomainName', () => {
  test('adds a new origin, under API_ORIGIN_ID, when none points at this domain yet', () => {
    const config = minimalConfig();

    patchConfig(config, 'abc123.execute-api.us-east-1.amazonaws.com');

    expect(config.Origins.Items).toHaveLength(1);
    expect(config.Origins.Items[0]).toMatchObject({
      Id: API_ORIGIN_ID,
      DomainName: 'abc123.execute-api.us-east-1.amazonaws.com',
    });
    expect(config.Origins.Quantity).toBe(1);
  });

  // The actual bug this guards against: stage's live origin is named
  // "ApiBackendOriginStage", not "ApiBackendOrigin" — matching by Id alone
  // missed it and added a second, redundant origin pointing at the same
  // domain on every run.
  test('reuses an existing origin with a different Id, rather than adding a duplicate', () => {
    const config = minimalConfig({
      Origins: {
        Quantity: 1,
        Items: [{ Id: 'ApiBackendOriginStage', DomainName: 'o4cz.execute-api.us-east-1.amazonaws.com' }],
      },
    });

    patchConfig(config, 'o4cz.execute-api.us-east-1.amazonaws.com');

    expect(config.Origins.Items).toHaveLength(1);
    expect(config.Origins.Items[0].Id).toBe('ApiBackendOriginStage');
  });

  test('every new backend behavior targets the reused origin Id, not the hardcoded default', () => {
    const config = minimalConfig({
      Origins: {
        Quantity: 1,
        Items: [{ Id: 'ApiBackendOriginStage', DomainName: 'o4cz.execute-api.us-east-1.amazonaws.com' }],
      },
    });

    patchConfig(config, 'o4cz.execute-api.us-east-1.amazonaws.com');

    const memberBehavior = config.CacheBehaviors.Items.find((b) => b.PathPattern === '/admin');
    expect(memberBehavior.TargetOriginId).toBe('ApiBackendOriginStage');
  });

  test('a second run against an already-patched config stays idempotent — no duplicate origins or behaviors', () => {
    const config = minimalConfig();

    patchConfig(config, 'abc123.execute-api.us-east-1.amazonaws.com');
    patchConfig(config, 'abc123.execute-api.us-east-1.amazonaws.com');

    expect(config.Origins.Items).toHaveLength(1);
    expect(config.CacheBehaviors.Items).toHaveLength(BACKEND_PATH_PATTERNS.length);
  });
});

describe('patchConfig — cache behaviors', () => {
  test('adds a behavior for every BACKEND_PATH_PATTERNS entry', () => {
    const config = minimalConfig();

    patchConfig(config, 'abc123.execute-api.us-east-1.amazonaws.com');

    const patterns = config.CacheBehaviors.Items.map((b) => b.PathPattern);
    expect(patterns.sort()).toEqual([...BACKEND_PATH_PATTERNS].sort());
    expect(config.CacheBehaviors.Quantity).toBe(BACKEND_PATH_PATTERNS.length);
  });

  test('removes any pre-existing obsolete-path behavior', () => {
    const config = minimalConfig({
      CacheBehaviors: {
        Quantity: 1,
        Items: [{ PathPattern: OBSOLETE_PATH_PATTERNS[0], TargetOriginId: 'SomeOldOrigin' }],
      },
    });

    patchConfig(config, 'abc123.execute-api.us-east-1.amazonaws.com');

    const patterns = config.CacheBehaviors.Items.map((b) => b.PathPattern);
    expect(patterns).not.toContain(OBSOLETE_PATH_PATTERNS[0]);
  });

  test('leaves an already-present backend behavior unchanged rather than duplicating it', () => {
    const existing = { PathPattern: '/admin', TargetOriginId: 'SomeCustomOriginSomeoneSetByHand' };
    const config = minimalConfig({
      CacheBehaviors: { Quantity: 1, Items: [existing] },
    });

    patchConfig(config, 'abc123.execute-api.us-east-1.amazonaws.com');

    const adminBehaviors = config.CacheBehaviors.Items.filter((b) => b.PathPattern === '/admin');
    expect(adminBehaviors).toHaveLength(1);
    expect(adminBehaviors[0]).toBe(existing);
  });
});

describe('patchConfig — default behavior function association', () => {
  test('sets DefaultCacheBehavior.FunctionAssociations when a functionArn is given', () => {
    const config = minimalConfig();

    patchConfig(config, 'abc123.execute-api.us-east-1.amazonaws.com', 'arn:aws:cloudfront::123:function/test-fn');

    expect(config.DefaultCacheBehavior.FunctionAssociations).toEqual({
      Quantity: 1,
      Items: [{ EventType: 'viewer-request', FunctionARN: 'arn:aws:cloudfront::123:function/test-fn' }],
    });
  });

  test('leaves DefaultCacheBehavior.FunctionAssociations alone when no functionArn is given', () => {
    const config = minimalConfig({ DefaultCacheBehavior: { FunctionAssociations: { Quantity: 0 } } });

    patchConfig(config, 'abc123.execute-api.us-east-1.amazonaws.com');

    expect(config.DefaultCacheBehavior.FunctionAssociations).toEqual({ Quantity: 0 });
  });
});
