#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One detector, three clients. The source is
 * react-frontend/src/lib/textLanguage/ (textLanguage.ts, markers.json,
 * vocabulary/, __fixtures__/corpus.json). This copies it to the phone app and
 * converts it to CommonJS for the accessible site, so all three decide the same
 * way about leaving out the Translate button.
 *
 *   node scripts/sync-text-language.mjs          # write the copies
 *   node scripts/sync-text-language.mjs --check  # fail if any copy has drifted
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'react-frontend', 'src', 'lib', 'textLanguage');
const MOBILE = path.join(ROOT, 'mobile', 'lib', 'textLanguage');
const WEBUK = path.join(ROOT, 'web-uk', 'src', 'lib', 'text-language');
const check = process.argv.includes('--check');

const GENERATED = '// GENERATED from react-frontend/src/lib/textLanguage by scripts/sync-text-language.mjs — edit the source there, then run that script.\n';
const HEADER_END = '// See NOTICE file for attribution and acknowledgements.\n';

function withNote(source) {
  const at = source.indexOf(HEADER_END);
  if (at === -1) throw new Error('textLanguage.ts lost its licence header');
  const cut = at + HEADER_END.length;
  return `${source.slice(0, cut)}${GENERATED}${source.slice(cut)}`;
}

function toCommonJs(source) {
  const ts = createRequire(path.join(ROOT, 'react-frontend', 'package.json'))('typescript');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  return outputText;
}

/*
 * The phone app ships the word lists as bundled files (data/*.txt, read on
 * first use by readerVocabulary.ts), not as JavaScript: compiled into the
 * Hermes bundle they cost ~0.85 MB of start-up weight and broke the app's
 * bundle budget. So its copy of textLanguage.ts takes markers from
 * onDeviceData.ts, which the loader fills.
 */
const MARKERS_IMPORT = "import markers from './markers.json';\n";
const MOBILE_MARKERS_IMPORT = "import { markers } from './onDeviceData';\n";

function forMobile(source) {
  if (!source.includes(MARKERS_IMPORT)) throw new Error('textLanguage.ts no longer imports markers.json the way the phone copy expects');
  return source.replace(MARKERS_IMPORT, MOBILE_MARKERS_IMPORT);
}

/** vocabulary/eng.json → data/eng.txt; markers.json → data/markers.txt */
function mobileDataPath(rel) {
  return path.join(MOBILE, 'data', `${path.basename(rel, '.json')}.txt`);
}

function sourceFiles() {
  const files = new Map();
  const code = fs.readFileSync(path.join(SOURCE, 'textLanguage.ts'), 'utf8').replace(/\r\n/g, '\n');
  const data = ['markers.json', ...fs.readdirSync(path.join(SOURCE, 'vocabulary')).sort().map((f) => `vocabulary/${f}`), '__fixtures__/corpus.json'];
  files.set(path.join(MOBILE, 'textLanguage.ts'), withNote(forMobile(code)));
  files.set(path.join(WEBUK, 'textLanguage.js'), withNote(toCommonJs(code)));
  for (const rel of data) {
    const content = fs.readFileSync(path.join(SOURCE, rel), 'utf8').replace(/\r\n/g, '\n');
    files.set(rel.startsWith('__fixtures__/') ? path.join(MOBILE, rel) : mobileDataPath(rel), content);
    files.set(path.join(WEBUK, rel), content);
  }
  return files;
}

const wanted = sourceFiles();
const problems = [];
for (const [file, content] of wanted) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === content) continue;
  if (check) problems.push(path.relative(ROOT, file));
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
// A copy that no longer exists at the source is stale too.
for (const dir of [path.join(MOBILE, 'data'), path.join(MOBILE, 'vocabulary'), path.join(WEBUK, 'vocabulary')]) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (wanted.has(file)) continue;
    if (check) problems.push(`${path.relative(ROOT, file)} (no longer in the source)`);
    else fs.rmSync(file);
  }
}
// The phone app's lists used to be JavaScript modules; they are data/*.txt now.
const oldMobileMarkers = path.join(MOBILE, 'markers.json');
if (fs.existsSync(oldMobileMarkers)) {
  if (check) problems.push(`${path.relative(ROOT, oldMobileMarkers)} (the app reads data/markers.txt)`);
  else fs.rmSync(oldMobileMarkers);
}

if (check) {
  if (problems.length) {
    console.error('Text-language copies are out of date:\n  ' + problems.join('\n  ') + '\nRun: node scripts/sync-text-language.mjs');
    process.exit(1);
  }
  console.log(`Text-language copies match the source (${wanted.size} files).`);
} else {
  console.log(`Text-language copies written (${wanted.size} files).`);
}
