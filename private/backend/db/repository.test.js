const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { Repository, slugify } = require('./repository.js');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('slugify', () => {
  test('lowercases, replaces runs of non-alphanumerics with a single dash, and trims dashes', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  Leading and trailing  ')).toBe('leading-and-trailing');
    expect(slugify('Already-Has-Dashes')).toBe('already-has-dashes');
    expect(slugify('')).toBe('');
    expect(slugify(undefined)).toBe('');
  });
});

describe('Repository#create', () => {
  test('derives the slug from slugField', async () => {
    ddbMock.on(PutCommand).resolves({});
    const repo = new Repository('test-table', { slugField: 'title' });

    const item = await repo.create({ title: 'Impact Investing 101' });

    expect(item.slug).toBe('impact-investing-101');
    expect(item.id).toEqual(expect.any(String));
  });

  test('does not set a slug when no slugField is configured', async () => {
    ddbMock.on(PutCommand).resolves({});
    const repo = new Repository('test-table');

    const item = await repo.create({ url: 'https://example.com/image.png' });

    expect(item.slug).toBeUndefined();
  });

  test('appends a Date.now()-based suffix for uniqueness when slugSuffix is set', async () => {
    ddbMock.on(PutCommand).resolves({});
    const repo = new Repository('test-table', { slugField: 'title', slugSuffix: true });

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    const first = await repo.create({ title: 'Same Title' });
    const second = await repo.create({ title: 'Same Title' });

    expect(first.slug).toBe(`same-title-${(1000).toString(36)}`);
    expect(second.slug).toBe(`same-title-${(2000).toString(36)}`);
    expect(first.slug).not.toBe(second.slug);

    nowSpy.mockRestore();
  });

  test('does not suffix the slug when slugSuffix is not set', async () => {
    ddbMock.on(PutCommand).resolves({});
    const repo = new Repository('test-table', { slugField: 'title' });

    const item = await repo.create({ title: 'Same Title' });

    expect(item.slug).toBe('same-title');
  });
});

describe('Repository#update — reslugOnUpdate', () => {
  test('re-derives the slug on a title change when reslugOnUpdate is true (the default)', async () => {
    const existing = { id: 'p1', title: 'Old Title', slug: 'old-title' };
    ddbMock.on(ScanCommand).resolves({ Items: [existing] });
    ddbMock.on(PutCommand).resolves({});
    const repo = new Repository('test-table', { slugField: 'title' });

    const updated = await repo.update('p1', { title: 'New Title' });

    expect(updated.slug).toBe('new-title');
    expect(updated.title).toBe('New Title');
  });

  test('leaves the slug unchanged on a title change when reslugOnUpdate is false (Posts)', async () => {
    const existing = { id: 'p1', title: 'Old Title', slug: 'old-title' };
    ddbMock.on(ScanCommand).resolves({ Items: [existing] });
    ddbMock.on(PutCommand).resolves({});
    const repo = new Repository('test-table', { slugField: 'title', reslugOnUpdate: false });

    const updated = await repo.update('p1', { title: 'New Title' });

    expect(updated.slug).toBe('old-title');
    expect(updated.title).toBe('New Title');
  });

  test('returns null when the id does not exist', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    const repo = new Repository('test-table', { slugField: 'title' });

    const updated = await repo.update('missing', { title: 'New Title' });

    expect(updated).toBeNull();
  });
});

describe('Repository#list — sortBy', () => {
  test('sorts scanned items using the configured comparator', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { id: 'c', order: 3 },
        { id: 'a', order: 1 },
        { id: 'b', order: 2 },
      ],
    });
    const repo = new Repository('test-table', { sortBy: (a, b) => a.order - b.order });

    const result = await repo.list();

    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  test('preserves scan order when no sortBy is configured', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ id: 'c' }, { id: 'a' }, { id: 'b' }] });
    const repo = new Repository('test-table');

    const result = await repo.list();

    expect(result.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  test('applies an optional filter before sorting', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { id: 'a', visible: true, order: 2 },
        { id: 'b', visible: false, order: 1 },
        { id: 'c', visible: true, order: 1 },
      ],
    });
    const repo = new Repository('test-table', { sortBy: (a, b) => a.order - b.order });

    const result = await repo.list((i) => i.visible);

    expect(result.map((i) => i.id)).toEqual(['c', 'a']);
  });
});

describe('Repository — getById / getBySlug / delete', () => {
  test('getById finds by id, or returns null', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ id: 'a' }, { id: 'b' }] });
    const repo = new Repository('test-table');

    expect(await repo.getById('b')).toEqual({ id: 'b' });
    expect(await repo.getById('missing')).toBeNull();
  });

  test('getBySlug finds by slug, or returns null', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ id: 'a', slug: 'a-slug' }] });
    const repo = new Repository('test-table');

    expect(await repo.getBySlug('a-slug')).toEqual({ id: 'a', slug: 'a-slug' });
    expect(await repo.getBySlug('missing-slug')).toBeNull();
  });

  test('delete sends a DeleteCommand keyed on id', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const repo = new Repository('test-table');

    await repo.delete('a');

    const calls = ddbMock.commandCalls(DeleteCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({ TableName: 'test-table', Key: { id: 'a' } });
  });
});
