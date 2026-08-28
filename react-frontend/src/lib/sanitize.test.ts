// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { __testing, htmlToPlainText, sanitizeCustomPageHtml, sanitizeInline, sanitizeRichText, stripHtmlToText } from './sanitize';

const { isSafeUrl } = __testing;

describe('sanitizeRichText', () => {
  it('returns an empty string for nullish input', () => {
    expect(sanitizeRichText(null)).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
    expect(sanitizeRichText('')).toBe('');
  });

  it('keeps allowed block-level rich content', () => {
    const out = sanitizeRichText('<h2>Title</h2><p>Body <strong>bold</strong></p><ul><li>x</li></ul>');
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<li>x</li>');
  });

  it('strips <script> tags but keeps surrounding content', () => {
    const out = sanitizeRichText('<p>safe</p><script>alert(1)</script>');
    expect(out).toContain('safe');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('forces safe anchor attributes', () => {
    const out = sanitizeRichText('<a href="https://example.com">link</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('href="https://example.com"');
  });

  it('strips javascript: hrefs', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('adds lazy loading and no-referrer to images', () => {
    const out = sanitizeRichText('<img src="https://example.com/a.png" alt="a">');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('referrerpolicy="no-referrer"');
  });

  it('strips data: image sources', () => {
    const out = sanitizeRichText('<img src="data:image/png;base64,AAAA" alt="a">');
    expect(out).not.toContain('data:image');
  });
});

describe('sanitizeInline', () => {
  it('returns empty string for nullish input', () => {
    expect(sanitizeInline(null)).toBe('');
    expect(sanitizeInline('')).toBe('');
  });

  it('keeps inline emphasis tags', () => {
    expect(sanitizeInline('Hello <strong>world</strong>')).toContain('<strong>world</strong>');
  });

  it('unwraps disallowed block tags but keeps their text', () => {
    const out = sanitizeInline('<div><p>only text</p></div>');
    expect(out).toContain('only text');
    expect(out).not.toContain('<div');
    expect(out).not.toContain('<p>');
  });
});

describe('sanitizeCustomPageHtml', () => {
  it('wraps builder content and scopes style rules to the custom page container', () => {
    const out = sanitizeCustomPageHtml('<style>.hero{color:red}@media(max-width:600px){.hero{color:blue}}</style><section class="hero">Hi</section>');
    const doc = new DOMParser().parseFromString(out, 'text/html');

    expect(out).toContain('class="nexus-custom-page-builder"');
    expect(doc.querySelectorAll('div.nexus-custom-page-builder')).toHaveLength(1);
    expect(doc.querySelector('.nexus-custom-page-builder .nexus-custom-page-builder')).toBeNull();
    expect(out).toContain('.nexus-custom-page-builder .hero{color:red}');
    expect(out).toMatch(/@media\s*\(max-width:\s*600px\)\{\.nexus-custom-page-builder \.hero\{color:blue\}/);
    expect(out).toContain('<section class="hero">Hi</section>');
  });

  it('drops global selectors and unsafe inline styles so builder pages cannot restyle the app shell', () => {
    const out = sanitizeCustomPageHtml('<style>body{display:none}.safe{color:green;position:fixed;inset:0;z-index:9999}#root{opacity:0}</style><div class="safe" style="position:fixed;inset:0">Safe</div>');

    expect(out).toContain('.nexus-custom-page-builder .safe{color:green}');
    expect(out).not.toContain('body{');
    expect(out).not.toContain('#root');
    expect(out).not.toContain('style="');
    expect(out).not.toContain('position:fixed');
    expect(out).not.toContain('z-index');
  });

  it('keeps safe inline styles from pasted custom HTML', () => {
    const out = sanitizeCustomPageHtml(
      '<section style="background:#f7faf8;color:#10201a;padding:32px;border-radius:12px"><h1 style="font-size:42px;line-height:1.1">Hello</h1></section>',
    );

    expect(out).toContain('style="background:#f7faf8;color:#10201a;padding:32px;border-radius:12px"');
    expect(out).toContain('style="font-size:42px;line-height:1.1"');
  });

  it('adds a scoped theme baseline for custom page builder pages', () => {
    const out = sanitizeCustomPageHtml('<section class="hero">Hi</section>');

    expect(out).toContain('.nexus-custom-page-builder{background:var(--background,#ffffff);color:var(--foreground,#111827);color-scheme:inherit}');
    expect(out).toContain('.nexus-custom-page-builder a{color:var(--accent-color,var(--color-accent,#0891b2))}');
    expect(out).toContain('class="nexus-custom-page-builder"');
  });

  it('tokenizes legacy NEXUS starter block colours when old builder CSS is rendered publicly', () => {
    const out = sanitizeCustomPageHtml(`
      <style>
        .nexus-page-section{background:#ffffff;color:#111827}
        .nexus-page-section:nth-child(even){background:#f7faf8}
        .nexus-page-hero h1{color:#10201a}
        .nexus-page-button{background:#047857;color:#fff}
      </style>
      <section class="nexus-page-section"><a class="nexus-page-button" href="/">Start</a></section>
    `);

    expect(out).toContain('.nexus-custom-page-builder .nexus-page-section{background:var(--background,#ffffff);color:var(--foreground,#111827)}');
    expect(out).toContain('.nexus-custom-page-builder .nexus-page-section:nth-child(even){background:var(--surface-elevated,rgba(255,255,255,.9))}');
    expect(out).toContain('.nexus-custom-page-builder .nexus-page-hero h1{color:var(--foreground,#111827)}');
    expect(out).toContain('.nexus-custom-page-builder .nexus-page-button{background:var(--accent-color,var(--color-accent,#0891b2));color:var(--accent-foreground,#fff)}');
    expect(out).not.toContain('background:#ffffff');
    expect(out).not.toContain('color:#111827');
  });

  it('emits NEXUS starter theme overrides after saved CSS so legacy pages can follow dark mode', () => {
    const out = sanitizeCustomPageHtml(`
      <style>
        .nexus-page-section{padding:88px 18%;background:#ffffff;color:#111827}
        .nexus-page-hero{background:linear-gradient(135deg,#f6fbf8 0%,#eef6ff 55%,#fff7ed 100%)}
        .nexus-page-kicker{color:#047857}
        .nexus-page-hero h1{color:#10201a}
        .nexus-page-lede{color:#40524a}
        .nexus-page-button{background:#047857;color:#fff}
      </style>
      <section class="nexus-page-section nexus-page-hero">
        <p class="nexus-page-kicker">Community Page</p>
        <h1>Build a beautiful custom page</h1>
        <p class="nexus-page-lede">Use sections, cards, images and calls to action.</p>
        <a class="nexus-page-button" href="/">Explore the community</a>
      </section>
    `);

    const savedHeroRuleIndex = out.indexOf(
      '.nexus-custom-page-builder .nexus-page-hero{background:linear-gradient(135deg,var(--surface-elevated,rgba(255,255,255,.9))',
    );
    const overrideHeroRuleIndex = out.lastIndexOf(
      '.nexus-custom-page-builder .nexus-page-hero{background:linear-gradient(135deg,var(--surface-elevated,rgba(255,255,255,.9))',
    );
    const savedHeadingRuleIndex = out.indexOf('.nexus-custom-page-builder .nexus-page-hero h1{color:var(--foreground,#111827)}');
    const overrideHeadingRuleIndex = out.indexOf(
      '.nexus-custom-page-builder .nexus-page-hero h1,.nexus-custom-page-builder .nexus-page-card h2{color:var(--foreground,#111827)}',
    );

    expect(savedHeroRuleIndex).toBeGreaterThanOrEqual(0);
    expect(overrideHeroRuleIndex).toBeGreaterThan(savedHeroRuleIndex);
    expect(overrideHeadingRuleIndex).toBeGreaterThan(savedHeadingRuleIndex);
    expect(out).not.toContain('#f6fbf8');
    expect(out).not.toContain('#eef6ff');
    expect(out).not.toContain('#fff7ed');
    expect(out).not.toContain('#10201a');
  });

  it('removes dangerous inline CSS while preserving safe declarations in the same attribute', () => {
    const out = sanitizeCustomPageHtml(
      '<div style="color:green;position:fixed;inset:0;z-index:9999;background:url(javascript:alert(1))">Safe text</div>',
    );

    expect(out).toContain('style="color:green"');
    expect(out).not.toContain('position:fixed');
    expect(out).not.toContain('inset:0');
    expect(out).not.toContain('z-index');
    expect(out).not.toContain('javascript:');
  });

  it('strips app-shell escape declarations even when they use important priorities', () => {
    const out = sanitizeCustomPageHtml(`
      <style>
        .overlay {
          color: green;
          position: fixed !important;
          inset: 0 !important;
          z-index: 2147483647 !important;
        }
        .sticky { position: sticky !important; top: 0; }
      </style>
      <section class="overlay"><div class="sticky">Safe</div></section>
    `);

    expect(out).toContain('.nexus-custom-page-builder .overlay{color:green}');
    expect(out).not.toContain('position:fixed');
    expect(out).not.toContain('position:sticky');
    expect(out).not.toContain('inset:0');
    expect(out).not.toContain('z-index');
    expect(out).toContain('top:0');
  });

  it('keeps parsed declaration values with semicolons inside strings', () => {
    const out = sanitizeCustomPageHtml('<style>.quote::before{content:"a;b";color:purple}</style><p class="quote">Quote</p>');

    expect(out).toContain('.nexus-custom-page-builder .quote::before{content:"a;b";color:purple}');
  });

  it('scopes selector lists and nested media/supports rules while dropping app globals', () => {
    const out = sanitizeCustomPageHtml(`
      <style>
        .hero, main .panel, body { color: red; }
        @media (min-width: 800px) {
          .hero { display: grid; }
          #root { display: none; }
        }
        @supports (display: grid) {
          .grid { display: grid; }
        }
        @font-face { font-family: Bad; src: url(/bad.woff2); }
      </style>
      <main><section class="hero"><div class="grid">Grid</div></section></main>
    `);

    expect(out).toContain('.nexus-custom-page-builder .hero,.nexus-custom-page-builder main .panel{color:red}');
    expect(out).toMatch(/@media\s*\(min-width:\s*800px\)\{\.nexus-custom-page-builder \.hero\{display:grid\}/);
    expect(out).toMatch(/@supports\s*\(display:\s*grid\)\{\.nexus-custom-page-builder \.grid\{display:grid\}/);
    expect(out).not.toContain('body{');
    expect(out).not.toContain('#root');
    expect(out).not.toContain('@font-face');
  });

  it('drops malformed CSS instead of leaking unscoped rules', () => {
    const out = sanitizeCustomPageHtml('<style>.safe{color:green}.broken{position:fixed</style><section class="safe">Safe</section>');

    expect(out).not.toContain('.broken');
    expect(out).not.toContain('position:fixed');
    expect(out).toContain('<section class="safe">Safe</section>');
  });

  it('strips scripts, event handlers, unsafe URLs and dangerous CSS constructs', () => {
    const out = sanitizeCustomPageHtml('<style>.x{background:url(javascript:alert(1))}</style><a href="javascript:alert(1)" onclick="bad()">x</a><script>alert(1)</script>');

    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('consistently strips unsafe CSS across repeated sanitization calls', () => {
    const html = '<style>.x{background:url(javascript:alert(1))}</style><section class="x">Safe</section>';

    expect(sanitizeCustomPageHtml(html)).not.toContain('javascript:');
    expect(sanitizeCustomPageHtml(html)).not.toContain('javascript:');
    expect(sanitizeCustomPageHtml(html)).not.toContain('javascript:');
  });
});

describe('stripHtmlToText', () => {
  it('returns empty string for nullish input', () => {
    expect(stripHtmlToText(null)).toBe('');
    expect(stripHtmlToText(undefined)).toBe('');
  });

  it('removes all tags and returns text content', () => {
    expect(stripHtmlToText('<b>Hi</b> <i>there</i>')).toBe('Hi there');
  });

  it('drops script content entirely', () => {
    const out = stripHtmlToText('<p>keep</p><script>drop()</script>');
    expect(out).toContain('keep');
    expect(out).not.toContain('drop()');
  });
});

describe('isSafeUrl', () => {
  it('accepts absolute http(s) and mailto URLs', () => {
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('https://example.com/path?q=1#a')).toBe(true);
    expect(isSafeUrl('mailto:hi@example.com')).toBe(true);
  });

  it('accepts relative paths and fragments', () => {
    expect(isSafeUrl('/dashboard')).toBe(true);
    expect(isSafeUrl('#section')).toBe(true);
    expect(isSafeUrl('?query=x')).toBe(true);
    expect(isSafeUrl('foo/bar')).toBe(true);
    expect(isSafeUrl('./rel')).toBe(true);
    expect(isSafeUrl('../rel')).toBe(true);
  });

  it('rejects dangerous schemes', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('ftp://example.com')).toBe(false);
  });

  it('rejects empty / whitespace-only values', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });

  it('rejects control-character obfuscated schemes', () => {
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\nscript:alert(1)')).toBe(false);
  });
});

describe('htmlToPlainText', () => {
  /**
   * 🔴 The composer's own output, verbatim from the post a member reported on 2026-08-24.
   * Anything that shows post content as text has to survive this exact string.
   */
  const COMPOSER_HTML =
    '<p class="mb-1 leading-relaxed text-[var(--text-primary)]"><span>So I had a meeting ' +
    'booked in this morning.</span></p><p class="mb-1 leading-relaxed">Then a second ' +
    'paragraph.</p>';

  it('returns an empty string for nullish input', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText(undefined)).toBe('');
    expect(htmlToPlainText('')).toBe('');
  });

  it('shows the words, never the markup', () => {
    const out = htmlToPlainText(COMPOSER_HTML);
    expect(out).not.toContain('<');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('leading-relaxed');
    expect(out).toContain('So I had a meeting booked in this morning.');
    expect(out).toContain('Then a second paragraph.');
  });

  it('keeps paragraphs apart instead of running the sentences together', () => {
    // This is what stripHtmlToText alone gets wrong.
    expect(stripHtmlToText('<p>One</p><p>Two</p>')).toBe('OneTwo');
    expect(htmlToPlainText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
  });

  it('keeps line breaks', () => {
    expect(htmlToPlainText('a<br>b')).toBe('a\nb');
    expect(htmlToPlainText('a<br />b')).toBe('a\nb');
  });

  it('marks list items so they still read as a list', () => {
    expect(htmlToPlainText('<ul><li>one</li><li>two</li></ul>')).toContain('• one');
  });

  it('decodes the entities the stripper leaves encoded', () => {
    expect(htmlToPlainText('<p>Fish &amp; chips</p>')).toBe('Fish & chips');
    expect(htmlToPlainText('<p>a&nbsp;b</p>')).toContain('a');
    expect(htmlToPlainText('<p>&quot;quoted&quot;</p>')).toBe('"quoted"');
  });

  it('drops script content rather than showing it as text', () => {
    const out = htmlToPlainText('<p>keep</p><script>alert(1)</script>');
    expect(out).toContain('keep');
    expect(out).not.toContain('alert(1)');
  });

  it('leaves plain text alone', () => {
    expect(htmlToPlainText('just words')).toBe('just words');
  });
});
