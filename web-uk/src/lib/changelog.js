// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The release history behind /changelog, pre-rendered by scripts/build-changelog.js.
 *
 * 🔴 The index is loaded at boot; a release BODY is loaded only when someone asks for
 * it. The rendered history is 2.7 MB across 18 releases, and a page needs one of them.
 */

const fs = require('node:fs');
const path = require('node:path');

const generatedDir = path.join(__dirname, 'generated', 'changelog');

const index = require(path.join(generatedDir, 'index.json'));

/** Release metadata, newest first — the order CHANGELOG.md itself uses. */
function listReleases() {
  return index.releases;
}

/**
 * One release, body included, or null when the slug is unknown.
 *
 * 🔴 The slug is checked against the index BEFORE it reaches the filesystem. It comes
 * straight from the URL, so building a path from it unchecked would be a path
 * traversal; matching it against known slugs first means only a generated file can
 * ever be read.
 */
function findRelease(slug) {
  const wanted = String(slug || '').trim().toLowerCase();
  if (!wanted) return null;

  const meta = index.releases.find((release) => release.slug === wanted);
  if (!meta) return null;

  const file = path.join(generatedDir, `${meta.slug}.json`);
  if (!fs.existsSync(file)) return null;

  const body = require(file);
  return { ...meta, html: body.html };
}

/** The most recent real release, skipping an Unreleased section if there is one. */
function latestRelease() {
  return index.releases.find((release) => !release.isUnreleased) || null;
}

module.exports = {
  findRelease,
  latestRelease,
  listReleases,
  releaseCount: index.releaseCount,
};
