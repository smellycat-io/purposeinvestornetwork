const crypto = require('crypto');

// USERS_TABLE is captured as a module-level constant on first require, so
// this must be set before that happens — the global test env setup blanks
// it (see test/setupEnv.js) precisely so a test file that forgets to do
// this fails loudly (empty-table no-ops) instead of scanning a real table.
process.env.AWS_USERS_TABLE = 'test-users-table';

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { hashPassword, verifyPassword } = require('../shared/passwords.js');
const users = require('./users.js');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('createInvite', () => {
  test('generates a token, stores only its hash, and writes a pending user', async () => {
    ddbMock.on(PutCommand).resolves({});

    const { user, token } = await users.createInvite('invitee@example.com');

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(user.status).toBe('pending');
    expect(user.email).toBe('invitee@example.com');
    expect(user.inviteTokenHash).toBe(sha256(token));
    expect(user.inviteTokenHash).not.toBe(token);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({ TableName: 'test-users-table', Item: user });
  });
});

describe('acceptInvite', () => {
  test('round-trips: valid token activates the account and sets a verifiable password', async () => {
    ddbMock.on(PutCommand).resolves({});
    const { user: pendingUser, token } = await users.createInvite('invitee@example.com');
    ddbMock.on(ScanCommand).resolves({ Items: [pendingUser] });

    const result = await users.acceptInvite(token, {
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      address: null,
      password: 's3cret-password',
    });

    expect(result.error).toBeUndefined();
    expect(result.user.status).toBe('active');
    expect(result.user.firstName).toBe('Jane');
    expect(result.user.inviteTokenHash).toBeNull();
    expect(result.user.inviteTokenExpiresAt).toBeNull();
    expect(verifyPassword('s3cret-password', result.user.passwordHash)).toBe(true);
    expect(verifyPassword('wrong-password', result.user.passwordHash)).toBe(false);
  });

  test('rejects a well-formed but wrong token', async () => {
    ddbMock.on(PutCommand).resolves({});
    const { user: pendingUser } = await users.createInvite('invitee@example.com');
    ddbMock.on(ScanCommand).resolves({ Items: [pendingUser] });

    const wrongToken = crypto.randomBytes(32).toString('hex');
    const result = await users.acceptInvite(wrongToken, { firstName: 'Jane', password: 'x' });

    expect(result).toEqual({ error: 'invalid_or_expired' });
  });

  test('rejects an expired invite even with the correct token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiredUser = {
      id: 'u1',
      email: 'invitee@example.com',
      status: 'pending',
      inviteTokenHash: sha256(token),
      inviteTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    ddbMock.on(ScanCommand).resolves({ Items: [expiredUser] });

    const result = await users.acceptInvite(token, { firstName: 'Jane', password: 'x' });

    expect(result).toEqual({ error: 'invalid_or_expired' });
  });
});

describe('createPasswordReset + resetPassword', () => {
  test('round-trips: reset token is hashed at rest and resets to a verifiable new password', async () => {
    const activeUser = { id: 'u1', email: 'active@example.com', status: 'active', passwordHash: sha256('old') };
    ddbMock.on(ScanCommand).resolves({ Items: [activeUser] });
    ddbMock.on(PutCommand).resolves({});

    const resetResult = await users.createPasswordReset('active@example.com');
    expect(resetResult).not.toBeNull();
    const { user: resetUser, token } = resetResult;
    expect(resetUser.resetTokenHash).toBe(sha256(token));
    expect(resetUser.resetTokenHash).not.toBe(token);

    // Re-mocking (rather than chaining .resolvesOnce()) is deliberate: each
    // .on(...) call starts its own onCall(0) counter, so two separate
    // .resolvesOnce() calls both target call #0 and the second silently
    // clobbers the first instead of queuing behind it. A plain .resolves()
    // replaces the default for every call from here on, which is exactly
    // what's needed since there's only one more Scan call left to make.
    ddbMock.on(ScanCommand).resolves({ Items: [resetUser] });
    const finalResult = await users.resetPassword(token, 'brand-new-password');

    expect(finalResult.error).toBeUndefined();
    expect(finalResult.user.resetTokenHash).toBeNull();
    expect(finalResult.user.resetTokenExpiresAt).toBeNull();
    expect(verifyPassword('brand-new-password', finalResult.user.passwordHash)).toBe(true);
  });

  test('createPasswordReset returns null for an unknown email', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    expect(await users.createPasswordReset('nobody@example.com')).toBeNull();
  });

  test('createPasswordReset returns null for a pending (not yet active) account', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ id: 'u2', email: 'pending@example.com', status: 'pending' }],
    });

    expect(await users.createPasswordReset('pending@example.com')).toBeNull();
  });

  test('resetPassword rejects a wrong token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = {
      id: 'u1',
      email: 'active@example.com',
      resetTokenHash: sha256(token),
      resetTokenExpiresAt: new Date(Date.now() + 1000 * 60).toISOString(),
    };
    ddbMock.on(ScanCommand).resolves({ Items: [user] });

    const wrongToken = crypto.randomBytes(32).toString('hex');
    expect(await users.resetPassword(wrongToken, 'new-pass')).toEqual({ error: 'invalid_or_expired' });
  });

  test('resetPassword rejects an expired token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = {
      id: 'u1',
      email: 'active@example.com',
      resetTokenHash: sha256(token),
      resetTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    ddbMock.on(ScanCommand).resolves({ Items: [user] });

    expect(await users.resetPassword(token, 'new-pass')).toEqual({ error: 'invalid_or_expired' });
  });
});

describe('updateOwnPassword', () => {
  test('succeeds and stores a verifiable new password when the current password is correct', async () => {
    const currentHash = hashPassword('correct-password');
    ddbMock.on(GetCommand).resolves({ Item: { id: 'u1', passwordHash: currentHash } });
    ddbMock.on(PutCommand).resolves({});

    const result = await users.updateOwnPassword('u1', 'correct-password', 'new-password');

    expect(result.error).toBeUndefined();
    expect(verifyPassword('new-password', result.user.passwordHash)).toBe(true);
  });

  test('rejects with current_password_incorrect and writes nothing when the current password is wrong', async () => {
    const currentHash = hashPassword('correct-password');
    ddbMock.on(GetCommand).resolves({ Item: { id: 'u1', passwordHash: currentHash } });
    ddbMock.on(PutCommand).resolves({});

    const result = await users.updateOwnPassword('u1', 'wrong-password', 'new-password');

    expect(result).toEqual({ error: 'current_password_incorrect' });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  test('returns not_found for a nonexistent user', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await users.updateOwnPassword('missing', 'x', 'y');

    expect(result).toEqual({ error: 'not_found' });
  });
});
