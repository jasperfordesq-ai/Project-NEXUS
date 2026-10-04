import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, useDisclosure, Button, Chip, Spinner, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, useConfirm } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG58 — Admin: Member Premium Tier management.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import HandHeart from 'lucide-react/icons/hand-heart';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Trash from 'lucide-react/icons/trash';
import Pencil from 'lucide-react/icons/pencil';
import Users from 'lucide-react/icons/users';
import Save from 'lucide-react/icons/save';
import ExternalLink from 'lucide-react/icons/external-link';
import Download from 'lucide-react/icons/download';
import { useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import {
  adminDonations,
  type DonationFinanceOverview,
} from '../../api/adminApi';
import {
  memberPremiumAdminApi,
  type DonationSupportAccountStatus,
  type MemberPremiumTier,
  type TierUpsertPayload,
} from '../../api/memberPremiumApi';
import { PageHeader } from '../../components/PageHeader';

interface FormState {
  id: number | null;
  slug: string;
  name: string;
  description: string;
  monthly_price: string;
  yearly_price: string;
  features: string;
  sort_order: number;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  slug: '',
  name: '',
  description: '',
  monthly_price: '0.00',
  yearly_price: '0.00',
  features: '',
  sort_order: 0,
  is_active: true,
};

function centsToInput(c: number): string {
  return (c / 100).toFixed(2);
}

function inputToCents(v: string): number {
  const n = Number.parseFloat(v);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function formatAmount(cents: number): string {
  return (cents / 100).toLocaleString(getFormattingLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isTierStripeSynced(tier: MemberPremiumTier): boolean {
  const monthSynced = !!tier.stripe_price_id_monthly || tier.monthly_price_cents === 0;
  const yearSynced = !!tier.stripe_price_id_yearly || tier.yearly_price_cents === 0;
  return monthSynced && yearSynced;
}

export function MemberPremiumAdminPage() {
  const { t } = useTranslation(['admin_premium', 'common']);
  const confirm = useConfirm();
  usePageTitle(t('member_premium_admin.meta.title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [tiers, setTiers] = useState<MemberPremiumTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [stripeConnectAccountId, setStripeConnectAccountId] = useState('');
  const [paymentRoute, setPaymentRoute] = useState<'platform_default' | 'tenant_connect'>('platform_default');
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<DonationSupportAccountStatus | null>(null);
  const [financeOverview, setFinanceOverview] = useState<DonationFinanceOverview | null>(null);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [exporting, setExporting] = useState<'gift_aid' | 'annual_receipts' | null>(null);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await memberPremiumAdminApi.listTiers();
      setTiers(res.data?.tiers ?? []);
    } catch {
      toast.error(t('member_premium_admin.toasts.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await memberPremiumAdminApi.getSettings();
      const settings = res.data?.settings;
      setStripeConnectAccountId(settings?.stripe_connect_account_id ?? '');
      setPaymentRoute(settings?.payment_route ?? 'platform_default');
      setFallbackReason(settings?.fallback_reason ?? null);
      setAccountStatus(settings?.account_status ?? null);
    } catch {
      toast.error(t('member_premium_admin.toasts.settings_load_failed'));
    } finally {
      setSettingsLoading(false);
    }
  }, [t, toast]);

  const loadFinance = useCallback(async () => {
    setFinanceLoading(true);
    try {
      const res = await adminDonations.financeOverview();
      setFinanceOverview(res.data?.overview ?? null);
    } catch {
      toast.error(t('member_premium_admin.toasts.finance_load_failed'));
    } finally {
      setFinanceLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
    loadSettings();
    loadFinance();
  }, [load, loadSettings, loadFinance]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    onOpen();
  };

  const openEdit = (tier: MemberPremiumTier) => {
    setForm({
      id: tier.id,
      slug: tier.slug,
      name: tier.name,
      description: tier.description ?? '',
      monthly_price: centsToInput(tier.monthly_price_cents),
      yearly_price: centsToInput(tier.yearly_price_cents),
      features: (tier.features ?? []).join(', '),
      sort_order: tier.sort_order,
      is_active: tier.is_active,
    });
    onOpen();
  };

  const save = async () => {
    if (!form.slug.trim() || !form.name.trim()) {
      toast.error(t('member_premium_admin.validation.slug_name_required'));
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(form.slug.trim())) {
      toast.error(t('member_premium_admin.validation.slug_format'));
      return;
    }
    setSaving(true);
    const payload: TierUpsertPayload = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      monthly_price_cents: inputToCents(form.monthly_price),
      yearly_price_cents: inputToCents(form.yearly_price),
      features: form.features
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
    };

    try {
      if (form.id) {
        await memberPremiumAdminApi.updateTier(form.id, payload);
        toast.success(t('member_premium_admin.toasts.updated'));
      } else {
        await memberPremiumAdminApi.createTier(payload);
        toast.success(t('member_premium_admin.toasts.created'));
      }
      onClose();
      await load();
    } catch {
      toast.error(t('member_premium_admin.toasts.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const syncTier = async (tier: MemberPremiumTier) => {
    setSyncing(tier.id);
    try {
      const res = await memberPremiumAdminApi.syncStripe(tier.id);
      const syncedTier = res.data?.tier;
      if (syncedTier) {
        setTiers((current) => current.map((item) =>
          item.id === syncedTier.id
            ? { ...syncedTier, active_subscriber_count: item.active_subscriber_count }
            : item,
        ));
      }
      if (!syncedTier || !isTierStripeSynced(syncedTier)) {
        toast.error(t('member_premium_admin.toasts.stripe_sync_failed'));
        await load();
        return;
      }
      toast.success(t('member_premium_admin.toasts.synced', { name: tier.name }));
      await load();
    } catch {
      toast.error(t('member_premium_admin.toasts.stripe_sync_failed'));
    } finally {
      setSyncing(null);
    }
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      const res = await memberPremiumAdminApi.updateSettings({
        stripe_connect_account_id: stripeConnectAccountId.trim(),
      });
      const settings = res.data?.settings;
      setStripeConnectAccountId(settings?.stripe_connect_account_id ?? '');
      setPaymentRoute(settings?.payment_route ?? 'platform_default');
      setFallbackReason(settings?.fallback_reason ?? null);
      setAccountStatus(settings?.account_status ?? null);
      toast.success(t('member_premium_admin.toasts.settings_saved'));
    } catch {
      toast.error(t('member_premium_admin.toasts.settings_save_failed'));
    } finally {
      setSettingsSaving(false);
    }
  };

  const startConnectOnboarding = async () => {
    setOnboarding(true);
    try {
      const currentUrl = `${window.location.origin}${tenantPath('/admin/member-premium')}`;
      const res = await memberPremiumAdminApi.createConnectOnboardingLink({
        return_url: `${currentUrl}?stripe_connect=return`,
        refresh_url: `${currentUrl}?stripe_connect=refresh`,
      });
      const settings = res.data?.settings;
      setStripeConnectAccountId(settings?.stripe_connect_account_id ?? '');
      setPaymentRoute(settings?.payment_route ?? 'platform_default');
      setFallbackReason(settings?.fallback_reason ?? null);
      setAccountStatus(settings?.account_status ?? null);

      const onboardingUrl = res.data?.onboarding_url;
      if (onboardingUrl) {
        window.location.assign(onboardingUrl);
      } else {
        toast.error(t('member_premium_admin.toasts.onboarding_failed'));
      }
    } catch {
      toast.error(t('member_premium_admin.toasts.onboarding_failed'));
    } finally {
      setOnboarding(false);
    }
  };

  const deleteTier = async (tier: MemberPremiumTier) => {
    const ok = await confirm({
      title: t('member_premium_admin.confirm_delete', { name: tier.name }),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) return;
    setDeleting(tier.id);
    try {
      await memberPremiumAdminApi.deleteTier(tier.id);
      toast.success(t('member_premium_admin.toasts.deleted'));
      await load();
    } catch {
      toast.error(t('member_premium_admin.toasts.delete_failed'));
    } finally {
      setDeleting(null);
    }
  };

  const exportGiftAid = async () => {
    setExporting('gift_aid');
    try {
      await adminDonations.giftAidExport();
    } catch {
      toast.error(t('member_premium_admin.toasts.gift_aid_export_failed'));
    } finally {
      setExporting(null);
    }
  };

  const exportAnnualReceipts = async () => {
    setExporting('annual_receipts');
    try {
      await adminDonations.annualReceiptsExport(new Date().getFullYear());
    } catch {
      toast.error(t('member_premium_admin.toasts.annual_receipts_export_failed'));
    } finally {
      setExporting(null);
    }
  };

  const financeStats = financeOverview
    ? [
        {
          label: t('member_premium_admin.finance.completed_volume'),
          value: formatAmount(financeOverview.totals.completed_cents),
        },
        {
          label: t('member_premium_admin.finance.platform_fallback_volume'),
          value: formatAmount(financeOverview.routing.platform_fallback_cents),
          detail: t('member_premium_admin.finance.donation_count', {
            count: financeOverview.routing.platform_fallback_count,
          }),
        },
        {
          label: t('member_premium_admin.finance.tenant_connect_volume'),
          value: formatAmount(financeOverview.routing.tenant_connect_cents),
          detail: t('member_premium_admin.finance.donation_count', {
            count: financeOverview.routing.tenant_connect_count,
          }),
        },
        {
          label: t('member_premium_admin.finance.gift_aid_ready'),
          value: formatAmount(financeOverview.gift_aid.ready_cents),
          detail: t('member_premium_admin.finance.declaration_count', {
            count: financeOverview.gift_aid.ready_count,
          }),
        },
        {
          label: t('member_premium_admin.finance.open_disputes'),
          value: String(financeOverview.disputes.open_count),
        },
        {
          label: t('member_premium_admin.finance.active_recurring'),
          value: String(financeOverview.recurring.active_count),
          detail: t('member_premium_admin.finance.past_due_count', {
            count: financeOverview.recurring.past_due_count,
          }),
        },
        {
          label: t('member_premium_admin.finance.failed_receipts'),
          value: String(financeOverview.receipts.failed_email_count),
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('member_premium_admin.meta.title')}
        description={t('member_premium_admin.meta.description')}
        icon={<HandHeart size={24} />}
        actions={
          <div className="flex gap-2">
            <Button as={Link} to={tenantPath('/admin/member-premium/subscribers')} variant="tertiary" startContent={<Users size={16} />}>
              {t('member_premium_admin.actions.subscribers')}
            </Button>
            <Button startContent={<Plus size={16} />} onPress={openCreate}>
              {t('member_premium_admin.actions.new_tier')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardBody className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                {t('member_premium_admin.settings.title')}
              </h2>
              <Chip size="sm" color={paymentRoute === 'tenant_connect' ? 'success' : 'warning'} variant="soft">
                {paymentRoute === 'tenant_connect'
                  ? t('member_premium_admin.settings.route_tenant_connect')
                  : t('member_premium_admin.settings.route_platform_default')}
              </Chip>
              <Chip
                size="sm"
                color={accountStatus?.state === 'ready' ? 'success' : accountStatus?.state === 'restricted' ? 'danger' : 'warning'}
                variant="soft"
              >
                {t(`member_premium_admin.settings.status.${accountStatus?.state ?? 'not_connected'}`)}
              </Chip>
            </div>
            <p className="text-sm text-muted">
              {t('member_premium_admin.settings.description')}
            </p>
            {accountStatus?.requirements_due?.length ? (
              <p className="text-sm text-warning-soft-foreground">
                {t('member_premium_admin.settings.requirements_due', {
                  count: accountStatus.requirements_due.length,
                })}
              </p>
            ) : null}
            {fallbackReason === 'stripe_connect_not_ready' ? (
              <p className="text-sm text-warning-soft-foreground">
                {t('member_premium_admin.settings.connect_fallback_active')}
              </p>
            ) : null}
            {accountStatus?.error ? (
              <p className="text-sm text-danger">
                {t('member_premium_admin.toasts.settings_load_failed')}
              </p>
            ) : null}
            <Input
              label={t('member_premium_admin.settings.stripe_connect_account_id')}
              value={stripeConnectAccountId}
              onValueChange={setStripeConnectAccountId}
              placeholder={t('member_premium_admin.settings.stripe_connect_placeholder')}
              description={t('member_premium_admin.settings.stripe_connect_description')}
              isDisabled={settingsLoading}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              startContent={<ExternalLink size={16} />}
              onPress={startConnectOnboarding}
              isLoading={onboarding}
              isDisabled={settingsLoading || settingsSaving}
            >
              {stripeConnectAccountId
                ? t('member_premium_admin.settings.continue_onboarding')
                : t('member_premium_admin.settings.start_onboarding')}
            </Button>
            <Button
              startContent={<Save size={16} />}
              onPress={saveSettings}
              isLoading={settingsSaving}
              isDisabled={settingsLoading || onboarding}
            >
              {t('member_premium_admin.settings.save')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">
                {t('member_premium_admin.finance.title')}
              </h2>
              <p className="text-sm text-muted">
                {t('member_premium_admin.finance.description')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                startContent={<Download size={16} />}
                onPress={exportGiftAid}
                isLoading={exporting === 'gift_aid'}
              >
                {t('member_premium_admin.finance.export_gift_aid')}
              </Button>
              <Button
                variant="secondary"
                startContent={<Download size={16} />}
                onPress={exportAnnualReceipts}
                isLoading={exporting === 'annual_receipts'}
              >
                {t('member_premium_admin.finance.export_annual_receipts')}
              </Button>
            </div>
          </div>

          {financeLoading ? (
            <div className="flex justify-center py-6" role="status" aria-busy="true" aria-label={t('common.loading')}>
              <Spinner />
            </div>
          ) : financeStats.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {financeStats.map((stat) => (
                <div key={stat.label} className="rounded-md border border-divider bg-surface-2 p-3">
                  <p className="text-xs font-medium uppercase text-muted">{stat.label}</p>
                  <p className="mt-2 text-xl font-semibold text-foreground">{stat.value}</p>
                  {stat.detail ? (
                    <p className="mt-1 text-xs text-muted">{stat.detail}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              {t('member_premium_admin.finance.empty')}
            </p>
          )}
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10" role="status" aria-busy="true" aria-label={t('common.loading')}>
          <Spinner />
        </div>
      ) : tiers.length === 0 ? (
        <Card>
          <CardBody className="text-center py-10 text-muted">
            {t('member_premium_admin.empty.tiers')}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table removeWrapper aria-label={t('member_premium_admin.table.aria')}>
              <TableHeader>
                <TableColumn>{t('member_premium_admin.table.name')}</TableColumn>
                <TableColumn>{t('member_premium_admin.table.slug')}</TableColumn>
                <TableColumn>{t('member_premium_admin.table.price_month')}</TableColumn>
                <TableColumn>{t('member_premium_admin.table.price_year')}</TableColumn>
                <TableColumn>{t('member_premium_admin.table.features')}</TableColumn>
                <TableColumn>{t('member_premium_admin.table.status')}</TableColumn>
                <TableColumn>{t('member_premium_admin.table.subscribers')}</TableColumn>
                <TableColumn>{t('member_premium_admin.table.stripe')}</TableColumn>
                <TableColumn>{t('member_premium_admin.table.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {tiers.map((tier) => {
                  const fullySynced = isTierStripeSynced(tier);
                  return (
                    <TableRow key={tier.id}>
                      <TableCell>{tier.name}</TableCell>
                      <TableCell><code className="text-xs">{tier.slug}</code></TableCell>
                      <TableCell>{formatAmount(tier.monthly_price_cents)}</TableCell>
                      <TableCell>{formatAmount(tier.yearly_price_cents)}</TableCell>
                      <TableCell>
                        <span className="text-xs">
                          {(tier.features ?? []).slice(0, 3).join(', ') || t('member_premium_admin.empty.value')}
                          {(tier.features ?? []).length > 3 ? `, +${tier.features.length - 3}` : ''}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" color={tier.is_active ? 'success' : 'default'} variant="soft">
                          {tier.is_active ? t('member_premium_admin.status.active') : t('member_premium_admin.status.inactive')}
                        </Chip>
                      </TableCell>
                      <TableCell>{tier.active_subscriber_count ?? 0}</TableCell>
                      <TableCell>
                        <Chip size="sm" color={fullySynced ? 'success' : 'warning'} variant="soft">
                          {fullySynced ? t('member_premium_admin.stripe.synced') : t('member_premium_admin.stripe.needs_sync')}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="tertiary"
                            isIconOnly
                            onPress={() => openEdit(tier)}
                            aria-label={t('member_premium_admin.actions.edit')}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="tertiary"
                            isIconOnly
                            isLoading={syncing === tier.id}
                            onPress={() => syncTier(tier)}
                            aria-label={t('member_premium_admin.actions.sync_stripe')}
                          >
                            <RefreshCw size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            isIconOnly
                            isLoading={deleting === tier.id}
                            onPress={() => deleteTier(tier)}
                            aria-label={t('member_premium_admin.actions.delete')}
                          >
                            <Trash size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Modal isOpen={isOpen} onClose={onClose} size="2xl">
        <ModalContent>
          <ModalHeader>{form.id ? t('member_premium_admin.modal.edit_title') : t('member_premium_admin.modal.new_title')}</ModalHeader>
          <ModalBody>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t('member_premium_admin.form.name')}
                value={form.name}
                onValueChange={(v) => setForm({ ...form, name: v })}
                isRequired
              />
              <Input
                label={t('member_premium_admin.form.slug')}
                value={form.slug}
                onValueChange={(v) => setForm({ ...form, slug: v })}
                description={t('member_premium_admin.form.slug_description')}
                isRequired
              />
            </div>
            <Textarea
              label={t('member_premium_admin.form.description')}
              value={form.description}
              onValueChange={(v) => setForm({ ...form, description: v })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                label={t('member_premium_admin.form.price_month')}
                value={form.monthly_price}
                onValueChange={(v) => setForm({ ...form, monthly_price: v })}
              />
              <Input
                type="number"
                step="0.01"
                min="0"
                label={t('member_premium_admin.form.price_year')}
                value={form.yearly_price}
                onValueChange={(v) => setForm({ ...form, yearly_price: v })}
              />
            </div>
            <Textarea
              label={t('member_premium_admin.form.features')}
              value={form.features}
              onValueChange={(v) => setForm({ ...form, features: v })}
              description={t('member_premium_admin.form.features_description')}
            />
            <div className="grid gap-4 sm:grid-cols-2 items-center">
              <Input
                type="number"
                label={t('member_premium_admin.form.sort_order')}
                value={String(form.sort_order)}
                onValueChange={(v) => setForm({ ...form, sort_order: Number(v) || 0 })}
              />
              <Switch
                isSelected={form.is_active}
                onValueChange={(v) => setForm({ ...form, is_active: v })}
              >
                {t('member_premium_admin.status.active')}
              </Switch>
            </div>
            {form.id && (
              <p className="text-xs text-warning-soft-foreground mt-2">
                {t('member_premium_admin.modal.stripe_price_note')}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose} isDisabled={saving}>{t('member_premium_admin.actions.cancel')}</Button>
            <Button onPress={save} isLoading={saving}>
              {form.id ? t('member_premium_admin.actions.save_changes') : t('member_premium_admin.actions.create_tier')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default MemberPremiumAdminPage;
