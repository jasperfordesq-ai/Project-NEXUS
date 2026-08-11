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
// 🔴 SPLIT 2026-08-11, and both halves still stay out of the PHP image — so
// every assertion below keeps exactly the strength it had. The distinction is
// WHY each one is excluded, which matters now that one of them is production-bound:
//
//   NEVER_DEPLOYED_DIRS — development-only, no production image of its own.
//   OWN_IMAGE_DIRS      — deployed, but from its OWN build context and image.
//                         web-uk moved here when it became the incoming
//                         accessible frontend. Copying it into the PHP image
//                         would be just as wrong as before, for a different
//                         reason: it has its own image.
const NEVER_DEPLOYED_DIRS = ['aspnet-backend'];
const OWN_IMAGE_DIRS = ['web-uk'];
const FORBIDDEN_DIRS = [...NEVER_DEPLOYED_DIRS, ...OWN_IMAGE_DIRS];

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


// --- N. Compose build contexts ---------------------------------------------
//
// 🔴 This closes a hole the checks above cannot see. `.dockerignore` excludes
// web-uk/ from the ROOT (PHP image) build context, which is correct. But someone
// building web-uk from context `.` would hit "file not found", and the obvious
// "fix" is to delete that .dockerignore line — which silently drags the entire
// repository into the PHP production image.
//
// So: web-uk must build from ITS OWN context, aspnet-backend must not be built by
// any compose file at all, and the web-uk service must name `target: production`
// (the default final stage is not guaranteed to be the hardened one, and the
// `development` stage mounts source and runs a dev server).
const COMPOSE_FILES = [
  'compose.bluegreen.yml',
  'compose.webuk.bluegreen.yml',
  'compose.yml'
];

for (const file of COMPOSE_FILES) {
  const text = readIfPresent(file);
  if (text === null) {
    notes.push(`${file}: not present, skipped`);
    continue;
  }

  // Deliberately a line scan rather than a YAML parse: these files use
  // `${VAR:?}` interpolation that throws on load when the variable is unset,
  // which is exactly the situation CI runs in.
  const lines = text.split(/\r?\n/);
  let service = null;
  let context = null;
  let target = null;
  const services = new Map();

  const flush = () => {
    if (service) services.set(service, { context, target });
  };

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "");
    const svc = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (svc) {
      flush();
      service = svc[1];
      context = null;
      target = null;
      continue;
    }
    const ctx = /^\s+context:\s*(\S+)/.exec(line);
    if (ctx) context = ctx[1];
    const tgt = /^\s+target:\s*(\S+)/.exec(line);
    if (tgt) target = tgt[1];
  }
  flush();

  for (const [name, meta] of services) {
    const ctxValue = (meta.context || "").replace(/^\.\//, "").replace(/\/$/, "");

    for (const dir of NEVER_DEPLOYED_DIRS) {
      if (ctxValue === dir) {
        failures.push(
          `${file}: service "${name}" builds from "${meta.context}" — ${dir}/ is ` +
          `development-only and must not be built by any deployment compose file.`
        );
      }
    }

    // A service NAMED after an own-image directory must build from that
    // directory, never from the repository root.
    for (const dir of OWN_IMAGE_DIRS) {
      const slug = dir.replace(/-/g, "");
      if (name !== dir && name !== slug) continue;

      if (!meta.context) {
        failures.push(`${file}: service "${name}" declares no build context; it must build from ./${dir}.`);
        continue;
      }
      if (ctxValue !== dir) {
        failures.push(
          `${file}: service "${name}" builds from "${meta.context}" but must build ` +
          `from ./${dir}. Building it from the repository root would pull the whole ` +
          `repo into its image and invites deleting the .dockerignore line that ` +
          `protects the PHP image.`
        );
      }
      if (meta.target !== "production") {
        failures.push(
          `${file}: service "${name}" must declare \`target: production\` ` +
          `(found ${meta.target ? `"${meta.target}"` : "none"}). The default final ` +
          `stage is not guaranteed to be the hardened one, and the development ` +
          `stage mounts source and runs a dev server.`
        );
      }
      notes.push(`${file}: ${name} builds ./${dir} with target ${meta.target}`);
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
