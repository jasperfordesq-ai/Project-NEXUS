#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Prepare Maestro's genuine iPhone Simulator captures for human App Store review. */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const EXPECTED_SCREENSHOTS = [
  '01-feed.png',
  '02-listings.png',
  '04-messages.png',
  '05-events.png',
];

const ACCEPTED_PORTRAIT_SIZES = new Set([
  '1260x2736',
  '1290x2796',
  '1320x2868',
]);

function argumentValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function walkPngs(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkPngs(file));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) files.push(file);
  }
  return files;
}

function convertOpaquePngToRgb(buffer) {
  const image = PNG.sync.read(buffer);
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] !== 255) {
      throw new Error('capture contains transparent pixels and cannot be presented as an untouched runtime screenshot');
    }
  }
  return {
    buffer: PNG.sync.write(image, { bitDepth: 8, colorType: 2, inputColorType: 6 }),
    width: image.width,
    height: image.height,
  };
}

function validateNativeSize(width, height) {
  const size = `${width}x${height}`;
  if (!ACCEPTED_PORTRAIT_SIZES.has(size)) {
    throw new Error(`${size} is not an accepted native 6.9-inch App Store portrait size`);
  }
  return size;
}

function prepareScreenshotSet(source, destination, environment = process.env) {
  if (!fs.existsSync(source)) throw new Error(`source directory does not exist: ${source}`);
  const discovered = walkPngs(source);
  fs.mkdirSync(destination, { recursive: true });

  const evidence = [];
  for (const name of EXPECTED_SCREENSHOTS) {
    const candidates = discovered.filter((file) => path.basename(file) === name);
    if (candidates.length !== 1) {
      throw new Error(`${name}: expected exactly one Maestro capture, found ${candidates.length}`);
    }

    const prepared = convertOpaquePngToRgb(fs.readFileSync(candidates[0]));
    const nativeSize = validateNativeSize(prepared.width, prepared.height);
    const output = path.join(destination, name);
    fs.writeFileSync(output, prepared.buffer);

    if (prepared.buffer[25] !== 2) throw new Error(`${name}: prepared PNG still contains an alpha channel`);
    const sha256 = crypto.createHash('sha256').update(prepared.buffer).digest('hex');
    evidence.push({ name, nativeSize, sha256 });
    console.log(`${name}: ${nativeSize}, opaque 24-bit RGB, sha256 ${sha256}`);
  }

  const manifest = {
    evidenceBoundary: 'Unsigned iOS Simulator build; not TestFlight or physical-device evidence.',
    sourceCommit: environment.GITHUB_SHA ?? null,
    simulatorModel: environment.IOS_SIMULATOR_MODEL ?? null,
    simulatorRuntime: environment.IOS_SIMULATOR_RUNTIME ?? null,
    generatedAt: new Date().toISOString(),
    screenshots: evidence,
  };
  fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const source = argumentValue(process.argv.slice(2), '--source');
  const destination = argumentValue(process.argv.slice(2), '--destination');
  if (!source || !destination) {
    throw new Error('usage: prepare-apple-simulator-screenshots.cjs --source <maestro-output> --destination <prepared-output>');
  }
  prepareScreenshotSet(path.resolve(source), path.resolve(destination));
  console.log(`\nPrepared ${EXPECTED_SCREENSHOTS.length} draft App Store screenshots in ${path.resolve(destination)}.`);
}

module.exports = {
  ACCEPTED_PORTRAIT_SIZES,
  EXPECTED_SCREENSHOTS,
  convertOpaquePngToRgb,
  prepareScreenshotSet,
  validateNativeSize,
};
