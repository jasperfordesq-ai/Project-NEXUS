// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { execFileSync } from 'child_process';
import path from 'path';

const PHP_ARRAY_COMMAND = 'echo json_encode(require $argv[1], JSON_UNESCAPED_UNICODE);';

const CONTAINER = () => process.env.NEXUS_PHP_CONTAINER || 'nexus-php-app';
const CONTAINER_ROOT = () =>
  (process.env.NEXUS_PHP_CONTAINER_ROOT || '/var/www/html').replace(/\/$/u, '');

/**
 * Dump the whole lang/ tree as one flat JSON document, in ONE PHP process.
 *
 * 🔴 Why this lives here rather than in one gate. This project is Docker-first:
 * PHP runs in the container and AGENTS.md forbids running PHP on the Windows
 * host (the host `vendor/` is incomplete). So a lang gate that shells out to a
 * bare `php` cannot run on a normal dev machine at all.
 *
 * check-php-lang-untranslated.mjs had this host→container fallback inline and
 * therefore worked. check-php-lang-parity.mjs did NOT: it called `php` directly
 * and hard-exited 1 with "PHP CLI not found on PATH", which preflight then
 * reported as a genuine FAILURE rather than an unavailable check — indistinguish-
 * able from real translation drift, on a machine where it could never pass. It
 * also read one PHP process PER FILE (462 of them), which is the cost
 * scripts/php/dump-lang.php was written to remove.
 *
 * Both gates now share this. If you add a third reader of lang/*.php, use this
 * and do not reintroduce a bare `php` call.
 *
 * @param {{ root?: string }} [options]
 * @returns {Record<string, Record<string, unknown>>} keyed "<locale>/<file>.php"
 */
export function dumpLangTree({ root = process.cwd() } = {}) {
  const dumpScript = path.join(root, 'scripts', 'php', 'dump-lang.php');
  const langDir = path.join(root, 'lang');
  const opts = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };

  try {
    return JSON.parse(
      execFileSync('php', ['-d', 'display_errors=stderr', dumpScript, langDir], opts),
    );
  } catch (error) {
    // Only a missing `php` binary justifies the container path. A PHP syntax
    // error must surface, not be retried somewhere else and misattributed.
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
  }

  const containerRoot = CONTAINER_ROOT();
  return JSON.parse(
    execFileSync(
      'docker',
      [
        'exec', CONTAINER(), 'php',
        '-d', 'display_errors=stderr',
        `${containerRoot}/scripts/php/dump-lang.php`,
        `${containerRoot}/lang`,
      ],
      opts,
    ),
  );
}

function evaluatePhpArray(executable, args) {
  const output = execFileSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  return JSON.parse(output);
}

export function loadPhpArray(file, { root = process.cwd() } = {}) {
  const phpArgs = [
    '-d',
    'display_errors=stderr',
    '-r',
    PHP_ARRAY_COMMAND,
    file,
  ];

  try {
    return evaluatePhpArray('php', phpArgs);
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const relativeFile = path.relative(path.resolve(root), path.resolve(file));
  if (relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) {
    throw new Error(`Cannot map PHP translation file outside the project root: ${file}`);
  }

  const container = process.env.NEXUS_PHP_CONTAINER || 'nexus-php-app';
  const containerRoot = (process.env.NEXUS_PHP_CONTAINER_ROOT || '/var/www/html').replace(/\/$/u, '');
  const containerFile = `${containerRoot}/${relativeFile.replace(/\\/gu, '/')}`;

  return evaluatePhpArray('docker', [
    'exec',
    container,
    'php',
    '-d',
    'display_errors=stderr',
    '-r',
    PHP_ARRAY_COMMAND,
    containerFile,
  ]);
}
