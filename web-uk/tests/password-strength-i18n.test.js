// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The live password-strength advisory on the register and reset-password forms
 * writes into #password-strength-msg, an aria-live region a screen reader
 * announces. It used to inject hardcoded English regardless of the member's
 * language. The strings must now come from translated `data-msg-*` attributes,
 * and the client script must read them (with an English fallback) rather than
 * hardcode.
 */

const fs = require('fs');
const path = require('path');
const { createTranslator } = require('../src/lib/localization');

const viewsDir = path.join(__dirname, '..', 'src', 'views');
const scriptPath = path.join(__dirname, '..', 'public', 'js', 'password-strength.js');

const TEMPLATES = ['register.njk', 'reset-password.njk'];
const DATA_ATTRS = [
  'data-msg-idle',
  'data-msg-too-short',
  'data-msg-checking',
  'data-msg-breached',
  'data-msg-strong'
];
const KEYS = [
  'auth.password_strength.idle',
  'auth.password_strength.too_short',
  'auth.password_strength.checking',
  'auth.password_strength.breached',
  'auth.password_strength.strong'
];

describe('password-strength advisory is localised', () => {
  test.each(TEMPLATES)('%s supplies translated data-msg-* attributes on the aria-live region', (rel) => {
    const src = fs.readFileSync(path.join(viewsDir, rel), 'utf8');
    for (const attr of DATA_ATTRS) {
      expect(src).toContain(attr + '="{{ t(');
    }
    for (const key of KEYS) {
      expect(src).toContain(`t('${key}')`);
    }
  });

  it('the client script reads the data attributes and no longer hardcodes the English advisory', () => {
    const js = fs.readFileSync(scriptPath, 'utf8');
    // Reads the localised strings...
    expect(js).toContain('msg.dataset');
    expect(js).toContain("msgText('msgIdle'");
    expect(js).toContain("msgText('msgTooShort'");
    expect(js).toContain("msgText('msgChecking'");
    expect(js).toContain("msgText('msgBreached'");
    expect(js).toContain("msgText('msgStrong'");
    // ...and no longer builds the old counted-down English string inline.
    expect(js).not.toContain("' more character'");
  });

  it('resolves the advisory keys in every locale, English as the Irish fallback', () => {
    for (const loc of ['en', 'de', 'fr', 'ar', 'ga']) {
      const t = createTranslator(loc);
      for (const key of KEYS) {
        const value = t(key);
        expect(value).not.toBe(key); // key resolved to a real string
        expect(value.length).toBeGreaterThan(0);
      }
    }
    // A non-English locale genuinely differs from English (proves it's translated,
    // not silently English for everyone).
    const en = createTranslator('en');
    const de = createTranslator('de');
    expect(de('auth.password_strength.strong')).not.toBe(en('auth.password_strength.strong'));
    // :min stays a token for the client to substitute, in every locale.
    expect(de('auth.password_strength.too_short')).toContain(':min');
  });
});
