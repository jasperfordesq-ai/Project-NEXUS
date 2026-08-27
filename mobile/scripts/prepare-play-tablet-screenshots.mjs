#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Convert a genuine Android tablet capture tour into Play-ready PNGs.
 *
 * Tablet AVDs render at 10:16. Google Play's live listing editor asks for 9:16
 * or 16:9. Cropping would remove real app UI, so the complete capture is scaled
 * proportionally and centred on an opaque neutral background.
 *
 * Usage:
 *   node scripts/prepare-play-tablet-screenshots.mjs --device 7-inch --source <takeScreenshot-dir>
 *   node scripts/prepare-play-tablet-screenshots.mjs --device 10-inch --source <takeScreenshot-dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(MOBILE, '..');
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
const sharp = requireFromRoot('sharp');

const args = process.argv.slice(2);
const device = argValue('--device');
const source = argValue('--source');
const profiles = {
  '7-inch': { width: 1080, height: 1920, directory: 'tablet-7' },
  // Pixel Tablet renders naturally in landscape. Keep it that way: a complete
  // 16:10 tablet capture scales to 2304x1440 with slim side gutters in a 16:9
  // 2560x1440 Play asset, rather than floating inside a mostly-empty portrait.
  '10-inch': { width: 2560, height: 1440, directory: 'tablet-10' },
};

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

if (!profiles[device]) {
  throw new Error('--device must be either 7-inch or 10-inch');
}
if (!source || !fs.existsSync(source)) {
  throw new Error(`--source does not exist: ${source || '(missing)'}`);
}

const expected = [
  '02-listings.png',
  '04-wallet.png',
  '08-volunteering.png',
];
const missing = expected.filter((name) => !fs.existsSync(path.join(source, name)));
if (missing.length > 0) {
  throw new Error(`capture tour is incomplete; missing ${missing.join(', ')}`);
}

const profile = profiles[device];
const destination = path.join(MOBILE, 'store-listing', 'screenshots', profile.directory);
fs.mkdirSync(destination, { recursive: true });

// Keep the generated upload folder exact. The feed is useful for verifying the
// tour, but some screens deliberately expose extreme local stress-test copy.
// Those are useful for QA, not public artwork, so this curated set keeps only
// the three strongest product screens.
for (const name of fs.readdirSync(destination)) {
  if (name.toLowerCase().endsWith('.png') && !expected.includes(name)) {
    fs.rmSync(path.join(destination, name));
  }
}

const background = { r: 247, g: 249, b: 252, alpha: 1 };
for (const name of expected) {
  const input = path.join(source, name);
  const output = path.join(destination, name);
  await sharp(input)
    .flatten({ background })
    .resize(profile.width, profile.height, {
      fit: 'contain',
      background,
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toFile(output);
  console.log(`${name}: ${device} capture -> ${profile.width}x${profile.height}`);
}

console.log(`\nPrepared ${expected.length} genuine ${device} screenshots in ${path.relative(MOBILE, destination)}.`);
