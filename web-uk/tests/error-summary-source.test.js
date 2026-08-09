// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

function nunjucksFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return nunjucksFilesUnder(entryPath);
    return entry.isFile() && entry.name.endsWith('.njk') ? [entryPath] : [];
  });
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

describe('GOV.UK error summary source contract', () => {
  it('makes every error summary programmatically focusable', () => {
    const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
    const violations = [];

    for (const templatePath of nunjucksFilesUnder(viewsDirectory)) {
      const source = fs.readFileSync(templatePath, 'utf8');
      const openingTags = source.matchAll(/<[a-z][^>]*>/gi);

      for (const match of openingTags) {
        const classAttribute = match[0].match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i);
        const classNames = classAttribute ? classAttribute[2].trim().split(/\s+/) : [];
        if (!classNames.includes('govuk-error-summary')) continue;

        const hasNegativeTabindex = /\btabindex\s*=\s*(?:(["'])-1\1|-1(?=\s|>))/i.test(match[0]);
        if (!hasNegativeTabindex) {
          violations.push(`${path.relative(viewsDirectory, templatePath)}:${lineNumberAt(source, match.index)}`);
        }
      }

      const macroCalls = source.matchAll(/govukErrorSummary\(\{[\s\S]*?\}\)\s*\}\}/g);
      for (const match of macroCalls) {
        const hasNegativeTabindex = /\battributes\s*:\s*\{[\s\S]*?\btabindex\s*:\s*(?:(["'])-1\1|-1(?=\s|[,}]))/i.test(match[0]);
        if (!hasNegativeTabindex) {
          violations.push(`${path.relative(viewsDirectory, templatePath)}:${lineNumberAt(source, match.index)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
