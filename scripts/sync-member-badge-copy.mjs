// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
// Small member/API catalogues share the existing administrator badge copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
let failed = false;
for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']) {
  const source = JSON.parse(fs.readFileSync(path.join(root, 'react-frontend/public/locales', locale, 'admin_gamification.json'), 'utf8'));
  const value = { badges: source.gamification.badges };
  for (const base of ['lang', 'react-frontend/public/locales']) {
    const target = path.join(root, base, locale, 'badge_copy.json');
    if (check) {
      if (!fs.existsSync(target) || JSON.stringify(JSON.parse(fs.readFileSync(target, 'utf8'))) !== JSON.stringify(value)) {
        console.error(`Badge copy drift: ${base}/${locale}/badge_copy.json`); failed = true;
      }
    } else fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
  }
}
if (failed) process.exitCode = 1;
else console.log(check ? 'Member/API badge copy: 22 catalogues match.' : 'Member/API badge copy: 22 catalogues generated.');
