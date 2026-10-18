// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { CardBody, Card, Button, Chip, Spinner, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, useConfirm } from '@/components/ui';

/**
 * AdminCouponsPage — AG63 admin oversight: list / suspend / delete merchant coupons.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Pause from 'lucide-react/icons/pause';
import Trash2 from 'lucide-react/icons/trash-2';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { formatMarketplaceMinorAmount } from '@/lib/marketplaceNumbers';
import { PageHeader } from '../../components/PageHeader';

interface AdminCoupon {
  id: number;
  seller_id: number;
  code: string;
  title: string;
  discount_type: 'percent' | 'fixed' | 'bogo';
  discount_value: number;
  status: string;
  usage_count: number;
  valid_until: string | null;
  created_at: string;
}

export default function AdminCouponsPage() {
  const { t } = useTranslation(['admin_marketplace', 'common']);
  const confirm = useConfirm();
  usePageTitle(t('marketplace.coupons.page_title'));
  const toast = useToast();
  const { tenant } = useTenant();
  const [items, setItems] = useState<AdminCoupon[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: AdminCoupon[] }>('/v2/admin/marketplace/coupons');
      if (!res.success) {
        // A refused load used to render as "No coupons." — an empty list is not an error.
        toast.error(t('marketplace.coupons.failed_load'));
        return;
      }
      setItems(res.data?.items ?? []);
    } catch {
      toast.error(t('marketplace.coupons.failed_load'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSuspend = async (id: number) => {
    const ok = await confirm({
      title: t('marketplace.coupons.confirm_suspend'),
      status: 'warning',
      confirmLabel: t('common:confirm'),
    });
    if (!ok) return;
    try {
      const res = await api.post(`/v2/admin/marketplace/coupons/${id}/suspend`, {});
      if (res.success) {
        toast.success(t('marketplace.coupons.suspended'));
        load();
      } else {
        toast.error(t('marketplace.coupons.failed_suspend'));
      }
    } catch {
      toast.error(t('marketplace.coupons.failed_suspend'));
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: t('marketplace.coupons.confirm_delete'),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/v2/admin/marketplace/coupons/${id}`);
      if (res.success) {
        toast.success(t('marketplace.coupons.deleted'));
        load();
      } else {
        toast.error(t('marketplace.coupons.failed_delete'));
      }
    } catch {
      toast.error(t('marketplace.coupons.failed_delete'));
    }
  };

  const formatDiscount = (c: AdminCoupon): string => {
    if (c.discount_type === 'percent') return t('marketplace.coupons.discount_percent', { value: c.discount_value });
    if (c.discount_type === 'fixed') {
      // Stored in the currency's minor unit (see MerchantCouponService::calculateDiscountMinor).
      return formatMarketplaceMinorAmount(c.discount_value, tenant?.currency || '');
    }
    return t('marketplace.coupons.discount_bogo');
  };

  return (
    <div>
      <PageHeader
        title={t('marketplace.coupons.page_title')}
        description={t('marketplace.coupons.description')}
      />
      {loading ? (
        <div className="flex justify-center py-12">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner /></div>
        </div>
      ) : (
        <Card>
          <CardBody>
            <Table aria-label={t('marketplace.coupons.table_aria')}>
              <TableHeader>
                <TableColumn>{t('marketplace.coupons.columns.code')}</TableColumn>
                <TableColumn>{t('marketplace.coupons.columns.title')}</TableColumn>
                <TableColumn>{t('marketplace.coupons.columns.seller_id')}</TableColumn>
                <TableColumn>{t('marketplace.coupons.columns.discount')}</TableColumn>
                <TableColumn>{t('marketplace.coupons.columns.status')}</TableColumn>
                <TableColumn>{t('marketplace.coupons.columns.uses')}</TableColumn>
                <TableColumn>{t('marketplace.coupons.columns.valid_until')}</TableColumn>
                <TableColumn>{t('marketplace.coupons.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('marketplace.coupons.empty')}>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.code}</TableCell>
                    <TableCell>{c.title}</TableCell>
                    <TableCell>{c.seller_id}</TableCell>
                    <TableCell>{formatDiscount(c)}</TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={c.status === 'active' ? 'success' : c.status === 'paused' ? 'warning' : 'default'}
                        variant="soft"
                      >
                        {t(`marketplace.coupons.status.${c.status}`, {
                          defaultValue: t('marketplace.coupons.status.unknown'),
                        })}
                      </Chip>
                    </TableCell>
                    <TableCell>{c.usage_count}</TableCell>
                    <TableCell>
                      {c.valid_until ? new Date(c.valid_until).toLocaleDateString(getFormattingLocale()) : t('marketplace.coupons.no_expiry')}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="tertiary"
                          color="warning"
                          startContent={<Pause className="w-4 h-4" />}
                          onPress={() => handleSuspend(c.id)}
                          isDisabled={c.status === 'paused'}
                        >
                          {t('marketplace.coupons.suspend')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          startContent={<Trash2 className="w-4 h-4" />}
                          onPress={() => handleDelete(c.id)}
                        >
                          {t('marketplace.coupons.delete')}
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
  );
}
