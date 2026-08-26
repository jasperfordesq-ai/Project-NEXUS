#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Google Play's mandatory image checks, kept executable rather than trusted to prose. */

const fs = require('node:fs');
const path = require('node:path');

const MOBILE = path.resolve(__dirname, '..');
const STORE = path.join(MOBILE, 'store-listing');

function inspectPng(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 26 || buffer.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error(`${file} is not a PNG`);
  }
  return {
    file,
    bytes: buffer.length,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

function validateScreenshotMeta(meta) {
  const problems = [];
  const shortest = Math.min(meta.width, meta.height);
  const longest = Math.max(meta.width, meta.height);
  if (meta.bitDepth !== 8 || meta.colorType !== 2) {
    problems.push('must be a 24-bit RGB PNG with no alpha channel');
  }
  if (shortest < 320 || longest > 3840) {
    problems.push('dimensions must stay between 320px and 3840px');
  }
  if (longest > shortest * 2) {
    problems.push('longest edge must not exceed twice the shortest edge');
  }
  return problems;
}

function validatePlayAssets(store = STORE) {
  const problems = [];
  const report = [];

  function checkPng(relative, expected) {
    const file = path.join(store, relative);
    if (!fs.existsSync(file)) {
      problems.push(`${relative}: missing`);
      return null;
    }
    const meta = inspectPng(file);
    report.push(meta);
    for (const [key, value] of Object.entries(expected)) {
      if (meta[key] !== value) problems.push(`${relative}: ${key} is ${meta[key]}, expected ${value}`);
    }
    return meta;
  }

  const icon = checkPng('play-icon-512.png', { width: 512, height: 512, bitDepth: 8, colorType: 6 });
  if (icon && icon.bytes > 1024 * 1024) problems.push('play-icon-512.png: exceeds Play\'s 1MB limit');

  checkPng('play-feature-graphic-1024x500.png', {
    width: 1024,
    height: 500,
    bitDepth: 8,
    colorType: 2,
  });

  for (const theme of ['light', 'dark']) {
    const directory = path.join(store, 'screenshots', theme);
    if (!fs.existsSync(directory)) {
      problems.push(`screenshots/${theme}: missing directory`);
      continue;
    }
    const files = fs.readdirSync(directory).filter((file) => file.toLowerCase().endsWith('.png')).sort();
    if (files.length < 2 || files.length > 8) {
      problems.push(`screenshots/${theme}: has ${files.length} PNGs; Play accepts 2–8 per device type`);
    }
    for (const name of files) {
      const relative = path.join('screenshots', theme, name);
      const meta = inspectPng(path.join(store, relative));
      report.push(meta);
      for (const problem of validateScreenshotMeta(meta)) problems.push(`${relative}: ${problem}`);
    }
  }

  return { problems, report };
}

if (require.main === module) {
  const { problems, report } = validatePlayAssets();
  for (const meta of report) {
    console.log(`${path.relative(MOBILE, meta.file)}: ${meta.width}×${meta.height}, ${meta.bytes} bytes, PNG color type ${meta.colorType}`);
  }
  if (problems.length > 0) {
    console.error(`\nPlay asset validation FAILED (${problems.length}):`);
    console.error(problems.map((problem) => `  - ${problem}`).join('\n'));
    process.exit(1);
  }
  console.log('\nAll Google Play image assets meet the mandatory format and dimension rules.');
}

module.exports = { inspectPng, validateScreenshotMeta, validatePlayAssets };

