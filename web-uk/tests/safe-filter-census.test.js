// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// F-315: `| safe` switches off Nunjucks autoescaping. On member-entered text it
// is stored cross-site scripting against every reader, on three live hostnames.
// tests/nl2br-safe-pairing.test.js pins only the other direction (nl2br output
// must carry | safe), so a template gaining `{{ member.bio | safe }}` shipped
// green. This test enumerates EVERY `| safe` in every template and allows it
// only when
//
//   1. the filter immediately before it is `nl2br` — src/lib/nl2br.js escapes
//      its input first, so the value is escaped regardless of what the API
//      returns; or
//   2. the site is listed in REVIEWED_RAW_SITES, naming what makes it safe and,
//      where a route sanitises the value, the exact line of source that does.
//      If that line disappears from the route, this test fails.
//
// Adding an entry is a security review, not a formality.

const fs = require('fs');
const path = require('path');

const WEB_UK = path.join(__dirname, '..');
const VIEWS = path.join(WEB_UK, 'src', 'views');

const CMS = 'sanitizeCmsHtml() allow-list sanitiser (tests/html-sanitizer.test.js)';

const REVIEWED_RAW_SITES = {
  'blog/detail.njk {{ articleStructuredData | safe }}': {
    why: 'JSON-LD inside <script>; scriptSafeJson escapes < > & so a title cannot close the tag',
    guard: ['src/routes/blog-posts.js', 'return scriptSafeJson(data);'],
  },
  'blog/detail.njk {{ post.content | safe }}': {
    why: CMS,
    guard: ['src/routes/blog-posts.js', 'content: sanitizeCmsHtml(post.content || post.body),'],
  },
  'courses/learn.njk {{ currentLesson.body | safe }}': {
    why: CMS,
    guard: ['src/routes/courses.js', 'body: sanitizeCmsHtml(lesson.body),'],
  },
  'custom-page.njk {{ page.content | safe }}': {
    why: CMS,
    guard: ['src/routes/static-pages.js', "content: sanitizeCmsHtml(page.content || ''),"],
  },
  'kb/article.njk {{ article.content | safe }}': {
    why: CMS,
    guard: ['src/routes/kb.js', 'content: sanitizeCmsHtml(row.content),'],
  },
  'support/help.njk {{ faq.answer | safe }}': {
    why: CMS,
    guard: ['src/routes/support.js', 'answer: sanitizeCmsHtml(faq && faq.answer)'],
  },
  'legal/document.njk {{ document.content | safe }}': {
    why: CMS,
    guard: ['src/routes/legal.js', 'withHeadingAnchors(sanitizeCmsHtml(row.content))'],
  },
  'legal/version.njk {{ document.content | safe }}': {
    why: CMS,
    guard: ['src/routes/legal.js', 'withHeadingAnchors(sanitizeCmsHtml(row.content))'],
  },
  'legal/accessibility.njk {{ document.content | safe }}': {
    why: CMS,
    guard: ['src/routes/legal.js', 'withHeadingAnchors(sanitizeCmsHtml(row.content))'],
  },
  'legal/compare.njk {{ diffHtml | safe }}': {
    why: 'sanitizeDiffHtml() allows only <ins>/<del>/<span>/<br> (tests/html-sanitizer.test.js)',
    guard: ['src/routes/legal.js', 'diffHtml: sanitizeDiffHtml(comparison?.diff_html),'],
  },
  'organisations-jobs.njk {{ organisationStructuredData | safe }}': {
    why: 'JSON-LD inside <script>; inlineScriptJson escapes < > &',
    guard: ['src/server.js', 'organisationStructuredData: inlineScriptJson(structuredData),'],
  },
  'venues/pass.njk {{ qrSvg | safe }}': {
    why: 'system-generated QR SVG; the pass URL is encoded into rectangles, never emitted as text',
    guard: ['src/routes/venues.js', 'qrSvg: passQrSvg(pass.qr_url),'],
  },
  // Gap B6 (7 Oct 2026): the volunteer's shift check-in QR. Same renderer as the venue
  // pass (src/lib/qr-svg.js, fixed colours and sizes); the API's qr_url is encoded into
  // rectangles and never emitted as text (tests/qr-svg.test.js pins that).
  'volunteer-opportunity.njk {{ opportunity.checkin.qrSvg | safe }}': {
    why: 'system-generated QR SVG from src/lib/qr-svg.js; the check-in URL is encoded into rectangles, never emitted as text',
    guard: ['src/server.js', "qrSvg: status === 'checked_out' ? null : qrSvg(data?.qr_url),"],
  },
  'public-info/changelog-release.njk {{ release.html | safe }}': {
    why: "build artefact from the repository's own CHANGELOG.md, sanitised at build time",
    guard: ['scripts/build-changelog.js', 'const html = sanitizeCmsHtml('],
  },
  'register.njk {{ t("auth.terms_label", { terms: termsLink, privacy: privacyLink }) | safe }}': {
    why: 'both replacements are {% set %} captures of autoescaped static markup; t() substitutes raw',
  },
  'ideation/tags.njk {{ t("govuk_alpha_ideation.tags.selected_heading", { tag: selectedTag | escape }) | safe }}': {
    why: 'the only replacement is escaped inside the t() argument',
  },
  'ideation/tags.njk {{ t("govuk_alpha_ideation.tags.no_matches", { tag: selectedTag | escape }) | safe }}': {
    why: 'the only replacement is escaped inside the t() argument',
  },
  'feed/index.njk {{ likeForm | safe }}': {
    why: '{% set likeForm %} capture of autoescaped template output',
  },
  'feed/index.njk {{ reaction.symbol | safe }}': {
    why: 'literal HTML-entity array hard-coded in the template',
  },
  'feed/item.njk {{ reaction.symbol | safe }}': {
    why: 'literal HTML-entity array hard-coded in the template',
  },
  'feed/post.njk {{ reaction.symbol | safe }}': {
    why: 'literal HTML-entity array hard-coded in the template',
  },
  'feed/hashtag.njk {{ reaction.symbol | safe }}': {
    why: 'literal HTML-entity array hard-coded in the template',
  },
  'feed/_comments.njk {{ reaction.symbol | safe }}': {
    why: 'literal HTML-entity array hard-coded in the template',
  },
};

function templatesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return templatesUnder(entryPath);
    return entry.isFile() && entry.name.endsWith('.njk') ? [entryPath] : [];
  });
}

function stripTemplateComments(source) {
  return source.replace(/\{#[\s\S]*?#\}/g, (m) => m.replace(/[^\n]/g, ' '));
}

// Every `{{ … }}` and `{% … %}`, found with a brace counter so an expression
// holding a dict literal (`t("x", { a: b }) | safe`) is not skipped.
function tagExpressions(source) {
  const found = [];
  for (let i = 0; i < source.length - 1; i += 1) {
    const open = source.slice(i, i + 2);
    if (open !== '{{' && open !== '{%') continue;
    const close = open === '{{' ? '}}' : '%}';
    let depth = 0;
    let j = i + 2;
    for (; j < source.length - 1; j += 1) {
      if (depth === 0 && source.slice(j, j + 2) === close) break;
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') depth -= 1;
    }
    if (j >= source.length - 1) break;
    found.push({ start: i, open, close, body: source.slice(i + 2, j) });
    i = j + 1;
  }
  return found;
}

// `| nl2br | safe` (optionally `| striptags | nl2br | safe`): the filter right
// before `safe` must be nl2br, which escapes.
const ESCAPED_BEFORE_SAFE = /\|\s*nl2br\s*\|\s*safe\b/g;
const ANY_SAFE = /\|\s*safe\b/g;

function safeSites(source, templateName) {
  const sites = [];
  const code = stripTemplateComments(source);
  for (const tag of tagExpressions(code)) {
    const total = (tag.body.match(ANY_SAFE) || []).length;
    if (total === 0) continue;
    const escaped = (tag.body.match(ESCAPED_BEFORE_SAFE) || []).length;
    const line = code.slice(0, tag.start).split('\n').length;
    const normalised = `${tag.open} ${tag.body.replace(/\s+/g, ' ').trim()} ${tag.close}`;
    sites.push({
      key: `${templateName} ${normalised}`,
      where: `${templateName}:${line} ${normalised}`,
      unescaped: total - escaped,
    });
  }
  return sites;
}

function allSites() {
  return templatesUnder(VIEWS).flatMap((file) => safeSites(
    fs.readFileSync(file, 'utf8'),
    path.relative(VIEWS, file).split(path.sep).join('/'),
  ));
}

describe('F-315 every | safe is escaped in the template or reviewed', () => {
  it('allows | safe only after nl2br or at a reviewed site', () => {
    const offenders = allSites()
      .filter((site) => site.unescaped > 0 && !REVIEWED_RAW_SITES[site.key])
      .map((site) => site.where);
    expect(offenders).toEqual([]);
  });

  it('has no stale reviewed entry', () => {
    const live = new Set(allSites().filter((site) => site.unescaped > 0).map((site) => site.key));
    expect(Object.keys(REVIEWED_RAW_SITES).filter((key) => !live.has(key))).toEqual([]);
  });

  it('still finds the protecting line of source for every sanitised site', () => {
    const missing = [];
    for (const [key, entry] of Object.entries(REVIEWED_RAW_SITES)) {
      if (!entry.guard) continue;
      const [file, needle] = entry.guard;
      const source = fs.readFileSync(path.join(WEB_UK, file), 'utf8');
      if (!source.includes(needle)) missing.push(`${key} -> ${file}: ${needle}`);
    }
    expect(missing).toEqual([]);
  });

  it('actually sees the templates (the matcher cannot silently find nothing)', () => {
    const sites = allSites();
    expect(sites.length).toBeGreaterThan(50);
    expect(sites.filter((site) => site.unescaped === 0).length).toBeGreaterThan(30);
  });

  it('flags member text emitted raw, which the nl2br pairing test cannot see', () => {
    const fixture = [
      '{# {{ ignored | safe }} #}',
      '<p>{{ member.bio | safe }}</p>',
      '<p>{{ member.bio | nl2br | safe }}</p>',
      '<p>{{ member.bio | striptags | safe }}</p>',
      '{% set raw = member.bio | safe %}',
      '{{ govukInsetText({ html: member.bio | safe }) }}',
      '{{ t("x", { name: member.name }) | safe }}',
    ].join('\n');
    expect(safeSites(fixture, 'fixture.njk').filter((s) => s.unescaped > 0).map((s) => s.where)).toEqual([
      'fixture.njk:2 {{ member.bio | safe }}',
      'fixture.njk:4 {{ member.bio | striptags | safe }}',
      'fixture.njk:5 {% set raw = member.bio | safe %}',
      'fixture.njk:6 {{ govukInsetText({ html: member.bio | safe }) }}',
      'fixture.njk:7 {{ t("x", { name: member.name }) | safe }}',
    ]);
  });
});
