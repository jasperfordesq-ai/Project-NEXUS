// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Minimal tag scanner for Nunjucks templates.
 *
 * A regular expression cannot find the end of an HTML tag in these templates,
 * because `{% if a > b %}` and `{{ x if y > 0 else 1 }}` put a `>` inside the
 * tag. This walks the source, treats every `{{ }}`, `{% %}` and `{# #}` block
 * as one opaque unit, honours quoted attribute values, and returns the tags the
 * GOV.UK form-pattern checks care about.
 */

const WANTED = /^<(form|input|select|textarea|a|button)(?=[\s/>{])/i;

function skipBlock(src, i) {
  // src[i] is '{' and src[i + 1] is one of { % #. Returns the index just past the block.
  const close = src[i + 1] === '{' ? '}}' : src[i + 1] === '%' ? '%}' : '#}';
  const end = src.indexOf(close, i + 2);
  return end === -1 ? src.length : end + close.length;
}

function scanTags(src) {
  const tags = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{' && (src[i + 1] === '{' || src[i + 1] === '%' || src[i + 1] === '#')) {
      i = skipBlock(src, i);
      continue;
    }
    if (ch === '<' && src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (ch === '<') {
      const head = src.slice(i, i + 12);
      const m = WANTED.exec(head);
      if (m) {
        let j = i + 1;
        let quote = null;
        while (j < src.length) {
          const c = src[j];
          if (c === '{' && (src[j + 1] === '{' || src[j + 1] === '%' || src[j + 1] === '#')) {
            j = skipBlock(src, j);
            continue;
          }
          if (quote) {
            if (c === quote) quote = null;
          } else if (c === '"' || c === "'") {
            quote = c;
          } else if (c === '>') {
            break;
          }
          j += 1;
        }
        tags.push({ name: m[1].toLowerCase(), start: i, end: j + 1, text: src.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return tags;
}

/** Remove Nunjucks blocks from a tag so attribute checks only see HTML. */
function plain(tag) {
  return tag
    .replace(/\{#[\s\S]*?#\}/g, '')
    .replace(/\{\{[\s\S]*?\}\}/g, 'X')
    .replace(/\{%[\s\S]*?%\}/g, ' ');
}

function hasAttr(tagText, name) {
  return new RegExp(String.raw`\s${name}(?=[\s=/>])`, 'i').test(plain(tagText));
}

function attrValue(tagText, name) {
  const m = new RegExp(String.raw`\s${name}\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`, 'i').exec(plain(tagText));
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
}

/** All `attributes: { ... }` object literals passed to GOV.UK macros, by brace depth. */
function macroAttributeBlocks(src) {
  const blocks = [];
  const re = /\b(attributes|inputAttributes)\s*:\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let k = re.lastIndex;
    while (k < src.length && depth > 0) {
      if (src[k] === '{') depth += 1;
      else if (src[k] === '}') depth -= 1;
      k += 1;
    }
    blocks.push({ start: m.index, end: k, text: src.slice(re.lastIndex, k - 1) });
  }
  return blocks;
}

module.exports = { scanTags, plain, hasAttr, attrValue, macroAttributeBlocks };

/**
 * Split the inside of a `{ ... }` object literal into its top-level entries,
 * so a key is only ever read from the start of an entry and never from inside
 * a string or a nested call such as `t("x", { max: 255 })`.
 */
function topLevelEntries(text) {
  const entries = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  const push = (end) => {
    const raw = text.slice(start, end);
    if (raw.trim()) {
      const m = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w-]*))\s*:/.exec(raw);
      entries.push({ start, end, key: m ? (m[1] || m[2] || m[3]) : null });
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if ('{[('.includes(c)) depth += 1;
    else if ('}])'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return entries;
}

module.exports.topLevelEntries = topLevelEntries;
