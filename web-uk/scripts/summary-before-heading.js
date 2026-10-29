// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * GOV.UK puts the error summary at the top of the main container and a
 * notification banner immediately before the page <h1>, so a screen reader meets
 * the problem (or the confirmation) before anything else. On 29 Oct 2026 about a
 * hundred templates had them just BELOW the heading; this tool moved them.
 *
 * It moves a block only when it is certain the move is safe: the block is a
 * whole `{% if %}…{% endif %}` containing an error summary or notification
 * banner and nothing else of substance (no form, heading, table, summary list,
 * or `set` other than the shared banner partial's inputs), and everything between
 * the <h1> and the block is the lede, a grid opening, a comment, a section nav
 * include or the nav's active-tab `set`. Anything else is left alone: a summary
 * that belongs to a form or section further down the page is correct where it is.
 *
 * Usage:
 *   node scripts/summary-before-heading.js          # list templates it would change
 *   node scripts/summary-before-heading.js --write  # move them
 * tests/summary-before-heading.test.js fails when a template needs moving.
 */

const fs = require('node:fs');
const path = require('node:path');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const IF_OPEN = /\{%-?\s*if\s/g;
const IF_CLOSE = /\{%-?\s*endif\s*-?%\}/g;
const BANNER_PARTIAL = /partials\/notification-banner\.njk/;
const SUMMARY = /govuk-error-summary"|govukErrorSummary\(|govuk-notification-banner[" ]|govukNotificationBanner\(|partials\/notification-banner\.njk/;
const PASSABLE = [
  /^\s*$/,
  /^\s*<div class="govuk-grid-row">\s*$/,
  /^\s*<div class="govuk-grid-column-[a-z-]+">\s*$/,
  /^\s*<p class="govuk-body-l[^"]*">.*<\/p>\s*$/,
  /^\s*\{#.*#\}\s*$/,
  /^\s*\{%-?\s*include\s+"[a-z-]+\/_nav\.njk"\s*%\}\s*$/,
  /^\s*\{%-?\s*set\s+\w*(Tab|NavGroup)\s*=\s*"[^"]*"\s*-?%\}\s*$/
];

const count = (text, re) => (text.match(re) || []).length;

function unsafe(body) {
  if (/<form|<h1|govuk-heading-(xl|l|m)"|\{%-?\s*block\s|<table|govuk-summary-list"|<fieldset/.test(body)) return true;
  const includes = body.match(/\{%-?\s*include\s+"[^"]+"/g) || [];
  if (includes.some((inc) => !BANNER_PARTIAL.test(inc))) return true;
  const sets = body.match(/\{%-?\s*set\s+\w+/g) || [];
  return sets.length > 0 && (!BANNER_PARTIAL.test(body) || sets.some((s) => !/set\s+notification/.test(s)));
}

/** Returns the new text, or null when nothing in this template should move. */
function moveSummaries(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const h1 = lines.findIndex((line) => /<h1[\s>]/.test(line));
  if (h1 < 0) return null;
  let h1End = h1;
  while (h1End < lines.length && !/<\/h1>/.test(lines[h1End])) h1End += 1;
  if (h1End >= lines.length) return null;

  let insertAt = h1;
  for (let k = h1 - 1; k >= 0; k -= 1) {
    if (/^\s*$/.test(lines[k])) continue;
    if (/^\s*<span class="govuk-caption-(xl|l|m)"[^>]*>.*<\/span>\s*$/.test(lines[k])) insertAt = k;
    break;
  }

  const blocks = [];
  let i = h1End + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (PASSABLE.some((re) => re.test(line))) { i += 1; continue; }
    if (/^\s*<p class="govuk-body-l[^"]*">/.test(line) && !/<\/p>/.test(line)) {
      let k = i;
      while (k < lines.length && !/<\/p>/.test(lines[k])) k += 1;
      if (k < lines.length && !lines.slice(i, k + 1).some((l) => /\{%/.test(l))) { i = k + 1; continue; }
      break;
    }
    if (!/^\s*\{%-?\s*if\s.*%\}/.test(line)) break;
    let depth = 0;
    let j = i;
    for (; j < lines.length; j += 1) {
      depth += count(lines[j], IF_OPEN) - count(lines[j], IF_CLOSE);
      if (depth <= 0) break;
    }
    if (j >= lines.length) break;
    const body = lines.slice(i, j + 1).join('\n');
    const trailing = lines[j].replace(/^.*\{%-?\s*endif\s*-?%\}/, '');
    if (!SUMMARY.test(body) || unsafe(body) || /\S/.test(trailing)) break;
    blocks.push([i, j]);
    i = j + 1;
  }
  if (!blocks.length) return null;

  const inBlock = (idx) => blocks.some(([a, b]) => idx >= a && idx <= b);
  const taken = lines.filter((_, idx) => inBlock(idx));
  const kept = lines.filter((_, idx) => !inBlock(idx));
  const targetIndent = (lines[insertAt].match(/^\s*/) || [''])[0];
  const sourceIndent = (taken.find((l) => /\S/.test(l)).match(/^\s*/) || [''])[0];
  const reindented = taken.map((l) => (l.startsWith(sourceIndent) ? targetIndent + l.slice(sourceIndent.length) : l));
  return [...kept.slice(0, insertAt), ...reindented, ...kept.slice(insertAt)].join(eol);
}

function templates(dir = VIEWS) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return templates(full);
    return entry.name.endsWith('.njk') ? [full] : [];
  });
}

function pending() {
  return templates().filter((file) => moveSummaries(fs.readFileSync(file, 'utf8')) !== null);
}

function main() {
  const files = pending();
  for (const file of files) {
    const rel = path.relative(VIEWS, file);
    if (process.argv.includes('--write')) {
      fs.writeFileSync(file, moveSummaries(fs.readFileSync(file, 'utf8')), 'utf8');
      console.log(`moved: ${rel}`);
    } else {
      console.log(`needs moving: ${rel}`);
    }
  }
  if (!files.length) console.log('No summary or banner sits directly below a page heading.');
}

module.exports = { moveSummaries, pending };

if (require.main === module) main();
