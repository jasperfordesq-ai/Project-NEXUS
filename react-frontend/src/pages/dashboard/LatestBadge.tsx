// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member's newest badge, on the dashboard's "Your progress" card (warmth
 * phase 5). Drawn with the same medallion as the achievements page. The
 * medallion is a picture only; the badge's name is plain text beside it, so a
 * screen reader reads the name once. The caller renders this only when the
 * member has earned a badge — there is no empty state.
 */

import { useTranslation } from 'react-i18next';
import { BadgeMedallion } from '@/components/achievements/BadgeMedallion';
import { useBadgeCopy } from '@/hooks/useBadgeCopy';
import { formatDateValue } from '@/lib/helpers';

/** One row of GET /v2/gamification/badges (user_badges merged with its definition). */
export interface EarnedBadge {
  badge_key: string;
  name?: string;
  name_code?: string | null;
  icon?: string | null;
  type?: string | null;
  rarity?: string | null;
  awarded_at?: string | null;
}

export function LatestBadge({ badge }: { badge: EarnedBadge }) {
  const { t } = useTranslation(['dashboard', 'gamification']);
  const { badgeName } = useBadgeCopy();
  const name = badgeName(badge);
  const earnedOn = badge.awarded_at
    ? formatDateValue(badge.awarded_at, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  return (
    <div data-testid="dashboard-latest-badge" className="flex min-w-0 items-center gap-3 rounded-lg bg-theme-elevated p-2">
      <BadgeMedallion icon={badge.icon} kind={badge.type} rarity={badge.rarity} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-theme-subtle">{t('gamification.latest_badge')}</p>
        <p className="break-words text-sm font-medium text-theme-primary">{name}</p>
        {earnedOn !== '—' && (
          <p className="text-xs text-theme-subtle">{t('gamification:achievements.earned_date', { date: earnedOn })}</p>
        )}
      </div>
    </div>
  );
}
