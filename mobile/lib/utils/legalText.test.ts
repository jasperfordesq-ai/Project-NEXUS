// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { decodeEntities, isNotYetInForce, legalDateOnly, parseLegalContent } from './legalText';

describe('parseLegalContent', () => {
  it('keeps headings, paragraphs and list items as separate blocks', () => {
    // 🔴 The app's existing stripHtml helper flattens all of this into one string:
    // headings disappear into the surrounding text and list items run together.
    // For a blog excerpt that is fine; for a document somebody is being asked to
    // AGREE TO, the structure is how it stays readable.
    const blocks = parseLegalContent(
      '<h2>Using this service</h2><p>Be fair.</p><ul><li>One</li><li>Two</li></ul>',
    );

    expect(blocks).toEqual([
      { type: 'heading', text: 'Using this service', level: 2 },
      { type: 'paragraph', text: 'Be fair.' },
      { type: 'listItem', text: 'One' },
      { type: 'listItem', text: 'Two' },
    ]);
  });

  it('records h3 as a sub-heading', () => {
    const blocks = parseLegalContent('<h2>Top</h2><h3>Under</h3>');

    expect(blocks.map((block) => block.level)).toEqual([2, 3]);
  });

  it('treats h1 as a heading at the same level as h2', () => {
    // The screen already has its own title; a document opening with an h1 must not
    // out-rank it.
    const blocks = parseLegalContent('<h1>Terms</h1>');

    expect(blocks[0]).toEqual({ type: 'heading', text: 'Terms', level: 2 });
  });

  it('decodes the entities a CMS actually produces', () => {
    const blocks = parseLegalContent('<p>Time &amp; credits &mdash; one &ldquo;hour&rdquo;</p>');

    // Leaving these as &amp; is the visible half of the old helper's problem.
    expect(blocks[0].text).toBe('Time & credits — one “hour”');
  });

  it('decodes numeric entities', () => {
    expect(decodeEntities('&#233;quipe &#x2014; ok')).toBe('équipe — ok');
  });

  it('strips inline markup from a block without losing its words', () => {
    const blocks = parseLegalContent('<p>Use <strong>time credits</strong> <em>fairly</em>.</p>');

    expect(blocks[0].text).toBe('Use time credits fairly.');
  });

  it('turns a line break into a space rather than gluing words together', () => {
    const blocks = parseLegalContent('<p>One<br>Two</p>');

    expect(blocks[0].text).toBe('One Two');
  });

  it('skips empty blocks instead of rendering blank lines', () => {
    const blocks = parseLegalContent('<p></p><p>  </p><p>Real</p>');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Real');
  });

  it('still shows something for content with no recognised block elements', () => {
    // A document must never render as a blank page just because its markup is not
    // what this models.
    const blocks = parseLegalContent('Just some text with a <span>span</span>.');

    expect(blocks).toEqual([{ type: 'paragraph', text: 'Just some text with a span.' }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseLegalContent('')).toEqual([]);
    expect(parseLegalContent(null)).toEqual([]);
    expect(parseLegalContent(undefined)).toEqual([]);
  });
});

describe('legalDateOnly', () => {
  it('keeps the date part of an ISO timestamp', () => {
    expect(legalDateOnly('2026-07-01T00:00:00Z')).toBe('2026-07-01');
  });

  it('passes a bare date through', () => {
    expect(legalDateOnly('2026-07-01')).toBe('2026-07-01');
  });

  it('returns an empty string for nothing', () => {
    expect(legalDateOnly(null)).toBe('');
    expect(legalDateOnly('  ')).toBe('');
  });
});

describe('isNotYetInForce', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('flags a future effective date', () => {
    // 🔴 effective_date is routinely future-dated — a policy published now to take
    // effect next month. Labelling that "Last updated" claims terms apply that do
    // not yet.
    expect(isNotYetInForce('2026-09-01T00:00:00Z', now)).toBe(true);
  });

  it('treats today as in force', () => {
    expect(isNotYetInForce('2026-08-11T00:00:00Z', now)).toBe(false);
  });

  it('treats a past date as in force', () => {
    expect(isNotYetInForce('2026-07-01', now)).toBe(false);
  });

  it('says no for anything unparseable rather than guessing', () => {
    expect(isNotYetInForce('', now)).toBe(false);
    expect(isNotYetInForce(null, now)).toBe(false);
    expect(isNotYetInForce('soon', now)).toBe(false);
  });
});
