// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { needsHtmlView, tidyHtmlForSource } from './richTextHtml';

describe('needsHtmlView', () => {
  it('is false for everything the visual editor can hold', () => {
    const html =
      '<h2>Title</h2><p>Some <strong>bold</strong> and <em>italic</em> text with a <a href="https://example.org">link</a>.</p>'
      + '<ul><li>One</li></ul><ol><li>Two</li></ol><blockquote><p>Quote<br>line</p></blockquote>';
    expect(needsHtmlView(html)).toBe(false);
  });

  it.each([
    ['an image', '<p>Hello</p><img src="/uploads/a.png" alt="">'],
    ['a table', '<table><tr><td>1</td></tr></table>'],
    ['a divider', '<p>Above</p><hr><p>Below</p>'],
    ['a figure', '<figure><figcaption>Caption</figcaption></figure>'],
    ['preformatted text', '<pre>code</pre>'],
    ['upper-case tags', '<IMG SRC="/uploads/a.png">'],
  ])('is true for %s', (_name, html) => {
    expect(needsHtmlView(html)).toBe(true);
  });

  it('is not fooled by words that only start like a tag name', () => {
    expect(needsHtmlView('<p>The image and the table are described in words.</p>')).toBe(false);
    expect(needsHtmlView('<header>Not allowed anyway</header>')).toBe(false);
  });

  it('is false for empty content', () => {
    expect(needsHtmlView('')).toBe(false);
  });
});

describe('tidyHtmlForSource', () => {
  it('puts each block of the editor\'s one-line output on its own line', () => {
    const oneLine = '<h2>Title</h2><p>First</p><ul><li>One</li><li>Two</li></ul><p>Last</p>';
    expect(tidyHtmlForSource(oneLine)).toBe(
      '<h2>Title</h2>\n<p>First</p>\n<ul>\n<li>One</li>\n<li>Two</li>\n</ul>\n<p>Last</p>',
    );
  });

  it('changes only white space between tags, never the content', () => {
    const oneLine = '<p class="mb-2" dir="ltr"><span style="white-space: pre-wrap;">A  B</span></p><p>C</p>';
    expect(tidyHtmlForSource(oneLine).replace(/\n/g, '')).toBe(oneLine);
  });

  it('leaves HTML a person already laid out exactly as it is', () => {
    const written = '<h2>Title</h2>\n\n<p>First</p><p>Second</p>';
    expect(tidyHtmlForSource(written)).toBe(written);
  });

  it('returns empty content unchanged', () => {
    expect(tidyHtmlForSource('')).toBe('');
  });
});
