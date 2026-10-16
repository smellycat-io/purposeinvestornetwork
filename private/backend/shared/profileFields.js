// Shared validation for the four self-service profile fields — firstName,
// lastName, phone, address — used by PATCH /api/users/me, PATCH
// /api/admin/users/:id, and POST /api/accept-invite. Was duplicated
// (loosely) across those three route handlers with no shape checks at
// all; pulled into one place so the three can't drift on what counts as
// valid.
//
// Only validates fields actually present in `body` — a caller submitting a
// partial update (e.g. just `phone`) isn't required to also submit the
// others. firstName/lastName may not be submitted *blank*, but omitting
// them entirely is fine; that's a route-level "is this field required at
// all" decision (see accept-invite), not this helper's job.
const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 40;
const MAX_ADDRESS_LENGTH = 300;

const FIELD_LABELS = {
  firstName: 'First name',
  lastName: 'Last name',
  phone: 'Phone',
  address: 'Address',
};

const FIELD_LIMITS = {
  firstName: MAX_NAME_LENGTH,
  lastName: MAX_NAME_LENGTH,
  phone: MAX_PHONE_LENGTH,
  address: MAX_ADDRESS_LENGTH,
};

// firstName/lastName can't be blanked out via a submitted empty string —
// unlike phone/address, there's no legitimate "clear this field" case for
// a person's name.
const CANNOT_BE_BLANK = ['firstName', 'lastName'];

// Returns { error } (a toast-ready message) on the first problem found, or
// { values } containing only the fields that were present in `body` —
// phone/address come back `null` when submitted blank, trimmed otherwise.
function validateProfileFields(body) {
  const source = body || {};
  const values = {};

  for (const field of ['firstName', 'lastName', 'phone', 'address']) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;

    const raw = source[field];
    if (typeof raw !== 'string') {
      return { error: `${FIELD_LABELS[field]} must be text.` };
    }

    const trimmed = raw.trim();
    if (CANNOT_BE_BLANK.includes(field) && !trimmed) {
      return { error: `${FIELD_LABELS[field]} is required.` };
    }
    if (trimmed.length > FIELD_LIMITS[field]) {
      return { error: `${FIELD_LABELS[field]} must be ${FIELD_LIMITS[field]} characters or fewer.` };
    }

    values[field] = trimmed === '' ? null : trimmed;
  }

  return { values };
}

module.exports = { validateProfileFields, MAX_NAME_LENGTH, MAX_PHONE_LENGTH, MAX_ADDRESS_LENGTH };
