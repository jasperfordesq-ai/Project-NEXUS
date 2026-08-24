// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Fill mobile locale gaps from the equivalent web translation where possible, then
 * optionally use Google's public translation endpoint. A real translation is never
 * overwritten.
 *
 * 🔴 **A MISSING key is not the gap that exists.** Run with `--summary` alone and it
 * reports "0 missing", because every mobile key is present in every locale. What it could
 * not see, until `--identical` was added on 2026-08-24, is the **5,671 keys that are
 * present and still hold the English sentence** — about 1,100 in each of de, es, fr, it and
 * pt. That is the same blind spot that let 99,139 PHP values sit in English behind a green
 * parity gate: comparing key SETS answers a different question from comparing values.
 *
 * Usage:
 *   node scripts/translate-mobile-i18n-gaps.mjs --summary
 *   node scripts/translate-mobile-i18n-gaps.mjs --identical --summary
 *   node scripts/translate-mobile-i18n-gaps.mjs --identical --reuse-only
 *   node scripts/translate-mobile-i18n-gaps.mjs --identical --google --concurrency 6
 *   node scripts/translate-mobile-i18n-gaps.mjs --google --repair-artifacts
 *
 * `--reuse-only` needs no provider at all: it fills from the website's own reviewed
 * translations, matched by the English phrase, which is both free and better than machine
 * output. Roughly one gap in five can be filled that way.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE_DIR = path.join(ROOT, 'mobile/locales');
const WEB_DIR = path.join(ROOT, 'react-frontend/public/locales');
const LANGUAGES = ['de', 'es', 'fr', 'ga', 'it', 'pt'];

const args = process.argv.slice(2);
const SUMMARY = args.includes('--summary');
const USE_GOOGLE = args.includes('--google');
const REPAIR_ARTIFACTS = args.includes('--repair-artifacts');
/** Count a present-but-English value as a gap (see the note at the top of this file). */
const INCLUDE_IDENTICAL = args.includes('--identical');
/** Fill only from the website's own translations. No provider, no network beyond the repo. */
const REUSE_ONLY = args.includes('--reuse-only');
const langFilter = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null;
const requestedConcurrency = args.includes('--concurrency')
  ? Number(args[args.indexOf('--concurrency') + 1])
  : 1;
const CONCURRENCY = Number.isInteger(requestedConcurrency)
  ? Math.min(10, Math.max(1, requestedConcurrency))
  : 1;

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function flatten(value, prefix = '', result = {}) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, fullKey, result);
    } else {
      result[fullKey] = child;
    }
  }
  return result;
}

function setNested(target, dottedKey, value) {
  const parts = dottedKey.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function orderLike(source, target) {
  const ordered = {};
  for (const key of Object.keys(source)) {
    if (!(key in target)) continue;
    ordered[key] = source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
      ? orderLike(source[key], target[key] ?? {})
      : target[key];
  }
  for (const key of Object.keys(target)) {
    if (!(key in ordered)) ordered[key] = target[key];
  }
  return ordered;
}

function protectVariables(text) {
  const variables = [];
  return {
    protectedText: text.replace(/\{\{[^}]+\}\}/g, variable => {
      variables.push(variable);
      return `ZXQNEXUSVAR${variables.length - 1}QXZ`;
    }),
    variables,
  };
}

function restoreVariables(text, variables) {
  return text.replace(/ZXQNEXUSVAR(\d+)QXZ/gi, (_, index) => variables[Number(index)] ?? '');
}

/**
 * Values that are the same in English by nature, not by neglect. A single word is already
 * excluded elsewhere; this catches the rest, so the count stays a count of real work.
 */
function isLegitimatelyIdentical(value) {
  const text = String(value).trim();
  if (!text) return true;
  // Nothing but placeholders and punctuation: "{{count}} / {{total}}".
  if (!text.replace(/\{\{[^}]+\}\}/g, '').match(/[A-Za-z]/)) return true;
  // A URL, an email address, or a path — translating these breaks them.
  if (/^(https?:\/\/|mailto:|tel:|\/[a-z])/i.test(text)) return true;
  // Product and platform names carry across untranslated.
  if (/^(Project NEXUS|NEXUS|Google Play|App Store|Stripe|Apple|Android|iOS|Expo)\b/.test(text)) return true;
  return false;
}

function hasTranslationArtifact(value) {
  return typeof value === 'string' && /<\/?nexus(?:item|\d)/i.test(value);
}

function variableSignature(value) {
  return [...String(value).matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)]
    .map(match => match[1])
    .sort()
    .join(',');
}

async function translateSingle(text, language, attempt = 1) {
  const { protectedText, variables } = protectVariables(text);
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  for (const [key, value] of Object.entries({ client: 'gtx', sl: 'en', tl: language, dt: 't', q: protectedText })) {
    url.searchParams.set(key, value);
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Google Translate ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const translated = Array.isArray(data?.[0]) ? data[0].map(part => part?.[0] ?? '').join('') : '';
    return restoreVariables(translated, variables);
  } catch (error) {
    if (attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
      return translateSingle(text, language, attempt + 1);
    }
    throw error;
  }
}

async function translateBatch(texts, language, attempt = 1) {
  const protectedItems = texts.map(protectVariables);
  const combined = protectedItems
    .map(({ protectedText }, index) => `<nexusitem id="${index}">${protectedText}</nexusitem>`)
    .join('');
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', language);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', combined);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    if (attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
      return translateBatch(texts, language, attempt + 1);
    }
    throw error;
  }
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
      return translateBatch(texts, language, attempt + 1);
    }
    throw new Error(`Google Translate ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const translatedDocument = Array.isArray(data?.[0])
    ? data[0].map(part => part?.[0] ?? '').join('')
    : '';
  const translations = [...translatedDocument.matchAll(/<nexusitem id="(\d+)">([\s\S]*?)<\/nexusitem>/gi)];
  if (translations.length !== texts.length) {
    if (texts.length > 1) {
      const midpoint = Math.ceil(texts.length / 2);
      return [
        ...await translateBatch(texts.slice(0, midpoint), language),
        ...await translateBatch(texts.slice(midpoint), language),
      ];
    }
    const unwrapped = translatedDocument
      .replace(/^<nexusitem id="0">/i, '')
      .replace(/<\/nexusitem>$/i, '');
    if (unwrapped) return [restoreVariables(unwrapped, protectedItems[0].variables)];
    throw new Error('Google Translate returned an empty single-item translation.');
  }
  const result = new Array(texts.length);
  for (const match of translations) {
    const index = Number(match[1]);
    result[index] = restoreVariables(match[2], protectedItems[index].variables);
  }
  return result;
}

async function translateAll(texts, language) {
  const translated = new Array(texts.length);
  if (REPAIR_ARTIFACTS) {
    let singleCursor = 0;
    async function singleWorker() {
      while (singleCursor < texts.length) {
        const index = singleCursor++;
        translated[index] = await translateSingle(texts[index], language);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, () => singleWorker()));
    return translated;
  }
  const batches = [];
  let batch = [];
  let batchLength = 0;
  for (const [index, text] of texts.entries()) {
    const estimatedLength = text.length + 40;
    if (batch.length >= 20 || (batch.length > 0 && batchLength + estimatedLength > 3500)) {
      batches.push(batch);
      batch = [];
      batchLength = 0;
    }
    batch.push({ index, text });
    batchLength += estimatedLength;
  }
  if (batch.length > 0) batches.push(batch);

  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const current = batches[cursor++];
      const batchTranslations = await translateBatch(current.map(item => item.text), language);
      current.forEach((item, index) => {
        translated[item.index] = batchTranslations[index];
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));
  return translated;
}

function buildWebTranslationMap(language) {
  const candidates = new Map();
  const enDir = path.join(WEB_DIR, 'en');
  for (const file of fs.readdirSync(enDir).filter(name => name.endsWith('.json'))) {
    const targetFile = path.join(WEB_DIR, language, file);
    if (!fs.existsSync(targetFile)) continue;
    const english = flatten(readJson(path.join(enDir, file)));
    const target = flatten(readJson(targetFile));
    for (const [key, englishValue] of Object.entries(english)) {
      const translatedValue = target[key];
      if (typeof englishValue !== 'string' || typeof translatedValue !== 'string') continue;
      if (translatedValue === englishValue) continue;
      if (!candidates.has(englishValue)) candidates.set(englishValue, new Set());
      candidates.get(englishValue).add(translatedValue);
    }
  }
  return new Map([...candidates]
    .filter(([, translations]) => translations.size === 1)
    .map(([english, translations]) => [english, [...translations][0]]));
}

async function main() {
  if (!SUMMARY && !USE_GOOGLE && !REUSE_ONLY) {
    throw new Error('Pass --summary for an audit, --reuse-only to fill from the website\'s translations, or --google to use the provider.');
  }

  let totalMissing = 0;
  let totalReused = 0;
  let totalTranslated = 0;

  for (const language of langFilter ? [langFilter] : LANGUAGES) {
    if (!LANGUAGES.includes(language)) throw new Error(`Unsupported mobile locale: ${language}`);
    const reusable = buildWebTranslationMap(language);
    for (const file of fs.readdirSync(path.join(MOBILE_DIR, 'en')).filter(name => name.endsWith('.json'))) {
      const englishFile = path.join(MOBILE_DIR, 'en', file);
      const targetFile = path.join(MOBILE_DIR, language, file);
      const englishData = readJson(englishFile);
      const targetData = readJson(targetFile);
      const english = flatten(englishData);
      const target = flatten(targetData);
      const missing = Object.entries(english)
        .filter(([key, value]) => (
          target[key] === undefined || (REPAIR_ARTIFACTS && (
            hasTranslationArtifact(target[key]) || variableSignature(value) !== variableSignature(target[key])
          )) || (INCLUDE_IDENTICAL
            // Present, but still the English sentence. Multi-word only: a single word is
            // very often correct as-is ("Email", "OK", "Total"), and treating those as work
            // would bury the real gap in noise.
            && target[key] === value
            && String(value).trim().split(/\s+/).length > 1
            && !isLegitimatelyIdentical(value))
        ) && typeof value === 'string')
        .map(([key, value]) => ({ key, value }));
      if (missing.length === 0) continue;

      const reused = missing.filter(({ value }) => reusable.has(value));
      const provider = missing.filter(({ value }) => !reusable.has(value));
      totalMissing += missing.length;
      totalReused += reused.length;
      totalTranslated += provider.length;
      console.log(`${language}/${file}: ${missing.length} missing (${reused.length} web reuse, ${provider.length} provider)`);
      if (SUMMARY) continue;

      const updated = structuredClone(targetData);
      for (const { key, value } of reused) setNested(updated, key, reusable.get(value));
      if (!REUSE_ONLY) {
        const translations = await translateAll(provider.map(item => item.value), language);
        provider.forEach(({ key }, index) => setNested(updated, key, translations[index]));
      }
      fs.writeFileSync(targetFile, `${JSON.stringify(orderLike(englishData, updated), null, 2)}\n`, 'utf8');
    }
  }

  console.log(`Total: ${totalMissing} missing; ${totalReused} reusable; ${totalTranslated} provider-required`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
