const { escapeCsvCell, buildCampaignCsv, campaignCsvFilename } = require('./csvExport.js');

describe('escapeCsvCell', () => {
  test('plain text passes through unchanged', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
  });

  test('null becomes an empty string', () => {
    expect(escapeCsvCell(null)).toBe('');
  });

  test('undefined becomes an empty string', () => {
    expect(escapeCsvCell(undefined)).toBe('');
  });

  test('a comma triggers quoting', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  test('an embedded quote is doubled and the cell is quoted', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  test('a newline triggers quoting', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  test('a leading = is prefixed with an apostrophe', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
  });

  test('a leading + is prefixed with an apostrophe', () => {
    expect(escapeCsvCell('+1')).toBe("'+1");
  });

  test('a leading - is prefixed with an apostrophe', () => {
    expect(escapeCsvCell('-1')).toBe("'-1");
  });

  test('a leading @ is prefixed with an apostrophe', () => {
    expect(escapeCsvCell('@user')).toBe("'@user");
  });

  test('a leading tab is prefixed with an apostrophe, and not itself quoted', () => {
    expect(escapeCsvCell('\tTab')).toBe("'\tTab");
  });

  test('a leading CR is prefixed with an apostrophe, and the CR then triggers quoting', () => {
    expect(escapeCsvCell('\rCR-lead')).toBe('"\'\rCR-lead"');
  });

  test('an object is JSON.stringify-ed, then quoted for its embedded quotes', () => {
    expect(escapeCsvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  test('a number is stringified with no quoting', () => {
    expect(escapeCsvCell(42)).toBe('42');
  });
});

describe('buildCampaignCsv', () => {
  test('an interest campaign — Email, Name, Consent, Consent text, Message, Created', () => {
    const campaign = { id: 'roundtable:rt1', type: 'roundtable-interest', name: 'Impact Roundtable' };
    const entries = [{
      email: 'a@example.com',
      name: 'Ada Lovelace',
      consent: true,
      consentText: 'Yes, email me updates about Impact Roundtable.',
      message: 'Count me in',
      createdAt: '2026-01-01T00:00:00.000Z',
    }];

    const csv = buildCampaignCsv(campaign, entries);

    expect(csv).toBe(
      '﻿' +
      'Email,Name,Consent,Consent text,Message,Created\r\n' +
      'a@example.com,Ada Lovelace,Yes,"Yes, email me updates about Impact Roundtable.",Count me in,2026-01-01T00:00:00.000Z\r\n'
    );
  });

  test('a waitlist campaign — Email, Name, Consent, Phone, Address, Created', () => {
    const campaign = { id: 'waitlist', type: 'waitlist', name: 'Membership Waitlist' };
    const entries = [{
      email: 'b@example.com',
      name: 'Grace Hopper',
      consent: true,
      phone: '555-0100',
      address: '1 Main St',
      createdAt: '2026-02-02T00:00:00.000Z',
    }];

    const csv = buildCampaignCsv(campaign, entries);

    expect(csv).toBe(
      '﻿' +
      'Email,Name,Consent,Phone,Address,Created\r\n' +
      'b@example.com,Grace Hopper,Yes,555-0100,1 Main St,2026-02-02T00:00:00.000Z\r\n'
    );
  });

  test('the survey campaign — Email, Name, Answers, Created, no Consent column', () => {
    const campaign = { id: 'survey', type: 'survey', name: 'Member Survey' };
    const entries = [{
      email: 'c@example.com',
      name: 'Alan Turing',
      answers: { q1: 'yes', q2: 2 },
      createdAt: '2026-03-03T00:00:00.000Z',
    }];

    const csv = buildCampaignCsv(campaign, entries);

    expect(csv).toBe(
      '﻿' +
      'Email,Name,Answers,Created\r\n' +
      'c@example.com,Alan Turing,"{""q1"":""yes"",""q2"":2}",2026-03-03T00:00:00.000Z\r\n'
    );
  });

  test('the newsletter campaign — Email, Name, Consent, Created, a null name becomes a blank cell', () => {
    const campaign = { id: 'newsletter', type: 'newsletter', name: 'Newsletter' };
    const entries = [{
      email: 'd@example.com',
      name: null,
      consent: true,
      createdAt: '2026-04-04T00:00:00.000Z',
    }];

    const csv = buildCampaignCsv(campaign, entries);

    expect(csv).toBe(
      '﻿' +
      'Email,Name,Consent,Created\r\n' +
      'd@example.com,,Yes,2026-04-04T00:00:00.000Z\r\n'
    );
  });

  test('an empty entries list returns just the header row', () => {
    const campaign = { id: 'waitlist', type: 'waitlist', name: 'Membership Waitlist' };

    const csv = buildCampaignCsv(campaign, []);

    expect(csv).toBe('﻿Email,Name,Consent,Phone,Address,Created\r\n');
  });

  test('Consent renders as Yes or No', () => {
    const campaign = { id: 'newsletter', type: 'newsletter', name: 'Newsletter' };
    const entries = [
      { email: 'yes@example.com', name: 'Yes Person', consent: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { email: 'no@example.com', name: 'No Person', consent: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    const csv = buildCampaignCsv(campaign, entries);

    expect(csv).toBe(
      '﻿' +
      'Email,Name,Consent,Created\r\n' +
      'yes@example.com,Yes Person,Yes,2026-01-01T00:00:00.000Z\r\n' +
      'no@example.com,No Person,No,2026-01-01T00:00:00.000Z\r\n'
    );
  });

  test('Consent text only appears for an interest campaign, not newsletter/waitlist/survey', () => {
    const header = (type) => buildCampaignCsv({ id: type, type, name: type }, []).split('\r\n')[0];

    expect(header('roundtable-interest')).toContain('Consent text');
    expect(header('initiative-interest')).toContain('Consent text');
    expect(header('newsletter')).not.toContain('Consent text');
    expect(header('waitlist')).not.toContain('Consent text');
    expect(header('survey')).not.toContain('Consent text');
  });
});

describe('campaignCsvFilename', () => {
  test('a normal campaign name', () => {
    const campaign = { id: 'roundtable:rt1', name: 'Impact Roundtable' };
    expect(campaignCsvFilename(campaign, new Date(2026, 0, 15))).toBe('pin-impact-roundtable-2026-01-15.csv');
  });

  test('a name with punctuation and spaces collapses to single hyphens', () => {
    const campaign = { id: 'x', name: "Chair's Corner!! Q&A" };
    expect(campaignCsvFilename(campaign, new Date(2026, 5, 3))).toBe('pin-chair-s-corner-q-a-2026-06-03.csv');
  });

  test('a name that slugs down to nothing falls back to the campaign id', () => {
    const campaign = { id: 'roundtable:abc123', name: '!!!' };
    expect(campaignCsvFilename(campaign, new Date(2026, 0, 15))).toBe('pin-roundtable:abc123-2026-01-15.csv');
  });

  test('the date is formatted YYYY-MM-DD with zero-padded month and day', () => {
    const campaign = { id: 'x', name: 'X' };
    expect(campaignCsvFilename(campaign, new Date(2026, 0, 5))).toBe('pin-x-2026-01-05.csv');
  });
});
