// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A membership anniversary on the dashboard (AWID feedback, Nov 2026:
 * "warmth, and community"): in the week after the day a member joined — one
 * year ago or more — a small thank-you in the community colour. Only the
 * member themself sees it (it reads their own join date from the signed-in
 * account), and once they close it, it stays closed until next year.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PartyPopper from 'lucide-react/icons/party-popper';
import X from 'lucide-react/icons/x';
import { Button, Card, CardBody } from '@/components/ui';
import { useAuth, useTenant } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';

const DAY_MS = 86_400_000;
const SHOW_FOR_DAYS = 7;

/** This year's anniversary of the join date, when today falls in the week after it. */
export function anniversaryThisWeek(joinedAt: string | null | undefined, now: Date = new Date()): Date | null {
  if (!joinedAt) return null;
  const joined = new Date(joinedAt);
  if (Number.isNaN(joined.getTime())) return null;
  const anniversary = new Date(now.getFullYear(), joined.getMonth(), joined.getDate());
  if (anniversary.getFullYear() - joined.getFullYear() < 1) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSince = Math.round((today.getTime() - anniversary.getTime()) / DAY_MS);
  return daysSince >= 0 && daysSince < SHOW_FOR_DAYS ? anniversary : null;
}

function storageKey(userId: unknown, year: number): string {
  return `nexus_anniversary_closed_${String(userId)}_${year}`;
}

function wasClosed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function MembershipAnniversary({ className = '' }: { className?: string }) {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { tenant, branding } = useTenant();
  const anniversary = anniversaryThisWeek(user?.created_at);
  const key = anniversary ? storageKey(user?.id, anniversary.getFullYear()) : '';
  const [closed, setClosed] = useState(() => (key ? wasClosed(key) : false));

  if (!anniversary || !user?.created_at || closed) return null;

  const joinedOn = new Date(user.created_at).toLocaleDateString(getFormattingLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const community = branding?.name || tenant?.name || '';

  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Storage unavailable: it simply shows again next visit.
    }
  };

  return (
    <Card data-testid="membership-anniversary" className={`border-0 bg-accent-soft shadow-none ${className}`}>
      <CardBody className="flex flex-row items-center gap-4 p-4 sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-strong text-white shadow-sm">
          <PartyPopper className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-theme-primary">{t('anniversary.title')}</h2>
          <p className="text-sm leading-6 text-theme-secondary">
            {t('anniversary.body', { community, date: joinedOn })}
          </p>
        </div>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('anniversary.close')} onPress={close}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </CardBody>
    </Card>
  );
}

export default MembershipAnniversary;
