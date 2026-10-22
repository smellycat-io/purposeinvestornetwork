// Pure CSV-building logic for the Campaigns tab's Export CSV button. Kept
// in its own file, separate from admin.js (which touches `document`/
// `window` throughout), so Jest can require it directly — same reasoning
// and module.exports guard as admin/dashboardVisibility.js.
(function (root) {
  'use strict';

  // Google Sheets and Excel both treat a cell starting with one of these
  // as a formula to evaluate, not literal text — a leading apostrophe
  // forces it to stay text in both. Applies to every string cell (names,
  // messages, phone, address are all free-text a submitter controls).
  const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
  const NEEDS_QUOTING = /[",\r\n]/;

  // null/undefined -> empty cell. Objects/arrays (the survey's `answers`)
  // are JSON-stringified first, then run through the same formula/quoting
  // rules as any other string, since a stringified object can still start
  // with a trigger character or contain a comma.
  function escapeCsvCell(value) {
    let str;
    if (value === null || value === undefined) {
      str = '';
    } else if (typeof value === 'object') {
      str = JSON.stringify(value);
    } else {
      str = String(value);
    }

    if (FORMULA_TRIGGER.test(str)) {
      str = "'" + str;
    }
    if (NEEDS_QUOTING.test(str)) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  const INTEREST_TYPES = ['roundtable-interest', 'initiative-interest'];

  // Mirrors admin.js's renderCampaignEntriesTable column logic exactly —
  // same columns, same order — with one addition: an interest campaign's
  // Consent text goes right after Consent. Survey has no Consent column
  // at all (consent isn't recorded for it; see db/campaigns.js).
  function columnsForCampaignType(type) {
    if (type === 'survey') return ['Email', 'Name', 'Answers', 'Created'];
    if (INTEREST_TYPES.includes(type)) {
      return ['Email', 'Name', 'Consent', 'Consent text', 'Message', 'Created'];
    }
    if (type === 'waitlist') return ['Email', 'Name', 'Consent', 'Phone', 'Address', 'Created'];
    return ['Email', 'Name', 'Consent', 'Created']; // newsletter, and any other site-wide type
  }

  // Raw field values, not the on-screen table's '—' placeholder for a
  // missing field — a spreadsheet should get a blank cell, not literal
  // text. Emails are exported exactly as the entry stored them (already
  // lowercased server-side on write), unlike copyFilteredEmails's own
  // extra .toLowerCase() — nothing to normalize again here.
  function rowForEntry(type, entry) {
    const row = [entry.email, entry.name];
    if (type !== 'survey') row.push(entry.consent ? 'Yes' : 'No');
    if (INTEREST_TYPES.includes(type)) row.push(entry.consentText, entry.message);
    if (type === 'waitlist') row.push(entry.phone, entry.address);
    if (type === 'survey') row.push(entry.answers);
    row.push(entry.createdAt);
    return row;
  }

  // CRLF row endings (including after the final row, per RFC 4180) and a
  // leading UTF-8 BOM so Excel detects the encoding and renders accented
  // characters correctly instead of guessing Latin-1.
  function buildCampaignCsv(campaign, entries) {
    const columns = columnsForCampaignType(campaign.type);
    const rows = [columns, ...entries.map((entry) => rowForEntry(campaign.type, entry))];
    const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
    return '﻿' + csv;
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function formatDateYYYYMMDD(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // Falls back to the campaign's id (always a stable, filename-safe
  // string — see db/campaigns.js) when the name slugs down to nothing,
  // e.g. a campaign named entirely in a script slugify() can't handle.
  function campaignCsvFilename(campaign, date) {
    const slug = slugify(campaign.name) || campaign.id;
    return `pin-${slug}-${formatDateYYYYMMDD(date)}.csv`;
  }

  const api = {
    escapeCsvCell,
    buildCampaignCsv,
    campaignCsvFilename,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CsvExport = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
