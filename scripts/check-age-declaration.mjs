// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every sign-up door must state the same minimum age.
 *
 * 🔴 Project NEXUS is for adults, 18 and over (owner decision, 2026-08-25). There are
 * three sign-up forms, and on 2026-08-25 they did not agree:
 *
 *   - the React web app said "…and I am 18 years of age or older" in all 11 languages;
 *   - the native app said "I agree to the platform terms and privacy notice" — no age at
 *     all, in any of its 7 languages;
 *   - the accessible frontend said "I agree to the terms and the privacy policy" — no age
 *     at all, in any of its 11 languages.
 *
 * The app is the one going to Google Play, where the target audience has to be declared,
 * and the declaration has to match what the app actually says. Nothing could see the
 * disagreement: each door's wording lives in a different tree, every key was present in
 * every locale, so both key-set parity gates reported a clean sheet. Same blind spot that
 * let 99,139 PHP values sit in English behind a green parity gate — comparing key sets
 * answers a different question from comparing what the sentence says.
 *
 * This checks the sentence. Deliberately narrow: it looks for the number 18 (every one of
 * these languages, Japanese and Arabic included, writes it in Western digits), and it
 * checks that each screen still renders the string and still refuses to submit without the
 * tick. It does not grade the translation — that is a human job, and the wording is
 * hand-written for exactly that reason.
 *
 * 🔴 KNOWN GAP, deliberately not asserted here: social sign-up (Google/Facebook, via
 * SocialAuthService → RegistrationOrchestrationService) presents no tick-box at all, so it
 * makes no age declaration. Those members meet the terms at first login through the legal
 * acceptance gate instead. Adding a fourth assertion here would fail on day one and say
 * nothing new; the gap is recorded in docs/PRODUCT-AUDIENCE.md with what closing it needs.
 *
 * Usage:
 *   node scripts/check-age-declaration.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WEB_LOCALES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'];
const MOBILE_LOCALES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es'];

/** Every one of these languages writes the number in Western digits. */
const AGE = /18/;

const problems = [];
const rows = [];

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function check(door, locale, where, value) {
  const ok = typeof value === 'string' && AGE.test(value);
  rows.push({ door, locale, ok, value: typeof value === 'string' ? value : '(missing)' });
  if (!ok) {
    problems.push(`${door} / ${locale}: no minimum age in ${where}\n    ${value ?? '(key missing)'}`);
  }
}

// Door 1 — the React web app: auth.json → register.terms_agreement
for (const locale of WEB_LOCALES) {
  const file = `react-frontend/public/locales/${locale}/auth.json`;
  const json = JSON.parse(read(file));
  check('web', locale, `${file} register.terms_agreement`, json.register?.terms_agreement);
}

// Door 2 — the native app: auth.json → register.termsAccepted
for (const locale of MOBILE_LOCALES) {
  const file = `mobile/locales/${locale}/auth.json`;
  const json = JSON.parse(read(file));
  check('mobile', locale, `${file} register.termsAccepted`, json.register?.termsAccepted);
}

// Door 3 — the accessible frontend: lang/<locale>/govuk_alpha.php → auth.terms_label.
// Read as text on purpose: this runs under node, and the one line is unambiguous.
for (const locale of WEB_LOCALES) {
  const file = `lang/${locale}/govuk_alpha.php`;
  const match = read(file).match(/^\s*'terms_label' => '((?:[^'\\]|\\.)*)',/m);
  check('accessible', locale, `${file} auth.terms_label`, match?.[1]);
}

// The wording is worth nothing if the screen stopped showing it, or stopped requiring it.
const SCREENS = [
  {
    door: 'web',
    file: 'react-frontend/src/pages/auth/RegisterPage.tsx',
    shows: /i18nKey="register\.terms_agreement"/,
    requires: /isStep4Valid = termsAccepted/,
  },
  {
    door: 'mobile',
    file: 'mobile/app/(auth)/register.tsx',
    shows: /label=\{t\('register\.termsAccepted'\)\}/,
    requires: /termsAccepted: z\.boolean\(\)\.refine\(/,
  },
  {
    door: 'accessible',
    file: 'web-uk/src/views/register.njk',
    shows: /t\("auth\.terms_label"/,
    requires: /name="terms_accepted"[^>]*\brequired\b/,
  },
];

for (const screen of SCREENS) {
  const source = read(screen.file);
  if (!screen.shows.test(source)) {
    problems.push(`${screen.door}: ${screen.file} no longer renders the age declaration`);
  }
  if (!screen.requires.test(source)) {
    problems.push(`${screen.door}: ${screen.file} no longer requires the tick before submitting`);
  }
}

const width = Math.max(...rows.map((row) => row.door.length));
for (const row of rows) {
  const flag = row.ok ? 'ok  ' : 'MISS';
  console.log(`${flag} ${row.door.padEnd(width)} ${row.locale}  ${row.value.slice(0, 78)}`);
}
console.log(`\n${rows.length} sign-up strings checked across ${SCREENS.length} doors.`);

if (problems.length > 0) {
  console.error(`\nFAILED: ${problems.length} problem(s).\n`);
  console.error(problems.map((problem) => `  - ${problem}`).join('\n'));
  console.error(
    '\nThe platform is for adults 18 and over. Every sign-up form says so, in every'
    + '\nlanguage it offers, or Google Play\'s target-audience declaration stops matching'
    + '\nthe product. See docs/PRODUCT-AUDIENCE.md.',
  );
  process.exit(1);
}

console.log('All sign-up doors state the same minimum age.');
