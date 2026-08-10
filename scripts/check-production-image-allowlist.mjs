#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guards the single mechanism that keeps the experimental monorepo siblings out
 * of the Laravel production image.
 *
 * WHY THIS EXISTS
 * ---------------
 * `aspnet-backend/` and `web-uk/` live in this repository but must never reach
 * production. Two things stop them:
 *
 *   1. `.dockerignore` excludes both directories.
 *   2. `Dockerfile.bluegreen` copies an EXPLICIT ALLOWLIST of directories —
 *      there is no `COPY . .` anywhere in it.
 *
 * (2) is the stronger guarantee: it holds even if (1) is deleted, because
 * nothing copies them. That is worth protecting, because a single well-meant
 * `COPY . .` — added to "simplify" the build or fix a missing-file error —
 * would silently ship both experimental trees into the live PHP image, and
 * nothing else in CI would notice.
 *
 * This check fails if:
 *   - a whole-context COPY/ADD appears in a production Dockerfile;
 *   - a production Dockerfile copies a sibling directory by name;
 *   - `.dockerignore` stops excluding the siblings.
 *
 * It deliberately does NOT pin the exact allowlist contents: adding a legitimate
 * new Laravel directory is normal work and should not need this file edited.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// Images that are built and shipped to production.
const PRODUCTION_DOCKERFILES = [
  'Dockerfile.bluegreen',
  'Dockerfile.prod',
];

// Directories that must never enter a production image.
const FORBIDDEN_DIRS = ['aspnet-backend', 'web-uk'];

const failures = [];
const notes = [];

function readIfPresent(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

// --- 1. No whole-context copies in a production image ------------------------
for (const file of PRODUCTION_DOCKERFILES) {
  const text = readIfPresent(file);
  if (text === null) {
    notes.push(`${file}: not present, skipped`);
    continue;
  }

  const lines = text.split(/\r?\n/);
  let copyCount = 0;

  lines.forEach((line, i) => {
    const n = i + 1;
    const trimmed = line.trim();
    if (/^#/.test(trimmed) || trimmed === '') return;

    const m = /^(COPY|ADD)\s+(.*)$/i.exec(trimmed);
    if (!m) return;
    copyCount++;

    const args = m[2];
    // Ignore `COPY --from=...` (multi-stage: copies from another image, not the
    // build context, so it cannot pull in sibling source).
    if (/--from=/.test(args)) return;

    // Strip flags, then take the source operands (everything but the last).
    const operands = args
      .replace(/--[a-z-]+=\S+/gi, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (operands.length < 2) return;
    const sources = operands.slice(0, -1);

    for (const src of sources) {
      if (src === '.' || src === './' || src === '*' || src === './*') {
        failures.push(
          `${file}:${n}: whole-context ${m[1]} ("${src}") would ship EVERY directory, ` +
          `including ${FORBIDDEN_DIRS.join(' and ')}, into the production image. ` +
          `Use an explicit allowlist of directories instead.`
        );
      }
      for (const dir of FORBIDDEN_DIRS) {
        if (src === dir || src.startsWith(`${dir}/`) || src.startsWith(`./${dir}`)) {
          failures.push(
            `${file}:${n}: ${m[1]} copies "${src}" — ${dir}/ is a development-only ` +
            `sibling and must never enter a production image.`
          );
        }
      }
    }
  });

  if (copyCount === 0) {
    failures.push(`${file}: no COPY/ADD instructions found at all — is this the right file?`);
  } else {
    notes.push(`${file}: ${copyCount} COPY/ADD instruction(s), none whole-context`);
  }
}

// --- 2. .dockerignore still excludes the siblings ----------------------------
const dockerignore = readIfPresent('.dockerignore');
if (dockerignore === null) {
  failures.push('.dockerignore is missing — the second layer of protection is gone.');
} else {
  const entries = dockerignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  for (const dir of FORBIDDEN_DIRS) {
    const excluded = entries.some((e) => {
      const norm = e.replace(/^\/+/, '').replace(/\/+$/, '');
      return norm === dir || norm === `${dir}/**`;
    });
    if (!excluded) {
      failures.push(
        `.dockerignore no longer excludes "${dir}/". Restore it — it is the ` +
        `backstop if a Dockerfile is ever widened.`
      );
    } else {
      notes.push(`.dockerignore excludes ${dir}/`);
    }
  }
}

// --- report ------------------------------------------------------------------
if (failures.length) {
  console.error('production image allowlist check FAILED:\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    '\nThe Laravel production image must copy an explicit list of directories.\n' +
    'See docs/PLATFORM-MONOREPO.md "Deployment isolation".'
  );
  process.exit(1);
}

console.log('production image allowlist check OK');
for (const n of notes) console.log(`  · ${n}`);
