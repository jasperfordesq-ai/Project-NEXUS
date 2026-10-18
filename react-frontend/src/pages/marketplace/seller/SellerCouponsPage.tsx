// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui/Table';
/**
 * SellerCouponsPage — AG63 seller-side list of own coupons.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

import Plus from 'lucide-react/icons/plus';
import Tag from 'lucide-react/icons/tag';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useTenant, useToast } from '@/contexts';
import { PageMeta } from '@/components/seo/PageMeta';
import { usePageTitle } from '@/hooks';
import { logError } from '@/lib/logger';
import { formatMarketplaceMinorAmount } from '@/lib/marketplaceNumbers';

interface Coupon {
  id: number;
  code: string;
  title: string;
  discount_type: 'percent' | 'fixed' | 'bogo';
  discount_value: number;
  status: string;
  usage_count: number;
  valid_until: string | null;
}

export default function SellerCouponsPage() {
  const { t } = useTranslation(['common', 'marketplace']);
  const confirm = useConfirm();
  const toast = useToast();
  const { tenant, tenantPath } = useTenant();
  usePageTitle(t('coupon.seller.page_title'));

  const [items, setItems] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: Coupon[] }>('/v2/marketplace/seller/coupons');
      if (res.success) {
        setItems(res.data?.items ?? []);
      }
    } catch (err) {
      logError('SellerCouponsPage.load', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: t('coupon.seller.delete_confirm'),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) return;
    try {
      const response = await api.delete(`/v2/marketplace/seller/coupons/${id}`);
      if (!response.success) {
        toast.error(response.error || t('error_title'));
        return;
      }
      toast.success(t('coupon.seller.deleted'));
      load();
    } catch (err) {
      logError('SellerCouponsPage.delete', err);
      toast.error(t('error_title'));
    }
  };

  const formatDiscount = (c: Coupon): string => {
    if (c.discount_type === 'percent') return `${c.discount_value}%`;
    if (c.discount_type === 'fixed') {
      // Stored in the currency's minor unit (see MerchantCouponService::calculateDiscountMinor).
      return formatMarketplaceMinorAmount(c.discount_value, tenant?.currency || '');
    }
    return t('coupon.type_bogo');
  };

  return (
    <>
      <PageMeta title={t('coupon.seller.page_title')} noIndex />
      <div className="container mx-auto px-4 py-8 max-w-6xl">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">{t('coupon.seller.page_title')}</h1>
        <Button
          as={Link}
          to={tenantPath('/marketplace/seller/coupons/new')}

          startContent={<Plus className="w-4 h-4" />}
        >
          {t('coupon.seller.create_button')}
        </Button>
      </header>

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <Tag className="w-12 h-12 mx-auto mb-3 text-[var(--color-text-secondary)]" />
            <p>{t('coupon.seller.no_coupons')}</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <Table aria-label={t('coupon.seller.table_aria')} mobileCards>
              <TableHeader>
                <TableColumn>{t('coupon.code')}</TableColumn>
                <TableColumn>{t('coupon.title')}</TableColumn>
                <TableColumn>{t('coupon.discount')}</TableColumn>
                <TableColumn>{t('coupon.seller.status')}</TableColumn>
                <TableColumn>{t('coupon.seller.usage_count', { count: 0 }).split(' ')[0]}</TableColumn>
                <TableColumn>{t('coupon.valid_until')}</TableColumn>
                <TableColumn>{' '}</TableColumn>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.code}</TableCell>
                    <TableCell>{c.title}</TableCell>
                    <TableCell>{formatDiscount(c)}</TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={c.status === 'active' ? 'success' : c.status === 'paused' ? 'warning' : 'default'}
                        variant="soft"
                      >
                      {t(`coupon.seller.status_${c.status}`, c.status)}
                      </Chip>
                    </TableCell>
                    <TableCell>{c.usage_count}</TableCell>
                    <TableCell>
                      {c.valid_until ? new Date(c.valid_until).toLocaleDateString(getFormattingLocale()) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button
                          as={Link}
                          to={tenantPath(`/marketplace/seller/coupons/${c.id}/edit`)}
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          aria-label={t('marketplace:edit.action_edit')}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="danger-soft"

                          aria-label={t('common.delete')}
                          onPress={() => handleDelete(c.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}
      </div>
    </>
  );
}
