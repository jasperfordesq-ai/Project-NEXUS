// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * HELP-10 (3 October 2026): a member wrote a poll description in paragraphs
 * with a numbered list. Every surface that showed it printed the text straight
 * into a <p>, so HTML collapsed the line breaks and the list ran together into
 * one paragraph. Each template that shows a poll description must send it
 * through `nl2br`, which escapes the text first and only then adds <br>.
 */
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { nl2br } = require('../src/lib/nl2br');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const TEMPLATES = [
  'polls/detail.njk',
  'polls/index.njk',
  'polls/rank.njk',
  'events/detail.njk',
];

describe('poll descriptions keep the author\'s line breaks', () => {
  test.each(TEMPLATES)('%s sends every poll description through nl2br', (template) => {
    const source = fs.readFileSync(path.join(VIEWS, template), 'utf8');
    const outputs = source.match(/\{\{\s*poll\.description[^}]*\}\}/g) || [];

    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(output.replace(/\s+/g, ' ')).toBe('{{ poll.description | nl2br | safe }}');
    }
  });

  test('the filter turns line breaks into <br> and still escapes markup', () => {
    const env = new nunjucks.Environment(null, { autoescape: true });
    env.addFilter('nl2br', nl2br);

    const html = env.renderString('{{ poll.description | nl2br | safe }}', {
      poll: { description: 'Sessions:\n1. Tutorials\n2. <b>Matching</b>' },
    });

    expect(html).toBe('Sessions:<br>1. Tutorials<br>2. &lt;b&gt;Matching&lt;/b&gt;');
  });
});
