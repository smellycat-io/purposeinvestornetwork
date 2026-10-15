const { validateProfileFields, MAX_NAME_LENGTH, MAX_PHONE_LENGTH, MAX_ADDRESS_LENGTH } = require('./profileFields.js');

describe('validateProfileFields', () => {
  test('returns an empty values object when no fields are present', () => {
    expect(validateProfileFields({})).toEqual({ values: {} });
  });

  test('trims every value', () => {
    expect(validateProfileFields({ firstName: '  Ada  ', phone: '  555-1234  ' })).toEqual({
      values: { firstName: 'Ada', phone: '555-1234' },
    });
  });

  test('rejects a non-string value for any of the four fields', () => {
    expect(validateProfileFields({ firstName: 123 })).toEqual({ error: 'First name must be text.' });
    expect(validateProfileFields({ lastName: true })).toEqual({ error: 'Last name must be text.' });
    expect(validateProfileFields({ phone: 5551234 })).toEqual({ error: 'Phone must be text.' });
    expect(validateProfileFields({ address: {} })).toEqual({ error: 'Address must be text.' });
  });

  test('rejects an empty or whitespace-only first name', () => {
    expect(validateProfileFields({ firstName: '' })).toEqual({ error: 'First name is required.' });
    expect(validateProfileFields({ firstName: '   ' })).toEqual({ error: 'First name is required.' });
  });

  test('rejects an empty last name', () => {
    expect(validateProfileFields({ lastName: '' })).toEqual({ error: 'Last name is required.' });
  });

  test('an empty phone becomes null rather than being rejected', () => {
    expect(validateProfileFields({ phone: '' })).toEqual({ values: { phone: null } });
    expect(validateProfileFields({ phone: '   ' })).toEqual({ values: { phone: null } });
  });

  test('an empty address becomes null rather than being rejected', () => {
    expect(validateProfileFields({ address: '' })).toEqual({ values: { address: null } });
  });

  test('a name at exactly the length cap is accepted', () => {
    const name = 'a'.repeat(MAX_NAME_LENGTH);
    expect(validateProfileFields({ firstName: name })).toEqual({ values: { firstName: name } });
  });

  test('a name one character over the cap is rejected', () => {
    const name = 'a'.repeat(MAX_NAME_LENGTH + 1);
    expect(validateProfileFields({ lastName: name })).toEqual({
      error: `Last name must be ${MAX_NAME_LENGTH} characters or fewer.`,
    });
  });

  test('a phone at exactly the length cap is accepted', () => {
    const phone = '5'.repeat(MAX_PHONE_LENGTH);
    expect(validateProfileFields({ phone })).toEqual({ values: { phone } });
  });

  test('a phone one character over the cap is rejected', () => {
    const phone = '5'.repeat(MAX_PHONE_LENGTH + 1);
    expect(validateProfileFields({ phone })).toEqual({
      error: `Phone must be ${MAX_PHONE_LENGTH} characters or fewer.`,
    });
  });

  test('an address at exactly the length cap is accepted', () => {
    const address = 'a'.repeat(MAX_ADDRESS_LENGTH);
    expect(validateProfileFields({ address })).toEqual({ values: { address } });
  });

  test('an address one character over the cap is rejected', () => {
    const address = 'a'.repeat(MAX_ADDRESS_LENGTH + 1);
    expect(validateProfileFields({ address })).toEqual({
      error: `Address must be ${MAX_ADDRESS_LENGTH} characters or fewer.`,
    });
  });

  test('a fully valid partial update returns only the submitted fields', () => {
    expect(validateProfileFields({ phone: '555-0100' })).toEqual({ values: { phone: '555-0100' } });
  });

  test('a fully valid full update returns all four fields', () => {
    expect(validateProfileFields({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '555-0100',
      address: '1 Analytical Engine Way',
    })).toEqual({
      values: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '555-0100',
        address: '1 Analytical Engine Way',
      },
    });
  });
});
