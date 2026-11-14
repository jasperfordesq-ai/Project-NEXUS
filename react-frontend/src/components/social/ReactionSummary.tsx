// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ReactionSummary — Shows grouped reaction counts below posts/comments.
 *
 * Displays reaction emojis with counts (e.g. "heart 5  laugh 3  clap 2")
 * plus a text summary ("John, Mary, and 8 others").
 * Clicking lazy-loads a modal with tabs per reaction type showing user avatars.
 */

import React, { lazy, Suspense, useState, useCallback } from 'react';

import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import {
  REACTION_EMOJI_MAP,
  REACTION_LABEL_MAP,
  type ReactionType,
} from './reactions';
import { Button } from '@/components/ui/Button';
import type { SortedReactionTypes } from './ReactionDetailsModal';

const ReactionDetailsModal = lazy(() => import('./ReactionDetailsModal').then((module) => ({ default: module.ReactionDetailsModal })));

/* ───────────────────────── Types ───────────────────────── */

export interface ReactionSummaryProps {
  /** Reaction counts by type, e.g. { love: 5, laugh: 3 } */
  counts: Record<string, number>;
  /** Total reaction count */
  total: number;
  /** Names of a few top reactors for the summary text */
  topReactors?: Array<{ id: number; name: string; avatar_url?: string | null }>;
  /** Entity type — any polymorphic feed item type (post, comment, listing, event, etc.) */
  entityType: string;
  /** Entity ID for loading reactor details */
  entityId: number;
  /**
   * False shows the count without opening the list of who reacted (a visitor
   * who is not signed in). Defaults to true.
   */
  isInteractive?: boolean;
}

/* ───────────────────────── Component ───────────────────────── */

const renderEmoji = (type: string) => {
  if (type === 'time_credit') {
    return <Clock className="w-3 h-3 text-accent" aria-hidden="true" />;
  }
  return (
    <span role="img" aria-label={REACTION_LABEL_MAP[type as ReactionType] ?? type}>
      {REACTION_EMOJI_MAP[type as ReactionType] ?? type}
    </span>
  );
};

export function ReactionSummary({
  counts,
  total,
  topReactors = [],
  entityType,
  entityId,
  isInteractive = true,
}: ReactionSummaryProps) {
  const { t } = useTranslation('feed');
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  // Sort reaction types by count descending
  const sortedTypes = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a) as SortedReactionTypes;

  if (total === 0 || sortedTypes.length === 0) {
    return null;
  }

  // Build summary text
  const summaryText = (() => {
    if (topReactors.length === 0) {
      return `${total} ${total === 1 ? tr('card.reaction', 'reaction') : tr('card.reactions', 'reactions')}`;
    }
    const names = topReactors.map((r) => r.name);
    const remaining = total - names.length;
    if (remaining <= 0) {
      return names.join(', ');
    }
    if (names.length === 1) {
      return `${names[0]} ${tr('card.and', 'and')} ${remaining} ${remaining === 1 ? tr('card.other', 'other') : tr('card.others', 'others')}`;
    }
    return `${names.join(', ')}, ${tr('card.and', 'and')} ${remaining} ${remaining === 1 ? tr('card.other', 'other') : tr('card.others', 'others')}`;
  })();
  const viewReactionsLabel = tr('card.view_reactions_aria', 'View reactions: {{summary}}').replace(
    '{{summary}}',
    summaryText
  );

  const emojiBadges = (
    <span className="flex items-center -space-x-0.5">
      {sortedTypes.slice(0, 3).map(([type]) => (
        <span
          key={type}
          className="w-5 h-5 rounded-full bg-[var(--surface-elevated)] border border-[var(--border-default)] flex items-center justify-center text-xs"
        >
          {renderEmoji(type)}
        </span>
      ))}
    </span>
  );

  if (!isInteractive) {
    return (
      <span className="flex min-h-[28px] items-center gap-1.5 text-xs text-[var(--text-subtle)]">
        {emojiBadges}
        <span>{summaryText}</span>
      </span>
    );
  }

  /* ───── Render inline summary ───── */

  return (
    <>
      {/* Inline summary row */}
      <Button
        variant="ghost"
        size="sm"
        onPress={handleOpenModal}
        className="flex min-h-[28px] items-center gap-1.5 px-0 py-0 text-xs text-[var(--text-subtle)] transition-colors hover:text-[var(--text-primary)]"
        aria-label={viewReactionsLabel}
      >
        {emojiBadges}
        <span>{summaryText}</span>
      </Button>

      {isModalOpen && (
        <Suspense fallback={null}>
          <ReactionDetailsModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            sortedTypes={sortedTypes}
            total={total}
            entityType={entityType}
            entityId={entityId}
          />
        </Suspense>
      )}
    </>
  );
}

export default ReactionSummary;
