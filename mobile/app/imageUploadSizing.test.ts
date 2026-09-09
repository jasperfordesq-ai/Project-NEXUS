// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every screen that picks a photo shrinks it before uploading, and nothing still uses the
 * deprecated media-type constant.
 *
 * 🔴 A per-screen test cannot cover this. The defect was not one broken screen — it was the
 * same omission repeated at twelve independent call sites, none of which was wrong on its
 * own terms. `quality: 0.85` looks like it bounds the upload and does not: it re-encodes
 * without resizing, so a 12-megapixel photo still left the phone at 12 megapixels. Only a
 * scan can say "and the twelfth one too". Audit 2026-09-09, item 6.
 */

import fs from 'fs';
import path from 'path';

const appDir = __dirname;
const SEARCH_DIRS = [path.join(appDir, '(modals)'), path.join(appDir, '(tabs)'), path.join(appDir, '..', 'components')];

interface SourceFile {
  name: string;
  source: string;
}

function sourceFiles(dir: string): SourceFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [{ name: entry.name, source: fs.readFileSync(full, 'utf8') }];
  });
}

const files = SEARCH_DIRS.flatMap(sourceFiles);

/** Files that pick from the photo library or camera. */
const pickers = files.filter((file) => /launchImageLibraryAsync|launchCameraAsync/.test(file.source));

/**
 * Screens that pick media but need no resize, and why.
 *
 * A video is not resized — re-encoding video on the device is slow, and the server accepts
 * the file as it is.
 */
const VIDEO_ONLY: Record<string, string> = {};

describe('picked photos are shrunk before upload', () => {
  it('finds the pickers it is meant to police', () => {
    expect(pickers.length).toBeGreaterThanOrEqual(10);
  });

  it('every screen that picks a photo routes it through prepareImageForUpload', () => {
    const missing = pickers
      .filter((file) => !file.source.includes('prepareImageForUpload') && !VIDEO_ONLY[file.name])
      .map((file) => file.name);

    expect(missing).toEqual([]);
  });

  it('uses the current media-type API, not the deprecated constant', () => {
    /*
      `ImagePicker.MediaTypeOptions` is deprecated in the installed expo-image-picker and
      logs a warning on every use. That matters more than usual here: a LogBox banner covers
      the tab bar and swallows the tap beneath it, which has already cost four device flows
      once (see app/_layout.tsx).
    */
    const deprecated = files.filter((file) => file.source.includes('MediaTypeOptions')).map((file) => file.name);

    expect(deprecated).toEqual([]);
  });
});
