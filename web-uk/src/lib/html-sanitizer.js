// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = Object.freeze([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead',
  'tbody', 'tr', 'th', 'td', 'div', 'span', 'hr', 'figure', 'figcaption'
]);

const ALLOWED_ATTRIBUTES = Object.freeze({
  '*': ['class'],
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  blockquote: ['cite']
});

function sanitizeCmsHtml(value, { allowImages = true } = {}) {
  const allowedTags = allowImages
    ? [...ALLOWED_TAGS]
    : ALLOWED_TAGS.filter((tag) => tag !== 'img');
  return sanitizeHtml(String(value || '').replaceAll('\0', ''), {
    allowedTags,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: attribs.target === '_blank'
          ? { ...attribs, rel: 'noopener noreferrer' }
          : attribs
      })
    }
  });
}

/**
 * Sanitise the version-comparison HTML that `GET /api/v2/legal/versions/compare`
 * returns.
 *
 * 🔴 This needs its OWN allowlist. `sanitizeCmsHtml` mirrors Laravel's
 * `HtmlSanitizer::sanitizeCms()`, and neither permits `ins` or `del` — so running
 * a diff through it strips exactly the two elements that carry the meaning,
 * leaving `class="diff-added"` / `class="diff-removed"` as the only signal. That
 * is a WCAG 1.4.1 failure (information conveyed by presentation alone) and it
 * would also be silent: the page would still look right in a browser with the
 * stylesheet applied.
 *
 * The allowlist here is narrower than the CMS one, not wider: structural
 * elements plus `ins`/`del`, `class` only, and no URLs of any kind. The API
 * already escapes every line of document text before wrapping it.
 */
const ALLOWED_DIFF_TAGS = Object.freeze(['div', 'span', 'ins', 'del', 'br']);

function sanitizeDiffHtml(value) {
  return sanitizeHtml(String(value || '').replaceAll('\0', ''), {
    allowedTags: [...ALLOWED_DIFF_TAGS],
    allowedAttributes: { '*': ['class'] },
    allowedSchemes: [],
    allowProtocolRelative: false
  });
}

/**
 * Build a table of contents for a long document, and give each heading an anchor
 * to link to.
 *
 * Runs on ALREADY-SANITISED html and only ever inserts an `id` built from
 * `[a-z0-9-]`, so it cannot reintroduce anything the sanitiser removed. A heading
 * that already carries an id keeps it, because an existing anchor may already be
 * linked from somewhere outside this app.
 *
 * Server-side on purpose: this must work with JavaScript switched off, which is
 * the whole premise of the accessible frontend.
 */
function withHeadingAnchors(html) {
  const source = String(html || '');
  const headings = [];
  const used = new Set();

  const slugFor = (text, index) => {
    const base = text
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    let candidate = base || `section-${index + 1}`;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base || 'section'}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  };

  const rendered = source.replace(
    /<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attribs, inner) => {
      const label = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (label === '') return match;

      const existing = /\sid\s*=\s*"([^"]*)"/i.exec(attribs);
      const id = existing ? existing[1] : slugFor(label, headings.length);
      if (existing) used.add(id);

      headings.push({ id, label, level: tag.toLowerCase() === 'h2' ? 2 : 3 });
      return existing
        ? match
        : `<${tag}${attribs} id="${id}">${inner}</${tag}>`;
    }
  );

  return { html: rendered, headings };
}

function htmlToPlainText(value) {
  const safeLayoutHtml = sanitizeHtml(String(value || '').replaceAll('\0', ''), {
    allowedTags: ['p', 'br'],
    allowedAttributes: {},
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript']
  });

  return safeLayoutHtml
    .replaceAll('</p>', '\n\n')
    .replaceAll('<p>', '')
    .replaceAll('<br />', '\n')
    .replaceAll('<br>', '\n')
    .trim();
}

module.exports = { sanitizeCmsHtml, sanitizeDiffHtml, withHeadingAnchors, htmlToPlainText };
