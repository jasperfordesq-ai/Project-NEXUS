// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A community milestone on the dashboard (warmth plan N6): when the hours the
 * whole community has shared pass a round number, a small celebration in the
 * community colour, with the same confetti a completed exchange gets.
 *
 * It shows a community total only — the figure the public front page already
 * shows (`GET /v2/platform/stats`, resolved for this community) — and nothing
 * about any member. Each member sees a milestone once: after they close it, it
 * stays closed until the next one is reached.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import X from 'lucide-react/icons/x';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { ConfettiCelebration } from '@/components/ui/ConfettiCelebration';
import { useAuth, useTenant } from '@/contexts';
import { useSiteAccent } from '@/contexts/SiteAccentContext';
import { api } from '@/lib/api';
import { confettiColoursFor } from '@/lib/confettiColours';
import { getFormattingLocale } from '@/lib/helpers';

/** The round numbers worth stopping for, smallest first. */
export const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000] as const;

/** The largest milestone the community's hours have reached, or null below the first. */
export function milestoneReached(hours: number | null | undefined): number | null {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return null;
  let reached: number | null = null;
  for (const milestone of MILESTONES) {
    if (hours >= milestone) reached = milestone;
  }
  return reached;
}

function storageKey(tenantId: unknown, userId: unknown, milestone: number): string {
  return `nexus_milestone_closed_${String(tenantId)}_${String(userId)}_${milestone}`;
}

function wasClosed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

const STANDARD_ACCENT = '#5b5ede';

export function CommunityMilestone({ className = '' }: { className?: string }) {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { tenant, branding } = useTenant();
  const accent = useSiteAccent() ?? STANDARD_ACCENT;
  const [hours, setHours] = useState<number | null>(null);
  const [closedKey, setClosedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ hours_exchanged?: number; scope?: string }>('/v2/platform/stats')
      .then((response) => {
        // Only this community's own total: never a platform-wide figure.
        if (cancelled || !response.success || response.data?.scope !== 'tenant') return;
        setHours(Number(response.data.hours_exchanged ?? 0));
      })
      .catch(() => {
        // No figure, no celebration.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const confetti = useMemo(
    () => confettiColoursFor(accent),
    [accent],
  );

  const milestone = milestoneReached(hours);
  if (!milestone || !user?.id) return null;

  const key = storageKey(tenant?.id, user.id, milestone);
  if (closedKey === key || wasClosed(key)) return null;

  const close = () => {
    setClosedKey(key);
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Storage unavailable: it simply shows again next visit.
    }
  };

  // Passed as `hours`, not `count`: `count` is i18next's plural selector and must be a number.
  const formattedHours = milestone.toLocaleString(getFormattingLocale());
  const community = branding?.name || tenant?.name || '';

  return (
    <Card data-testid="community-milestone" className={`relative overflow-hidden border-0 bg-accent-soft shadow-none ${className}`}>
      {/* Like the exchange thank-you: the site's reduced-motion rules still it. */}
      <ConfettiCelebration show colors={confetti} />
      <CardBody className="relative flex flex-row items-center gap-4 p-4 sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-strong text-white shadow-sm">
          <HeartHandshake className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-theme-primary">{t('milestone.title', { hours: formattedHours })}</h2>
          <p className="text-sm leading-6 text-theme-secondary">{t('milestone.body', { community, hours: formattedHours })}</p>
        </div>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('milestone.close')} onPress={close}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </CardBody>
    </Card>
  );
}

export default CommunityMilestone;
