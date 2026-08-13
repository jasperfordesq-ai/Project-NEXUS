// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Cross-namespace translation keys — t('gamification:achievements.xp_value') —
// only resolve when that namespace has actually been loaded. i18n.ts keeps
// startup lean (four namespaces) and relies on useTranslation('ns') to lazy-load
// the rest, so a file that references 'other_ns:key' without listing 'other_ns'
// in its own useTranslation() call renders the RAW KEY to the user. That shipped
// to production on the Explore page's Top Contributors strip, which showed
// "achievements.xp_value" under every avatar.
//
// This check fails when a file references a namespace it never asked for.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, '..', 'src');
const I18N_CONFIG = path.join(SOURCE_ROOT, 'i18n.ts');

const EXCLUDED_DIRECTORIES = new Set(['__tests__', 'test']);
const EXCLUDED_FILE_PATTERN = /\.(?:spec|stories|test)\.(?:ts|tsx)$/;

/** Namespaces i18n.ts loads before first render — always safe to reference. */
function readStartupNamespaces() {
  const source = fs.readFileSync(I18N_CONFIG, 'utf8');
  const block = source.match(/const STARTUP_NAMESPACES\s*=\s*\[([^\]]*)\]/);
  if (!block) {
    throw new Error(
      'Could not read STARTUP_NAMESPACES from src/i18n.ts — update this check to match.',
    );
  }
  return new Set([...block[1].matchAll(/['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]));
}

function collectProductionFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        collectProductionFiles(entryPath, files);
      }
      continue;
    }

    if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts') &&
      !EXCLUDED_FILE_PATTERN.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function toRelativePath(filePath) {
  return path.relative(SOURCE_ROOT, filePath).replaceAll('\\', '/');
}

function declaredNamespaces(source) {
  const declared = new Set();
  for (const call of source.matchAll(/useTranslation\(\s*(\[[^\]]*\]|['"][a-z0-9_]+['"])/g)) {
    for (const name of call[1].matchAll(/['"]([a-z0-9_]+)['"]/g)) {
      declared.add(name[1]);
    }
  }
  return declared;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

const startupNamespaces = readStartupNamespaces();
const violations = [];

for (const filePath of collectProductionFiles(SOURCE_ROOT)) {
  const source = fs.readFileSync(filePath, 'utf8');
  const declared = declaredNamespaces(source);

  for (const use of source.matchAll(/\bt\(\s*['"]([a-z0-9_]+):([^'"]*)['"]/g)) {
    const [, namespace, key] = use;
    if (startupNamespaces.has(namespace) || declared.has(namespace)) continue;

    violations.push({
      file: toRelativePath(filePath),
      line: lineOf(source, use.index),
      namespace,
      key,
      declared: [...declared],
    });
  }
}

if (violations.length > 0) {
  console.error(
    `\n${violations.length} translation key(s) reference a namespace that is never loaded:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  t('${v.namespace}:${v.key}')`);
    console.error(
      `    useTranslation() in this file declares: ${
        v.declared.length ? v.declared.map((n) => `'${n}'`).join(', ') : '(none)'
      }`,
    );
    console.error(
      `    Fix: useTranslation(['${v.declared[0] ?? v.namespace}'${
        v.declared.length ? `, '${v.namespace}'` : ''
      }]) — the first entry stays the default namespace.\n`,
    );
  }
  process.exit(1);
}

console.log(
  `i18n namespace check passed — every cross-namespace key resolves (startup namespaces: ${[
    ...startupNamespaces,
  ].join(', ')}).`,
);
