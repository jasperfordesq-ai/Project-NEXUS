// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every **bold** label in a guide must be words the app really shows, in the
 * same language. The matching rules are in `labelCheck.ts`.
 *
 * Bold is also used for emphasis, and some labels exist only in the phone app,
 * so today not every span passes. This is therefore a RATCHET:
 *
 *   data/label-allowlist.json  genuine exceptions, one reason each
 *   data/label-baseline.json   known failures per locale, still to be fixed
 *
 * It fails on a failure that is not in the baseline (a new wrong label), on a
 * baseline line that no longer fails (fixed: take it out so it cannot come
 * back), and on an allowlist entry nothing uses. Regenerate the baseline, only
 * after checking that the change is an improvement, with
 *
 *   node scripts/write-help-label-baseline.mjs [--report <file.json>]
 *
 * (from react-frontend/), which runs this file with HELP_LABELS_WRITE=1.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boldSpans,
  buildUiText,
  collectStrings,
  failureKey,
  isAllowlisted,
  isEmphasisSentence,
  normalizeLabel,
  type AllowlistEntry,
  type UiText,
} from './labelCheck';
import { HELP_AUDIENCES, HELP_AUDIENCE_NAMESPACE } from './types';

const LOCALES_DIR = path.resolve(__dirname, '../../../../public/locales');
const DATA_DIR = path.resolve(__dirname, 'data');
const BASELINE_FILE = path.join(DATA_DIR, 'label-baseline.json');
const ALLOWLIST_FILE = path.join(DATA_DIR, 'label-allowlist.json');

const LOCALES = fs.readdirSync(LOCALES_DIR)
  .filter((entry) => fs.statSync(path.join(LOCALES_DIR, entry)).isDirectory())
  .sort();

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

interface GuideFile {
  sections: Record<string, { title?: string; articles: Record<string, { title?: string; body: string }> }>;
}

function readGuides(locale: string): Array<{ audience: string; guide: GuideFile }> {
  return HELP_AUDIENCES.flatMap((audience) => {
    const file = path.join(LOCALES_DIR, locale, `${HELP_AUDIENCE_NAMESPACE[audience]}.json`);
    // A missing guide file is the integrity test's job.
    return fs.existsSync(file) ? [{ audience, guide: readJson(file) as GuideFile }] : [];
  });
}

/** Section and article titles: a bold span naming another guide is a cross-reference. */
function guideTitles(guides: Array<{ guide: GuideFile }>): Set<string> {
  const titles = new Set<string>();
  for (const { guide } of guides) {
    for (const section of Object.values(guide.sections ?? {})) {
      if (section.title) titles.add(normalizeLabel(section.title));
      for (const article of Object.values(section.articles ?? {})) {
        if (article.title) titles.add(normalizeLabel(article.title));
      }
    }
  }
  return titles;
}

function uiTextFor(locale: string): UiText {
  const dir = path.join(LOCALES_DIR, locale);
  const values: string[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.json') || file.startsWith('help_')) continue;
    collectStrings(readJson(path.join(dir, file)), values);
  }
  return buildUiText(values);
}

interface LocaleResult {
  bold: number;
  emphasis: number;
  crossReferences: number;
  allowlisted: number;
  failures: Array<{ key: string; audience: string; section: string; article: string; label: string }>;
  allowlistUsed: Set<number>;
}

const ALLOWLIST = (readJson(ALLOWLIST_FILE) as { entries: AllowlistEntry[] }).entries;

function checkLocale(locale: string): LocaleResult {
  const ui = uiTextFor(locale);
  const guides = readGuides(locale);
  const titles = guideTitles(guides);
  const result: LocaleResult = { bold: 0, emphasis: 0, crossReferences: 0, allowlisted: 0, failures: [], allowlistUsed: new Set() };
  const seen = new Set<string>();
  for (const { audience, guide } of guides) {
    for (const [section, sectionText] of Object.entries(guide.sections ?? {})) {
      for (const [article, articleText] of Object.entries(sectionText.articles ?? {})) {
        for (const span of boldSpans(articleText.body ?? '')) {
          result.bold += 1;
          if (isEmphasisSentence(span)) {
            result.emphasis += 1;
            continue;
          }
          if (ui.has(span)) continue;
          if (titles.has(normalizeLabel(span))) {
            result.crossReferences += 1;
            continue;
          }
          const allowed = ALLOWLIST.findIndex((entry) => isAllowlisted(entry, locale, span));
          if (allowed >= 0) {
            result.allowlisted += 1;
            result.allowlistUsed.add(allowed);
            continue;
          }
          const key = failureKey(audience, section, article, span);
          if (seen.has(key)) continue;
          seen.add(key);
          result.failures.push({ key, audience, section, article, label: normalizeLabel(span) });
        }
      }
    }
  }
  return result;
}

const RESULTS = new Map(LOCALES.map((locale) => [locale, checkLocale(locale)] as const));
const WRITE = process.env.HELP_LABELS_WRITE === '1';

if (WRITE) {
  const baseline: Record<string, string[]> = {};
  for (const [locale, result] of RESULTS) baseline[locale] = result.failures.map((f) => f.key).sort();
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
  const report = process.env.HELP_LABELS_REPORT;
  if (report) {
    const counts: Record<string, unknown> = {};
    const failures: Record<string, LocaleResult['failures']> = {};
    for (const [locale, result] of RESULTS) {
      counts[locale] = {
        boldSpans: result.bold,
        emphasisSentencesSkipped: result.emphasis,
        guideTitleCrossReferences: result.crossReferences,
        allowlisted: result.allowlisted,
        unmatched: result.failures.length,
      };
      failures[locale] = [...result.failures].sort((a, b) => a.key.localeCompare(b.key));
    }
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify({
      generated: new Date().toISOString(),
      rules: 'react-frontend/src/pages/help/guides/labelCheck.ts',
      counts,
      failures,
    }, null, 2)}\n`);
  }
}

const BASELINE = fs.existsSync(BASELINE_FILE)
  ? readJson(BASELINE_FILE) as Record<string, string[]>
  : {};

describe('Help Centre label check: rules', () => {
  it('ignores spacing and a trailing colon or ellipsis, nothing else', () => {
    const ui = buildUiText(['Language:', 'Save Changes', 'Loading…']);
    expect(ui.has('Language')).toBe(true);
    expect(ui.has('  Save   Changes ')).toBe(true);
    expect(ui.has('Loading...')).toBe(true);
    expect(ui.has('Save changes')).toBe(false);
    expect(ui.has('Save')).toBe(false);
  });

  it('fills placeholders, but a bare placeholder matches nothing', () => {
    const ui = buildUiText(['{{count}} left today', '{{name}}', 'Your rank: #{{rank}} of {{total}} members']);
    expect(ui.has('5 left today')).toBe(true);
    expect(ui.has('Your rank: #12 of 150 members')).toBe(true);
    expect(ui.has('Anything at all')).toBe(false);
  });

  it('treats a bolded sentence as emphasis, not a label', () => {
    expect(isEmphasisSentence('Do not delete anything.')).toBe(true);
    expect(isEmphasisSentence('記録してください。')).toBe(true);
    expect(isEmphasisSentence('Loading...')).toBe(false);
    expect(isEmphasisSentence('Save Changes')).toBe(false);
  });

  it('reads nested translation values', () => {
    expect(collectStrings({ a: 'x', b: { c: 'y', d: ['z'] }, e: 1 })).toEqual(['x', 'y', 'z']);
  });
});

describe('Help Centre label check: allowlist', () => {
  it('gives every exception a reason and a locale list', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.label?.trim(), JSON.stringify(entry)).toBeTruthy();
      expect(entry.reason?.trim().length, `${entry.label}: reason`).toBeGreaterThan(10);
      expect(entry.locales === '*' || (Array.isArray(entry.locales) && entry.locales.every((l) => LOCALES.includes(l))), `${entry.label}: locales`).toBe(true);
    }
  });

  it.skipIf(WRITE)('has no exception that nothing needs any more', () => {
    const used = new Set<number>();
    for (const result of RESULTS.values()) for (const index of result.allowlistUsed) used.add(index);
    const unused = ALLOWLIST.filter((_, index) => !used.has(index)).map((entry) => entry.label);
    expect(unused, 'remove these from data/label-allowlist.json').toEqual([]);
  });
});

describe.skipIf(WRITE).each(LOCALES)('Help Centre label check: %s', (locale) => {
  const result = RESULTS.get(locale);
  const known = new Set(BASELINE[locale] ?? []);

  it('has no bold label that is missing from the interface text, beyond the known ones', () => {
    const fresh = (result?.failures ?? []).filter((f) => !known.has(f.key)).map((f) => f.key);
    expect(fresh, `${locale}: these bold labels are not words the app shows in ${locale}. Fix the guide text to the real label, or — if it is a genuine exception — add it to data/label-allowlist.json with a reason.`).toEqual([]);
  });

  it('has no fixed failure still listed in the baseline', () => {
    const now = new Set((result?.failures ?? []).map((f) => f.key));
    const fixed = [...known].filter((key) => !now.has(key));
    expect(fixed, `${locale}: these are fixed (or their article moved). Regenerate with node scripts/write-help-label-baseline.mjs so they cannot come back.`).toEqual([]);
  });
});
