// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

/**
 * govuk-frontend focuses the error-summary ROOT on init, and deliberately keeps
 * role="alert" on a nested CHILD, because focusing and alerting the same
 * element races and screen readers drop the announcement (documented in the
 * component's own template). 35 hand-rolled summaries had drifted back to
 * role="alert" on the focused root; this pins the corrected form everywhere.
 *
 * Transient load-failure summaries additionally carry
 * data-disable-auto-focus="true" so a backend hiccup does not steal focus on
 * page load — that half is asserted per-file below for the files fixed, not
 * globally (validation summaries SHOULD keep the autofocus).
 */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.njk')) out.push(full);
  }
  return out;
}

const stripComments = (src) => src.replace(/\{#[\s\S]*?#\}/g, '');

describe('error summary role="alert" placement', () => {
  const viewsDir = path.join(__dirname, '..', 'src', 'views');
  const templates = walk(viewsDir);

  it('covers a real template set', () => {
    expect(templates.length).toBeGreaterThan(200);
  });

  it('never puts role="alert" on the govuk-error-summary root in any template', () => {
    const offenders = [];
    for (const file of templates) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (/class="govuk-error-summary"[^>]*role="alert"/.test(src)) {
        offenders.push(path.relative(viewsDir, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the client-built summary alerting on a child, not the focused root', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'validation.js'), 'utf8');
    expect(js).not.toContain("summary.setAttribute('role', 'alert')");
    expect(js).toContain('<div role="alert">');
  });

  it('does not autofocus transient load-failure summaries on page load', () => {
    // Spot-pins for the class of fix, one per area.
    for (const file of ['dashboard/index.njk', 'search/index.njk', 'settings/appearance.njk', 'jobs/index.njk']) {
      const src = fs.readFileSync(path.join(viewsDir, file), 'utf8');
      expect(src).toMatch(/data-module="govuk-error-summary" data-disable-auto-focus="true"/);
    }
  });
});
