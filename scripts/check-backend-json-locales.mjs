// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// The runtime JSON translator falls back to English before trying PHP catalogues.
// PHP parity therefore cannot prove that these user-facing strings are translated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lang');
const locales = ['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'];
function flatten(value, prefix = '', result = {}) {
  for (const [key, text] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (text && typeof text === 'object') flatten(text, name, result);
    else result[name] = text;
  }
  return result;
}
const read = file => flatten(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
const tokens = (text, optionalCount = false) => [...new Set(String(text).match(/\{\{\s*\w+\s*\}\}|(?<![\w:]):[a-zA-Z_]\w*/g) || [])]
  // Arabic singular/dual forms can spell out the number grammatically.
  .filter(token => !optionalCount || !/^\{\{\s*count\s*\}\}$/.test(token)).sort().join('|');
const errors = [];
let checked = 0;
for (const file of fs.readdirSync(path.join(root, 'en')).filter(file => file.endsWith('.json'))) {
  const english = read(path.join(root, 'en', file));
  for (const locale of locales) {
    const target = path.join(root, locale, file);
    if (!fs.existsSync(target)) { errors.push(`${locale}/${file}: missing catalogue`); continue; }
    const translated = read(target);
    for (const [key, source] of Object.entries(english)) {
      checked++;
      if (typeof translated[key] !== typeof source || (typeof source === 'string' && !translated[key].trim())) {
        errors.push(`${locale}/${file}:${key}: missing value`);
      } else if (tokens(source, locale === 'ar' && /_(one|two|zero)$/.test(key)) !== tokens(translated[key], locale === 'ar' && /_(one|two|zero)$/.test(key))) {
        errors.push(`${locale}/${file}:${key}: interpolation mismatch`);
      }
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Backend JSON locale coverage and interpolation: ${checked} entries passed.`);
