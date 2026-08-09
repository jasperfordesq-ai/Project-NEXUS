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

module.exports = { sanitizeCmsHtml };
