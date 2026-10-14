const {
  visibleTabs,
  defaultTab,
  canSeeEvents,
  canDeleteRoundtable,
  visibleRoundtables,
  lockedRoundtableId,
  lockedPostType,
} = require('./dashboardVisibility.js');

describe('visibleTabs', () => {
  test('admin sees every tab, Press included', () => {
    expect(visibleTabs('admin')).toEqual([
      'campaigns', 'posts', 'content', 'press', 'investments-events', 'settings', 'users',
    ]);
  });

  test('chair sees every tab except Press', () => {
    expect(visibleTabs('chair')).toEqual([
      'campaigns', 'posts', 'content', 'investments-events', 'settings', 'users',
    ]);
  });

  test('an unrecognized role sees no tabs — fail closed, not a default list', () => {
    expect(visibleTabs(null)).toEqual([]);
    expect(visibleTabs(undefined)).toEqual([]);
    expect(visibleTabs('member')).toEqual([]);
  });
});

describe('defaultTab', () => {
  test('is campaigns for admin', () => {
    expect(defaultTab('admin')).toBe('campaigns');
  });

  test('is campaigns for chair too (first tab left once Press is hidden)', () => {
    expect(defaultTab('chair')).toBe('campaigns');
  });

  test('is undefined for an unrecognized role — nothing to select', () => {
    expect(defaultTab(null)).toBeUndefined();
  });
});

describe('canSeeEvents', () => {
  test('true for admin', () => {
    expect(canSeeEvents('admin')).toBe(true);
  });

  test('false for chair', () => {
    expect(canSeeEvents('chair')).toBe(false);
  });
});

describe('canDeleteRoundtable', () => {
  test('true for admin', () => {
    expect(canDeleteRoundtable('admin')).toBe(true);
  });

  test('false for chair', () => {
    expect(canDeleteRoundtable('chair')).toBe(false);
  });
});

describe('visibleRoundtables', () => {
  const all = [{ id: 'rt1', name: 'One' }, { id: 'rt2', name: 'Two' }];

  test('admin sees every roundtable', () => {
    expect(visibleRoundtables('admin', all, 'rt1')).toEqual(all);
  });

  test('chair sees only their own roundtable', () => {
    expect(visibleRoundtables('chair', all, 'rt2')).toEqual([{ id: 'rt2', name: 'Two' }]);
  });

  test('chair with no matching roundtable sees an empty list', () => {
    expect(visibleRoundtables('chair', all, 'rt-missing')).toEqual([]);
  });
});

describe('lockedRoundtableId', () => {
  test('null for admin regardless of roundtableId', () => {
    expect(lockedRoundtableId('admin', 'rt1')).toBeNull();
  });

  test("the chair's own roundtableId for a chair session", () => {
    expect(lockedRoundtableId('chair', 'rt1')).toBe('rt1');
  });
});

describe('lockedPostType', () => {
  test('null for admin — every type stays a choice', () => {
    expect(lockedPostType('admin')).toBeNull();
  });

  test("'update' for a chair — the only type tied to an Initiative they can reach", () => {
    expect(lockedPostType('chair')).toBe('update');
  });
});
