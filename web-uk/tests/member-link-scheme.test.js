// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-207: member-supplied link URLs reached `href` with any scheme — idea media
 * links in the ideation page, and message attachments / feed media through
 * resolveBackendMediaUrl. Only the content-security-policy stood between a
 * `javascript:` link and a script running on the accessible site. Now only an
 * http(s) address (or a path on the API's own origin) becomes a link.
 */
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { resolveBackendMediaUrl } = require('../src/lib/accessible-shell');

describe('resolveBackendMediaUrl refuses non-web schemes (F-207)', () => {
  it.each([
    'javascript:alert(document.domain)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/x.png',
    '\\\\evil.example\\x.png',
    '/\\evil.example/x.png'
  ])('returns nothing usable for %j', (value) => {
    const resolved = resolveBackendMediaUrl(value);
    expect(resolved === '' || resolved.startsWith('http://127.0.0.1:8090/')).toBe(true);
    expect(resolved.toLowerCase()).not.toMatch(/^(javascript|data|vbscript|file):/);
  });

  it('keeps http(s) media and API-relative uploads working', () => {
    expect(resolveBackendMediaUrl('https://cdn.example.test/feed/full.png')).toBe('https://cdn.example.test/feed/full.png');
    expect(resolveBackendMediaUrl('HTTP://cdn.example.test/a.png')).toBe('HTTP://cdn.example.test/a.png');
    expect(resolveBackendMediaUrl('/uploads/messages/file.pdf')).toBe('http://127.0.0.1:8090/uploads/messages/file.pdf');
  });
});

describe('idea media links (F-207)', () => {
  const template = fs.readFileSync(path.join(__dirname, '../src/views/ideation/idea-detail.njk'), 'utf8');
  const start = template.indexOf('{% for item in media %}');
  const end = template.indexOf('{% endfor %}', start) + '{% endfor %}'.length;
  const mediaLoop = template.slice(start, end);
  const env = new nunjucks.Environment(null, { autoescape: true });

  function render(media) {
    return env.renderString(mediaLoop, { media, t: (key) => key });
  }

  it('found the media loop in the template', () => {
    expect(start).toBeGreaterThan(-1);
    expect(mediaLoop).toContain('item.url');
  });

  it('links an https attachment', () => {
    const html = render([{ url: 'https://example.org/plan.pdf', caption: 'Plan', typeLabel: 'Document' }]);
    expect(html).toContain('href="https://example.org/plan.pdf"');
  });

  it.each([
    'javascript:alert(document.domain)',
    '  JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/x'
  ])('shows %j as text, never as a link', (url) => {
    const html = render([{ url, caption: 'Open me', typeLabel: 'Link' }]);
    expect(html).not.toContain('href=');
    expect(html).toContain('Open me');
  });
});
