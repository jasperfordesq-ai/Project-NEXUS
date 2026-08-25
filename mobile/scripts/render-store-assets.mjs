#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Build the two Google Play graphics that are not screenshots.
 *
 * Play wants a **512×512** app icon and a **1024×500** feature graphic with no transparency.
 * The app's own icon is 1024², which Play rejects outright, and a feature graphic did not
 * exist at all — it is the banner across the top of the listing, so there is no shipping
 * without one.
 *
 * Both are generated rather than hand-exported, for one reason: a binary nobody can
 * regenerate is a binary nobody can change. The feature graphic's real source is
 * `store-listing/feature-graphic.html`; edit that and re-run this.
 *
 *   node scripts/render-store-assets.mjs          # writes both, then verifies them
 *   node scripts/render-store-assets.mjs --check  # verify only; non-zero if wrong or missing
 *
 * The icon is downscaled with a premultiplied 2×2 box filter. Premultiplied because the
 * naive version averages the colour of fully transparent pixels into the edge, which halos
 * a rounded icon against Play's white grid.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(MOBILE, '..');
const OUT_DIR = path.join(MOBILE, 'store-listing');

const ICON_SOURCE = path.join(MOBILE, 'assets', 'icon.png');
const ICON_OUT = path.join(OUT_DIR, 'play-icon-512.png');
const GRAPHIC_HTML = path.join(OUT_DIR, 'feature-graphic.html');
const GRAPHIC_OUT = path.join(OUT_DIR, 'play-feature-graphic-1024x500.png');

const checkOnly = process.argv.includes('--check');
const problems = [];

/** Half the size of a square PNG, averaging each 2×2 block with alpha premultiplied. */
function halveSquare(png) {
  const size = png.width / 2;
  const out = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const i = ((png.width * (y * 2 + dy)) + (x * 2 + dx)) << 2;
          const alpha = png.data[i + 3] / 255;
          r += png.data[i] * alpha;
          g += png.data[i + 1] * alpha;
          b += png.data[i + 2] * alpha;
          a += png.data[i + 3];
        }
      }
      const alpha = a / 4;
      const scale = alpha > 0 ? 255 / alpha : 0;
      const o = ((size * y) + x) << 2;
      out.data[o] = Math.round((r / 4) * scale);
      out.data[o + 1] = Math.round((g / 4) * scale);
      out.data[o + 2] = Math.round((b / 4) * scale);
      out.data[o + 3] = Math.round(alpha);
    }
  }
  return out;
}

async function writeIcon() {
  const source = PNG.sync.read(fs.readFileSync(ICON_SOURCE));
  if (source.width !== source.height) {
    problems.push(`assets/icon.png is ${source.width}×${source.height}; Play needs a square icon`);
    return;
  }
  let png = source;
  while (png.width > 512) png = halveSquare(png);
  if (png.width !== 512) {
    problems.push(`cannot reach 512 from ${source.width} by halving; resize assets/icon.png`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(ICON_OUT, PNG.sync.write(png));
}

async function writeFeatureGraphic() {
  // Chromium comes from the Playwright the repository already installs for e2e, at the ROOT
  // node_modules — not mobile's.
  const rootRequire = createRequire(path.join(ROOT, 'package.json'));
  const { chromium } = rootRequire('playwright');

  const icon = fs.readFileSync(ICON_OUT).toString('base64');
  const html = fs.readFileSync(GRAPHIC_HTML, 'utf8')
    .replace('ICON_DATA_URI', `data:image/png;base64,${icon}`);
  const temp = path.join(OUT_DIR, '.feature-graphic.rendered.html');
  fs.writeFileSync(temp, html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${temp.replace(/\\/g, '/')}`);
    // Fonts and the gradient settle within a frame or two; half a second is generous.
    // 🔴 Not byte-reproducible: two runs of the same source produced 295,466 and 281,015
    // byte PNGs. The image is the same; chromium is free to encode it differently. So do
    // not add a "the committed asset matches a fresh render" gate — it would fail on a
    // no-op. --check verifies size, format and transparency, which is what Play cares about.
    await page.waitForTimeout(500);
    await page.screenshot({ path: GRAPHIC_OUT });
  } finally {
    await browser.close();
    fs.rmSync(temp, { force: true });
  }
}

function verify() {
  for (const [file, width, height, allowAlpha] of [
    [ICON_OUT, 512, 512, true],
    [GRAPHIC_OUT, 1024, 500, false],
  ]) {
    if (!fs.existsSync(file)) {
      problems.push(`${path.relative(ROOT, file)} is missing — run without --check`);
      continue;
    }
    const png = PNG.sync.read(fs.readFileSync(file));
    if (png.width !== width || png.height !== height) {
      problems.push(`${path.relative(ROOT, file)} is ${png.width}×${png.height}, Play needs ${width}×${height}`);
    }
    if (!allowAlpha) {
      let transparent = 0;
      for (let i = 3; i < png.data.length; i += 4) if (png.data[i] < 255) transparent += 1;
      if (transparent > 0) {
        problems.push(`${path.relative(ROOT, file)} has ${transparent} transparent pixels; Play rejects transparency here`);
      }
    }
    const bytes = fs.statSync(file).size;
    if (bytes > 1024 * 1024) {
      problems.push(`${path.relative(ROOT, file)} is ${bytes} bytes; Play's limit for this asset is 1 MB`);
    }
    console.log(`${path.relative(ROOT, file)}: ${png.width}×${png.height}, ${bytes} bytes`);
  }
}

if (!checkOnly) {
  await writeIcon();
  if (problems.length === 0) await writeFeatureGraphic();
}
verify();

if (problems.length > 0) {
  console.error(`\nFAILED: ${problems.length} problem(s).`);
  console.error(problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('\nPlay store graphics are the right size and format.');
