const { canSeeFull, filterVisible, redactPost } = require('./access.js');

describe('access.js', () => {
  describe('canSeeFull', () => {
    // Canary: this is the stated TODO in access.js — nobody is a recognized
    // member yet. This test should be the first thing to fail the moment
    // real membership checking gets wired in, not something quietly routed
    // around — that's the point of asserting it here explicitly.
    test('always returns false regardless of item or session state', () => {
      expect(canSeeFull({ memberOnly: true }, {})).toBe(false);
      expect(canSeeFull({ memberOnly: true }, { session: { loggedIn: true } })).toBe(false);
      expect(canSeeFull(null, null)).toBe(false);
      expect(canSeeFull(undefined, undefined)).toBe(false);
    });
  });

  describe('filterVisible', () => {
    test('drops memberOnly items and keeps public ones', () => {
      const items = [
        { id: '1', memberOnly: false },
        { id: '2', memberOnly: true },
        { id: '3', memberOnly: false },
        { id: '4', memberOnly: true },
      ];
      expect(filterVisible(items, {})).toEqual([
        { id: '1', memberOnly: false },
        { id: '3', memberOnly: false },
      ]);
    });

    test('treats a missing memberOnly field as public', () => {
      const items = [{ id: '1' }, { id: '2', memberOnly: true }];
      expect(filterVisible(items, {})).toEqual([{ id: '1' }]);
    });

    test('returns an empty array unchanged', () => {
      expect(filterVisible([], {})).toEqual([]);
    });
  });

  describe('redactPost', () => {
    test('returns a non-memberOnly post unchanged', () => {
      const post = { id: '1', memberOnly: false, body: 'full text' };
      expect(redactPost(post, {})).toEqual(post);
    });

    test('strips the body and flags memberLocked on a memberOnly post', () => {
      const post = { id: '1', memberOnly: true, title: 'Education post', body: 'secret text' };
      const result = redactPost(post, {});
      expect(result).toEqual({ id: '1', memberOnly: true, title: 'Education post', body: null, memberLocked: true });
    });

    test('passes through null/undefined without throwing', () => {
      expect(redactPost(null, {})).toBe(null);
      expect(redactPost(undefined, {})).toBe(undefined);
    });
  });
});
