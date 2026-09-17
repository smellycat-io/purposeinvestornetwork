const crypto = require('crypto');

// USERS_TABLE is captured as a module-level constant on first require, so
// this must be set before that happens — the global test env setup blanks
// it (see test/setupEnv.js) precisely so a test file that forgets to do
// this fails loudly (empty-table no-ops) instead of scanning a real table.
process.env.AWS_USERS_TABLE = 'test-users-table';

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
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

  test('lowercases the email regardless of how it was submitted', async () => {
    ddbMock.on(PutCommand).resolves({});

    const { user } = await users.createInvite('  Invitee@Example.COM  ');

    expect(user.email).toBe('invitee@example.com');
  });

  test('defaults role to admin when omitted (accounts created before roles existed)', async () => {
    ddbMock.on(PutCommand).resolves({});

    const { user } = await users.createInvite('invitee@example.com');

    expect(user.role).toBe('admin');
    expect(user.roundtableId).toBeNull();
    expect(user.roundtableIds).toEqual([]);
  });

  test('carries a chair role and roundtableId through, forcing roundtableIds empty', async () => {
    ddbMock.on(PutCommand).resolves({});

    const { user } = await users.createInvite('chair@example.com', {
      role: 'chair',
      roundtableId: 'rt-1',
      roundtableIds: ['rt-should-be-ignored'],
    });

    expect(user.role).toBe('chair');
    expect(user.roundtableId).toBe('rt-1');
    expect(user.roundtableIds).toEqual([]);
  });

  test('carries a member role and roundtableIds through, forcing roundtableId null', async () => {
    ddbMock.on(PutCommand).resolves({});

    const { user } = await users.createInvite('member@example.com', {
      role: 'member',
      roundtableId: 'rt-should-be-ignored',
      roundtableIds: ['rt-1', 'rt-2'],
    });

    expect(user.role).toBe('member');
    expect(user.roundtableId).toBeNull();
    expect(user.roundtableIds).toEqual(['rt-1', 'rt-2']);
  });

  test('a member invite with no roundtableIds defaults to an empty array, not undefined', async () => {
    ddbMock.on(PutCommand).resolves({});

    const { user } = await users.createInvite('member@example.com', { role: 'member' });

    expect(user.roundtableIds).toEqual([]);
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

  test('carries role/roundtableId/roundtableIds from the invite onto the activated account unchanged', async () => {
    ddbMock.on(PutCommand).resolves({});
    const { user: pendingChair, token } = await users.createInvite('chair@example.com', {
      role: 'chair',
      roundtableId: 'rt-1',
    });
    ddbMock.on(ScanCommand).resolves({ Items: [pendingChair] });

    const result = await users.acceptInvite(token, { firstName: 'Chair', lastName: 'Person', password: 'x'.repeat(10) });

    expect(result.user.role).toBe('chair');
    expect(result.user.roundtableId).toBe('rt-1');
    expect(result.user.roundtableIds).toEqual([]);
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

describe('findUserByEmail', () => {
  test('queries the email-index GSI, normalizing the input to lowercase', async () => {
    const user = { id: 'u1', email: 'active@example.com', status: 'active' };
    ddbMock.on(QueryCommand).resolves({ Items: [user] });

    const result = await users.findUserByEmail('  Active@Example.COM  ');

    expect(result).toEqual(user);
    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      TableName: 'test-users-table',
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': 'active@example.com' },
      Limit: 1,
    });
  });

  test('returns null when no match is found', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    expect(await users.findUserByEmail('nobody@example.com')).toBeNull();
  });

  test('returns null for a blank email without querying', async () => {
    expect(await users.findUserByEmail('   ')).toBeNull();
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});

describe('createPasswordReset + resetPassword', () => {
  test('round-trips: reset token is hashed at rest and resets to a verifiable new password', async () => {
    const activeUser = { id: 'u1', email: 'active@example.com', status: 'active', passwordHash: sha256('old') };
    // createPasswordReset looks the user up via findUserByEmail (the GSI
    // query); resetPassword looks the token up via listAllRaw (a scan) —
    // these are two different commands, so they need two different mocks.
    ddbMock.on(QueryCommand).resolves({ Items: [activeUser] });
    ddbMock.on(PutCommand).resolves({});

    const resetResult = await users.createPasswordReset('active@example.com');
    expect(resetResult).not.toBeNull();
    const { user: resetUser, token } = resetResult;
    expect(resetUser.resetTokenHash).toBe(sha256(token));
    expect(resetUser.resetTokenHash).not.toBe(token);

    ddbMock.on(ScanCommand).resolves({ Items: [resetUser] });
    const finalResult = await users.resetPassword(token, 'brand-new-password');

    expect(finalResult.error).toBeUndefined();
    expect(finalResult.user.resetTokenHash).toBeNull();
    expect(finalResult.user.resetTokenExpiresAt).toBeNull();
    expect(verifyPassword('brand-new-password', finalResult.user.passwordHash)).toBe(true);
  });

  test('createPasswordReset returns null for an unknown email', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    expect(await users.createPasswordReset('nobody@example.com')).toBeNull();
  });

  test('createPasswordReset returns null for a pending (not yet active) account', async () => {
    ddbMock.on(QueryCommand).resolves({
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

describe('updateUser', () => {
  test('updates only the fields passed, ignoring anything not in the whitelist', async () => {
    const existing = { id: 'u1', email: 'a@example.com', firstName: 'Old', passwordHash: 'irrelevant', status: 'active' };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});

    const updated = await users.updateUser('u1', { firstName: 'New', email: 'attacker@example.com', status: 'pending' });

    expect(updated.firstName).toBe('New');
    expect(updated.email).toBe('a@example.com'); // not in the whitelist — unchanged
    const putItem = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(putItem.status).toBe('active'); // not in the whitelist — unchanged
  });

  test('returns null and writes nothing for a nonexistent user', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await users.updateUser('missing', { firstName: 'New' });

    expect(result).toBeNull();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  test('never returns passwordHash or token fields', async () => {
    const existing = {
      id: 'u1',
      email: 'a@example.com',
      passwordHash: 'secret-hash',
      inviteTokenHash: 'secret-token-hash',
      resetTokenHash: 'another-secret',
    };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});

    const updated = await users.updateUser('u1', { firstName: 'New' });

    expect(updated).not.toHaveProperty('passwordHash');
    expect(updated).not.toHaveProperty('inviteTokenHash');
    expect(updated).not.toHaveProperty('resetTokenHash');
  });

  test('changing role to chair forces roundtableIds empty, keeps the submitted roundtableId', async () => {
    const existing = { id: 'u1', role: 'member', roundtableId: null, roundtableIds: ['rt-1', 'rt-2'] };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});

    const updated = await users.updateUser('u1', { role: 'chair', roundtableId: 'rt-5' });

    expect(updated.role).toBe('chair');
    expect(updated.roundtableId).toBe('rt-5');
    expect(updated.roundtableIds).toEqual([]);
  });

  test('changing role to member forces roundtableId null, keeps the submitted roundtableIds', async () => {
    const existing = { id: 'u1', role: 'chair', roundtableId: 'rt-1', roundtableIds: [] };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});

    const updated = await users.updateUser('u1', { role: 'member', roundtableIds: ['rt-2', 'rt-3'] });

    expect(updated.role).toBe('member');
    expect(updated.roundtableId).toBeNull();
    expect(updated.roundtableIds).toEqual(['rt-2', 'rt-3']);
  });

  test('changing role to admin forces both roundtableId and roundtableIds empty', async () => {
    const existing = { id: 'u1', role: 'member', roundtableId: null, roundtableIds: ['rt-1'] };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});

    const updated = await users.updateUser('u1', { role: 'admin' });

    expect(updated.roundtableId).toBeNull();
    expect(updated.roundtableIds).toEqual([]);
  });

  test('editing an unrelated field does not touch an existing roundtableId/roundtableIds', async () => {
    const existing = { id: 'u1', role: 'chair', roundtableId: 'rt-1', roundtableIds: [], phone: 'old' };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});

    const updated = await users.updateUser('u1', { phone: 'new' });

    expect(updated.phone).toBe('new');
    expect(updated.role).toBe('chair');
    expect(updated.roundtableId).toBe('rt-1'); // untouched — role wasn't part of this update
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
