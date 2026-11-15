// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Changelog page shows whatever `scripts/lib/changelog-data.mjs` makes of
 * CHANGELOG.md, and `copy-changelog.mjs` never fails a build over it. So a
 * heading or bullet the parser misreads would quietly drop release notes from
 * the page. These tests run the parser on small examples of every shape the
 * file uses, and then on the real CHANGELOG.md, where the number of entries
 * must equal the number of bullets.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildIndex,
  firstSentenceEnd,
  parseChangelog,
  splitEntry,
} from '../../../../scripts/lib/changelog-data.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

const SAMPLE = `# Changelog

All notable changes are documented here. See [Keep a Changelog](https://keepachangelog.com/).

- A bullet in the preamble is not a release note.

---

## [Unreleased]

### Added
- **A bold title (15 Nov 2026)**: the detail, with \`code.ts\` and a [guide](docs/I18N.md).
- **A bold sentence.** Its detail follows without a colon.
- A plain entry with no bold lead. It has a second sentence, e.g. this one.

### Fixed
- One sentence only, nothing more to say

### Added
- **A second Added block joins the first**: same release, same heading.

## [2.0.0] - 2026-09-16

**Version two is here.** An opening paragraph before any entry.

### Changed
- **BREAKING:** The old endpoint is gone. Use the new one instead.
- **A wrapped entry whose bold title runs
  onto a second line.** And whose detail
  is wrapped too.
  - a nested point
  - another nested point

A loose paragraph after an entry belongs to that entry.

#### Sub-group
- **Grouped entry**: sits under a fourth-level heading.

---

## [1.5.0-rc.1] – 2026-03-27

- **An entry before any section heading**: goes under "Other".

---

## Project history

- This bullet is not a release note either.

## Support

- **Issues**: nor is this one.

[Unreleased]: https://github.com/example/repo/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/example/repo/compare/v1.5.0...v2.0.0
`;

describe('splitting the changelog into releases', () => {
  const { releases } = parseChangelog(SAMPLE);
  const release = (slug: string) => {
    const found = releases.find((candidate) => candidate.slug === slug);
    if (!found) throw new Error(`no release ${slug}`);
    return found;
  };
  const entries = (slug: string, type: string) =>
    release(slug).sections.find((section) => section.type === type)?.entries ?? [];

  it('finds each release, newest first, with its date and a slug usable as a file name', () => {
    expect(releases.map((item) => [item.version, item.slug, item.date, item.isUnreleased])).toEqual([
      ['Unreleased', 'unreleased', '', true],
      ['2.0.0', '2.0.0', '2026-09-16', false],
      ['1.5.0-rc.1', '1.5.0-rc.1', '2026-03-27', false],
    ]);
  });

  it('takes the GitHub comparison link for a release from the foot of the file', () => {
    expect(release('2.0.0').compareUrl).toBe('https://github.com/example/repo/compare/v1.5.0...v2.0.0');
    expect(release('1.5.0-rc.1').compareUrl).toBeNull();
  });

  it('leaves out the preamble and everything after the last release', () => {
    const everything = JSON.stringify(releases);
    expect(everything).not.toContain('preamble');
    expect(everything).not.toContain('Project history');
    expect(everything).not.toContain('not a release note either');
    expect(everything).not.toContain('Issues');
  });

  it('merges a heading that appears twice in one release', () => {
    expect(release('unreleased').sections.map((section) => [section.type, section.entries.length])).toEqual([
      ['added', 4],
      ['fixed', 1],
    ]);
  });

  it('uses a bold lead as the title, without its trailing punctuation', () => {
    const [colon, fullStop] = entries('unreleased', 'added');
    expect(colon?.title).toBe('A bold title (15 Nov 2026)');
    // The detail stands alone on the page, so it starts with a capital.
    expect(colon?.body.startsWith('The detail, with `code.ts`')).toBe(true);
    expect(fullStop?.title).toBe('A bold sentence');
    expect(fullStop?.body).toBe('Its detail follows without a colon.');
  });

  it('points links to repository files at GitHub, where they exist', () => {
    expect(entries('unreleased', 'added')[0]?.body).toContain(
      '[guide](https://github.com/jasperfordesq-ai/Project-NEXUS/blob/main/docs/I18N.md)',
    );
  });

  it('uses the first sentence as the title when there is no bold lead', () => {
    const plain = entries('unreleased', 'added')[2];
    expect(plain?.title).toBe('A plain entry with no bold lead.');
    expect(plain?.body).toBe('It has a second sentence, e.g. this one.');
  });

  it('gives a one-sentence entry no detail to open', () => {
    expect(entries('unreleased', 'fixed')[0]).toEqual({
      title: 'One sentence only, nothing more to say',
      body: '',
    });
  });

  it('marks a BREAKING entry and titles it with what broke', () => {
    const breaking = entries('2.0.0', 'changed')[0];
    expect(breaking?.breaking).toBe(true);
    expect(breaking?.title).toBe('The old endpoint is gone.');
    expect(breaking?.body).toBe('Use the new one instead.');
    expect(entries('2.0.0', 'changed')[1]?.breaking).toBeUndefined();
  });

  it('keeps wrapped lines, nested bullets and a following paragraph with their entry', () => {
    const wrapped = entries('2.0.0', 'changed')[1];
    expect(wrapped?.title).toBe('A wrapped entry whose bold title runs onto a second line');
    expect(wrapped?.body).toContain('And whose detail\nis wrapped too.');
    expect(wrapped?.body).toContain('- a nested point\n- another nested point');
    expect(wrapped?.body).toContain('A loose paragraph after an entry belongs to that entry.');
  });

  it('keeps a paragraph written above the first entry as the release intro', () => {
    expect(release('2.0.0').intro).toBe('**Version two is here.** An opening paragraph before any entry.');
    expect(release('unreleased').intro).toBe('');
  });

  it('carries a fourth-level heading on the entries under it', () => {
    expect(entries('2.0.0', 'changed')[2]).toMatchObject({ title: 'Grouped entry', group: 'Sub-group' });
  });

  it('files an entry with no section heading under "other"', () => {
    expect(entries('1.5.0-rc.1', 'other').map((entry) => entry.title)).toEqual([
      'An entry before any section heading',
    ]);
  });

  it('builds an index with counts and no entry text', () => {
    const index = buildIndex({ releases });
    expect(index.releases[0]).toEqual({
      version: 'Unreleased',
      slug: 'unreleased',
      date: '',
      isUnreleased: true,
      compareUrl: 'https://github.com/example/repo/compare/v2.0.0...HEAD',
      total: 5,
      counts: [
        { type: 'added', label: 'Added', count: 4 },
        { type: 'fixed', label: 'Fixed', count: 1 },
      ],
    });
    expect(JSON.stringify(index)).not.toContain('the detail');
  });

  it('refuses two releases that would share a file name', () => {
    expect(() => parseChangelog('## [1.0.0] - 2026-01-01\n\n## [1.0.0] - 2026-01-02\n')).toThrow(/repeated slug/);
  });
});

describe('starting the detail with a capital', () => {
  it('leaves code and mixed-case words as written', () => {
    expect(splitEntry('**Title**: `npm run build` now works.').body).toBe('`npm run build` now works.');
    expect(splitEntry('**Title**: iOS builds are signed.').body).toBe('iOS builds are signed.');
    expect(splitEntry('**Title**: a short detail.').body).toBe('A short detail.');
  });
});

describe('finding where a title ends', () => {
  it('does not stop at a full stop inside code or a version number', () => {
    const text = 'The `file.test.ts` suite for v3.2.0 passes again. More detail.';
    expect(text.slice(0, firstSentenceEnd(text))).toBe('The `file.test.ts` suite for v3.2.0 passes again.');
  });

  it('stops before a nested list', () => {
    const text = 'Three things changed on the page\n- one\n- two';
    expect(splitEntry(text)).toMatchObject({ title: 'Three things changed on the page', body: '- one\n- two' });
  });
});

describe('the real CHANGELOG.md', () => {
  const markdown = readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8').replace(/\r\n?/g, '\n');
  const { releases } = parseChangelog(markdown);

  it('has every release, each with a date and a file-safe, unique slug', () => {
    expect(releases.length).toBeGreaterThanOrEqual(22);
    expect(releases[0]?.isUnreleased).toBe(true);

    const slugs = releases.map((release) => release.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const release of releases) {
      expect(release.slug).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
      if (!release.isUnreleased) {
        expect(release.date, release.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(release.compareUrl, release.version).toMatch(/^https:\/\/github\.com\//);
      }
    }
  });

  it('loses no entry: one parsed entry for every bullet inside a release', () => {
    // Counted independently of the parser: top-level bullets between the first
    // release heading and the first `## ` heading that is not a release.
    let inRelease = false;
    let bullets = 0;
    for (const line of markdown.split('\n')) {
      if (/^## \[/.test(line)) inRelease = true;
      else if (/^## /.test(line)) inRelease = false;
      else if (inRelease && line.startsWith('- ')) bullets += 1;
    }

    const parsed = releases.reduce(
      (sum, release) => sum + release.sections.reduce((inner, section) => inner + section.entries.length, 0),
      0,
    );

    expect(bullets).toBeGreaterThan(5000);
    expect(parsed).toBe(bullets);
  });

  it('gives every entry a title, and shows no closing section as a release note', () => {
    for (const release of releases) {
      for (const section of release.sections) {
        for (const entry of section.entries) {
          expect(entry.title.length, `${release.version} / ${section.label}`).toBeGreaterThan(0);
        }
      }
    }
    const oldest = JSON.stringify(releases[releases.length - 1]);
    expect(oldest).not.toContain('Project NEXUS development began');
    expect(oldest).not.toContain('Security reports');
  });

  it('keeps the index small enough to open the page with', () => {
    expect(JSON.stringify(buildIndex({ releases })).length).toBeLessThan(40_000);
  });
});
