// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * What the changelog search found: the matching changes, grouped under the
 * release each belongs to, newest release first.
 *
 * It searches titles and detail with the Help Centre's matching (every word
 * typed must start a word in the text; accents and capitals are ignored), so
 * this search behaves like the FAQ and guide searches.
 */

import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import SearchX from 'lucide-react/icons/search-x';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { foldText, matchesEveryWord } from '@/pages/help/guides/searchText';

import { ChangeList, type ListedChange } from './ChangeList';
import { kindLabel } from './kindLabel';
import type { ChangelogIndex, ChangelogRelease, ChangelogReleaseSummary } from './types';
import type { Loadable } from './useChangelog';

/** How many matches are shown before "Show more". */
export const RESULTS_PER_PAGE = 30;

export interface ReleaseMatches {
  summary: ChangelogReleaseSummary;
  changes: ListedChange[];
}

interface SearchableChange {
  id: string;
  type: string;
  label: string;
  folded: string;
  entry: ListedChange['entry'];
}

// A release's text is folded once, the first time it is searched: folding all
// 3.7 MB again on every keystroke would be felt.
const searchable = new WeakMap<ChangelogRelease, SearchableChange[]>();

function searchableChanges(release: ChangelogRelease): SearchableChange[] {
  let changes = searchable.get(release);
  if (!changes) {
    changes = release.sections.flatMap((section) =>
      section.entries.map((entry, index) => ({
        id: `${release.slug}-${section.type}-${index}`,
        type: section.type,
        label: section.label,
        folded: foldText(`${entry.title} ${entry.group ?? ''} ${entry.body}`),
        entry,
      })),
    );
    searchable.set(release, changes);
  }
  return changes;
}

/** The matching changes in every release loaded so far, in the index's order. */
export function findMatches(
  index: ChangelogIndex,
  releases: Record<string, Loadable<ChangelogRelease>>,
  words: string[],
  t: TFunction<'public'>,
): { groups: ReleaseMatches[]; total: number } {
  const groups: ReleaseMatches[] = [];
  let total = 0;
  if (words.length === 0) return { groups, total };

  for (const summary of index.releases) {
    const release = releases[summary.slug];
    if (release?.status !== 'ok') continue;
    const changes = searchableChanges(release.data)
      .filter((change) => matchesEveryWord(change.folded, words))
      .map((change) => ({ id: change.id, entry: change.entry, kind: kindLabel(t, change.type, change.label) }));
    if (changes.length > 0) {
      groups.push({ summary, changes });
      total += changes.length;
    }
  }
  return { groups, total };
}

interface ChangelogSearchResultsProps {
  groups: ReleaseMatches[];
  total: number;
  /** Still fetching releases: an empty result is not final yet. */
  isPending: boolean;
  /** Some releases could not be fetched, so the results may be incomplete. */
  hasFailures: boolean;
  nameOf: (summary: ChangelogReleaseSummary) => string;
  dateOf: (summary: ChangelogReleaseSummary) => string;
  onClear: () => void;
  onRetry: () => void;
}

export function ChangelogSearchResults({
  groups,
  total,
  isPending,
  hasFailures,
  nameOf,
  dateOf,
  onClear,
  onRetry,
}: ChangelogSearchResultsProps) {
  const { t } = useTranslation('public');
  const [shown, setShown] = useState(RESULTS_PER_PAGE);

  // Fill the page from the newest release down, stopping at the limit.
  let room = shown;
  const visible: ReleaseMatches[] = [];
  for (const group of groups) {
    if (room <= 0) break;
    visible.push({ summary: group.summary, changes: group.changes.slice(0, room) });
    room -= group.changes.length;
  }

  return (
    <div data-testid="changelog-search-results" className="space-y-8">
      {hasFailures && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-danger">{t('changelog_page.search_incomplete')}</p>
          <Button size="sm" variant="secondary" onPress={onRetry}>
            {t('changelog_page.retry')}
          </Button>
        </div>
      )}

      {visible.map(({ summary, changes }) => (
        <section key={summary.slug} aria-labelledby={`changelog-found-${summary.slug}`} className="space-y-1">
          <h2 id={`changelog-found-${summary.slug}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg font-semibold text-foreground">{nameOf(summary)}</span>
            <span className="text-sm font-normal text-theme-muted">{dateOf(summary)}</span>
          </h2>
          <ChangeList
            headingLevel={3}
            changes={changes}
            label={t('changelog_page.changes_in', { release: nameOf(summary) })}
          />
        </section>
      ))}

      {total > shown && (
        <Button variant="secondary" onPress={() => setShown((count) => count + RESULTS_PER_PAGE)}>
          {t('changelog_page.show_more')}{' '}
          <span className="tabular-nums opacity-70">
            {shown} / {total}
          </span>
        </Button>
      )}

      {total === 0 && !isPending && (
        <Card className="border border-border shadow-sm">
          <Card.Content className="flex flex-col items-center gap-4 p-4 text-center sm:p-8">
            <span className="inline-flex rounded-2xl bg-accent-soft p-3 text-accent-soft-foreground">
              <SearchX className="size-6" aria-hidden="true" />
            </span>
            <p className="max-w-md text-theme-secondary">{t('changelog_page.no_results')}</p>
            <Button variant="secondary" onPress={onClear}>
              {t('changelog_page.clear_search')}
            </Button>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}

export default ChangelogSearchResults;
