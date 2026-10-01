// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import {
  sanitizePageBuilderCssForStorage,
  stripUnsafePageBuilderHtml,
} from './pageBuilderHtml';
import { sanitizeCustomPageHtml } from './sanitize';

describe('page builder storage sanitizers', () => {
  it('uses a parser-backed allow-list for malformed and nested hostile markup', () => {
    const result = stripUnsafePageBuilderHtml(`
      <section class="hero" onclick="alert(1)">
        <script><script>alert(1)</script></script>
        <joomla-module><img src="javascript:alert(2)" onerror="alert(3)"></joomla-module>
        <a href="java\tscript:alert(4)">Unsafe link</a>
        <p>Safe content</p>
      </section>
    `);

    expect(result).toContain('<section class="hero">');
    expect(result).toContain('<p>Safe content</p>');
    expect(result).not.toMatch(/<script|onerror|onclick|javascript:/i);
    expect(result).not.toContain('joomla-module');
  });

  it('keeps safe builder markup while applying URL and inline-style policy', () => {
    const result = stripUnsafePageBuilderHtml(`
      <form action="/contact" method="post">
        <a href="https://example.test/about">About</a>
        <img src="/uploads/page.jpg" alt="Page">
        <div style="color:green;position:fixed;z-index:99;background:url(javascript:bad)">Text</div>
      </form>
    `);

    expect(result).toContain('action="/contact"');
    expect(result).toContain('href="https://example.test/about"');
    expect(result).toContain('src="/uploads/page.jpg"');
    expect(result).toContain('style="color:green"');
    expect(result).not.toContain('position:fixed');
    expect(result).not.toContain('z-index');
    expect(result).not.toContain('javascript:');
  });

  describe('F-282: a published form can only send to this site', () => {
    const harvestingForm = (action: string) => `
      <form action="${action}" method="post">
        <label for="pw">Password</label><input id="pw" type="password" name="password">
        <button type="submit">Sign in</button>
        <a href="https://example.test/about">About</a>
      </form>
    `;

    it.each([
      ['an outside web address', 'https://attacker.example/collect'],
      ['a scheme-relative outside address', '//attacker.example/collect'],
      ['a mixed-case outside address', 'HTTPS://Attacker.Example/collect'],
      ['the platform API', '/api/v2/auth/login'],
    ])('drops a form action pointing at %s, when stored and when rendered', (_label, action) => {
      const stored = stripUnsafePageBuilderHtml(harvestingForm(action));
      const rendered = sanitizeCustomPageHtml(harvestingForm(action));

      for (const output of [stored, rendered]) {
        expect(output).not.toContain(action);
        expect(output.toLowerCase()).not.toContain('attacker.example');
        expect(output).not.toMatch(/\saction=/i);
        // Control: an ordinary outbound LINK is still allowed — only where
        // form input is sent is restricted.
        expect(output).toContain('href="https://example.test/about"');
      }
    });

    it('keeps a form action on this site, when stored and when rendered', () => {
      expect(stripUnsafePageBuilderHtml(harvestingForm('/contact'))).toContain('action="/contact"');
      expect(sanitizeCustomPageHtml(harvestingForm('/contact'))).toContain('action="/contact"');
      expect(stripUnsafePageBuilderHtml(harvestingForm(`${window.location.origin}/contact`)))
        .toContain(`action="${window.location.origin}/contact"`);
    });
  });

  it('serializes safe unscoped CSS and drops global, escaped, and active declarations', () => {
    const result = sanitizePageBuilderCssForStorage(`
      body { display:none }
      .hero { color: red; position: fixed; z-index: 100; }
      .escaped { p\\6fsition:fixed; background:u\\72l(javascript:alert(1)); }
      @media (max-width: 600px) { .hero { color: blue } }
    `);

    expect(result).toContain('.hero{color:red}');
    expect(result).toContain('@media (max-width: 600px){.hero{color:blue}}');
    expect(result).not.toContain('body');
    expect(result).not.toContain('position');
    expect(result).not.toContain('z-index');
    expect(result).not.toContain('javascript');
    expect(result).not.toContain('\\');
  });

  it('cannot break out of the stored style element', () => {
    const result = sanitizePageBuilderCssForStorage(
      '.hero{color:red}</style><img src=x onerror=alert(1)><style>.other{color:blue}',
    );

    expect(result).toBe('');
  });
});

// F-499 (E-075): the anti-overlay policy refused three spellings of a full-page
// overlay and permitted a fourth (`position:absolute` with offsets, or a
// non-zero `inset`) — and a community administrator could equally borrow the
// app's own Tailwind classes (`fixed inset-0 z-50`) through `class`. Enumerating
// spellings cannot close that. The rendered page now sits in a frame the
// page's own CSS cannot select, and the frame is a paint-containment boundary:
// nothing inside it — fixed, absolute, any z-index — can paint outside it, so
// published content cannot cover the site's header, menus or footer.
describe('F-499: published builder content cannot paint outside its own area', () => {
  it('wraps the page in a frame that paint-contains everything inside it', () => {
    const out = sanitizeCustomPageHtml('<style>.hero{color:red}</style><section class="hero">Hi</section>');
    const doc = new DOMParser().parseFromString(out, 'text/html');

    const frame = doc.querySelector('div.nexus-page-builder-frame');
    expect(frame).not.toBeNull();
    expect(frame?.querySelector(':scope > div.nexus-custom-page-builder')).not.toBeNull();
    expect(out).toMatch(/\.nexus-page-builder-frame\{[^}]*contain:paint/);
    expect(out).toMatch(/\.nexus-page-builder-frame\{[^}]*isolation:isolate/);
  });

  it('the page\'s own CSS cannot reach the frame to switch containment off', () => {
    const out = sanitizeCustomPageHtml(
      '<style>.nexus-page-builder-frame{contain:none} .x{contain:none}</style><p class="x">Hi</p>',
    );

    // Every author selector is confined under the builder root, so it can
    // never match the frame, which is the root's PARENT: the author's rule
    // survives only in its confined form.
    expect(out).not.toMatch(/(^|[}\n])\.nexus-page-builder-frame\{contain:none/);
    expect(out).toContain('.nexus-custom-page-builder .nexus-page-builder-frame{contain:none}');
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect(doc.querySelector('.nexus-custom-page-builder .nexus-page-builder-frame')).toBeNull();
  });

  it('control: ordinary page styling still renders', () => {
    const out = sanitizeCustomPageHtml('<style>.hero{color:red;position:relative}</style><section class="hero">Hi</section>');
    expect(out).toContain('.nexus-custom-page-builder .hero{color:red;position:relative}');
  });
});

// F-500 (E-075): `@media` / `@supports` preludes were copied verbatim into the
// generated stylesheet, unlike selectors and declarations. A prelude may now
// carry only the characters a media or feature query needs.
describe('F-500: @media and @supports preludes are validated', () => {
  it('drops an at-rule whose prelude carries a brace, a semicolon or an at-sign', () => {
    for (const prelude of ['screen}', 'screen;x', 'screen and (x:y){', '(min-width:1px)@x', 'screen "q"', 'screen \\7d']) {
      const stored = sanitizePageBuilderCssForStorage(`@media ${prelude} { .hero { color: blue } }`);
      expect(stored, prelude).not.toContain('@media');
    }
  });

  it('control: ordinary media and feature queries are kept, stored and rendered', () => {
    const stored = sanitizePageBuilderCssForStorage(`
      @media (max-width: 768px) { .hero { color: blue } }
      @media screen and (min-width: 40em) and (orientation: landscape) { .hero { color: green } }
      @supports (display: grid) and (not (display: inline-grid)) { .hero { display: grid } }
    `);
    expect(stored).toContain('@media (max-width: 768px){.hero{color:blue}}');
    expect(stored).toContain('@media screen and (min-width: 40em) and (orientation: landscape){.hero{color:green}}');
    expect(stored).toContain('@supports (display: grid) and (not (display: inline-grid)){.hero{display:grid}}');

    const rendered = sanitizeCustomPageHtml(`<style>${stored}</style><p class="hero">x</p>`);
    expect(rendered).toContain('@media (max-width: 768px){.nexus-custom-page-builder .hero{color:blue}}');
  });
});
