#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turn the real 1080×2400 phone captures into Play-compatible 1080×1920 assets.
 *
 * Google caps screenshot aspect ratio at 2:1 and requires an opaque JPEG or 24-bit PNG.
 * Cropping 480 pixels would remove either navigation or the primary bottom action on several
 * screens. Instead, preserve the complete truthful capture at 80% (864×1920) and centre it
 * on a 1080×1920 background sampled from that capture. Nothing in the app UI is invented,
 * stretched, or cut off.
 *
 * Re-running is safe: already-prepared 1080×1920 RGB screenshots are left untouched.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(MOBILE, '..');
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
const sharp = requireFromRoot('sharp');

const SCREENSHOTS = path.join(MOBILE, 'store-listing', 'screenshots');
const SOURCE_WIDTH = 1080;
const SOURCE_HEIGHT = 2400;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const CONTENT_WIDTH = 864;
const SIDE_GUTTER = (OUTPUT_WIDTH - CONTENT_WIDTH) / 2;

async function prepareScreenshot(file) {
  const image = sharp(file);
  const metadata = await image.metadata();

  if (metadata.width === OUTPUT_WIDTH && metadata.height === OUTPUT_HEIGHT && metadata.hasAlpha === false) {
    console.log(`${path.relative(MOBILE, file)}: already Play-ready`);
    return;
  }

  if (metadata.width !== SOURCE_WIDTH || metadata.height !== SOURCE_HEIGHT) {
    throw new Error(
      `${path.relative(MOBILE, file)} is ${metadata.width}×${metadata.height}; `
      + `expected a ${SOURCE_WIDTH}×${SOURCE_HEIGHT} capture or ${OUTPUT_WIDTH}×${OUTPUT_HEIGHT} prepared asset`,
    );
  }

  const { data } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const background = { r: data[0], g: data[1], b: data[2], alpha: 1 };
  const temporary = `${file}.play-ready.png`;

  await sharp(file)
    .removeAlpha()
    .resize(CONTENT_WIDTH, OUTPUT_HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .extend({ left: SIDE_GUTTER, right: SIDE_GUTTER, top: 0, bottom: 0, background })
    .png({ compressionLevel: 9, palette: false })
    .toFile(temporary);

  fs.copyFileSync(temporary, file);
  fs.rmSync(temporary, { force: true });
  console.log(`${path.relative(MOBILE, file)}: ${SOURCE_WIDTH}×${SOURCE_HEIGHT} → ${OUTPUT_WIDTH}×${OUTPUT_HEIGHT}`);
}

for (const theme of ['light', 'dark']) {
  const directory = path.join(SCREENSHOTS, theme);
  const files = fs.readdirSync(directory)
    .filter((file) => file.toLowerCase().endsWith('.png'))
    .sort();
  for (const file of files) await prepareScreenshot(path.join(directory, file));
}

console.log('\nPlay screenshots preserve the full app capture at a compliant 9:16 ratio.');
