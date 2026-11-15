// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The shapes of the changelog data files written at build time by
 * `scripts/copy-changelog.mjs` (parser: `scripts/lib/changelog-data.mjs`) into
 * `public/changelog-data/`. The page reads `index.json` first, then one
 * `<slug>.json` per release as each is opened.
 */

/** One change. `title` is plain text; `body` is markdown and may be empty. */
export interface ChangelogEntry {
  title: string;
  body: string;
  /** Present (and true) only on entries marked `**BREAKING:**`. */
  breaking?: boolean;
  /** The `####` sub-heading the entry sat under, where a release used them. */
  group?: string;
}

/** A `### Added` / `### Fixed` block. `type` is the heading lower-cased. */
export interface ChangelogSection {
  type: string;
  /** The heading as written, shown when `type` has no translation. */
  label: string;
  entries: ChangelogEntry[];
}

interface ChangelogReleaseBase {
  version: string;
  /** File name and link fragment: `3.2.0`, `unreleased`, `1.5.0-rc.1`. */
  slug: string;
  /** `YYYY-MM-DD`, or empty for the unreleased block. */
  date: string;
  isUnreleased: boolean;
  /** The GitHub comparison for this release, from the foot of CHANGELOG.md. */
  compareUrl: string | null;
}

/** A release in full: `/changelog-data/<slug>.json`. */
export interface ChangelogRelease extends ChangelogReleaseBase {
  /** Markdown written above the first entry of the release, if any. */
  intro: string;
  sections: ChangelogSection[];
}

export interface ChangelogTypeCount {
  type: string;
  label: string;
  count: number;
}

/** A release as listed in `/changelog-data/index.json`: counts, no entry text. */
export interface ChangelogReleaseSummary extends ChangelogReleaseBase {
  total: number;
  counts: ChangelogTypeCount[];
}

export interface ChangelogIndex {
  releases: ChangelogReleaseSummary[];
}
