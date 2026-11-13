#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Cold-wording ratchet (warmth phase 6, 13 Nov 2026).
 *
 * docs/VOICE-AND-TONE.md says how the platform speaks to members: a kind
 * neighbour, not a machine. This counts the member-facing English messages of
 * the React website that still read cold — "Failed to…", "Unable to…",
 * "Invalid…", bare "…is required", "…not found", "Something went wrong",
 * shouting — and fails when that count goes UP.
 *
 * It is a shrink-only ceiling, kept in .github/cold-wording-baseline.json:
 *   - more cold messages than the ceiling  => FAIL (reword the new ones);
 *   - fewer                                => PASS, with a reminder to lower
 *     the ceiling in the same change (`--write-baseline`), so the gain is kept.
 *
 * English only, on purpose: the other ten languages are translations of these
 * strings, and a pattern list per language would be a second thing to keep
 * true. Staff screens (admin, broker, super-admin) and Caring Community files
 * are out of scope — the guide is about members.
 *
 * What it cannot see: a cold sentence that matches none of the patterns, and
 * the server's own messages. It is a floor under the rewrite, not a proof of
 * warmth.
 *
 *   node scripts/check-cold-wording.mjs                  check
 *   node scripts/check-cold-wording.mjs --write-baseline lower the ceiling to today's count
 *   node scripts/check-cold-wording.mjs --list           print every cold message
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALE_DIR = path.join(ROOT, 'react-frontend', 'public', 'locales', 'en');
const BASELINE = path.join(ROOT, '.github', 'cold-wording-baseline.json');

/** Each is a way a message sounds like a machine, blames the member, or shouts. */
export const PATTERNS = [
  ['failed_to', /^failed to\b/i],
  ['unable_to', /^unable to\b/i],
  ['could_not_blunt', /^(could not|couldn't|cannot|can't) [a-z]+ [^.]*$/i],
  ['invalid', /^invalid\b|\bis invalid\b|\bis not valid\b/i],
  ['error_word', /^error\b|^an error (occurred|has occurred)|\berror occurred\b|unexpected error/i],
  ['went_wrong', /something went wrong/i],
  ['not_found', /^no [a-z ]+ found\.?$|^not found\.?$|\bwas not found\b|\bnot found\.?$/i],
  ['denied', /access denied|permission denied|forbidden|unauthori[sz]ed|not authori[sz]ed|not allowed/i],
  ['shouting', /\b[A-Z]{4,}\b.*!|!!/],
  ['must_blunt', /^you must\b|\bis required\.?$|^required\.?$|^missing\b/i],
];

/** Files whose text only staff see, or that belong to the unfinished Caring Community module. */
const OUT_OF_SCOPE = /^(admin|broker|super)|caring|federation_admin|prerender|diagnostic/i;

export function classify(text) {
  // A placeholder is not a word: judge the sentence around it.
  const plain = text.replace(/\{\{[^}]+\}\}/g, 'X').trim();
  return PATTERNS.filter(([, pattern]) => pattern.test(plain)).map(([name]) => name);
}

function flatten(value, prefix, into) {
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (typeof entry === 'string') into.push([prefix + key, entry]);
    else if (entry && typeof entry === 'object') flatten(entry, `${prefix}${key}.`, into);
  }
  return into;
}

export function measure(localeDir = LOCALE_DIR) {
  const cold = [];
  let strings = 0;
  for (const file of readdirSync(localeDir).filter((name) => name.endsWith('.json')).sort()) {
    if (OUT_OF_SCOPE.test(file)) continue;
    const data = JSON.parse(readFileSync(path.join(localeDir, file), 'utf8'));
    for (const [key, text] of flatten(data, '', [])) {
      strings++;
      const kinds = classify(text);
      if (kinds.length > 0) cold.push({ file, key, text, kinds });
    }
  }
  const byKind = {};
  for (const row of cold) for (const kind of row.kinds) byKind[kind] = (byKind[kind] ?? 0) + 1;
  return { strings, cold, byKind };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const { strings, cold, byKind } = measure();
  const summary = Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${kind} ${n}`).join(', ');

  if (args.has('--list')) {
    for (const row of cold) console.log(`${row.file}\t${row.key}\t${row.kinds.join('+')}\t${row.text.replace(/\s+/g, ' ')}`);
  }

  if (args.has('--write-baseline')) {
    const baseline = {
      description: 'Shrink-only ceiling for cold member-facing English messages on the React website. See scripts/check-cold-wording.mjs and docs/VOICE-AND-TONE.md.',
      ceiling: cold.length,
      byKind,
    };
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`cold-wording: ceiling written — ${cold.length} of ${strings} member-facing messages (${summary}).`);
    return 0;
  }

  let ceiling;
  try {
    ceiling = JSON.parse(readFileSync(BASELINE, 'utf8')).ceiling;
  } catch {
    console.error(`cold-wording: FAIL — cannot read ${path.relative(ROOT, BASELINE)}. Run with --write-baseline once.`);
    return 1;
  }
  if (!Number.isInteger(ceiling) || ceiling < 0) {
    console.error('cold-wording: FAIL — the ceiling in the baseline file is not a whole number.');
    return 1;
  }

  console.log(`cold-wording: ${cold.length} of ${strings} member-facing messages read cold (ceiling ${ceiling}). ${summary}`);

  if (cold.length > ceiling) {
    console.error(`cold-wording: FAIL — ${cold.length - ceiling} more cold message(s) than the ceiling allows.`);
    console.error('  Reword the new ones the way docs/VOICE-AND-TONE.md describes ("We couldn\'t…", say what to do next).');
    console.error('  List them all with: node scripts/check-cold-wording.mjs --list');
    return 1;
  }
  if (cold.length < ceiling) {
    console.log(`cold-wording: PASS — ${ceiling - cold.length} fewer than the ceiling. Keep the gain: node scripts/check-cold-wording.mjs --write-baseline`);
    return 0;
  }
  console.log('cold-wording: PASS — no new cold messages.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
