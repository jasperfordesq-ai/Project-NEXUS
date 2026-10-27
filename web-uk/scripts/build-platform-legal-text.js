// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Build this frontend's copy of the PLATFORM's three legal documents (Project NEXUS
 * itself, not any community): Platform Terms of Service, Platform Privacy Policy and
 * Platform Disclaimer, served at /platform/terms, /platform/privacy and
 * /platform/disclaimer by both frontends.
 *
 * 🔴 WHY THE BODY IS GENERATED FROM REACT'S PAGES AND NOT TRANSLATED INTO lang/*.php.
 * The substantive text of these documents is canonically ENGLISH, by decision: React's
 * three pages carry it as literal JSX with the i18n lint rule switched off and the
 * reason written next to it — "Localized versions, if produced, must be authored by
 * lawyers (not machine-translated)". Each page then tells the reader, in their own
 * language, that the English text is the authoritative version. Only the chrome
 * (titles, section headings, the notices) is translated; that chrome lives in
 * lang/<locale>/govuk_alpha_platform_legal.php like every other accessible page.
 *
 * Copying the body into a PHP namespace would mean ten byte-identical English copies
 * (which the untranslated-value gate rightly refuses), or machine translation of a
 * legal document (which the decision above rules out). A hand-maintained second copy
 * in this frontend would drift from React's the first time either is edited — and two
 * frontends publishing two different sets of terms is a legal problem, not a cosmetic
 * one. So there is one source, React's page files, and this script reads it.
 *
 * The parser is deliberately narrow. It understands exactly the markup those pages use
 * (<p>, <ul>, <li>, <strong>, <em>, <a href>, <br />, {' '} and a few HTML entities)
 * and FAILS on anything else, so a new construct in a React page breaks the check
 * loudly instead of being silently dropped from a legal document.
 *
 * Usage:
 *   node scripts/build-platform-legal-text.js          # write the file
 *   node scripts/build-platform-legal-text.js --check  # fail if it is out of date
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const pagesRoot = path.join(repoRoot, 'react-frontend', 'src', 'pages', 'platform');
const outputPath = path.join(__dirname, '..', 'src', 'lib', 'generated', 'platform-legal-text.json');

const DOCUMENTS = Object.freeze([
  { key: 'terms', file: 'PlatformTermsPage.tsx' },
  { key: 'privacy', file: 'PlatformPrivacyPage.tsx' },
  { key: 'disclaimer', file: 'PlatformDisclaimerPage.tsx' },
]);

const ENTITIES = Object.freeze({
  '&ldquo;': String.fromCharCode(0x201C),
  '&rdquo;': String.fromCharCode(0x201D),
  '&lsquo;': String.fromCharCode(0x2018),
  '&rsquo;': String.fromCharCode(0x2019),
  '&apos;': String.fromCharCode(0x27),
  '&quot;': String.fromCharCode(0x22),
  '&amp;': '&',
  '&euro;': String.fromCharCode(0x20AC),
  '&nbsp;': String.fromCharCode(0xA0),
  '&mdash;': String.fromCharCode(0x2014),
  '&ndash;': String.fromCharCode(0x2013),
});

const MONTHS = Object.freeze({
  January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
  July: '07', August: '08', September: '09', October: '10', November: '11', December: '12',
});

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function decodeEntities(file, value) {
  return value.replace(/&[a-z]+;/g, (entity) => {
    if (!Object.prototype.hasOwnProperty.call(ENTITIES, entity)) {
      fail(file, `unsupported HTML entity ${entity}`);
    }
    return ENTITIES[entity];
  });
}

/**
 * JSX's own whitespace rule for a text child (Babel's cleanJSXElementLiteralChild):
 * every line but the first loses its leading whitespace, every line but the last its
 * trailing whitespace, lines left empty are dropped, and the rest are joined with one
 * space. Reproduced exactly so the text matches what React actually renders, down to
 * where a space does and does not fall next to an inline element.
 */
function jsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = -1;
  lines.forEach((line, index) => { if (/[^ \t]/.test(line)) lastNonEmpty = index; });
  let out = '';
  lines.forEach((line, index) => {
    const isFirst = index === 0;
    const isLast = index === lines.length - 1;
    const isLastNonEmpty = index === lastNonEmpty;
    let trimmed = line.replace(/\t/g, ' ');
    if (!isFirst) trimmed = trimmed.replace(/^[ ]+/, '');
    if (!isLast) trimmed = trimmed.replace(/[ ]+$/, '');
    if (trimmed) {
      if (!isLastNonEmpty) trimmed += ' ';
      out += trimmed;
    }
  });
  return out;
}

/** The source text of each `{ id: '…', … content: ( <> … </> ) }` entry. */
function sectionSources(file, source) {
  const start = source.indexOf('const sections');
  if (start === -1) fail(file, 'no `const sections` array');
  const end = source.indexOf('\n];', start);
  if (end === -1) fail(file, 'unterminated `const sections` array');
  const body = source.slice(start, end);

  const sections = [];
  const pattern = /id:\s*'([a-z0-9-]+)'[\s\S]*?content:\s*\(\s*<>([\s\S]*?)<\/>\s*\)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    sections.push({ id: match[1], markup: match[2] });
  }
  const declared = (body.match(/\bid:\s*'/g) || []).length;
  if (sections.length === 0 || sections.length !== declared) {
    fail(file, `parsed ${sections.length} section bodies but the array declares ${declared} ids`);
  }
  return sections;
}

/**
 * Tokenise one section's markup into blocks. A block is a paragraph or a bullet list;
 * a list holds items; both hold "runs" of text carrying the inline formatting that
 * applies to them (strong, em, a link) or a line break.
 */
function parseMarkup(file, sectionId, markup) {
  const where = `section "${sectionId}"`;
  const tokenPattern = /<(\/?)([a-z]+)((?:\s+[a-zA-Z]+(?:=(?:"[^"]*"|\{[^}]*\}))?)*)\s*(\/?)>|\{'([^']*)'\}|\{([^}]*)\}/g;

  const blocks = [];
  let block = null; // { type: 'p', runs } | { type: 'ul', items: [runs] }
  let runs = null; // the run list currently being filled
  const inline = []; // stack of { tag, href }
  let cursor = 0;

  function pushText(text) {
    if (text === '') return;
    if (!runs) {
      if (/^\s*$/.test(text)) return;
      fail(file, `${where}: text outside a paragraph or list item: ${JSON.stringify(text.slice(0, 60))}`);
    }
    const run = { text };
    for (const frame of inline) {
      if (frame.tag === 'strong') run.strong = true;
      if (frame.tag === 'em') run.em = true;
      if (frame.tag === 'a') run.href = frame.href;
    }
    const previous = runs[runs.length - 1];
    if (previous && previous.text !== undefined
      && previous.strong === run.strong && previous.em === run.em && previous.href === run.href) {
      previous.text += text;
    } else {
      runs.push(run);
    }
  }

  let match;
  while ((match = tokenPattern.exec(markup)) !== null) {
    pushText(decodeEntities(file, jsxText(markup.slice(cursor, match.index))));
    cursor = tokenPattern.lastIndex;

    const [, closing, tag, attributes, selfClosing, literal, expression] = match;

    if (literal !== undefined) {
      pushText(literal);
      continue;
    }
    if (expression !== undefined) {
      fail(file, `${where}: unsupported JSX expression {${expression}}`);
    }

    if (tag === 'br') {
      if (!runs) fail(file, `${where}: <br /> outside a paragraph or list item`);
      runs.push({ br: true });
      continue;
    }
    if (selfClosing) fail(file, `${where}: unsupported self-closing <${tag} />`);

    if (tag === 'p') {
      if (closing) {
        if (!block || block.type !== 'p') fail(file, `${where}: stray </p>`);
        blocks.push(block);
        block = null;
        runs = null;
      } else {
        if (block) fail(file, `${where}: <p> nested inside <${block.type}>`);
        block = { type: 'p', runs: [] };
        runs = block.runs;
      }
    } else if (tag === 'ul') {
      if (closing) {
        if (!block || block.type !== 'ul' || runs) fail(file, `${where}: stray </ul>`);
        blocks.push(block);
        block = null;
      } else {
        if (block) fail(file, `${where}: <ul> nested inside <${block.type}>`);
        block = { type: 'ul', items: [] };
      }
    } else if (tag === 'li') {
      if (!block || block.type !== 'ul') fail(file, `${where}: <li> outside a <ul>`);
      if (closing) {
        if (!runs) fail(file, `${where}: stray </li>`);
        block.items.push(runs);
        runs = null;
      } else {
        if (runs) fail(file, `${where}: nested <li>`);
        runs = [];
      }
    } else if (tag === 'strong' || tag === 'em' || tag === 'a') {
      if (closing) {
        const frame = inline.pop();
        if (!frame || frame.tag !== tag) fail(file, `${where}: mismatched </${tag}>`);
      } else {
        if (!runs) fail(file, `${where}: <${tag}> outside a paragraph or list item`);
        let href;
        if (tag === 'a') {
          const hrefMatch = /\shref="([^"]+)"/.exec(attributes);
          if (!hrefMatch || !/^https:\/\/[^\s"<>]+$/.test(hrefMatch[1])) {
            fail(file, `${where}: a link without a plain https href`);
          }
          href = hrefMatch[1];
        }
        inline.push({ tag, href });
      }
    } else {
      fail(file, `${where}: unsupported tag <${closing}${tag}>`);
    }
  }
  pushText(decodeEntities(file, jsxText(markup.slice(cursor))));

  if (block || runs || inline.length) fail(file, `${where}: unclosed element`);
  if (blocks.length === 0) fail(file, `${where}: no content`);
  return blocks;
}

/** "1 March 2026" -> "2026-03-01". */
function isoDate(file, text) {
  const match = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/.exec(text);
  if (!match || !MONTHS[match[2]]) fail(file, `unrecognised effectiveDate "${text}"`);
  return `${match[3]}-${MONTHS[match[2]]}-${match[1].padStart(2, '0')}`;
}

function build() {
  const documents = {};
  for (const { key, file } of DOCUMENTS) {
    const absolute = path.join(pagesRoot, file);
    if (!fs.existsSync(absolute)) throw new Error(`Not found: ${absolute}`);
    const source = fs.readFileSync(absolute, 'utf8');

    const dateMatch = /effectiveDate="([^"]+)"/.exec(source);
    if (!dateMatch) fail(file, 'no effectiveDate="…" prop');

    documents[key] = {
      source: `react-frontend/src/pages/platform/${file}`,
      effectiveDate: isoDate(file, dateMatch[1]),
      effectiveDateText: dateMatch[1],
      sections: sectionSources(file, source).map(({ id, markup }) => ({
        id,
        blocks: parseMarkup(file, id, markup),
      })),
    };
  }

  return {
    _README:
      'GENERATED by web-uk/scripts/build-platform-legal-text.js from '
      + 'react-frontend/src/pages/platform/Platform{Terms,Privacy,Disclaimer}Page.tsx — do not '
      + 'edit by hand. The body of the platform legal documents is canonically English and has '
      + 'one source, React\'s page files. Refresh with '
      + '`npm --prefix web-uk run build:platform-legal-text`; '
      + '`npm --prefix web-uk run check:platform-legal-text` fails when it is out of date.',
    language: 'en',
    documents,
  };
}

function serialise(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes('--check');
  const next = serialise(build());
  const count = DOCUMENTS.length;

  if (check) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (current !== next) {
      console.error('FAIL: src/lib/generated/platform-legal-text.json is out of date.');
      console.error('      Run `npm --prefix web-uk run build:platform-legal-text` and commit the result.');
      process.exit(1);
    }
    console.log(`Platform legal text up to date: ${count} documents.`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, next, 'utf8');
  console.log(`Platform legal text written: ${count} documents.`);
}

if (require.main === module) {
  main();
}

module.exports = { build, serialise, jsxText, parseMarkup };
