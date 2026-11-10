// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID feedback (Nov 2026): "warmth, and community". The members directory
 * welcomes people who joined in the last 30 days with a "New here" tag, the
 * same rule as the React directory.
 */

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const { isNewMember } = require('../src/lib/new-member');
const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');

const NOW = Date.parse('2026-11-10T12:00:00Z');

describe('New here', () => {
  it('is true only for a join date in the last 30 days', () => {
    expect(isNewMember('2026-11-01 09:00:00', NOW)).toBe(true);
    expect(isNewMember('2026-10-12T13:00:00Z', NOW)).toBe(true);
    expect(isNewMember('2026-10-11 11:00:00', NOW)).toBe(false);
    expect(isNewMember('2025-11-10 12:00:00', NOW)).toBe(false);
  });

  it('is false for a missing, unreadable or future date', () => {
    for (const value of [null, undefined, '', 'not a date', 42, '2026-12-01 00:00:00']) {
      expect(isNewMember(value, NOW)).toBe(false);
    }
  });

  it('shows a GOV.UK tag on the directory card', () => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([
      path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
    ]), { autoescape: true });
    require('../src/lib/template-filters').registerTemplateFilters(env);
    const render = (member) => env.render('members/index.njk', {
      t: createTranslator('en'), tc: createChoiceTranslator('en'), urlFor: (value) => value,
      users: [{ id: 5, name: 'Aoife', initial: 'A', hoursGivenLabel: '0', hoursReceivedLabel: '0', ...member }],
      pagination: { total: 1 }
    }).replace(/\s+/g, ' ');
    expect(render({ isNewHere: true })).toContain('<strong class="govuk-tag govuk-tag--magenta"> New here </strong>');
    expect(render({ isNewHere: false })).not.toContain('New here');
  });

  it('is worked out from the directory row', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'members.js'), 'utf8');
    expect(route).toMatch(/isNewHere: isNewMember\(member\.created_at/);
  });
});
