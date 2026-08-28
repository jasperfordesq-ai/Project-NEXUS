// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * LoyaltyHistoryPage — Member's history of time-credit redemptions
 * at participating local marketplace merchants.
 *
 * Renders the GET /v2/caring-community/loyalty/my-history payload.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Coins from 'lucide-react/icons/coins';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LoyaltyRedemption {
  id: number;
  credits_used: number;
  exchange_rate_chf: number;
  discount_chf: number;
  order_total_chf: number;
  status: 'pending' | 'applied' | 'reversed';
  redeemed_at: string;
  merchant_id: number | null;
  merchant_name: string;
  marketplace_listing_id: number | null;
  listing_title: string | null;
}

interface HistoryResponse {
  items: LoyaltyRedemption[];
}

function formatHoursShort(
  hours: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t('hours_short', { count: hours.toFixed(2) });
}

const dateFormatter = () => new Intl.DateTimeFormat(getFormattingLocale(), {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDate(value: string): string {
  return dateFormatter().format(new Date(value));
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LoyaltyHistoryPage() {
  const { t } = useTranslation('common');
  const { tenantPath } = useTenant();
  const [items, setItems] = useState<LoyaltyRedemption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(t('loyalty.history.meta.title'));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<HistoryResponse>('/v2/caring-community/loyalty/my-history')
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setItems(res.data.items || []);
        } else {
          setError(t('loyalty.history.errors.load_failed'));
          setItems([]);
        }
      })
      .catch((err) => {
        logError('LoyaltyHistoryPage: fetch failed', err);
        if (!cancelled) {
          setError(t('loyalty.history.errors.load_failed'));
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <PageMeta
        title={t('loyalty.history.meta.title')}
        description={t('loyalty.history.meta.description')}
      />

      <Link
        to={tenantPath('/caring-community')}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('loyalty.history.back')}
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <Coins className="w-7 h-7 text-warning" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-foreground">
          {t('loyalty.history.meta.title')}
        </h1>
      </div>
      <p className="text-sm text-muted mb-6">
        {t('loyalty.history.subtitle')}
      </p>

      {loading && (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!loading && (items?.length ?? 0) === 0 && (
        <EmptyState
          title={t('loyalty.history.empty.title')}
          description={t('loyalty.history.empty.body')}
          icon={<Coins className="w-12 h-12 text-muted" aria-hidden="true" />}
        />
      )}

      {!loading && items && items.length > 0 && (
        <GlassCard className="overflow-hidden">
          <Table aria-label={t('loyalty.history.table.aria')} mobileCards removeWrapper>
            <TableHeader>
              <TableColumn>{t('loyalty.history.table.date')}</TableColumn>
              <TableColumn>{t('loyalty.history.table.merchant')}</TableColumn>
              <TableColumn className="hidden sm:table-cell">
                {t('loyalty.history.table.item')}
              </TableColumn>
              <TableColumn align="end">{t('loyalty.history.table.credits')}</TableColumn>
              <TableColumn align="end">{t('loyalty.history.table.discount')}</TableColumn>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-foreground">
                    {formatDate(row.redeemed_at)}
                  </TableCell>
                  <TableCell className="text-foreground">
                    {row.merchant_name || (
                      <span aria-label={t('not_available')}>{t('empty_dash')}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-foreground">
                    {row.marketplace_listing_id && row.listing_title ? (
                      <Link
                        to={tenantPath(`/marketplace/${row.marketplace_listing_id}`)}
                        className="text-accent hover:underline"
                      >
                        {row.listing_title}
                      </Link>
                    ) : (
                      <span aria-label={t('not_available')}>{t('empty_dash')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHoursShort(row.credits_used, t)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Chip variant="flat" color="success" size="sm">
                      CHF {row.discount_chf.toFixed(2)}
                    </Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </GlassCard>
      )}

      {error && !loading && (
        <p role="alert" className="mt-4 text-sm text-danger">{error}</p>
      )}
    </div>
  );
}

export default LoyaltyHistoryPage;
