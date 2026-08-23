// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { identicalValueIsLegitimate } = require('../scripts/locale-invariants');

/**
 * This classifier decides which English-identical values are real translation debt,
 * and a score row now rests on its answer. The risk is obvious: a classifier that is
 * too generous makes untranslated English disappear from the report. These tests
 * exist mainly to pin the SECOND group — the things it must never excuse.
 */
describe('English-identical locale values', () => {
  it.each([
    [':community', 'a bare placeholder'],
    [':value%', 'placeholder plus a symbol'],
    [':xp XP', 'placeholder plus a unit'],
    ['km', 'an SI unit'],
    ['XP', 'an abbreviation'],
    ['Status', 'one word, the same in German and Dutch'],
    ['Link', 'one word, the same in German'],
    ['日本語', 'a language endonym — translating it is the defect'],
    ['العربية', 'a language endonym'],
    ['Project NEXUS Accessible', 'the product name'],
    ['AccessNI', 'the Northern Ireland disclosure service'],
    ['DBS Basic', 'the England and Wales disclosure service'],
    ['mailto:feedback@project-nexus.ie', 'an address'],
    ['https://example.org/thing', 'a URL']
  ])('treats %j as legitimately identical (%s)', (value) => {
    expect(identicalValueIsLegitimate(value)).toBe(true);
  });

  it.each([
    ['Save your changes now'],
    ['You have no upcoming events'],
    ['Enter an event title'],
    ['This link has expired. Request a new one.'],
    ['Website (optional)'],
    ['Score (%)'],
    ['Web push']
  ])('still reports %j as needing a translator', (value) => {
    expect(identicalValueIsLegitimate(value)).toBe(false);
  });

  it('does not excuse a sentence merely because it mentions a brand', () => {
    // The brand rule exists for bare proper nouns, not as a blanket exemption.
    // 🔴 This is the classifier's weakest edge and is deliberately recorded: a
    // sentence containing a brand IS excused today. If that ever starts hiding real
    // copy, tighten INVARIANT_BRANDS to whole-value matches rather than widening it.
    expect(identicalValueIsLegitimate('Sign in to Project NEXUS to continue')).toBe(true);
  });

  it('handles empty and missing values without throwing', () => {
    expect(identicalValueIsLegitimate('')).toBe(true);
    expect(identicalValueIsLegitimate(null)).toBe(true);
    expect(identicalValueIsLegitimate(undefined)).toBe(true);
  });
});
