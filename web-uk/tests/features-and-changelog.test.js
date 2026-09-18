// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const fs = require('fs');
const path = require('path');

const {
  ALL_CATEGORIES,
  allGroups,
  categoryOptions,
  chromeFor,
  filterCatalogue,
  groupCount,
  itemCount
} = require('../src/lib/features-catalogue');
const { findRelease, latestRelease, listReleases, releaseCount } = require('../src/lib/changelog');

describe('feature catalogue', () => {
  it('carries the whole shared catalogue', () => {
    expect(groupCount).toBe(8);
    expect(itemCount).toBe(119);
    expect(filterCatalogue({ locale: 'en' }).total).toBe(119);
  });

  it('🔴 stays in step with the shared source the React page reads', () => {
    // The two /features pages are generated from one catalogue precisely so they
    // cannot drift. If this fails, run `npm --prefix web-uk run build:features`.
    const shared = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'react-frontend', 'src', 'data', 'featuresCatalogue.json'),
      'utf8'
    ));
    const sharedItems = shared.groups.reduce((n, g) => n + g.items.length, 0);

    expect(shared.groups.length).toBe(groupCount);
    expect(sharedItems).toBe(itemCount);
    expect(shared.groups.map((g) => g.key)).toEqual(allGroups('en').map((g) => g.key));
  });

  it('has every feature translated in every language', () => {
    for (const locale of ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar']) {
      const groups = allGroups(locale);
      expect(groups).toHaveLength(8);
      for (const group of groups) {
        expect(group.title).not.toBe(group.key);
        for (const item of group.items) {
          expect(item.title).not.toBe(item.key);
          expect(item.description.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('records each feature’s maturity, defaulting to generally available', () => {
    const all = allGroups('en').flatMap((g) => g.items);
    const counts = all.reduce((acc, item) => {
      acc[item.maturity] = (acc[item.maturity] || 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({ ga: 79, beta: 11, preview: 21, dormant: 8 });
  });

  it('filters by search term, ignoring case', () => {
    const lower = filterCatalogue({ locale: 'en', query: 'wallet' });
    const upper = filterCatalogue({ locale: 'en', query: 'WALLET' });

    expect(lower.shown).toBeGreaterThan(0);
    expect(lower.shown).toBeLessThan(119);
    expect(upper.shown).toBe(lower.shown);
  });

  it('🔴 ignores accents, in both directions', () => {
    // Folding only the query makes an accented word unfindable by its accented
    // spelling, which is the spelling a native speaker types.
    const plain = filterCatalogue({ locale: 'fr', query: 'federation' });
    const accented = filterCatalogue({ locale: 'fr', query: 'fédération' });

    expect(accented.shown).toBeGreaterThan(0);
    expect(plain.shown).toBe(accented.shown);
  });

  it('filters by category, and combines it with the search term', () => {
    const category = filterCatalogue({ locale: 'en', category: 'federation' });
    expect(category.groups).toHaveLength(1);
    expect(category.groups[0].key).toBe('federation');

    const both = filterCatalogue({ locale: 'en', query: 'wallet', category: 'core_platform' });
    expect(both.shown).toBeLessThanOrEqual(category.total);
    expect(both.groups.every((g) => g.key === 'core_platform')).toBe(true);
  });

  it('🔴 ignores an unknown category instead of matching nothing', () => {
    // Applying it produced "Showing 0 of 119" underneath a dropdown reading
    // "Everything" — a dead end caused by a stale or hand-edited URL.
    const result = filterCatalogue({ locale: 'en', category: 'no_such_group' });

    expect(result.shown).toBe(119);
    expect(result.categoryIsKnown).toBe(false);
  });

  it('drops groups with no surviving items rather than rendering empty headings', () => {
    const result = filterCatalogue({ locale: 'en', query: 'wallet' });

    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it('reports an empty result set honestly', () => {
    const result = filterCatalogue({ locale: 'en', query: 'zzz-nothing-matches-this' });

    expect(result.groups).toHaveLength(0);
    expect(result.shown).toBe(0);
    expect(result.total).toBe(119);
    expect(result.isFiltered).toBe(true);
  });

  it('offers every category plus an "everything" option', () => {
    const options = categoryOptions('en');

    expect(options).toHaveLength(9);
    expect(options[0].value).toBe(ALL_CATEGORIES);
    expect(options.every((o) => o.label && o.label !== o.value)).toBe(true);
  });

  it('falls back to English for a locale it does not have', () => {
    expect(chromeFor('xx').heading).toBe(chromeFor('en').heading);
  });
});

describe('changelog', () => {
  it('lists every release in the changelog', () => {
    const releases = listReleases();

    expect(releaseCount).toBeGreaterThanOrEqual(18);
    expect(releases).toHaveLength(releaseCount);
    expect(releases.every((r) => r.version && r.slug)).toBe(true);
  });

  it('keeps the index free of rendered HTML', () => {
    // The index is loaded at boot; the bodies are 2.7 MB between them and are
    // loaded one at a time, only when someone asks for one.
    for (const release of listReleases()) {
      expect(release.html).toBeUndefined();
    }
  });

  it('loads a release body as sanitised, GOV.UK-classed HTML', () => {
    const release = findRelease('2.0.0');

    expect(release).not.toBeNull();
    expect(release.version).toBe('2.0.0');
    expect(release.html).toContain('govuk-body');
    expect(release.html).not.toMatch(/<p>/);
  });

  it('🔴 strips anything executable from every release', () => {
    // The source is our own file, but it is rendered into every reader's page and
    // `marked` passes raw HTML through by default.
    for (const meta of listReleases()) {
      const { html } = findRelease(meta.slug);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<iframe/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it('returns null for an unknown release', () => {
    expect(findRelease('9.9.9')).toBeNull();
    expect(findRelease('')).toBeNull();
    expect(findRelease(undefined)).toBeNull();
  });

  it('🔴 refuses a slug that tries to escape the generated directory', () => {
    // The slug comes straight from the URL. It is matched against the index before
    // it is ever used to build a path, so only a generated file can be read.
    expect(findRelease('../index')).toBeNull();
    expect(findRelease('../../package')).toBeNull();
    expect(findRelease('..%2Findex')).toBeNull();
  });

  it('finds the newest real release, skipping an unreleased section', () => {
    const latest = latestRelease();

    expect(latest).not.toBeNull();
    expect(latest.isUnreleased).toBe(false);
  });

  it('gives every release a distinct, URL-safe slug', () => {
    const slugs = listReleases().map((r) => r.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9.-]+$/);
  });
});
