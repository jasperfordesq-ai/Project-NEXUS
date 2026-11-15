// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A list of changes as short titles. A change with more to say opens to show
 * its detail; one that is a single sentence is a plain line.
 *
 * The changes sit in their own Accordion on purpose. A release is itself an
 * item of the page's Accordion, and an opening row placed directly inside it
 * would join that outer group, so opening a change would be reported as
 * opening a release.
 *
 * The detail is markdown and is only rendered while its row is open: a
 * release can hold several hundred changes.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Chip } from '@/components/ui/Chip';
import { MarkdownRenderer } from '@/components/content/MarkdownRenderer';

import type { ChangelogEntry } from './types';

export interface ListedChange {
  /** Unique within the list it is shown in. */
  id: string;
  entry: ChangelogEntry;
  /** The translated kind ("Fixed"), shown as a label when the list mixes kinds. */
  kind?: string;
}

interface ChangeListProps {
  changes: ListedChange[];
  /** Names the list for a screen reader, e.g. "Changes in 3.2.0". */
  label: string;
  /** The heading level of each row, one below the heading the list sits under. */
  headingLevel: number;
}

type Keys = Set<string | number>;

function ChangeTitle({ change, isOpen }: { change: ListedChange; isOpen: boolean }) {
  const { t } = useTranslation('public');
  const { entry, kind } = change;

  return (
    <span className="flex min-w-0 flex-col gap-1">
      {(kind || entry.breaking || entry.group) && (
        <span className="flex flex-wrap items-center gap-1.5">
          {kind && (
            <Chip size="sm" variant="soft" color="default">
              {kind}
            </Chip>
          )}
          {entry.breaking && (
            <Chip size="sm" variant="soft" color="danger">
              {t('changelog_page.breaking')}
            </Chip>
          )}
          {entry.group && (
            <span lang="en" dir="ltr" className="text-xs text-theme-subtle">
              {entry.group}
            </span>
          )}
        </span>
      )}
      {/* Two lines while closed, the whole title once open: some run long.
          The changelog is written in English whatever language the page is
          in, so it is marked as English and laid out left to right. */}
      <span
        lang="en"
        dir="ltr"
        className={`text-sm font-medium leading-6 text-foreground wrap-anywhere ${isOpen ? '' : 'line-clamp-2'}`}
      >
        {entry.title}
      </span>
    </span>
  );
}

export function ChangeList({ changes, label, headingLevel }: ChangeListProps) {
  const [open, setOpen] = useState<Keys>(() => new Set());

  return (
    <Accordion
      aria-label={label}
      data-testid="changelog-changes"
      selectionMode="multiple"
      showDivider={false}
      className="divide-y divide-border"
      expandedKeys={open}
      onExpandedChange={(keys) => setOpen(new Set(keys))}
      itemClasses={{
        trigger: 'px-0 py-3 items-start',
        content: 'px-0 pb-4 pt-0',
        // HeroUI's default arrow is too faint to see on the light theme.
        indicator: 'mt-1 text-theme-muted',
      }}
    >
      {changes.map((change) => {
        const isOpen = open.has(change.id);
        if (!change.entry.body) {
          return (
            <div key={change.id} data-change="plain" className="py-3 pe-7">
              <ChangeTitle change={change} isOpen />
            </div>
          );
        }
        return (
          <AccordionItem
            key={change.id}
            id={change.id}
            data-change="opens"
            headingLevel={headingLevel}
            title={<ChangeTitle change={change} isOpen={isOpen} />}
          >
            {isOpen && (
              <div lang="en" dir="ltr">
                <MarkdownRenderer content={change.entry.body} variant="changelogEntry" />
              </div>
            )}
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

export default ChangeList;
