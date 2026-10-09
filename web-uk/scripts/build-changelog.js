// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Turn the repository CHANGELOG.md into pre-rendered, sanitised HTML for /changelog.
 *
 * 🔴 BUILD TIME, NOT REQUEST TIME, and `marked` is a devDependency for that reason.
 * The live accessible frontend ships no markdown parser and parses nothing per
 * request: it serves a generated file. That keeps a 7,900-line document off the hot
 * path and keeps a parser out of an internet-facing app's runtime dependency tree.
 *
 * 🔴 It must be committed. This frontend's Docker build context is `web-uk/`, so
 * CHANGELOG.md is not in its image and it cannot be generated during a production
 * build — the same constraint as the locale catalogues and the feature catalogue.
 *
 * One release per page, not one enormous page: the file holds 18 releases and the
 * largest single release is over 2,000 lines. React renders the lot in the browser;
 * that is a poor trade for the members this frontend exists for.
 *
 * Usage:
 *   node scripts/build-changelog.js                   # write the files
 *   node scripts/build-changelog.js --check           # fail if ANY file is out of date
 *   node scripts/build-changelog.js --check-released  # fail if a RELEASED version is out of date
 *
 * 🔴 `--check-released` is the BLOCKING gate (CI docs-hygiene job and preflight);
 * `--check` is not. Almost every commit edits the `[Unreleased]` section of
 * CHANGELOG.md, so gating `unreleased.json` would force a regeneration — and a
 * generated-file merge conflict between concurrent sessions — on nearly every commit,
 * for a page that only previews what is coming. A released version's section changes
 * once, when `scripts/release.mjs` cuts it, and that tool regenerates these files. A
 * released page going missing or stale is the failure that actually happened: 2.1.0,
 * 3.0.0 and 3.1.0 were absent from /changelog until 9 Oct 2026. `unreleased.json` is
 * refreshed by every release cut and whenever build:changelog is run.
 *
 * Exit codes: 0 up to date / written, 1 out of date, 2 could not run (a dependency is
 * not installed, CHANGELOG.md unreadable) — so preflight can say "not run" honestly.
 */

const fs = require('node:fs');
const path = require('node:path');

// 🔴 `marked` is a devDependency and `sanitize-html` lives in web-uk/node_modules,
// which a root-level `npm ci` does not install. Say so plainly and exit 2, rather
// than letting a bare stack trace read like a broken changelog.
let marked;
let sanitizeCmsHtml;
try {
  ({ marked } = require('marked'));
  ({ sanitizeCmsHtml } = require('../src/lib/html-sanitizer'));
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND') {
    console.error(`build-changelog: a web-uk dependency is not installed (${String(err.message).split('\n')[0]}).`);
    console.error('                 Run `npm --prefix web-uk ci` first. Nothing was checked or written.');
    process.exit(2);
  }
  throw err;
}

const repoRoot = path.join(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'CHANGELOG.md');

/**
 * 🔴 ONE FILE PER RELEASE, plus a small index — not one document.
 *
 * The first version of this wrote a single 2.7 MB JSON. Two things were wrong with
 * that: `require` pulled the entire rendered history into memory at boot to serve a
 * page that needs one release, and every new release rewrote the whole blob, so each
 * release produced a 2.7 MB diff in a public repository.
 */
const outputDir = path.join(__dirname, '..', 'src', 'lib', 'generated', 'changelog');
const indexPath = path.join(outputDir, 'index.json');

/**
 * GOV.UK classes for the elements the changelog actually uses. Applied after render
 * because marked emits bare tags, and unstyled markdown inside a GOV.UK page looks
 * like a rendering fault rather than a document.
 */
const GOVUK_CLASSES = Object.freeze([
  [/<h3>/g, '<h3 class="govuk-heading-s">'],
  [/<h4>/g, '<h4 class="govuk-heading-s">'],
  [/<p>/g, '<p class="govuk-body">'],
  [/<ul>/g, '<ul class="govuk-list govuk-list--bullet">'],
  [/<ol>/g, '<ol class="govuk-list govuk-list--number">'],
  [/<a /g, '<a class="govuk-link" '],
  [/<table>/g, '<table class="govuk-table">'],
  [/<thead>/g, '<thead class="govuk-table__head">'],
  [/<tbody>/g, '<tbody class="govuk-table__body">'],
  [/<tr>/g, '<tr class="govuk-table__row">'],
  [/<th>/g, '<th class="govuk-table__header" scope="col">'],
  [/<td>/g, '<td class="govuk-table__cell">'],
]);

function applyGovukClasses(html) {
  return GOVUK_CLASSES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), html);
}

/**
 * Split the file on its release headings.
 *
 * Handles `## [1.2.3] - 2026-01-01` and `## [Unreleased]`. Everything before the first
 * release heading is the preamble (the Keep-a-Changelog boilerplate) and is dropped:
 * the page explains itself in its own words, in eleven languages.
 */
function splitReleases(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headingRe = /^##\s+\[([^\]]+)\](?:\s*[-–]\s*(.+))?\s*$/;

  const releases = [];
  let current = null;

  for (const line of lines) {
    const m = headingRe.exec(line);
    if (m) {
      current = {
        version: m[1].trim(),
        date: (m[2] || '').trim(),
        lines: [],
      };
      releases.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  return releases;
}

/** A URL-safe id for a version, so /changelog/2.0.0 and /changelog/unreleased both work. */
function slugFor(version) {
  return version.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
}

function build() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`CHANGELOG.md not found at ${sourcePath}`);
  }

  const markdown = fs.readFileSync(sourcePath, 'utf8');
  const releases = splitReleases(markdown);

  if (releases.length === 0) {
    throw new Error('No "## [version]" headings found in CHANGELOG.md — has its format changed?');
  }

  const seen = new Set();
  const rendered = releases.map((release) => {
    const slug = slugFor(release.version);
    if (seen.has(slug)) {
      throw new Error(`Duplicate release slug "${slug}" — two headings reduce to the same URL.`);
    }
    seen.add(slug);

    const body = release.lines.join('\n').trim();

    // 🔴 Sanitise even though the source is our own file. It is rendered into every
    // reader's page, the file takes contributions, and `marked` passes raw HTML
    // through by default — so this is the difference between a trusted-input
    // assumption and a guarantee.
    const html = sanitizeCmsHtml(applyGovukClasses(marked.parse(body, { async: false })));

    // A rough size signal for the index, so the page can warn before a long read.
    const headingCount = (body.match(/^###\s+/gm) || []).length;

    return {
      version: release.version,
      slug,
      date: release.date,
      isUnreleased: /^unreleased$/i.test(release.version),
      sectionCount: headingCount,
      lineCount: release.lines.length,
      html,
    };
  });

  return rendered;
}

function serialise(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** The index carries metadata only — no HTML — so it stays small enough to load at boot. */
function indexPayload(releases) {
  return {
    _README:
      'GENERATED by web-uk/scripts/build-changelog.js from the repository CHANGELOG.md — '
      + 'do not edit by hand. Each release body is a sibling <slug>.json. Refresh with '
      + '`npm --prefix web-uk run build:changelog`; `npm --prefix web-uk run check:changelog` '
      + 'fails when these files are out of date.',
    releaseCount: releases.length,
    releases: releases.map(({ html, ...meta }) => meta),
  };
}

function expectedFiles(releases) {
  const files = new Map();
  files.set('index.json', serialise(indexPayload(releases)));
  for (const release of releases) {
    const { lineCount, sectionCount, ...body } = release;
    files.set(`${release.slug}.json`, serialise(body));
  }
  return files;
}

/**
 * The index with everything an `[Unreleased]` edit moves taken out: the unreleased
 * entry (its line and section counts change with every entry) and `releaseCount`.
 * What is left is exactly the released history.
 */
function releasedIndexShape(text) {
  const { releaseCount, ...rest } = JSON.parse(text);
  return JSON.stringify({
    ...rest,
    releases: (rest.releases || []).filter((release) => !release.isUnreleased),
  });
}

/** Problems with the released-version pages only. See the header for why. */
function releasedProblems(releases, files, onDisk) {
  const unreleasedFiles = new Set(
    releases.filter((release) => release.isUnreleased).map((release) => `${release.slug}.json`),
  );
  const problems = [];

  for (const [name, content] of files) {
    if (unreleasedFiles.has(name)) continue;
    const file = path.join(outputDir, name);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === null) {
      problems.push(`missing: ${name}`);
    } else if (name === 'index.json') {
      let same = false;
      try {
        same = releasedIndexShape(current) === releasedIndexShape(content);
      } catch {
        // Unparseable index: report it as out of date.
      }
      if (!same) problems.push('out of date: index.json (its released-version entries)');
    } else if (current !== content) {
      problems.push(`out of date: ${name}`);
    }
  }
  for (const name of onDisk) {
    if (!files.has(name) && !unreleasedFiles.has(name)) {
      problems.push(`stale, no longer in CHANGELOG.md: ${name}`);
    }
  }
  return problems;
}

function main() {
  const checkReleased = process.argv.includes('--check-released');
  const check = process.argv.includes('--check');
  let releases;
  try {
    releases = build();
  } catch (err) {
    console.error(`build-changelog: ${err.message}`);
    process.exit(2);
  }
  const files = expectedFiles(releases);

  const onDisk = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((name) => name.endsWith('.json'))
    : [];

  if (checkReleased) {
    const problems = releasedProblems(releases, files, onDisk);
    const releasedCount = releases.filter((release) => !release.isUnreleased).length;
    if (problems.length) {
      console.error('FAIL: the accessible frontend\'s changelog pages for released versions are out of date.');
      for (const problem of problems.slice(0, 15)) console.error(`  - ${problem}`);
      if (problems.length > 15) console.error(`  ...and ${problems.length - 15} more`);
      console.error('      Run `npm --prefix web-uk run build:changelog` and commit web-uk/src/lib/generated/changelog/.');
      console.error('      (scripts/release.mjs does this itself when it cuts a release.)');
      process.exit(1);
    }
    console.log(`Released changelog pages up to date: ${releasedCount} releases (unreleased.json is not gated, by design).`);
    return;
  }

  if (check) {
    const problems = [];
    for (const [name, content] of files) {
      const file = path.join(outputDir, name);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (current === null) problems.push(`missing: ${name}`);
      else if (current !== content) problems.push(`out of date: ${name}`);
    }
    // A release removed or renamed upstream must not leave a stale page behind.
    for (const name of onDisk) {
      if (!files.has(name)) problems.push(`stale, no longer in CHANGELOG.md: ${name}`);
    }

    if (problems.length) {
      console.error('FAIL: the generated changelog is out of date.');
      for (const problem of problems.slice(0, 15)) console.error(`  - ${problem}`);
      if (problems.length > 15) console.error(`  ...and ${problems.length - 15} more`);
      console.error('      Run `npm --prefix web-uk run build:changelog` and commit the result.');
      process.exit(1);
    }
    console.log(`Changelog up to date: ${releases.length} releases.`);
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of onDisk) {
    if (!files.has(name)) fs.rmSync(path.join(outputDir, name));
  }
  for (const [name, content] of files) {
    fs.writeFileSync(path.join(outputDir, name), content, 'utf8');
  }
  console.log(`Changelog written: ${releases.length} releases into ${path.relative(repoRoot, outputDir)}.`);
}

main();
