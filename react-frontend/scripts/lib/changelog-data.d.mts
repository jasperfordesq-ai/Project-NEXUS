// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Types for changelog-data.mjs, so the page's tests can import the parser and
// have its output checked against the shapes the page reads.

import type {
  ChangelogEntry,
  ChangelogIndex,
  ChangelogRelease,
} from '../../src/pages/public/changelog/types';

export function plainText(markdown: string): string;
export function absoluteLinks(markdown: string): string;
export function slugFor(version: string): string;
export function firstSentenceEnd(text: string): number;
export function splitEntry(text: string): Required<Pick<ChangelogEntry, 'title' | 'body' | 'breaking'>>;
export function parseChangelog(markdown: string): { releases: ChangelogRelease[] };
export function buildIndex(parsed: { releases: ChangelogRelease[] }): ChangelogIndex;
