// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useTranslation } from 'react-i18next';

/**
 * LevelProgress - Glassmorphic XP/level progress bar
 *
 * Ported from Next.js glass-progress.tsx, adapted for light/dark theme support.
 * Used in dashboard gamification sidebar and profile pages.
 */

export interface LevelProgressProps {
  currentXP: number;
  requiredXP: number;
  level: number;
  /** Optional: V2 level name (e.g. "Builder", "Champion") */
  levelName?: string;
  /** Optional: show compact variant without level text */
  compact?: boolean;
}

export function LevelProgress({ currentXP, requiredXP, level, levelName, compact = false }: LevelProgressProps) {
  const { t } = useTranslation('common');
  // Guard against negative or NaN values from malformed backend data
  const safeCurrentXP = Math.max(0, currentXP ?? 0);
  const safeRequiredXP = Math.max(0, requiredXP ?? 0);
  const percentage = safeRequiredXP > 0 ? Math.min(Math.round((safeCurrentXP / safeRequiredXP) * 100), 100) : 0;

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex justify-between items-center">
          <span className="text-theme-primary font-medium">
            {levelName ? t('level_named', { level, name: levelName }) : t('level_plain', { level })}
          </span>
          <span className="text-theme-subtle text-sm">
            {t('xp_progress', { current: safeCurrentXP.toLocaleString(getFormattingLocale()), required: safeRequiredXP.toLocaleString(getFormattingLocale()) })}
          </span>
        </div>
      )}
      <div
        className="relative h-3 bg-theme-elevated rounded-full overflow-hidden border border-[var(--border-default)]"
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('level_progress_aria', { level, percentage })}
      >
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent via-accent-gradient-end to-companion rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent dark:from-white/20 dark:to-transparent rounded-full" />
      </div>
      {compact && (
        <div className="flex justify-between text-xs">
          <span className="text-theme-muted">
            {t('xp_progress', { current: safeCurrentXP.toLocaleString(getFormattingLocale()), required: safeRequiredXP.toLocaleString(getFormattingLocale()) })}
          </span>
          <span className="text-theme-primary font-medium">{percentage}%</span>
        </div>
      )}
    </div>
  );
}
