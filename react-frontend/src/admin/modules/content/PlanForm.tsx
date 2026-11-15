import { Card, CardBody, CardHeader, Input, Textarea, Button, Spinner, Chip, Switch } from '@/components/ui';
import { useState, useEffect } from 'react';

import { Separator } from '@/components/ui';
import CreditCard from 'lucide-react/icons/credit-card';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { useNavigate, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminPlans, type PlanDetail } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Plan Create/Edit Form
 * Super-admin form for creating or editing a subscription plan.
 * Includes Stripe sync status and one-click sync trigger.
 */


interface PlanFormData {
  name: string;
  description: string;
  price_monthly: string;
  price_yearly: string;
  tier_level: string;
  max_users: string;
  max_menus: string;
  max_menu_items: string;
  /** One feature per line */
  features: string;
  is_active: boolean;
}

interface StripeStatus {
  stripe_product_id?: string | null;
  stripe_price_id_monthly?: string | null;
  stripe_price_id_yearly?: string | null;
}

export function PlanForm() {
  const { t } = useTranslation('admin_content');
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  usePageTitle(t(isEdit ? 'content.plan_edit_page_title' : 'content.plan_create_page_title'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [formData, setFormData] = useState<PlanFormData>({
    name: '',
    description: '',
    price_monthly: '0',
    price_yearly: '0',
    tier_level: '1',
    max_users: '',
    max_menus: '',
    max_menu_items: '',
    features: '',
    is_active: true,
  });
  const [stripeStatus, setStripeStatus] = useState<StripeStatus>({});
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    adminPlans.get(Number(id))
      .then((res) => {
        if (res.success && res.data) {
          const plan = res.data as PlanDetail;
          setFormData({
            name: plan.name ?? '',
            description: plan.description ?? '',
            price_monthly: plan.price_monthly != null ? String(plan.price_monthly) : '0',
            price_yearly: plan.price_yearly != null ? String(plan.price_yearly) : '0',
            tier_level: plan.tier_level != null ? String(plan.tier_level) : '1',
            max_users: plan.max_users != null ? String(plan.max_users) : '',
            max_menus: plan.max_menus != null ? String(plan.max_menus) : '',
            max_menu_items: plan.max_menu_items != null ? String(plan.max_menu_items) : '',
            // One feature per line
            features: Array.isArray(plan.features) ? plan.features.join('\n') : '',
            is_active: plan.is_active !== false,
          });
          setStripeStatus({
            stripe_product_id: plan.stripe_product_id,
            stripe_price_id_monthly: plan.stripe_price_id_monthly,
            stripe_price_id_yearly: plan.stripe_price_id_yearly,
          });
        }
      })
      .catch(() => toast.error(t('content.failed_to_load_plans')))
      .finally(() => setLoading(false));
  }, [id, isEdit, t, toast]);


  const handleChange = (field: keyof PlanFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const buildPayload = () => {
    const featuresArr = formData.features.trim()
      ? formData.features.split('\n').map((s) => s.trim()).filter(Boolean)
      : [];

    return {
      name: formData.name,
      description: formData.description || undefined,
      price_monthly: formData.price_monthly !== '' ? Number(formData.price_monthly) : 0,
      price_yearly: formData.price_yearly !== '' ? Number(formData.price_yearly) : 0,
      tier_level: formData.tier_level ? Number(formData.tier_level) : 0,
      max_users: formData.max_users !== '' ? Number(formData.max_users) : null,
      max_menus: formData.max_menus ? Number(formData.max_menus) : undefined,
      max_menu_items: formData.max_menu_items ? Number(formData.max_menu_items) : undefined,
      features: featuresArr,
      is_active: formData.is_active,
    };
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.warning(t('content.plan_name_required'));
      return;
    }

    const numericChecks: Array<{ label: string; value: string }> = [
      { label: t('content.monthly_price'), value: formData.price_monthly },
      { label: t('content.annual_price'), value: formData.price_yearly },
      { label: t('content.tier_level'), value: formData.tier_level },
    ];
    for (const check of numericChecks) {
      if (!check.value) continue;
      const n = Number(check.value);
      if (Number.isNaN(n) || n < 0) {
        toast.error(t('content.valid_non_negative_number', { field: check.label }));
        return;
      }
    }

    setSaving(true);
    try {
      if (isEdit) {
        const res = await adminPlans.update(Number(id), buildPayload());
        if (res?.success) {
          toast.success(t('content.plan_updated'));
          navigate(tenantPath('/platform-team/plans'));
        } else {
          toast.error(t('content.failed_to_update_plan'));
        }
      } else {
        const res = await adminPlans.create(buildPayload());
        if (res?.success) {
          toast.success(t('content.plan_created'));
          navigate(tenantPath('/platform-team/plans'));
        } else {
          toast.error(t('content.failed_to_create_plan'));
        }
      }
    } catch {
      toast.error(t('content.an_unexpected_error_occurred'));
    } finally {
      setSaving(false);
    }
  };

  const handleSyncStripe = async () => {
    if (!isEdit) return;
    setSyncing(true);
    try {
      const res = await adminPlans.syncStripe(Number(id));
      if (res.success && res.data) {
        const d = res.data as unknown as { stripe_product_id: string | null; stripe_price_id_monthly: string | null; stripe_price_id_yearly: string | null };
        setStripeStatus({
          stripe_product_id: d.stripe_product_id,
          stripe_price_id_monthly: d.stripe_price_id_monthly,
          stripe_price_id_yearly: d.stripe_price_id_yearly,
        });
        toast.success(t('content.stripe_sync_success'));
      } else {
        toast.error(t('content.stripe_sync_failed'));
      }
    } catch {
      toast.error(t('content.stripe_sync_failed_config'));
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title={t(isEdit ? 'content.plan_edit_title' : 'content.plan_create_title')} description="" />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12"><Spinner size="lg" /></div>
      </div>
    );
  }

  const stripeSynced = !!stripeStatus.stripe_product_id;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(isEdit ? 'content.plan_edit_title' : 'content.plan_create_title')}
        description={isEdit
          ? t('content.plans_admin_desc')
          : t('content.desc_create_subscription_plans_to_offer_diffe')}
        actions={
          <Button variant="tertiary" startContent={<ArrowLeft size={16} />} onPress={() => navigate(tenantPath('/platform-team/plans'))}>
            {t('common.back')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main form */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card >
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CreditCard size={20} /> {t('content.plan_details')}
              </h3>
            </CardHeader>
            <CardBody className="gap-4">
              <Input
                label={t('content.label_name')}
                placeholder={t('content.plan_name_placeholder')}
                isRequired
                variant="secondary"
                value={formData.name}
                onValueChange={(v) => handleChange('name', v)}
              />
              <Textarea
                label={t('content.label_description')}
                placeholder={t('content.plan_description_placeholder')}
                variant="secondary"
                minRows={3}
                value={formData.description}
                onValueChange={(v) => handleChange('description', v)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('content.monthly_price')}
                  type="number" min="0" step="0.01"
                  variant="secondary"
                  startContent={<span className="text-muted text-sm">EUR</span>}
                  value={formData.price_monthly}
                  onValueChange={(v) => handleChange('price_monthly', v)}
                />
                <Input
                  label={t('content.annual_price')}
                  type="number" min="0" step="0.01"
                  variant="secondary"
                  startContent={<span className="text-muted text-sm">EUR</span>}
                  description={t('content.annual_price_description')}
                  value={formData.price_yearly}
                  onValueChange={(v) => handleChange('price_yearly', v)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('content.tier_level')}
                  type="number" min="0" step="1"
                  variant="secondary"
                  description={t('content.tier_level_description')}
                  value={formData.tier_level}
                  onValueChange={(v) => handleChange('tier_level', v)}
                />
                <Input
                  label={t('content.max_users')}
                  type="number" min="1" step="1"
                  variant="secondary"
                  placeholder={t('content.leave_blank_unlimited')}
                  description={t('content.max_users_description')}
                  value={formData.max_users}
                  onValueChange={(v) => handleChange('max_users', v)}
                />
              </div>
            </CardBody>
          </Card>

          <Card >
            <CardHeader>
              <h3 className="text-lg font-semibold">{t('content.selling_points')}</h3>
            </CardHeader>
            <CardBody className="gap-4">
              <Textarea
                label={t('content.feature_list')}
                placeholder={t('content.features_placeholder')}
                variant="secondary"
                minRows={6}
                description={t('content.features_description')}
                value={formData.features}
                onValueChange={(v) => handleChange('features', v)}
              />
            </CardBody>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          <Card >
            <CardHeader>
              <h3 className="text-base font-semibold">{t('content.status_limits')}</h3>
            </CardHeader>
            <CardBody className="gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{t('content.label_active')}</p>
                  <p className="text-xs text-muted">{t('content.plan_active_description')}</p>
                </div>
                <Switch
                  isSelected={formData.is_active}
                  onValueChange={(v) => handleChange('is_active', v)}
                  aria-label={t('content.label_active')}
                />
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={t('content.max_menus')}
                  type="number" min="1" step="1"
                  variant="secondary"
                  size="sm"
                  placeholder={t('content.max_menus_placeholder')}
                  value={formData.max_menus}
                  onValueChange={(v) => handleChange('max_menus', v)}
                />
                <Input
                  label={t('content.max_menu_items')}
                  type="number" min="1" step="1"
                  variant="secondary"
                  size="sm"
                  placeholder={t('content.max_menu_items_placeholder')}
                  value={formData.max_menu_items}
                  onValueChange={(v) => handleChange('max_menu_items', v)}
                />
              </div>
            </CardBody>
          </Card>

          {isEdit && (
            <Card >
              <CardHeader>
                <h3 className="text-base font-semibold flex items-center gap-2">
                  {t('content.stripe_sync')}
                </h3>
              </CardHeader>
              <CardBody className="gap-3">
                <div className="flex items-center gap-2">
                  {stripeSynced ? (
                    <CheckCircle size={16} className="text-success shrink-0" />
                  ) : (
                    <AlertCircle size={16} className="text-warning shrink-0" />
                  )}
                  <Chip size="sm" variant="soft" color={stripeSynced ? 'success' : 'warning'}>
                    {stripeSynced ? t('content.synced') : t('content.not_synced')}
                  </Chip>
                </div>

                {stripeSynced && (
                  <div className="flex flex-col gap-1 text-xs text-muted break-all">
                    {stripeStatus.stripe_product_id && (
                      <span><span className="font-medium">{t('content.product')}:</span> {stripeStatus.stripe_product_id}</span>
                    )}
                    {stripeStatus.stripe_price_id_monthly && (
                      <span><span className="font-medium">{t('content.monthly')}:</span> {stripeStatus.stripe_price_id_monthly}</span>
                    )}
                    {stripeStatus.stripe_price_id_yearly && (
                      <span><span className="font-medium">{t('content.yearly')}:</span> {stripeStatus.stripe_price_id_yearly}</span>
                    )}
                  </div>
                )}

                <Button
                  color="default"
                  variant="tertiary"
                  startContent={<RefreshCw size={14} />}
                  onPress={handleSyncStripe}
                  isLoading={syncing}
                  size="sm"
                  fullWidth
                >
                  {stripeSynced ? t('content.resync_stripe') : t('content.sync_stripe')}
                </Button>
                <p className="text-xs text-muted">
                  {t('content.stripe_sync_description')}
                </p>
              </CardBody>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            <Button
              startContent={<Save size={16} />}
              onPress={handleSave}
              isLoading={saving}
              fullWidth
            >
              {isEdit ? t('federation.save_changes') : t('content.plan_create_title')}
            </Button>
            <Button variant="tertiary" onPress={() => navigate(tenantPath('/platform-team/plans'))} fullWidth>
              {t('cancel')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlanForm;
