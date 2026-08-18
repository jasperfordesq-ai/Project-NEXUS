// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// The polls category filter rendered API-supplied category values through
// Nunjucks' built-in `capitalize`, which raises the first letter AND LOWER-CASES
// THE REST. A category slug therefore appeared in the dropdown as "Local_events",
// and any value containing an acronym would have been mangled too
// ("NGO support" → "Ngo support").
//
// These tests pin the two properties that make the replacement a safe
// substitute: it separates words, and it never lower-cases anything.

const nunjucks = require('nunjucks');
const { humanizeLabel } = require('../src/lib/humanize-label');

describe('humanizeLabel filter', () => {
  it('turns an underscored slug into a readable label', () => {
    expect(humanizeLabel('local_events')).toBe('Local events');
    expect(humanizeLabel('community-support')).toBe('Community support');
    expect(humanizeLabel('time__credits')).toBe('Time credits');
  });

  it('never lower-cases the tail, unlike the capitalize filter it replaced', () => {
    expect(humanizeLabel('NGO support')).toBe('NGO support');
    expect(humanizeLabel('Local events')).toBe('Local events');
  });

  it('handles empty and missing values without throwing', () => {
    expect(humanizeLabel('')).toBe('');
    expect(humanizeLabel(null)).toBe('');
    expect(humanizeLabel(undefined)).toBe('');
    expect(humanizeLabel('   ')).toBe('');
  });

  it('differs from Nunjucks capitalize on exactly the failing cases', () => {
    const capitalize = new nunjucks.Environment().getFilter('capitalize');

    // Reproduces the original bug, so this test proves the fix rather than
    // asserting a behaviour that was never broken.
    expect(capitalize('local_events')).toBe('Local_events');
    expect(humanizeLabel('local_events')).toBe('Local events');

    expect(capitalize('NGO support')).toBe('Ngo support');
    expect(humanizeLabel('NGO support')).toBe('NGO support');
  });

  it('is the filter the polls category dropdown actually uses', () => {
    const fs = require('fs');
    const path = require('path');
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'polls', 'index.njk'),
      'utf8'
    );

    expect(template).toContain('category | humanizeLabel');
    expect(template).not.toContain('category | capitalize');
  });
});
