#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Help Centre staleness check — "has the page this guide describes changed
 * since someone last checked the guide against it?"
 *
 * THE RECORD
 *   react-frontend/src/pages/help/guides/data/sources.json maps each guide
 *   article, "<audience>/<section>/<article>", to
 *     { "sources": [repo-relative files or folders/ the text depends on],
 *       "verified": "<full commit sha the text was last checked at>" }
 *   It is a sidecar so the member registry stays byte-identical to the copy
 *   the phone app bundles (mobile/lib/help/membersRegistry.json).
 *
 * WHAT IT REPORTS
 *   stale           a source changed in a commit after `verified`
 *                   (git log <verified>..HEAD -- <sources>, renames counted
 *                   as changes)
 *   missingSources  a source path that no longer exists
 *   unmapped        an article with no entry at all
 *   invalid         an entry that is malformed, or for an article that no
 *                   longer exists, or whose `verified` commit is not in
 *                   HEAD's history — always a failure, never baselined
 *   unavailable     `verified` is not in this clone (a shallow CI checkout).
 *                   Never a pass: exit 2. CI needs `fetch-depth: 0`.
 *
 * THE RATCHET
 *   .github/help-staleness-baseline.json lists the stale / missingSources /
 *   unmapped keys accepted today. The check fails on anything NEW in those
 *   categories and on a baseline line that no longer applies (so a fix is
 *   locked in and cannot silently regress). Exit 0 clean, 1 failed, 2 nothing
 *   failed but something could not be checked.
 *
 * CLI (from the repository root)
 *   node scripts/check-help-staleness.mjs                    # check
 *   node scripts/check-help-staleness.mjs --json             # machine output
 *   node scripts/check-help-staleness.mjs --write-baseline   # accept today's drift
 *   node scripts/check-help-staleness.mjs --mark-verified members/wallet/sending_credits
 *   node scripts/check-help-staleness.mjs --mark-verified all
 *   node scripts/check-help-staleness.mjs --root <dir>       # another checkout (tests)
 *
 * --mark-verified sets `verified` to HEAD. Use it only after reading the
 * article against its sources as they are at HEAD; it is a statement that a
 * person checked, not a way to make the check pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REGISTRY_DIR = 'react-frontend/src/pages/help/guides/data';
export const AUDIENCES = ['members', 'brokers', 'admins'];
export const SOURCES_FILE = `${REGISTRY_DIR}/sources.json`;
export const BASELINE_FILE = '.github/help-staleness-baseline.json';
const BASELINED = ['stale', 'missingSources', 'unmapped'];
const SHA = /^[0-9a-f]{40}$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOk(root, args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Every article in the three registries, as "<audience>/<section>/<article>". */
export function articleKeys(root) {
  const keys = [];
  for (const audience of AUDIENCES) {
    const registry = readJson(path.join(root, REGISTRY_DIR, `${audience}.registry.json`));
    for (const section of registry) {
      for (const article of section.articles ?? []) keys.push(`${audience}/${section.id}/${article.id}`);
    }
  }
  return keys;
}

/** The entries of sources.json, without "//" comment keys. */
export function readSources(root) {
  const file = path.join(root, SOURCES_FILE);
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(Object.entries(readJson(file)).filter(([key]) => !key.startsWith('//')));
}

function writeSources(root, entries) {
  const file = path.join(root, SOURCES_FILE);
  const existing = fs.existsSync(file) ? readJson(file) : {};
  const comments = Object.fromEntries(Object.entries(existing).filter(([key]) => key.startsWith('//')));
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
  fs.writeFileSync(file, `${JSON.stringify({ ...comments, ...sorted }, null, 2)}\n`);
}

function entryProblem(entry) {
  if (!entry || typeof entry !== 'object') return 'entry is not an object';
  if (!Array.isArray(entry.sources) || entry.sources.length === 0) return 'sources must be a non-empty list';
  for (const source of entry.sources) {
    if (typeof source !== 'string' || source === '' || source.startsWith('/') || /^[a-z]:/i.test(source)
      || source.includes('\\') || source.split('/').includes('..')) {
      return `source ${JSON.stringify(source)} must be a repo-relative path with forward slashes`;
    }
  }
  if (typeof entry.verified !== 'string' || !SHA.test(entry.verified)) return 'verified must be a full 40-character commit sha';
  return null;
}

function touches(changed, source) {
  if (source.endsWith('/')) return changed.startsWith(source);
  return changed === source || changed.startsWith(`${source}/`);
}

/** The whole analysis, with no side effects. */
export function analyse(root) {
  const keys = articleKeys(root);
  const known = new Set(keys);
  const entries = readSources(root);
  const result = { stale: [], missingSources: [], unmapped: [], invalid: [], unavailable: [], details: {} };
  const shallow = gitOk(root, ['rev-parse', '--is-shallow-repository'])
    && git(root, ['rev-parse', '--is-shallow-repository']) === 'true';
  const changedSince = new Map();

  for (const key of keys) if (!(key in entries)) result.unmapped.push(key);

  for (const [key, entry] of Object.entries(entries)) {
    if (!known.has(key)) {
      result.invalid.push(`${key}: no such article in the registries — remove the entry`);
      continue;
    }
    const problem = entryProblem(entry);
    if (problem) {
      result.invalid.push(`${key}: ${problem}`);
      continue;
    }
    for (const source of entry.sources) {
      if (!fs.existsSync(path.join(root, source))) result.missingSources.push(`${key} | ${source}`);
    }
    if (!gitOk(root, ['cat-file', '-e', `${entry.verified}^{commit}`])) {
      result.unavailable.push(`${key}: commit ${entry.verified.slice(0, 12)} is not in this clone${shallow ? ' (shallow clone: fetch with fetch-depth: 0)' : ''}`);
      continue;
    }
    if (!gitOk(root, ['merge-base', '--is-ancestor', entry.verified, 'HEAD'])) {
      result.invalid.push(`${key}: verified commit ${entry.verified.slice(0, 12)} is not in HEAD's history`);
      continue;
    }
    if (!changedSince.has(entry.verified)) {
      const out = git(root, ['log', '--no-renames', '--name-only', '--format=@@commit %h', `${entry.verified}..HEAD`]);
      const files = new Map();
      let commit = '';
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        if (line.startsWith('@@commit ')) {
          commit = line.slice('@@commit '.length);
          continue;
        }
        const list = files.get(line) ?? [];
        if (!list.includes(commit)) list.push(commit);
        files.set(line, list);
      }
      changedSince.set(entry.verified, files);
    }
    const commits = new Set();
    for (const [file, fileCommits] of changedSince.get(entry.verified)) {
      if (entry.sources.some((source) => touches(file, source))) fileCommits.forEach((c) => commits.add(c));
    }
    if (commits.size > 0) {
      result.stale.push(key);
      result.details[key] = [...commits];
    }
  }

  for (const category of [...BASELINED, 'invalid', 'unavailable']) result[category].sort();
  return result;
}

export function readBaseline(root) {
  const file = path.join(root, BASELINE_FILE);
  const empty = { stale: [], missingSources: [], unmapped: [] };
  if (!fs.existsSync(file)) return empty;
  const data = readJson(file);
  return Object.fromEntries(BASELINED.map((category) => [category, Array.isArray(data[category]) ? data[category] : []]));
}

/** Compares an analysis with the baseline. */
export function compare(result, baseline) {
  const unavailableKeys = new Set(result.unavailable.map((line) => line.split(':')[0]));
  const fresh = {};
  const fixed = {};
  for (const category of BASELINED) {
    const now = new Set(result[category]);
    const accepted = new Set(baseline[category]);
    fresh[category] = result[category].filter((key) => !accepted.has(key));
    // A key we could not check is neither fixed nor stale: leave its baseline line alone.
    fixed[category] = baseline[category].filter((key) => !now.has(key) && !unavailableKeys.has(key.split(' | ')[0]));
  }
  const failed = result.invalid.length > 0
    || BASELINED.some((category) => fresh[category].length > 0 || fixed[category].length > 0);
  const status = failed ? 'FAIL' : result.unavailable.length > 0 ? 'UNAVAILABLE' : 'PASS';
  return { status, fresh, fixed };
}

function markVerified(root, target) {
  const entries = readSources(root);
  const head = git(root, ['rev-parse', 'HEAD']);
  const keys = target === 'all' ? Object.keys(entries) : [target];
  for (const key of keys) {
    if (!entries[key]) throw new Error(`${key} has no entry in ${SOURCES_FILE}: add its sources first`);
    const problem = entryProblem({ ...entries[key], verified: head });
    if (problem) throw new Error(`${key}: ${problem}`);
    const dirty = git(root, ['status', '--porcelain', '--', ...entries[key].sources]);
    if (dirty) {
      console.warn(`warning: ${key}: sources have uncommitted changes; verified is set to HEAD (${head.slice(0, 12)}), so committing them will show the article as stale again.`);
    }
    entries[key] = { ...entries[key], verified: head };
  }
  writeSources(root, entries);
  return keys;
}

function writeBaseline(root, result) {
  if (result.invalid.length > 0 || result.unavailable.length > 0) {
    throw new Error('refusing to write a baseline while entries are invalid or cannot be checked; fix those first');
  }
  const data = {
    '//': 'Help Centre drift accepted today. May only shrink: see scripts/check-help-staleness.mjs and docs/TESTING.md.',
    stale: result.stale,
    missingSources: result.missingSources,
    unmapped: result.unmapped,
  };
  const file = path.join(root, BASELINE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function list(title, lines, details = {}) {
  if (lines.length === 0) return;
  console.log(`\n${title} (${lines.length})`);
  for (const line of lines) {
    const commits = details[line];
    console.log(`  - ${line}${commits ? `  [changed in ${commits.slice(0, 5).join(', ')}${commits.length > 5 ? ', …' : ''}]` : ''}`);
  }
}

function main(argv) {
  const args = [...argv];
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const root = path.resolve(option('--root') ?? process.cwd());

  if (args.includes('--mark-verified')) {
    const target = option('--mark-verified');
    if (!target) throw new Error('--mark-verified needs an article key or "all"');
    const keys = markVerified(root, target);
    console.log(`Marked ${keys.length} article(s) verified at HEAD.`);
    return 0;
  }

  const result = analyse(root);

  if (args.includes('--write-baseline')) {
    writeBaseline(root, result);
    console.log(`Wrote ${BASELINE_FILE}: ${result.stale.length} stale, ${result.missingSources.length} missing sources, ${result.unmapped.length} unmapped.`);
    return 0;
  }

  const outcome = compare(result, readBaseline(root));
  if (args.includes('--json')) {
    console.log(JSON.stringify({ ...outcome, ...result }, null, 2));
  } else {
    const total = articleKeys(root).length;
    console.log(`Help Centre staleness: ${outcome.status}`);
    console.log(`${total} articles; ${total - result.unmapped.length} mapped, ${result.unmapped.length} unmapped; ${result.stale.length} stale; ${result.missingSources.length} missing sources; ${result.unavailable.length} could not be checked.`);
    list('NEW stale articles — re-check the text, then --mark-verified <key>', outcome.fresh.stale, result.details);
    list('NEW missing sources — a file moved or was deleted: update sources.json', outcome.fresh.missingSources);
    list('NEW unmapped articles — add an entry to sources.json', outcome.fresh.unmapped);
    list('Invalid entries', result.invalid);
    list('Baseline lines that no longer apply — run --write-baseline to lock the improvement in', [
      ...outcome.fixed.stale, ...outcome.fixed.missingSources, ...outcome.fixed.unmapped,
    ]);
    list('Could not be checked (UNAVAILABLE is not a pass)', result.unavailable);
  }
  return outcome.status === 'FAIL' ? 1 : outcome.status === 'UNAVAILABLE' ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-help-staleness: ${error.message}`);
    process.exitCode = 1;
  }
}
