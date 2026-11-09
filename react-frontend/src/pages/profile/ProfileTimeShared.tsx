// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Time shared" on a profile (AWID feedback, Nov 2026: "attractive visuals",
 * "warmth"): the member's hours given and received, with a HeroUI
 * ProgressCircle in the community colour showing how much of their time they
 * have given. The same two numbers the profile always showed, made visible.
 *
 * It sits inside the profile's stats <dl>, so it is one group of dt/dd pairs,
 * like the other stat cards. The ring is decoration: a screen reader reads the
 * numbers, not a percentage.
 */

import { useTranslation } from 'react-i18next';
import { ProgressCircle } from '@heroui/react/progress-circle';
import { GlassCard } from '@/components/ui/GlassCard';
import { getFormattingLocale } from '@/lib/helpers';

interface ProfileTimeSharedProps {
  given: number;
  received: number;
  className?: string;
}

export function ProfileTimeShared({ given, received, className = '' }: ProfileTimeSharedProps) {
  const { t } = useTranslation('profile');
  const total = given + received;
  const givenShare = total > 0 ? Math.round((given / total) * 100) : 0;
  const format = (n: number) => n.toLocaleString(getFormattingLocale(), { maximumFractionDigits: 1 });

  return (
    // One grid, so each dt/dd sits directly in the card, which is the <dl>'s
    // child (a valid dl > div > dt + dd group, like the other stat cards).
    <GlassCard
      data-testid="profile-time-shared"
      className={`grid grid-cols-[5rem_auto_1fr_auto] items-center gap-x-2 gap-y-1 p-4 text-sm ${className}`}
    >
      <div data-testid="profile-time-shared-ring" aria-hidden="true" className="relative row-span-3 me-2 size-20">

        <ProgressCircle aria-label={t('impact.title')} value={givenShare} className="size-20">
          <ProgressCircle.Track className="size-20" strokeWidth={4} viewBox="0 0 36 36">
            <ProgressCircle.TrackCircle cx={18} cy={18} r={15} strokeWidth={4} className="stroke-[var(--accent-soft)]" />
            <ProgressCircle.FillCircle
              cx={18}
              cy={18}
              r={15}
              strokeWidth={4}
              strokeLinecap="round"
              className="stroke-[var(--accent-strong)] dark:stroke-[var(--accent)]"
            />
          </ProgressCircle.Track>
        </ProgressCircle>
        <span
          data-testid="profile-time-shared-total"
          className="absolute inset-0 flex items-center justify-center text-lg font-bold text-theme-primary"
        >
          {format(total)}
        </span>
      </div>
      <p className="col-span-3 text-start font-semibold text-theme-primary">{t('impact.title')}</p>
      <span className="size-2.5 rounded-full bg-accent-strong dark:bg-accent" aria-hidden="true" />
      <dt className="text-start text-theme-secondary">{t('stats.hours_given')}</dt>
      <dd className="text-end font-bold text-theme-primary">{format(given)}</dd>
      <span className="size-2.5 rounded-full bg-accent-soft ring-1 ring-accent/40" aria-hidden="true" />
      <dt className="text-start text-theme-secondary">{t('stats.hours_received')}</dt>
      <dd className="text-end font-bold text-theme-primary">{format(received)}</dd>
    </GlassCard>
  );
}

export default ProfileTimeShared;
