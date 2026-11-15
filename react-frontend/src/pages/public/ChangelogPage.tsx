// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ChangelogPage
 *
 * The project's CHANGELOG.md, one release at a time.
 *
 * Until 15 Nov 2026 this page downloaded the whole file (3.78 MB, 5,186
 * entries) and printed it as a single page. It now opens with a list of
 * releases; opening one fetches that release and shows its changes as short
 * titles, each opening to its detail. A search box looks through every
 * release.
 *
 * The data is split at build time by `scripts/copy-changelog.mjs` into
 * `public/changelog-data/` — see `./changelog/useChangelog.ts`. No changelog
 * text lives in the JS bundle.
 *
 * Each release has an address: `/changelog#v3.2.0` opens that release.
 */

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ScrollText from 'lucide-react/icons/scroll-text';
import ExternalLink from 'lucide-react/icons/external-link';

import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate } from '@/lib/helpers';
import { queryWords } from '@/pages/help/guides/searchText';

import { ChangelogSearchResults, findMatches } from './changelog/ChangelogSearchResults';
import { ReleaseChanges } from './changelog/ReleaseChanges';
import type { ChangelogReleaseSummary } from './changelog/types';
import { useChangelog } from './changelog/useChangelog';

const GITHUB_CHANGELOG = 'https://github.com/jasperfordesq-ai/Project-NEXUS/blob/main/CHANGELOG.md';

type Keys = Set<string | number>;

/** The fragment that opens a release: `#v3.2.0`, or `#unreleased`. */
export function anchorFor(release: Pick<ChangelogReleaseSummary, 'slug' | 'isUnreleased'>): string {
  return release.isUnreleased ? release.slug : `v${release.slug}`;
}

function currentFragment(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

/** Bring a release's row to the top of the window, clear of the fixed header. */
function scrollToRelease(slug: string) {
  // Slugs are [a-z0-9.-] (checked when the data is built), so safe in a selector.
  document.querySelector(`[data-release="${slug}"]`)?.scrollIntoView?.({ block: 'start' });
}

export function ChangelogPage() {
  const { t, i18n } = useTranslation('public');
  usePageTitle(t('changelog_page.title'));

  const { index, releases, loadRelease, loadAll } = useChangelog();
  const [query, setQuery] = useState('');
  const words = useMemo(() => queryWords(query), [query]);
  const deferredWords = useDeferredValue(words);
  const isSearching = words.length > 0;

  // A release with nothing in it (the unreleased block, straight after a
  // release is cut) is not worth a row.
  const listed = useMemo(
    () => (index.status === 'ok' ? index.data.releases.filter((release) => release.total > 0) : []),
    [index],
  );
  const latest = index.status === 'ok' ? index.data.releases.find((release) => !release.isUnreleased) : undefined;

  // Which release is open on arrival: the one the address names, else the newest.
  const arrival = useMemo(() => {
    const wanted = currentFragment();
    const named = listed.find((release) => anchorFor(release) === wanted);
    const first = named ?? listed[0];
    return { keys: new Set<string | number>(first ? [first.slug] : []), scrollTo: named ? named.slug : null };
  }, [listed]);

  // Null until someone opens or closes a row themselves.
  const [chosen, setChosen] = useState<Keys | null>(null);
  const open = chosen ?? arrival.keys;

  useEffect(() => {
    for (const slug of open) loadRelease(String(slug));
  }, [open, loadRelease]);

  useEffect(() => {
    if (arrival.scrollTo) scrollToRelease(arrival.scrollTo);
  }, [arrival.scrollTo]);

  // A link to another release followed while the page is already open changes
  // only the fragment: the page is not loaded again, so open that release here.
  useEffect(() => {
    const onFragmentChange = () => {
      const wanted = currentFragment();
      const named = listed.find((release) => anchorFor(release) === wanted);
      if (!named) return;
      setChosen((previous) => new Set([...(previous ?? arrival.keys), named.slug]));
      // After the row has opened, so the browser's own jump does not win.
      window.requestAnimationFrame(() => scrollToRelease(named.slug));
    };
    window.addEventListener('hashchange', onFragmentChange);
    return () => window.removeEventListener('hashchange', onFragmentChange);
  }, [listed, arrival.keys]);

  useEffect(() => {
    if (isSearching) loadAll();
  }, [isSearching, loadAll]);

  const nameOf = (release: ChangelogReleaseSummary) =>
    release.isUnreleased
      ? t('changelog_page.latest_changes')
      : t('changelog_page.version', { number: release.version });

  // The date is a calendar day with no time, so it is read as UTC: otherwise
  // a reader west of Greenwich would see the day before.
  const dateOf = (release: ChangelogReleaseSummary) =>
    release.isUnreleased || !/^\d{4}-\d{2}-\d{2}$/.test(release.date)
      ? ''
      : formatDate(release.date, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

  const onOpenChange = (keys: Keys) => {
    const next = new Set(keys);
    const opened = [...next].find((key) => !open.has(key));
    setChosen(next);
    const release = listed.find((candidate) => candidate.slug === opened);
    if (release) {
      // Give the address the release just opened, so it can be shared. The
      // router's own state object is kept: it lives in history.state.
      window.history.replaceState(window.history.state, '', `#${anchorFor(release)}`);
    }
  };

  const found = useMemo(
    () => (index.status === 'ok' ? findMatches(index.data, releases, deferredWords, t) : { groups: [], total: 0 }),
    [index, releases, deferredWords, t],
  );
  const searchPending =
    isSearching &&
    index.status === 'ok' &&
    index.data.releases.some((release) => {
      const state = releases[release.slug];
      return !state || state.status === 'loading';
    });
  const searchFailures =
    index.status === 'ok' && index.data.releases.some((release) => releases[release.slug]?.status === 'error');

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-4 sm:px-6 lg:px-8">
      <PageMeta title={t('changelog_page.meta_title')} description={t('changelog_page.meta_description')} />

      <div className="space-y-4">
        <PublicPageHero
          eyebrow={t('release_stage')}
          title={t('changelog_page.heading')}
          description={t('changelog_page.subheading')}
          icon={<ScrollText className="h-7 w-7" aria-hidden="true" />}
          stats={
            latest
              ? [
                  { label: t('changelog_page.latest_release'), value: latest.version },
                  {
                    label: t('changelog_page.releases_heading'),
                    value: String(listed.filter((release) => !release.isUnreleased).length),
                  },
                ]
              : undefined
          }
          action={
            <Button
              as="a"
              href={GITHUB_CHANGELOG}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              endContent={<ExternalLink className="size-4" aria-hidden="true" />}
            >
              {t('changelog_page.view_on_github')}
            </Button>
          }
        />

        {index.status === 'ok' && (
          <div role="search" className="space-y-2">
            <SearchField
              size="lg"
              className="w-full"
              placeholder={t('changelog_page.search_placeholder')}
              aria-label={t('changelog_page.search_placeholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {/* Always in the page, so a screen reader hears the count change. */}
            <p role="status" data-testid="changelog-match-count" className="min-h-5 text-sm text-theme-muted">
              {isSearching && searchPending
                ? t('changelog_page.searching')
                : isSearching && found.total > 0
                  ? t('changelog_page.results_count', { total: found.total })
                  : ''}
            </p>
            {!i18n.language.toLowerCase().startsWith('en') && (
              <p className="text-sm text-theme-muted">{t('changelog_page.english_only')}</p>
            )}
          </div>
        )}
      </div>

      {index.status === 'loading' && (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('changelog_page.loading')}
          className="flex items-center justify-center gap-3 rounded-2xl border border-theme-default bg-theme-card py-12 text-theme-muted"
        >
          <Spinner size="sm" />
          <span className="text-sm">{t('changelog_page.loading')}</span>
        </div>
      )}

      {index.status === 'error' && (
        <div
          role="alert"
          className="rounded-2xl border border-theme-default bg-theme-card px-4 py-8 text-center text-sm text-danger"
        >
          {t('changelog_page.error')}
          <p className="mt-2 font-mono text-xs text-theme-muted">{index.message}</p>
        </div>
      )}

      {index.status === 'ok' && isSearching && (
        <ChangelogSearchResults
          // A new search starts from the first page of results again.
          key={deferredWords.join(' ')}
          groups={found.groups}
          total={found.total}
          isPending={searchPending || words !== deferredWords}
          hasFailures={searchFailures}
          nameOf={nameOf}
          dateOf={dateOf}
          onClear={() => setQuery('')}
          onRetry={loadAll}
        />
      )}

      {index.status === 'ok' && !isSearching && (
        <section aria-label={t('changelog_page.releases_heading')}>
          <Accordion
            variant="splitted"
            selectionMode="multiple"
            data-testid="changelog-releases"
            itemClasses={{
              title: 'text-lg font-semibold text-foreground',
              subtitle: 'text-sm text-theme-muted',
              // HeroUI's default arrow is too faint to see on the light theme.
              indicator: 'text-theme-muted',
            }}
            expandedKeys={open}
            onExpandedChange={onOpenChange}
          >
            {listed.map((release) => {
              const name = nameOf(release);
              return (
                <AccordionItem
                  key={release.slug}
                  id={release.slug}
                  data-release={release.slug}
                  // Clear of the fixed header when a link jumps to this row.
                  className="scroll-mt-24"
                  headingLevel={2}
                  title={<span id={anchorFor(release)}>{name}</span>}
                  subtitle={
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>
                        {release.isUnreleased
                          ? t('changelog_page.latest_changes_hint')
                          : t('changelog_page.released_on', { date: dateOf(release) })}
                      </span>
                      <span className="tabular-nums">{t('changelog_page.changes_total', { total: release.total })}</span>
                    </span>
                  }
                >
                  {/* Only an open release is drawn: a closed one has not been fetched. */}
                  {open.has(release.slug) && (
                    <ReleaseChanges
                      summary={release}
                      release={releases[release.slug]}
                      name={name}
                      onRetry={() => loadRelease(release.slug)}
                    />
                  )}
                </AccordionItem>
              );
            })}
          </Accordion>
        </section>
      )}
    </div>
  );
}

export default ChangelogPage;
