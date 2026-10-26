// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The Help Centre guides on the accessible site.
 *
 * Content and structure are GENERATED from the React Help Centre — see
 * scripts/build-help-guides.js. This module only reads that copy and reproduces
 * React's rules for it:
 *
 * - which sections and articles a community sees (react-frontend
 *   src/pages/help/guides/registry.ts `visibleSections`), evaluated here against
 *   the tenant bootstrap with `flagEnabled`, the same feature/module switches the
 *   rest of the shell uses;
 * - the article body format (react-frontend HelpBody.tsx): paragraphs, `##`
 *   headings, `-` bullets, `1.` steps, `>` tips, `**bold**` and `[text](/path)`.
 *   Bodies are turned into plain data and rendered by an autoescaping template,
 *   never into HTML strings, so translated text cannot inject markup;
 * - search (react-frontend searchText.ts / useHelpGuides.ts): accents and case
 *   ignored, every word must start a word somewhere in the guide, scored by where
 *   it was found.
 */

const path = require('node:path');

const { flagEnabled } = require('./accessible-shell');
const { localeForIntl } = require('./localization');
const { accessibleHelpLink } = require('./help-guide-links');

const GENERATED_DIR = path.join(__dirname, 'generated', 'help-guides');
const structure = require('./generated/help-guides/structure.json');

const AUDIENCES = Object.freeze([...structure.audiences]);
const FALLBACK_LOCALE = 'en';

/**
 * React's TenantContext defaults for gate keys the shell's featureDefaults does
 * not list. Everything else falls through to featureDefaults / moduleDefaults,
 * and a key nobody knows is OFF, as React's `features[key] ?? false` is.
 */
const REACT_FEATURE_DEFAULTS = Object.freeze({
  two_factor_authentication: true,
  biometric_login: true,
  explore: true,
  event_attendance_credits: false
});

const textCache = new Map();

function textFor(locale) {
  const wanted = structure.locales.includes(locale) ? locale : FALLBACK_LOCALE;
  if (!textCache.has(wanted)) {
    textCache.set(wanted, require(path.join(GENERATED_DIR, `${wanted}.json`)));
  }
  return textCache.get(wanted);
}

function isAudience(value) {
  return typeof value === 'string' && AUDIENCES.includes(value);
}

/**
 * The gate context for one request.
 *
 * @param {object} tenant  tenant bootstrap (req.accessibleRouting.tenant)
 * @param {object} settings  community settings that are not features or modules;
 *   `exchange_workflow` comes from GET /api/v2/exchanges/config for a signed-in
 *   member. Unknown (signed out, or the call failed) counts as ON, as in React.
 */
function gateContext(tenant, settings = {}) {
  const safeTenant = tenant && typeof tenant === 'object' ? tenant : {};
  return {
    hasFeature: (key) => flagEnabled(safeTenant, key, 'features', REACT_FEATURE_DEFAULTS[key] ?? false),
    hasModule: (key) => flagEnabled(safeTenant, key, 'modules', false),
    hasSetting: (key) => (typeof settings[key] === 'boolean' ? settings[key] : true)
  };
}

function isGateOpen(gate, ctx) {
  if (!gate) return true;
  if (Array.isArray(gate.any)) return gate.any.some((part) => isGateOpen(part, ctx));
  if (Array.isArray(gate.all)) return gate.all.every((part) => isGateOpen(part, ctx));
  if (gate.feature) return ctx.hasFeature(gate.feature);
  if (gate.module) return ctx.hasModule(gate.module);
  if (gate.setting) return ctx.hasSetting(gate.setting);
  return true;
}

/** Sections (with their open articles) this community has, in display order. */
function visibleSections(audience, ctx) {
  if (!isAudience(audience)) return [];
  return structure.registry[audience]
    .filter((section) => isGateOpen(section.gate, ctx))
    .map((section) => ({
      ...section,
      articles: section.articles.filter((article) => isGateOpen(article.gate, ctx))
    }))
    .filter((section) => section.articles.length > 0);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function interpolate(value, params = {}) {
  return String(value).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
}

/**
 * A Help Centre chrome string (help_centre.json), with i18next-style `{{name}}`
 * interpolation and `_one` / `_other` (etc.) plurals when `count` is given.
 */
function centreText(locale, key, params = {}) {
  const centre = textFor(locale).centre || {};
  const english = textFor(FALLBACK_LOCALE).centre || {};
  const candidates = [];

  if (typeof params.count === 'number') {
    let category = 'other';
    try {
      category = new Intl.PluralRules(localeForIntl(locale)).select(params.count);
    } catch {
      category = 'other';
    }
    candidates.push(`${key}_${category}`, `${key}_other`);
  }
  candidates.push(key);

  for (const candidate of candidates) {
    const found = candidateValue(centre, english, candidate);
    if (found !== undefined) return interpolate(found, params);
  }
  return key;
}

function candidateValue(centre, english, key) {
  const read = (source) => key.split('.').reduce((value, part) => (
    value && typeof value === 'object' ? value[part] : undefined
  ), source);
  const local = read(centre);
  if (typeof local === 'string') return local;
  const fallback = read(english);
  return typeof fallback === 'string' ? fallback : undefined;
}

function sectionText(locale, audience, sectionId) {
  const sections = (textFor(locale).guides || {})[audience] || {};
  return sections[sectionId] || { title: sectionId, summary: '', articles: {} };
}

function articleText(locale, audience, sectionId, articleId) {
  const section = sectionText(locale, audience, sectionId);
  return (section.articles || {})[articleId] || { title: articleId, summary: '', body: '' };
}

// ---------------------------------------------------------------------------
// Article bodies (react-frontend HelpBody.tsx)
// ---------------------------------------------------------------------------

function classify(line) {
  if (line.trim() === '') return 'blank';
  if (/^##\s+/.test(line)) return 'heading';
  if (/^\s*[-•]\s+/.test(line)) return 'bullet';
  if (/^\s*\d+[.)]\s+/.test(line)) return 'step';
  if (/^\s*>\s?/.test(line)) return 'tip';
  return 'text';
}

function stripMarker(kind, line) {
  switch (kind) {
    case 'heading': return line.replace(/^##\s+/, '');
    case 'bullet': return line.replace(/^\s*[-•]\s+/, '');
    case 'step': return line.replace(/^\s*\d+[.)]\s+/, '');
    case 'tip': return line.replace(/^\s*>\s?/, '');
    default: return line.trim();
  }
}

/** Groups body lines into blocks; consecutive lines of one kind form one block. */
function parseHelpBody(body) {
  const blocks = [];
  let current = null;
  for (const raw of String(body || '').replace(/\r\n?/g, '\n').split('\n')) {
    const kind = classify(raw);
    if (kind === 'blank') {
      current = null;
      continue;
    }
    if (current && current.kind === kind && kind !== 'heading') {
      current.lines.push(stripMarker(kind, raw));
      continue;
    }
    current = { kind, lines: [stripMarker(kind, raw)] };
    blocks.push(current);
  }
  return blocks;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

function isInternalPath(value) {
  return value.startsWith('/') && !value.startsWith('//');
}

/**
 * Inline segments of one line: text, bold, or a link. A link keeps its target
 * only when it is an internal path that maps to a page on this site; otherwise
 * its words stay as plain text, as React does for a non-internal link.
 */
function inlineTokens(text) {
  return String(text).split(INLINE_PATTERN).filter(Boolean).map((part) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) return { type: 'bold', text: bold[1] };
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = isInternalPath(link[2]) ? accessibleHelpLink(link[2]) : null;
      return href ? { type: 'link', text: link[1], href } : { type: 'text', text: link[1] };
    }
    return { type: 'text', text: part };
  });
}

/**
 * The body as render-ready blocks. Headings get stable ids so the article's
 * contents list can link to them without JavaScript.
 */
function renderableBody(body) {
  let headingIndex = 0;
  return parseHelpBody(body).map((block) => {
    if (block.kind === 'heading') {
      headingIndex += 1;
      return {
        kind: 'heading',
        id: `guide-section-${headingIndex}`,
        text: plainInline(block.lines[0] || ''),
        tokens: inlineTokens(block.lines[0] || '')
      };
    }
    if (block.kind === 'bullet' || block.kind === 'step') {
      return { kind: block.kind, items: block.lines.map(inlineTokens) };
    }
    return { kind: block.kind, tokens: inlineTokens(block.lines.join(' ')) };
  });
}

function plainInline(text) {
  return String(text)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1');
}

/** Plain text of a body, for search. */
function helpBodyToPlainText(body) {
  return plainInline(parseHelpBody(body).map((block) => block.lines.join(' ')).join(' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Search (react-frontend searchText.ts)
// ---------------------------------------------------------------------------

function foldText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const NO_WORD_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function hasWord(text, word) {
  if (NO_WORD_SPACES.test(word)) return text.includes(word);
  let from = text.indexOf(word);
  while (from !== -1) {
    if (from === 0 || !LETTER_OR_DIGIT.test(text.charAt(from - 1))) return true;
    from = text.indexOf(word, from + 1);
  }
  return false;
}

function queryWords(query) {
  return foldText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 || NO_WORD_SPACES.test(word));
}

const foldedCache = new Map();

function foldedArticle(locale, audience, sectionId, articleId) {
  const key = `${locale}|${audience}|${sectionId}|${articleId}`;
  if (!foldedCache.has(key)) {
    const article = articleText(locale, audience, sectionId, articleId);
    foldedCache.set(key, {
      title: foldText(article.title),
      summary: foldText(article.summary),
      section: foldText(sectionText(locale, audience, sectionId).title),
      body: foldText(helpBodyToPlainText(article.body))
    });
  }
  return foldedCache.get(key);
}

/** Every visible guide containing all the words searched for, best first. */
function searchGuides(locale, query, ctx) {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const results = [];
  for (const audience of AUDIENCES) {
    for (const section of visibleSections(audience, ctx)) {
      for (const article of section.articles) {
        const folded = foldedArticle(locale, audience, section.id, article.id);
        let score = 0;
        let allFound = true;
        for (const word of words) {
          let wordScore = 0;
          if (hasWord(folded.title, word)) wordScore += 6;
          if (hasWord(folded.summary, word)) wordScore += 3;
          if (hasWord(folded.section, word)) wordScore += 2;
          if (hasWord(folded.body, word)) wordScore += 1;
          if (wordScore === 0) {
            allFound = false;
            break;
          }
          score += wordScore;
        }
        if (allFound) {
          const text = articleText(locale, audience, section.id, article.id);
          results.push({
            audience,
            sectionId: section.id,
            articleId: article.id,
            title: text.title,
            summary: text.summary,
            sectionTitle: sectionText(locale, audience, section.id).title,
            score
          });
        }
      }
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

function helpPath(audience, sectionId, articleId) {
  const parts = ['/help', audience];
  if (sectionId) parts.push(sectionId);
  if (articleId) parts.push(articleId);
  return parts.join('/');
}

/** Where an audience's page is: members' guides are the Help Centre home. */
function audiencePath(audience) {
  return audience === 'members' ? '/help' : helpPath(audience);
}

module.exports = {
  AUDIENCES,
  REACT_FEATURE_DEFAULTS,
  articleText,
  audiencePath,
  centreText,
  foldText,
  gateContext,
  helpBodyToPlainText,
  helpPath,
  inlineTokens,
  isAudience,
  isGateOpen,
  parseHelpBody,
  queryWords,
  renderableBody,
  searchGuides,
  sectionText,
  structure,
  visibleSections
};
