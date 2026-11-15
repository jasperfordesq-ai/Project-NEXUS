// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The inside of an open release: buttons to show one kind of change, then the
 * changes themselves, a page at a time. The largest release has 721 changes,
 * so the list never renders whole.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ExternalLink from 'lucide-react/icons/external-link';

import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { MarkdownRenderer } from '@/components/content/MarkdownRenderer';

import { ChangeList, type ListedChange } from './ChangeList';
import { kindLabel } from './kindLabel';
import type { ChangelogRelease, ChangelogReleaseSummary } from './types';
import type { Loadable } from './useChangelog';

/** How many changes one press of "Show more" adds. */
export const CHANGES_PER_PAGE = 25;

const ALL = 'all';

interface ReleaseChangesProps {
  summary: ChangelogReleaseSummary;
  /** Undefined until the release has been asked for. */
  release: Loadable<ChangelogRelease> | undefined;
  /** The release's name as shown on its row ("3.2.0", "Latest changes"). */
  name: string;
  onRetry: () => void;
}

export function ReleaseChanges({ summary, release, name, onRetry }: ReleaseChangesProps) {
  const { t } = useTranslation('public');
  const [kind, setKind] = useState(ALL);
  const [shown, setShown] = useState(CHANGES_PER_PAGE);

  // The kinds on show, each with as many of its changes as fit the page so far.
  const { groups, total } = useMemo(() => {
    const sections =
      release?.status === 'ok'
        ? release.data.sections.filter((section) => kind === ALL || section.type === kind)
        : [];
    let room = shown;
    const visible: Array<{ type: string; label: string; count: number; changes: ListedChange[] }> = [];
    for (const section of sections) {
      if (room <= 0) break;
      visible.push({
        type: section.type,
        label: kindLabel(t, section.type, section.label),
        count: section.entries.length,
        changes: section.entries.slice(0, room).map((entry, index) => ({ id: `${section.type}-${index}`, entry })),
      });
      room -= section.entries.length;
    }
    return { groups: visible, total: sections.reduce((sum, section) => sum + section.entries.length, 0) };
  }, [release, kind, shown, t]);

  if (!release || release.status === 'loading') {
    return (
      <div role="status" aria-busy="true" className="flex items-center gap-3 py-4 text-sm text-theme-muted">
        <Spinner size="sm" />
        <span>{t('changelog_page.loading')}</span>
      </div>
    );
  }

  if (release.status === 'error') {
    return (
      <div role="alert" className="space-y-3 py-2 text-sm">
        <p className="text-danger">{t('changelog_page.release_error')}</p>
        <Button size="sm" variant="secondary" onPress={onRetry}>
          {t('changelog_page.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {release.data.intro && (
        // Written in English whatever language the page is in.
        <div lang="en" dir="ltr">
          <MarkdownRenderer content={release.data.intro} variant="changelogEntry" />
        </div>
      )}

      {summary.counts.length > 1 && (
        <ToggleButtonGroup
          aria-label={t('changelog_page.filter_label')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          className="flex flex-wrap gap-1.5"
          selectedKeys={new Set([kind])}
          onSelectionChange={(keys) => {
            const [next] = Array.from(keys);
            if (typeof next !== 'string') return;
            setKind(next);
            setShown(CHANGES_PER_PAGE);
          }}
        >
          <ToggleButton id={ALL}>
            {t('changelog_page.types.all')} <span className="tabular-nums opacity-70">{summary.total}</span>
          </ToggleButton>
          {summary.counts.map((count) => (
            <ToggleButton key={count.type} id={count.type}>
              {kindLabel(t, count.type, count.label)} <span className="tabular-nums opacity-70">{count.count}</span>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}

      {groups.map((group) => (
        <div key={group.type} data-kind={group.type}>
          {/* With every kind on show, each gets a small heading. Once one kind
              is chosen its button already says which, so the heading goes. */}
          {kind === ALL && summary.counts.length > 1 && (
            <h3 className="flex items-baseline gap-2 pt-2 text-sm font-semibold text-theme-primary">
              {group.label}
              <span className="font-normal tabular-nums text-theme-subtle">{group.count}</span>
            </h3>
          )}
          <ChangeList
            // Release (h2) → kind (h3) → change (h4).
            headingLevel={4}
            changes={group.changes}
            label={t('changelog_page.changes_in', { release: `${name}, ${group.label}` })}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {total > shown ? (
          <Button variant="secondary" onPress={() => setShown((count) => count + CHANGES_PER_PAGE)}>
            {t('changelog_page.show_more')}{' '}
            <span className="tabular-nums opacity-70">
              {shown} / {total}
            </span>
          </Button>
        ) : (
          <span />
        )}
        {summary.compareUrl && (
          <a
            href={summary.compareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline underline-offset-4"
          >
            {t('changelog_page.view_release_on_github')}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

export default ReleaseChanges;
