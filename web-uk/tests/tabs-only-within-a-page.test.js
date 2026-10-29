// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GOV.UK: "do not use tabs for navigating between pages". Sixteen templates used
 * tab styling for links to other pages until 29 Oct 2026 (owner decision: follow
 * GOV.UK). They now use the plain link list (`nexus-alpha-filter-nav`, current page
 * marked with aria-current). Real tabs stay allowed, with in-page `#` targets.
 */

const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'src', 'views');

function templates(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return templates(full);
    return entry.name.endsWith('.njk') ? [full] : [];
  });
}

it('no tab is a link to another page', () => {
  const offenders = [];
  for (const file of templates(VIEWS)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/<a\b[^>]*class="govuk-tabs__tab"[^>]*>/g)) {
      const href = (match[0].match(/href="([^"]*)"/) || [])[1] || '';
      if (!href.startsWith('#')) offenders.push(`${path.relative(VIEWS, file)}: ${href}`);
    }
  }
  expect(offenders).toEqual([]);
});
