// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's own birthday on the dashboard (warmth phase 6, D4):
 * "Riverside Timebank is three this month", in the community colour, through
 * the month the community was founded — from its first anniversary on.
 *
 * The founded date is set (optionally) by the community's admin on "Make it
 * yours". The server works out the anniversary and sends only
 * `anniversary_years` with the month's totals (GET /v2/community/this-month,
 * the same request the month highlight makes, so the client shares it): no
 * date reaches the page, and it renders nothing when there is no date, in any
 * other month, or before the first birthday. Once a member closes it, it stays
 * closed until the next one.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Cake from 'lucide-react/icons/cake';
import X from 'lucide-react/icons/x';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';

function storageKey(tenantId: unknown, userId: unknown, years: number): string {
  return `nexus_community_birthday_closed_${String(tenantId)}_${String(userId)}_${years}`;
}

function wasClosed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function CommunityAnniversary({ className = '' }: { className?: string }) {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { tenant, branding } = useTenant();
  const [years, setYears] = useState<number | null>(null);
  const [closedKey, setClosedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ anniversary_years?: number | null }>('/v2/community/this-month')
      .then((res) => {
        if (cancelled || !res.success) return;
        const value = Number(res.data?.anniversary_years ?? 0);
        setYears(Number.isInteger(value) && value >= 1 ? value : null);
      })
      .catch(() => {
        // No answer, no birthday. The month highlight logs the same failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!years) return null;

  const key = storageKey(tenant?.id, user?.id, years);
  if (closedKey === key || wasClosed(key)) return null;

  const close = () => {
    setClosedKey(key);
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Storage unavailable: it simply shows again next visit.
    }
  };

  const community = branding?.name || tenant?.name || '';

  return (
    <Card data-testid="community-anniversary" className={`border-0 bg-accent-soft shadow-none ${className}`}>
      <CardBody className="flex flex-row items-center gap-4 p-4 sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-strong text-white shadow-sm">
          <Cake className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-theme-primary">
            {t('community_anniversary.title', { count: years, community })}
          </h2>
          <p className="text-sm leading-6 text-theme-secondary">{t('community_anniversary.body')}</p>
        </div>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('anniversary.close')} onPress={close}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </CardBody>
    </Card>
  );
}

export default CommunityAnniversary;
