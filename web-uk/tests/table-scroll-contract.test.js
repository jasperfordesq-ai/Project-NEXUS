// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

/**
 * Every wide GOV.UK data table must sit inside a focusable, horizontally
 * scrollable region, per the GOV.UK "make tables scroll" pattern.
 *
 * The wrapper is:
 *   <div class="nexus-alpha-table-scroll" tabindex="0" role="region" aria-label="…">
 *     <table class="govuk-table">…</table>
 *   </div>
 *
 * `.nexus-alpha-table-scroll` (defined in src/assets/scss/main.scss) gives the
 * region `overflow-x: auto`; `tabindex="0"` + `role="region"` let a keyboard user
 * focus and scroll it, and a screen reader announces it as a named region using
 * the table's own caption text.
 *
 * This is a contract, not a ratchet with a number: EVERY raw `<table class="govuk-table"`
 * across every .njk under src/views must be directly wrapped (only whitespace between
 * the wrapper's opening tag and the table). New wide tables must ship inside the wrapper.
 */
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const TABLE = '<table class="govuk-table"';
const WRAPPER = '<div class="nexus-alpha-table-scroll"';

function njkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...njkFiles(p));
    else if (entry.name.endsWith('.njk')) out.push(p);
  }
  return out;
}

describe('GOV.UK data-table scroll region contract', () => {
  it('wraps every <table class="govuk-table"> in a focusable scroll region', () => {
    const problems = [];

    for (const file of njkFiles(VIEWS)) {
      const source = fs.readFileSync(file, 'utf8');
      const rel = path.relative(VIEWS, file).split(path.sep).join('/');

      let idx = 0;
      while ((idx = source.indexOf(TABLE, idx)) !== -1) {
        const tableStart = idx;
        idx += TABLE.length;

        // Look back only a short window; the wrapper must be immediately before.
        const window = source.slice(Math.max(0, tableStart - 200), tableStart);
        const divPos = window.lastIndexOf(WRAPPER);
        if (divPos === -1) {
          problems.push(`${rel}: <table class="govuk-table"> is not wrapped in ${WRAPPER}`);
          continue;
        }

        const divTag = window.slice(divPos);
        const gt = divTag.indexOf('>');
        if (gt === -1 || !divTag.slice(0, gt).includes('role="region"')) {
          problems.push(`${rel}: wrapper before table is missing role="region"`);
          continue;
        }

        // Between the wrapper's opening tag and the table: whitespace only.
        const between = divTag.slice(gt + 1);
        if (!/^\s*$/.test(between)) {
          problems.push(`${rel}: content between wrapper and table (found: ${JSON.stringify(between.slice(0, 60))})`);
        }
      }
    }

    if (problems.length) {
      throw new Error(
        `Unwrapped or malformed GOV.UK table scroll regions:\n  ${problems.join('\n  ')}\n`
        + `Wrap the table: <div class="nexus-alpha-table-scroll" tabindex="0" role="region" `
        + `aria-label="{{ <same expression as the table caption> }}">…</div>`
      );
    }

    expect(problems).toEqual([]);
  });
});
