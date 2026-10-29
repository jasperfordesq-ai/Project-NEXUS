// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Build this frontend's copy of the FAQ.
 *
 * ONE SOURCE, TWO FRONTENDS, as scripts/build-help-guides.js: the questions are
 * written for React's FaqPage, in all eleven languages, under
 * react-frontend/public/locales/<locale>/public.json -> faq.categories. The
 * accessible /faq showed five questions of its own while React had twenty in five
 * groups (29 Oct 2026 parity audit).
 *
 * This frontend's Docker build context is `web-uk/`, so the React files are not in
 * its image. The copy is generated and committed, and `--check` (plus
 * tests/faq.test.js) fails the moment it no longer matches React.
 *
 * Each answer is turned into blocks, in the order React writes the keys:
 *   paragraph   answer, answer_p1.., answer_intro, answer_outro
 *   list        stepN / tipN / itemN ... (with an optional _bold lead-in)
 *   link        *_before + wallet_link / settings_link + *_after
 * A key this does not recognise fails the build, so a new React answer shape
 * cannot be dropped silently.
 *
 * A string missing from a language is filled from English, as React's i18next
 * fallback does at runtime.
 *
 * Usage:
 *   node scripts/build-faq.js          # write src/lib/generated/faq.json
 *   node scripts/build-faq.js --check  # fail if it is out of date
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const localesRoot = path.join(repoRoot, 'react-frontend', 'public', 'locales');
const outputFile = path.join(__dirname, '..', 'src', 'lib', 'generated', 'faq.json');

const LOCALES = Object.freeze(['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar']);
const LINK_TARGETS = Object.freeze({ wallet_link: '/wallet', settings_link: '/settings', help_center_link: '/help' });
const PARAGRAPH = /^answer(_p\d+|_intro|_outro)?$/;
const LIST_ITEM = /^([a-z]+\d+)(_bold|_text)?$/;
const LINK_BEFORE = /^answer_(link_before|before_link)$/;
const LINK_AFTER = /^answer_(link_after|after_link)$/;

function readFaq(locale) {
  const file = path.join(localesRoot, locale, 'public.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return json.faq || {};
}

function pick(localised, english, key) {
  const value = localised && typeof localised[key] === 'string' && localised[key].trim() !== ''
    ? localised[key]
    : english && english[key];
  if (typeof value !== 'string') throw new Error(`FAQ string missing in English: ${key}`);
  return value;
}

function answerBlocks(englishAnswer, localAnswer, where) {
  const blocks = [];
  const keys = Object.keys(englishAnswer).filter((key) => key !== 'question');
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (PARAGRAPH.test(key)) {
      blocks.push({ type: 'p', text: pick(localAnswer, englishAnswer, key) });
      continue;
    }
    if (LINK_BEFORE.test(key)) {
      const linkKey = keys[index + 1];
      const afterKey = keys[index + 2];
      if (!LINK_TARGETS[linkKey] || !LINK_AFTER.test(afterKey || '')) {
        throw new Error(`Unrecognised FAQ link shape at ${where}.${key}`);
      }
      blocks.push({
        type: 'link',
        before: pick(localAnswer, englishAnswer, key),
        text: pick(localAnswer, englishAnswer, linkKey),
        href: LINK_TARGETS[linkKey],
        after: pick(localAnswer, englishAnswer, afterKey)
      });
      index += 2;
      continue;
    }
    const item = key.match(LIST_ITEM);
    if (item) {
      let list = blocks[blocks.length - 1];
      if (!list || list.type !== 'ul') {
        list = { type: 'ul', items: [] };
        blocks.push(list);
      }
      if (item[2] === '_bold') {
        const textKey = `${item[1]}_text`;
        list.items.push({ bold: pick(localAnswer, englishAnswer, key), text: pick(localAnswer, englishAnswer, textKey) });
      } else if (item[2] === '_text') {
        // Consumed with its _bold partner.
      } else {
        list.items.push({ bold: '', text: pick(localAnswer, englishAnswer, key) });
      }
      continue;
    }
    throw new Error(`Unrecognised FAQ key ${where}.${key}`);
  }
  return blocks;
}

function build() {
  const english = readFaq('en');
  const englishCategories = english.categories || {};
  const out = { locales: {} };
  let questions = 0;
  for (const locale of LOCALES) {
    const local = locale === 'en' ? english : readFaq(locale);
    const localCategories = local.categories || {};
    out.locales[locale] = Object.entries(englishCategories).map(([categoryKey, englishCategory]) => {
      const localCategory = localCategories[categoryKey] || {};
      const items = Object.entries(englishCategory)
        .filter(([key, value]) => key !== 'title' && value && typeof value === 'object')
        .map(([questionKey, englishAnswer]) => {
          const localAnswer = localCategory[questionKey] || {};
          return {
            id: `${categoryKey}-${questionKey}`,
            question: pick(localAnswer, englishAnswer, 'question'),
            blocks: answerBlocks(englishAnswer, localAnswer, `${categoryKey}.${questionKey}`)
          };
        });
      if (locale === 'en') questions += items.length;
      return { id: categoryKey, title: pick(localCategory, englishCategory, 'title'), items };
    });
  }
  return { content: `${JSON.stringify(out, null, 2)}\n`, questions };
}

function isStale(content) {
  try {
    return fs.readFileSync(outputFile, 'utf8').replace(/\r\n/g, '\n') !== content;
  } catch {
    return true;
  }
}

function main() {
  const { content, questions } = build();
  if (process.argv.includes('--check')) {
    if (isStale(content)) {
      console.error('FAIL: src/lib/generated/faq.json is out of date.');
      console.error('      Run `npm --prefix web-uk run build:faq` and commit the result.');
      process.exit(1);
    }
    console.log(`FAQ up to date: ${questions} questions, ${LOCALES.length} locales.`);
    return;
  }
  fs.writeFileSync(outputFile, content, 'utf8');
  console.log(`FAQ written: ${questions} questions, ${LOCALES.length} locales.`);
}

module.exports = { build, isStale, LOCALES, outputFile };

if (require.main === module) main();
