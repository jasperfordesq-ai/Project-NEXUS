// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { htmlToPlainText, sanitizeCmsHtml, sanitizeDiffHtml } = require('../src/lib/html-sanitizer');

describe('htmlToPlainText', () => {
  test('preserves readable paragraph boundaries while removing markup', () => {
    expect(htmlToPlainText('<p>Hello <strong>neighbour</strong>.</p><p>Welcome back.<br>Take care.</p>'))
      .toBe('Hello neighbour.\n\nWelcome back.\nTake care.');
  });

  test('drops non-text elements and nested tag-filter bypasses', () => {
    expect(htmlToPlainText('<scr<script>ipt>alert(1)</scr</script>ipt><p>Safe text</p>'))
      .toBe('ipt&gt;alert(1)ipt&gt;Safe text');
    expect(htmlToPlainText('<script>alert(1)</script><style>body{display:none}</style><p>Safe</p>'))
      .toBe('Safe');
  });
});

// F-316: sanitizeCmsHtml() is the only defence for the admin-authored HTML that
// ten `| safe` sites emit (blog, course lessons, knowledge base, legal documents,
// custom pages, support FAQ — see tests/safe-filter-census.test.js), and
// sanitizeDiffHtml() for the legal-version comparison. Before these tests an
// edit widening either allow-list (adding `iframe` for video embeds, or `style`
// for richer formatting) shipped with a green suite.

// Anything that can run script, restyle or overlay the page, submit a form,
// re-base links, or clobber the DOM.
const DANGEROUS_OUTPUT = /<\s*(script|svg|math|style|iframe|frame|object|embed|base|meta|link|form|input|button|textarea|select|video|audio)\b|\son[a-z]+\s*=|\s(style|id|name|srcdoc|srcset|formaction)\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text/i;

describe('sanitizeCmsHtml — hostile input', () => {
  test.each([
    ['script tag', '<script>x=1</script>', ''],
    ['nested tag-filter bypass', '<scr<script>ipt>x=1</scr</script>ipt>', 'ipt&gt;x=1ipt&gt;'],
    ['svg onload', '<svg onload="x=1"></svg>', ''],
    ['math/mglyph mutation', '<math><mglyph><style><img src=x onerror=1>', ''],
    ['style element', '<style>body{display:none}</style>', ''],
    ['style attribute', '<p style="position:fixed;top:0;width:100vw;height:100vh">x</p>', '<p>x</p>'],
    ['id attribute (DOM clobbering)', '<div id="attributes">x</div>', '<div>x</div>'],
    ['form and formaction', '<form action="https://evil.invalid"><button formaction="https://evil.invalid">go</button></form>', 'go'],
    ['form controls', '<input value=x><textarea>t</textarea><select><option>o</option></select>', ''],
    ['javascript: href', '<a href="javascript:x=1">a</a>', '<a>a</a>'],
    ['mixed-case javascript: href', '<a href="JaVaScRiPt:x=1">a</a>', '<a>a</a>'],
    ['entity-obfuscated javascript: href', '<a href="java&#115;cript:x=1">a</a>', '<a>a</a>'],
    ['NUL byte inside the scheme', '<a href="java\u0000script:x=1">a</a>', '<a>a</a>'],
    ['data:text/html href', '<a href="data:text/html,<script>x=1</script>">a</a>', '<a>a</a>'],
    ['data: image as a link', '<a href="data:image/png;base64,AAAA">x</a>', '<a>x</a>'],
    ['protocol-relative href', '<a href="//evil.invalid/x">a</a>', '<a>a</a>'],
    ['javascript: image source', '<img src="javascript:alert(1)">', '<img />'],
    ['img onerror', '<img src=x onerror="x=1">', '<img src="x" />'],
    ['iframe srcdoc', '<iframe srcdoc="<script>x=1</script>"></iframe>', ''],
    ['object and embed', '<object data="x"></object><embed src="x">', ''],
    ['base tag', '<base href="https://evil.invalid/">', ''],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.invalid">', ''],
    ['stylesheet link', '<link rel="stylesheet" href="https://evil.invalid/x.css">', ''],
    ['media elements', '<video src="x"></video><audio src="x"></audio>', ''],
    ['srcset and data attributes', '<p data-x="1">a</p><img srcset="https://x 1x" src="https://example.org/i.png">', '<p>a</p><img src="https://example.org/i.png" />'],
  ])('%s', (_label, input, expected) => {
    const output = sanitizeCmsHtml(input);
    expect(output).toBe(expected);
    expect(output).not.toMatch(DANGEROUS_OUTPUT);
  });

  test('forces rel="noopener noreferrer" on a target="_blank" link, replacing any supplied rel', () => {
    expect(sanitizeCmsHtml('<a href="https://ok.invalid" target="_blank" rel="opener">a</a>'))
      .toBe('<a href="https://ok.invalid" target="_blank" rel="noopener noreferrer">a</a>');
  });

  test('drops NUL bytes before parsing', () => {
    expect(sanitizeCmsHtml('a\u0000b')).toBe('ab');
  });

  test('treats null and undefined as empty', () => {
    expect(sanitizeCmsHtml(null)).toBe('');
    expect(sanitizeCmsHtml(undefined)).toBe('');
  });
});

describe('sanitizeCmsHtml — legitimate editorial markup survives (control)', () => {
  test('keeps text formatting, web, mail and phone links, and images', () => {
    const input = '<p>Hello <strong>world</strong> <em>and</em> <a href="https://example.org/x" title="t">link</a> '
      + '<a href="mailto:a@example.org">m</a> <a href="tel:+15551234567">t</a></p>'
      + '<img src="https://example.org/i.png" alt="A" width="10">';
    expect(sanitizeCmsHtml(input)).toBe(
      '<p>Hello <strong>world</strong> <em>and</em> <a href="https://example.org/x" title="t">link</a> '
      + '<a href="mailto:a@example.org">m</a> <a href="tel:+15551234567">t</a></p>'
      + '<img src="https://example.org/i.png" alt="A" width="10" />'
    );
  });

  test('keeps an inline data: image, which cannot run script as an <img>', () => {
    expect(sanitizeCmsHtml('<img src="data:image/png;base64,AAAA" alt="x">'))
      .toBe('<img src="data:image/png;base64,AAAA" alt="x" />');
  });

  test('keeps tables, headings, lists, quotes and the class attribute', () => {
    const input = '<h2 class="govuk-heading-m">T</h2><ul><li>a</li></ul><blockquote cite="https://example.org">q</blockquote>'
      + '<table><thead><tr><th scope="col" colspan="2">h</th></tr></thead><tbody><tr><td rowspan="1">d</td></tr></tbody></table>';
    expect(sanitizeCmsHtml(input)).toBe(input);
  });

  test('removes images when the caller asks for text-only markup', () => {
    expect(sanitizeCmsHtml('<p>a</p><img src="https://example.org/i.png">', { allowImages: false })).toBe('<p>a</p>');
  });
});

describe('sanitizeDiffHtml', () => {
  test('keeps the ins/del markup that carries the meaning of a comparison (control)', () => {
    const input = '<div class="diff-line"><ins class="diff-added">new</ins><del class="diff-removed">old</del><span>s</span><br></div>';
    expect(sanitizeDiffHtml(input))
      .toBe('<div class="diff-line"><ins class="diff-added">new</ins><del class="diff-removed">old</del><span>s</span><br /></div>');
  });

  test('allows no links, images, paragraphs or attributes other than class', () => {
    const input = '<a href="https://x">a</a><img src="https://x"><p>p</p><script>1</script><style>x</style>'
      + '<span style="color:red" onclick="1" id="z">s</span>';
    const output = sanitizeDiffHtml(input);
    expect(output).toBe('ap<span>s</span>');
    expect(output).not.toMatch(DANGEROUS_OUTPUT);
  });

  test.each([
    ['script', '<ins><script>x=1</script>new</ins>', '<ins>new</ins>'],
    ['iframe', '<del><iframe src="https://evil.invalid"></iframe>old</del>', '<del>old</del>'],
    ['svg onload', '<span><svg onload="x=1"></svg>s</span>', '<span>s</span>'],
    ['event handler on an allowed tag', '<ins onmouseover="x=1">n</ins>', '<ins>n</ins>'],
  ])('strips %s', (_label, input, expected) => {
    expect(sanitizeDiffHtml(input)).toBe(expected);
  });

  test('leaves already-escaped document text escaped', () => {
    expect(sanitizeDiffHtml('<ins>&lt;script&gt;</ins>')).toBe('<ins>&lt;script&gt;</ins>');
  });
});
