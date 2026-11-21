import { Alert, Card, CardBody, CardHeader, Input, Textarea, Button, Spinner, Chip, Switch } from '@/components/ui';
import { useState, useEffect } from 'react';

import { Separator } from '@/components/ui';
import CreditCard from 'lucide-react/icons/credit-card';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminPlans, type PlanDetail, type PlanStripePriceWarning } from '../../api/adminApi';
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
  price_monthly_gbp: string;
  price_yearly_gbp: string;
  setup_fee: string;
  setup_fee_gbp: string;
  tier_level: string;
  max_users: string;
  max_communities: string;
  storage_gb: string;
  emails_per_month: string;
  max_menus: string;
  max_menu_items: string;
  /** One feature per line */
  features: string;
  is_active: boolean;
}

/** A stored value as form text; null and undefined become an empty field. */
function toField(value: number | string | null | undefined): string {
  return value != null ? String(value) : '';
}

/** Empty means "not set" (null); the API must not read it as 0. */
function toNullableNumber(value: string): number | null {
  return value.trim() !== '' ? Number(value) : null;
}

interface StripeStatus {
  stripe_product_id?: string | null;
  stripe_price_id_monthly?: string | null;
  stripe_price_id_yearly?: string | null;
  stripe_price_id_monthly_gbp?: string | null;
  stripe_price_id_yearly_gbp?: string | null;
}

/** Carried to the edit page when a new plan's prices did not reach Stripe. */
interface PlanFormLocationState {
  stripePriceWarnings?: PlanStripePriceWarning[];
}

const STRIPE_WARNING_KEYS = {
  eur: {
    monthly: 'content.plan_stripe_warning_eur_monthly',
    yearly: 'content.plan_stripe_warning_eur_yearly',
  },
  gbp: {
    monthly: 'content.plan_stripe_warning_gbp_monthly',
    yearly: 'content.plan_stripe_warning_gbp_yearly',
  },
} as const;

/** Keeps only well-formed entries, so an unexpected shape never renders a key name. */
function cleanWarnings(value: unknown): PlanStripePriceWarning[] {
  if (!Array.isArray(value)) return [];
  return value.filter((w): w is PlanStripePriceWarning =>
    !!w && typeof w === 'object'
    && ((w as PlanStripePriceWarning).currency === 'eur' || (w as PlanStripePriceWarning).currency === 'gbp')
    && ((w as PlanStripePriceWarning).interval === 'monthly' || (w as PlanStripePriceWarning).interval === 'yearly'));
}

/** Whole-number fields: the server refuses a fraction or a value below its minimum. */
const WHOLE_NUMBER_RULES = [
  { field: 'max_users', labelKey: 'content.max_users', min: 1 },
  { field: 'max_communities', labelKey: 'content.plan_max_communities', min: 1 },
  { field: 'storage_gb', labelKey: 'content.plan_storage_gb', min: 0 },
  { field: 'emails_per_month', labelKey: 'content.plan_emails_per_month', min: 0 },
] as const;

// A field with a currency in front is drawn by the Input wrapper as a bare
// shell, which on a card read as plain text. The same visible box as the
// other fields of this form.
const PRICE_FIELD_SHELL = 'rounded-xl border border-divider bg-[var(--field-background)]';

export function PlanForm() {
  const { t } = useTranslation('admin_content');
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  usePageTitle(t(isEdit ? 'content.plan_edit_page_title' : 'content.plan_create_page_title'));
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [stripeWarnings, setStripeWarnings] = useState<PlanStripePriceWarning[]>(
    () => cleanWarnings((location.state as PlanFormLocationState | null)?.stripePriceWarnings),
  );

  const [formData, setFormData] = useState<PlanFormData>({
    name: '',
    description: '',
    price_monthly: '0',
    price_yearly: '0',
    price_monthly_gbp: '',
    price_yearly_gbp: '',
    setup_fee: '0',
    setup_fee_gbp: '',
    tier_level: '1',
    max_users: '',
    max_communities: '',
    storage_gb: '',
    emails_per_month: '',
    max_menus: '',
    max_menu_items: '',
    features: '',
    is_active: true,
  });
  const [stripeStatus, setStripeStatus] = useState<StripeStatus>({});
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

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
            price_monthly_gbp: toField(plan.price_monthly_gbp),
            price_yearly_gbp: toField(plan.price_yearly_gbp),
            setup_fee: plan.setup_fee != null ? String(plan.setup_fee) : '0',
            setup_fee_gbp: toField(plan.setup_fee_gbp),
            tier_level: plan.tier_level != null ? String(plan.tier_level) : '1',
            max_users: plan.max_users != null ? String(plan.max_users) : '',
            max_communities: toField(plan.max_communities),
            storage_gb: toField(plan.storage_gb),
            emails_per_month: toField(plan.emails_per_month),
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
            stripe_price_id_monthly_gbp: plan.stripe_price_id_monthly_gbp,
            stripe_price_id_yearly_gbp: plan.stripe_price_id_yearly_gbp,
          });
        } else {
          // A refused load used to leave an empty form that looked like a
          // new plan, ready to be saved over the real one.
          toast.error(t('content.failed_to_load_plans'));
          setLoadFailed(true);
        }
      })
      .catch(() => {
        toast.error(t('content.failed_to_load_plans'));
        setLoadFailed(true);
      })
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
      // Sent even when empty: leaving it out meant a description could
      // never be cleared once set.
      description: formData.description.trim(),
      price_monthly: formData.price_monthly !== '' ? Number(formData.price_monthly) : 0,
      price_yearly: formData.price_yearly !== '' ? Number(formData.price_yearly) : 0,
      price_monthly_gbp: toNullableNumber(formData.price_monthly_gbp),
      price_yearly_gbp: toNullableNumber(formData.price_yearly_gbp),
      // The euro setup fee column is NOT NULL DEFAULT 0, so empty means no fee.
      setup_fee: formData.setup_fee.trim() !== '' ? Number(formData.setup_fee) : 0,
      setup_fee_gbp: toNullableNumber(formData.setup_fee_gbp),
      tier_level: formData.tier_level ? Number(formData.tier_level) : 0,
      max_users: formData.max_users !== '' ? Number(formData.max_users) : null,
      max_communities: toNullableNumber(formData.max_communities),
      storage_gb: toNullableNumber(formData.storage_gb),
      emails_per_month: toNullableNumber(formData.emails_per_month),
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
      { label: t('content.plan_price_monthly_eur'), value: formData.price_monthly },
      { label: t('content.plan_price_yearly_eur'), value: formData.price_yearly },
      { label: t('content.plan_setup_fee_eur'), value: formData.setup_fee },
      { label: t('content.plan_price_monthly_gbp'), value: formData.price_monthly_gbp },
      { label: t('content.plan_price_yearly_gbp'), value: formData.price_yearly_gbp },
      { label: t('content.plan_setup_fee_gbp'), value: formData.setup_fee_gbp },
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
    for (const rule of WHOLE_NUMBER_RULES) {
      const raw = formData[rule.field].trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < rule.min) {
        toast.error(t('content.plan_whole_number_min', { field: t(rule.labelKey), min: rule.min }));
        return;
      }
    }

    setSaving(true);
    try {
      if (isEdit) {
        const res = await adminPlans.update(Number(id), buildPayload());
        if (res?.success) {
          toast.success(t('content.plan_updated'));
          const warnings = cleanWarnings(res.data?.stripe_price_warnings);
          setStripeWarnings(warnings);
          // A price that did not reach Stripe needs the sync button on this page.
          if (warnings.length === 0) navigate(tenantPath('/platform-team/plans'));
        } else {
          // The server names the field and the reason.
          // admin-i18n-ignore: localized server message — AdminContentController plan validation (lang/*/api.php)
          toast.error(res?.error || t('content.failed_to_update_plan'));
        }
      } else {
        const res = await adminPlans.create(buildPayload());
        if (res?.success) {
          toast.success(t('content.plan_created'));
          const warnings = cleanWarnings(res.data?.stripe_price_warnings);
          const newId = res.data?.id;
          if (warnings.length > 0 && newId) {
            const state: PlanFormLocationState = { stripePriceWarnings: warnings };
            navigate(tenantPath(`/platform-team/plans/edit/${newId}`), { state });
          } else {
            navigate(tenantPath('/platform-team/plans'));
          }
        } else {
          // admin-i18n-ignore: localized server message — AdminContentController plan validation (lang/*/api.php)
          toast.error(res?.error || t('content.failed_to_create_plan'));
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
        const d = res.data;
        setStripeStatus({
          stripe_product_id: d.stripe_product_id,
          stripe_price_id_monthly: d.stripe_price_id_monthly,
          stripe_price_id_yearly: d.stripe_price_id_yearly,
          stripe_price_id_monthly_gbp: d.stripe_price_id_monthly_gbp,
          stripe_price_id_yearly_gbp: d.stripe_price_id_yearly_gbp,
        });
        setStripeWarnings(cleanWarnings(
          (d.price_changes ?? []).filter((change) => change.outcome === 'failed'),
        ));
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

  if (loadFailed) {
    return (
      <div>
        <PageHeader title={t('content.plan_edit_title')} description="" />
        <p role="alert" className="py-12 text-center text-danger">{t('content.failed_to_load_plans')}</p>
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

      {stripeWarnings.length > 0 && (
        <Alert
          color="warning"
          variant="tertiary"
          title={t('content.plan_stripe_warning_title')}
          description={
            <span className="flex flex-col gap-1">
              {stripeWarnings.map((w) => (
                <span key={`${w.currency}-${w.interval}`}>{t(STRIPE_WARNING_KEYS[w.currency][w.interval])}</span>
              ))}
              <span>
                {t('content.plan_stripe_warning_action', {
                  button: stripeSynced ? t('content.resync_stripe') : t('content.sync_stripe'),
                })}
              </span>
            </span>
          }
        />
      )}

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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label={t('content.plan_price_monthly_eur')}
                  type="number" min="0" step="0.01"
                  variant="secondary"
                  startContent={<span className="text-muted text-sm">EUR</span>}
                  classNames={{ inputWrapper: PRICE_FIELD_SHELL }}
                  value={formData.price_monthly}
                  onValueChange={(v) => handleChange('price_monthly', v)}
                />
                <Input
                  label={t('content.plan_price_yearly_eur')}
                  type="number" min="0" step="0.01"
                  variant="secondary"
                  startContent={<span className="text-muted text-sm">EUR</span>}
                  classNames={{ inputWrapper: PRICE_FIELD_SHELL }}
                  description={t('content.annual_price_description')}
                  value={formData.price_yearly}
                  onValueChange={(v) => handleChange('price_yearly', v)}
                />
                <Input
                  label={t('content.plan_setup_fee_eur')}
                  type="number" min="0" step="0.01"
                  variant="secondary"
                  startContent={<span className="text-muted text-sm">EUR</span>}
                  classNames={{ inputWrapper: PRICE_FIELD_SHELL }}
                  value={formData.setup_fee}
                  onValueChange={(v) => handleChange('setup_fee', v)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label={t('content.plan_price_monthly_gbp')}
                  type="number" min="0" step="0.01"
                  variant="secondary"
                  startContent={<span className="text-muted text-sm">GBP</span>}
                  classNames={{ inputWrapper: PRICE_FIELD_SHELL }}
                  placeholder={t('content.plan_gbp_not_sold')}
                  value={formData.price_monthly_gbp}
                  onValueChange={(v) => handleChange('price_monthly_gbp', v)}
                />
                <Input
                  label={t('content.plan_price_yearly_gbp')}
                  type="number" min="0" step="0.01"
                  variant="secondary"
                  startContent={<span className="text-muted text-sm">GBP</span>}
                  classNames={{ inputWrapper: PRICE_FIELD_SHELL }}
                  placeholder={t('content.plan_gbp_not_sold')}
                  value={formData.price_yearly_gbp}
                  onValueChange={(v) => handleChange('price_yearly_gbp', v)}
                />
                <Input
                  label={t('content.plan_setup_fee_gbp')}
                  type="number" min="0" step="0.01"
                  variant="secondary"
                  startContent={<span className="text-muted text-sm">GBP</span>}
                  classNames={{ inputWrapper: PRICE_FIELD_SHELL }}
                  placeholder={t('content.plan_gbp_not_sold')}
                  value={formData.setup_fee_gbp}
                  onValueChange={(v) => handleChange('setup_fee_gbp', v)}
                />
              </div>
              <p className="text-xs text-muted">{t('content.plan_price_change_note')}</p>
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
              <h3 className="text-lg font-semibold">{t('content.plan_allowances')}</h3>
            </CardHeader>
            <CardBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label={t('content.plan_max_communities')}
                  type="number" min="1" step="1"
                  variant="secondary"
                  placeholder={t('content.leave_blank_unlimited')}
                  value={formData.max_communities}
                  onValueChange={(v) => handleChange('max_communities', v)}
                />
                <Input
                  label={t('content.plan_storage_gb')}
                  type="number" min="0" step="1"
                  variant="secondary"
                  placeholder={t('content.leave_blank_unlimited')}
                  value={formData.storage_gb}
                  onValueChange={(v) => handleChange('storage_gb', v)}
                />
                <Input
                  label={t('content.plan_emails_per_month')}
                  type="number" min="0" step="1"
                  variant="secondary"
                  placeholder={t('content.leave_blank_unlimited')}
                  value={formData.emails_per_month}
                  onValueChange={(v) => handleChange('emails_per_month', v)}
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
                    {([
                      ['content.plan_price_monthly_eur', stripeStatus.stripe_price_id_monthly],
                      ['content.plan_price_yearly_eur', stripeStatus.stripe_price_id_yearly],
                      ['content.plan_price_monthly_gbp', stripeStatus.stripe_price_id_monthly_gbp],
                      ['content.plan_price_yearly_gbp', stripeStatus.stripe_price_id_yearly_gbp],
                    ] as const).map(([labelKey, priceId]) => priceId ? (
                      <span key={labelKey}><span className="font-medium">{t(labelKey)}:</span> <span>{priceId}</span></span>
                    ) : null)}
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
