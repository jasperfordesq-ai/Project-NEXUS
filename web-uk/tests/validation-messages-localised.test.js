// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Client-side validation (public/js/validation.js) shows an inline error when a
 * field fails a rule. It resolves the text as:
 *   field.dataset[`${rule}Message`] || form.dataset[...] || <English default>
 * so without a translated `data-<rule>-message` attribute the member sees the
 * English default ("Enter ...", "... must be ... characters or fewer") even on
 * a localised page. These forms must supply a translated message for every rule
 * on every validated field, drawn from the shared `states.validation.*` keys.
 */

const fs = require('fs');
const path = require('path');
const { createTranslator } = require('../src/lib/localization');

const viewsDir = path.join(__dirname, '..', 'src', 'views');

// The JS rule name -> the data attribute it reads (dataset camelCase to kebab).
const RULE_ATTR = {
  required: 'data-required-message',
  maxLength: 'data-max-length-message',
  minLength: 'data-min-length-message',
  number: 'data-number-message',
  min: 'data-min-message',
  max: 'data-max-message',
  email: 'data-email-message',
  matches: 'data-matches-message',
  pattern: 'data-pattern-message'
};

const TEMPLATES = [
  'events/new.njk',
  'events/edit.njk',
  'groups/new.njk',
  'groups/edit.njk'
];

describe('localised client-side validation messages', () => {
  test.each(TEMPLATES)('%s supplies a translated message for every validated rule', (rel) => {
    const src = fs.readFileSync(path.join(viewsDir, rel), 'utf8');

    // Every field declares its rules in a `"data-validate": "rule rule:param"`.
    const validateDecls = [...src.matchAll(/"data-validate":\s*"([^"]+)"/g)];
    expect(validateDecls.length).toBeGreaterThan(0);

    const missing = [];
    for (const decl of validateDecls) {
      const rules = decl[1].split(/\s+/).map((r) => r.split(':')[0]).filter(Boolean);
      // The attributes object for this field runs from the data-validate match
      // to the end of that object literal; 600 chars comfortably covers it.
      const slice = src.slice(decl.index, decl.index + 600);
      for (const rule of rules) {
        const attr = RULE_ATTR[rule];
        if (!attr) continue; // unknown rule: JS has no default, nothing to localise
        if (!slice.includes(attr)) {
          missing.push(`rules "${decl[1]}" -> ${attr}`);
        }
      }
    }

    // A miss means that field's inline error would render in English.
    expect(missing).toEqual([]);

    // And the messages must be wired to the shared translation keys.
    expect(src).toContain('states.validation.');
  });

  it('resolves the shared keys in every supported locale with tokens replaced', () => {
    for (const loc of ['en', 'de', 'fr', 'ar', 'ga']) {
      const t = createTranslator(loc);
      const required = t('states.validation.required', { field: 'Title' });
      const maxLen = t('states.validation.max_length', { field: 'Title', max: 255 });
      // Key resolved (not echoed back) and no leftover :tokens.
      expect(required).not.toBe('states.validation.required');
      expect(required).toContain('Title');
      expect(maxLen).toContain('255');
      expect(maxLen).not.toContain(':max');
      expect(maxLen).not.toContain(':field');
    }
  });
});
