// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
/**
 * SellerCouponEditPage — AG63 create/edit coupon form.
 */

import { useEffect, useState, FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Tag from 'lucide-react/icons/tag';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useAuth, useTenant, useToast } from '@/contexts';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { usePageTitle } from '@/hooks';
import { logError } from '@/lib/logger';

type DiscountType = 'percent' | 'fixed' | 'bogo';
type Status = 'draft' | 'active' | 'paused' | 'expired';
type AppliesTo = 'all_listings' | 'listing_ids' | 'category_ids';

interface FormState {
  code: string;
  title: string;
  description: string;
  discount_type: DiscountType;
  discount_value: string;
  min_order_cents: string;
  max_uses: string;
  max_uses_per_member: string;
  valid_from: string;
  valid_until: string;
  status: Status;
  applies_to: AppliesTo;
  applies_to_ids: string[];
}

interface CouponTarget {
  id: number;
  label: string;
}

const initialState: FormState = {
  code: '',
  title: '',
  description: '',
  discount_type: 'percent',
  discount_value: '10',
  min_order_cents: '',
  max_uses: '',
  max_uses_per_member: '1',
  valid_from: '',
  valid_until: '',
  status: 'draft',
  applies_to: 'all_listings',
  applies_to_ids: [],
};

export default function SellerCouponEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const toast = useToast();
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const isEdit = Boolean(id);
  usePageTitle(isEdit ? t('coupon.seller.edit_title') : t('coupon.seller.create_title'));

  const [form, setForm] = useState<FormState>(initialState);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState<CouponTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  useEffect(() => {
    if (!isEdit || !id) return;
    let cancelled = false;
    (async () => {
      try {
        // Seller endpoint returns list; we filter. Or fetch via member detail endpoint.
        const res = await api.get<{ items: Array<{ id: number } & Record<string, unknown>> }>(
          '/v2/marketplace/seller/coupons'
        );
        const c = (res.data?.items ?? []).find((x) => x.id === Number(id));
        if (cancelled || !c) return;
        setForm({
          code: String(c.code ?? ''),
          title: String(c.title ?? ''),
          description: String(c.description ?? ''),
          discount_type: (c.discount_type as DiscountType) ?? 'percent',
          discount_value: String(c.discount_value ?? ''),
          min_order_cents: c.min_order_cents != null ? String(c.min_order_cents) : '',
          max_uses: c.max_uses != null ? String(c.max_uses) : '',
          max_uses_per_member: String(c.max_uses_per_member ?? '1'),
          valid_from: c.valid_from ? String(c.valid_from).slice(0, 16) : '',
          valid_until: c.valid_until ? String(c.valid_until).slice(0, 16) : '',
          status: (c.status as Status) ?? 'draft',
          applies_to: (c.applies_to as AppliesTo) ?? 'all_listings',
          applies_to_ids: Array.isArray(c.applies_to_ids)
            ? c.applies_to_ids.map((targetId) => String(targetId))
            : [],
        });
      } catch (err) {
        logError('SellerCouponEditPage.load', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  useEffect(() => {
    if (form.applies_to === 'all_listings' || !user?.id) {
      setTargets([]);
      setTargetsLoading(false);
      return;
    }

    let cancelled = false;
    const loadTargets = async () => {
      setTargetsLoading(true);
      try {
        if (form.applies_to === 'listing_ids') {
          const response = await api.get<Array<{ id: number; title: string }>>(
            `/v2/marketplace/listings?user_id=${user.id}&status=active&limit=100`,
          );
          if (!cancelled && response.success && response.data) {
            setTargets(response.data.map((listing) => ({ id: listing.id, label: listing.title })));
          } else if (!cancelled) {
            toast.error(response.error || t('errors.unexpected'));
          }
        } else {
          const response = await api.get<Array<{ id: number; name: string }>>('/v2/marketplace/categories');
          if (!cancelled && response.success && response.data) {
            setTargets(response.data.map((category) => ({ id: category.id, label: category.name })));
          } else if (!cancelled) {
            toast.error(response.error || t('errors.unexpected'));
          }
        }
      } catch (err) {
        if (!cancelled) {
          logError('SellerCouponEditPage.targets', err);
          toast.error(t('errors.unexpected'));
        }
      } finally {
        if (!cancelled) setTargetsLoading(false);
      }
    };

    void loadTargets();
    return () => {
      cancelled = true;
    };
  }, [form.applies_to, t, toast, user?.id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.applies_to !== 'all_listings' && form.applies_to_ids.length === 0) {
      toast.error(t('coupon.seller.target_required'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        code: form.code || undefined,
        title: form.title,
        description: form.description || null,
        discount_type: form.discount_type,
        discount_value: parseFloat(form.discount_value || '0'),
        min_order_cents: form.min_order_cents ? parseInt(form.min_order_cents, 10) : null,
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
        max_uses_per_member: parseInt(form.max_uses_per_member || '1', 10),
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        status: form.status,
        applies_to: form.applies_to,
        applies_to_ids: form.applies_to === 'all_listings'
          ? null
          : form.applies_to_ids.map((targetId) => Number(targetId)),
      };
      const response = isEdit
        ? await api.put(`/v2/marketplace/seller/coupons/${id}`, payload)
        : await api.post('/v2/marketplace/seller/coupons', payload);
      if (response.success) {
        toast.success(t('coupon.seller.saved'));
        navigate(tenantPath('/marketplace/seller/coupons'));
      } else {
        toast.error(response.error || t('errors.unexpected'));
      }
    } catch (err) {
      logError('SellerCouponEditPage.save', err);
      toast.error(t('errors.unexpected'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageMeta title={isEdit ? t('coupon.seller.edit_title') : t('coupon.seller.create_title')} noIndex />
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title={isEdit ? t('coupon.seller.edit_title') : t('coupon.seller.create_title')} noIndex />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Button
        as={Link}
        to={tenantPath('/marketplace/seller/coupons')}
        variant="tertiary"
        startContent={<ArrowLeft className="w-4 h-4" />}
        className="mb-4"
      >
        {t('coupon.back_to_coupons')}
      </Button>

      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <div className="mb-6">
        <PublicPageHero
          size="compact"
          title={isEdit ? t('coupon.seller.edit_title') : t('coupon.seller.create_title')}
          icon={<Tag className="h-6 w-6" aria-hidden="true" />}
          accent="emerald"
        />
      </div>

      <Card>
        <CardBody className="p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label={t('coupon.code')}
              description={t('coupon.seller.code_help')}
              value={form.code}
              onValueChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))}
            />
            <Input
              label={t('coupon.title')}
              isRequired
              value={form.title}
              onValueChange={(v) => setForm((f) => ({ ...f, title: v }))}
            />
            <Textarea
              label={t('coupon.description')}
              value={form.description}
              onValueChange={(v) => setForm((f) => ({ ...f, description: v }))}
              minRows={2}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label={t('coupon.seller.discount_type')}
                selectedKeys={[form.discount_type]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, discount_type: e.target.value as DiscountType }))
                }
              >
                <SelectItem key="percent" id="percent">% {t('coupon.type_percent')}</SelectItem>
                <SelectItem key="fixed" id="fixed">{t('coupon.type_fixed')}</SelectItem>
                <SelectItem key="bogo" id="bogo">{t('coupon.type_bogo')}</SelectItem>
              </Select>
              <Input
                type="number"
                label={t('coupon.seller.discount_value')}
                description={
                  form.discount_type === 'percent'
                    ? t('coupon.seller.discount_value_help_percent')
                    : form.discount_type === 'fixed'
                      ? t('coupon.seller.discount_value_help_fixed')
                      : ''
                }
                value={form.discount_value}
                onValueChange={(v) => setForm((f) => ({ ...f, discount_value: v }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                type="number"
                label={t('coupon.seller.max_uses')}
                value={form.max_uses}
                onValueChange={(v) => setForm((f) => ({ ...f, max_uses: v }))}
              />
              <Input
                type="number"
                label={t('coupon.seller.max_uses_per_member')}
                value={form.max_uses_per_member}
                onValueChange={(v) => setForm((f) => ({ ...f, max_uses_per_member: v }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                type="datetime-local"
                label={t('coupon.seller.valid_from')}
                value={form.valid_from}
                onValueChange={(v) => setForm((f) => ({ ...f, valid_from: v }))}
              />
              <Input
                type="datetime-local"
                label={t('coupon.seller.valid_until')}
                value={form.valid_until}
                onValueChange={(v) => setForm((f) => ({ ...f, valid_until: v }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label={t('coupon.seller.status')}
                selectedKeys={[form.status]}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Status }))}
              >
                <SelectItem key="draft" id="draft">{t('coupon.seller.status_draft')}</SelectItem>
                <SelectItem key="active" id="active">{t('coupon.seller.status_active')}</SelectItem>
                <SelectItem key="paused" id="paused">{t('coupon.seller.status_paused')}</SelectItem>
                <SelectItem key="expired" id="expired">{t('coupon.seller.status_expired')}</SelectItem>
              </Select>
              <Select
                label={t('coupon.seller.applies_to')}
                selectedKeys={[form.applies_to]}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    applies_to: e.target.value as AppliesTo,
                    applies_to_ids: [],
                  }))
                }
              >
                <SelectItem key="all_listings" id="all_listings">{t('coupon.seller.all_listings')}</SelectItem>
                <SelectItem key="listing_ids" id="listing_ids">{t('coupon.seller.specific_listings')}</SelectItem>
                <SelectItem key="category_ids" id="category_ids">{t('coupon.seller.specific_categories')}</SelectItem>
              </Select>
            </div>
            {form.applies_to !== 'all_listings' && (
              <Select
                label={form.applies_to === 'listing_ids'
                  ? t('coupon.seller.specific_listings')
                  : t('coupon.seller.specific_categories')}
                description={t('coupon.seller.target_required')}
                selectionMode="multiple"
                selectedKeys={new Set(form.applies_to_ids)}
                onSelectionChange={(keys) => {
                  const selected = keys === 'all'
                    ? targets.map((target) => String(target.id))
                    : Array.from(keys).map(String);
                  setForm((current) => ({ ...current, applies_to_ids: selected }));
                }}
                isLoading={targetsLoading}
                isRequired
              >
                {targets.map((target) => (
                  <SelectItem key={target.id} id={String(target.id)} textValue={target.label}>
                    {target.label}
                  </SelectItem>
                ))}
              </Select>
            )}
            <Input
              type="number"
              label={t('coupon.min_order')}
              description={t('coupon.seller.amount_cents_help')}
              value={form.min_order_cents}
              onValueChange={(v) => setForm((f) => ({ ...f, min_order_cents: v }))}
            />
            <div className="flex flex-col justify-end gap-2 mt-2 sm:flex-row">
              <Button as={Link} to={tenantPath('/marketplace/seller/coupons')} variant="tertiary">
                {t('common.cancel')}
              </Button>
              <Button type="submit" isLoading={saving}>
                {t('coupon.seller.save')}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      </div>
    </>
  );
}
