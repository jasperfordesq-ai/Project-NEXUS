// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MyPickupsPage — AG45 click-and-collect: buyer's reservations with QR display.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState } from 'react';import ShoppingBag from 'lucide-react/icons/shopping-bag';
import QrCode from 'lucide-react/icons/qr-code';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useAuth } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';

interface Reservation {
  id: number;
  slot_id: number;
  order_id: number;
  listing_id: number;
  listing_title: string | null;
  qr_code: string;
  status: string;
  reserved_at: string | null;
  picked_up_at: string | null;
  slot: { slot_start: string | null; slot_end: string | null } | null;
}

const formatTime = (s: string | null) => (s ? new Date(s).toLocaleString(getFormattingLocale()) : '—');

const statusColor = (s: string): 'primary' | 'success' | 'warning' | 'danger' => {
  if (s === 'picked_up') return 'success';
  if (s === 'cancelled') return 'danger';
  if (s === 'no_show') return 'warning';
  return 'primary';
};

export function MyPickupsPage() {
  const { t } = useTranslation('marketplace');
  usePageTitle(t('pickup.my_pickups_title'));
  const { isAuthenticated } = useAuth();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<Reservation[]>('/v2/marketplace/me/pickups');
        if (!cancelled && res.success && res.data) setReservations(res.data);
      } catch (err) {
        logError('MyPickupsPage: load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  return (
    <>
      <PageMeta title={t('pickup.my_pickups_title')} noIndex />
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        size="compact"
        title={t('pickup.my_pickups_title')}
        description={t('pickup.my_pickups_subtitle')}
        icon={<ShoppingBag className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
      />

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-16">
          <Spinner size="lg" color="accent" />
        </div>
      ) : reservations.length === 0 ? (
        <GlassCard className="p-8 text-center text-muted">
          {t('pickup.no_pickups')}
        </GlassCard>
      ) : (
        <div className="grid gap-4">
          {reservations.map((r) => (
            <GlassCard key={r.id} className="p-5 space-y-3">
              <div className="flex justify-between items-start gap-4 flex-wrap">
                <div>
                  <p className="font-semibold text-foreground">
                    {r.listing_title || t('pickup.order_n', { id: r.order_id })}
                  </p>
                  <p className="text-sm text-muted">
                    {t('pickup.window')}: {formatTime(r.slot?.slot_start ?? null)}
                  </p>
                </div>
                <Chip color={statusColor(r.status)} variant="soft" size="sm">
                  {t(`pickup.status_${r.status}`)}
                </Chip>
              </div>

              {r.status === 'reserved' && (
                <div className="flex items-center gap-3 p-3 rounded-md bg-surface-secondary">
                  <QrCode className="w-10 h-10 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted">
                      {t('pickup.show_this_code')}
                    </p>
                    <p className="font-mono text-sm font-semibold break-all text-foreground">
                      {r.qr_code}
                    </p>
                  </div>
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}
      </div>
    </>
  );
}

export default MyPickupsPage;
