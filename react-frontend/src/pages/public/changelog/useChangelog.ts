// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Loads the changelog a piece at a time: the index of releases when the page
 * opens, then each release's entries when someone opens it (or all of them,
 * once, when someone searches).
 *
 * The files are written at build time by `scripts/copy-changelog.mjs`. Every
 * answer is checked to be the JSON we expect: a server without the
 * `/changelog-data/` rule answers 200 with the app's own HTML for a missing
 * file, which the old page accepted and printed (see changelogServing.test.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChangelogIndex, ChangelogRelease } from './types';

/** Where the data files live. The server rule in nginx.bluegreen.conf names the same path. */
export const CHANGELOG_DATA_PATH = '/changelog-data/';

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; message: string };

async function fetchJson(file: string): Promise<unknown> {
  const response = await fetch(`${CHANGELOG_DATA_PATH}${file}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function isIndex(value: unknown): value is ChangelogIndex {
  return typeof value === 'object' && value !== null && Array.isArray((value as ChangelogIndex).releases);
}

function isRelease(value: unknown): value is ChangelogRelease {
  return typeof value === 'object' && value !== null && Array.isArray((value as ChangelogRelease).sections);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface UseChangelog {
  index: Loadable<ChangelogIndex>;
  /** By slug. A release that has not been asked for has no entry. */
  releases: Record<string, Loadable<ChangelogRelease>>;
  /** Fetch one release. Does nothing if it is loading or loaded; retries one that failed. */
  loadRelease: (slug: string) => void;
  /** Fetch every release not yet loaded, for the search. */
  loadAll: () => void;
}

export function useChangelog(): UseChangelog {
  const [index, setIndex] = useState<Loadable<ChangelogIndex>>({ status: 'loading' });
  const [releases, setReleases] = useState<Record<string, Loadable<ChangelogRelease>>>({});
  // What has been asked for, kept outside state so two calls in one render
  // (opening a release while a search starts) cannot both fetch it.
  const inFlight = useRef(new Set<string>());
  const loaded = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetchJson('index.json')
      .then((data) => {
        if (!mounted.current) return;
        // An empty list is what copy-changelog.mjs writes when it had no
        // CHANGELOG.md to read: nothing to show, so send people to GitHub.
        if (!isIndex(data) || data.releases.length === 0) throw new Error('No releases in the changelog index');
        setIndex({ status: 'ok', data });
      })
      .catch((error: unknown) => {
        if (mounted.current) setIndex({ status: 'error', message: messageOf(error) });
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadRelease = useCallback((slug: string) => {
    if (inFlight.current.has(slug) || loaded.current.has(slug)) return;
    inFlight.current.add(slug);
    setReleases((previous) => ({ ...previous, [slug]: { status: 'loading' } }));

    fetchJson(`${encodeURIComponent(slug)}.json`)
      .then((data) => {
        if (!isRelease(data)) throw new Error('Unexpected answer for this release');
        loaded.current.add(slug);
        if (mounted.current) setReleases((previous) => ({ ...previous, [slug]: { status: 'ok', data } }));
      })
      .catch((error: unknown) => {
        if (mounted.current) {
          setReleases((previous) => ({ ...previous, [slug]: { status: 'error', message: messageOf(error) } }));
        }
      })
      .finally(() => {
        inFlight.current.delete(slug);
      });
  }, []);

  const loadAll = useCallback(() => {
    if (index.status !== 'ok') return;
    for (const release of index.data.releases) loadRelease(release.slug);
  }, [index, loadRelease]);

  return { index, releases, loadRelease, loadAll };
}
