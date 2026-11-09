import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Button, Chip, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CouponsPage — AG63 member browse for active merchant coupons.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import Tag from 'lucide-react/icons/tag';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { logError } from '@/lib/logger';

interface CouponItem {
  id: number;
  seller_id: number;
  code: string;
  title: string;
  description: string | null;
  discount_type: 'percent' | 'fixed' | 'bogo';
  discount_value: number;
  min_order_cents: number | null;
  valid_until: string | null;
  status: string;
}

export default function CouponsPage() {
  const { t } = useTranslation('common');
  const toast = useToast();
  const { tenantPath } = useTenant();
  usePageTitle(t('coupon.page_title'));
  const [items, setItems] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ items: CouponItem[] }>('/v2/coupons');
        if (!cancelled) setItems(res.data?.items ?? []);
      } catch (err) {
        logError('CouponsPage.load', err);
        if (!cancelled) toast.error(t('coupon.no_coupons'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast, t]);

  const formatDiscount = (c: CouponItem): string => {
    if (c.discount_type === 'percent') return `${c.discount_value}${t('coupon.type_percent')}`;
    if (c.discount_type === 'fixed') return `€${(c.discount_value / 100).toFixed(2)} ${t('coupon.type_fixed')}`;
    return t('coupon.type_bogo');
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <PageMeta title={t('coupon.page_title')} description={t('coupon.meta_description')} />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <header className="mb-6">
        <PublicPageHero
          size="full"
          title={t('coupon.page_title')}
          description={t('coupon.page_subtitle')}
          icon={<Tag className="h-7 w-7" aria-hidden="true" />}
          accent="indigo"
        />
      </header>

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <Tag className="w-12 h-12 mx-auto mb-3 text-[var(--color-text-secondary)]" aria-hidden="true" />
            <h3 className="text-lg font-semibold mb-1">{t('coupon.no_coupons')}</h3>
            <p className="text-[var(--color-text-secondary)]">{t('coupon.no_coupons_subtitle')}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((c) => (
            <Card key={c.id} className="hover:shadow-lg transition-shadow">
              <CardBody className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <Tag className="w-6 h-6 text-accent" aria-hidden="true" />
                  <Chip size="sm" color="success" variant="flat">
                    {formatDiscount(c)}
                  </Chip>
                </div>
                <h3 className="text-lg font-semibold mb-1 line-clamp-2">{c.title}</h3>
                {c.description && (
                  <p className="text-sm text-[var(--color-text-secondary)] mb-3 line-clamp-2">
                    {c.description}
                  </p>
                )}
                <div className="text-xs font-mono bg-[var(--color-surface-elevated)] px-2 py-1 rounded mb-3">
                  {c.code}
                </div>
                {c.valid_until && (
                  <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                    {t('coupon.valid_until')}: {new Date(c.valid_until).toLocaleDateString(getFormattingLocale())}
                  </p>
                )}
                <Button as={Link} to={tenantPath(`/coupons/${c.id}`)} color="primary" size="sm" fullWidth>
                  {t('coupon.details')}
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
