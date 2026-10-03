// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Configuration
 * Configure broker controls, messaging oversight, and risk settings.
 * Parity: PHP BrokerControlsController::configuration()
 *
 * Restyled to the broker design language: BrokerPageShell frame, grouped
 * section cards (icon + title + one-line description), admin-only settings
 * surfaced with a lock chip + tooltip instead of bare disabled inputs, and
 * an honest load-error state with retry. Setting keys and the save payload
 * are byte-identical to the previous implementation.
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import Save from 'lucide-react/icons/save';
import Settings from 'lucide-react/icons/settings';
import MessageSquare from 'lucide-react/icons/message-square';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Eye from 'lucide-react/icons/eye';
import Copy from 'lucide-react/icons/copy';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Lock from 'lucide-react/icons/lock';
import AlertCircle from 'lucide-react/icons/circle-alert';
import type { LucideIcon } from 'lucide-react';

import {
  Card,
  CardBody,
  Button,
  Input,
  Switch,
  Chip,
  Tooltip,
  Separator,
} from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { adminBroker } from '@/admin/api/adminApi';
import type { BrokerConfig } from '@/admin/api/types';
import { useAuth, useTenant, useToast } from '@/contexts';
import {
  BrokerPageShell,
  BrokerSkeleton,
  BrokerEmptyState,
  type BrokerStatColor,
} from '../components';

const ADMIN_ONLY_CONFIG_KEYS = [
  'broker_messaging_enabled',
  'broker_copy_all_messages',
  'require_exchange_for_listings',
  'risk_tagging_enabled',
  'auto_flag_high_risk',
  'require_approval_high_risk',
  'notify_on_high_risk_match',
  'broker_approval_required',
  'auto_approve_low_risk',
  'max_hours_without_approval',
  'insurance_enabled',
  'enforce_insurance_on_exchanges',
] as const satisfies readonly (keyof BrokerConfig)[];

// Tailwind JIT needs full class names at build time.
const sectionTileClass: Record<BrokerStatColor, string> = {
  accent: 'text-accent bg-accent/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  neutral: 'text-muted bg-surface-tertiary',
};

// ─────────────────────────────────────────────────────────────────────────────
// Presentational helpers — one section card per settings domain, uniform
// setting rows, and the admin-only lock chip.
// ─────────────────────────────────────────────────────────────────────────────

interface SectionCardProps {
  icon: LucideIcon;
  color: BrokerStatColor;
  title: string;
  description: string;
  children: ReactNode;
}

function SectionCard({ icon: Icon, color, title, description, children }: SectionCardProps) {
  return (
    <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${sectionTileClass[color]}`}
        >
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          <p className="text-sm text-muted">{description}</p>
        </div>
      </div>
      <Separator />
      <CardBody className="divide-y divide-divider p-0">{children}</CardBody>
    </Card>
  );
}

/** Lock chip + tooltip marking a tenant-wide policy the current user can't change. */
function AdminOnlyChip() {
  const { t } = useTranslation('broker');
  return (
    <Tooltip content={t('configuration.admin_only_tooltip')}>
      <Chip
        size="sm"
        variant="soft"
        color="default"
        className="shrink-0"
        startContent={<Lock size={11} aria-hidden="true" />}
      >
        {t('configuration.admin_only_chip')}
      </Chip>
    </Tooltip>
  );
}

interface SettingRowProps {
  label: string;
  help: string;
  /** Admin-only policy the current user cannot edit — renders the lock chip. */
  locked?: boolean;
  /** The control (Switch / Input) — rendered right-aligned. */
  children: ReactNode;
}

function SettingRow({ label, help, locked = false, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{label}</p>
          {locked && <AdminOnlyChip />}
        </div>
        <p className="mt-0.5 text-sm leading-5 text-muted">{help}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BrokerConfiguration() {
  const { t } = useTranslation('broker');
  usePageTitle(t('configuration.page_title'));
  const { hasFeature } = useTenant();
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [config, setConfig] = useState<BrokerConfig>({
    broker_messaging_enabled: true,
    broker_copy_all_messages: false,
    broker_copy_threshold_hours: 5,
    new_member_monitoring_days: 30,
    require_exchange_for_listings: false,
    risk_tagging_enabled: true,
    auto_flag_high_risk: true,
    require_approval_high_risk: false,
    notify_on_high_risk_match: true,
    broker_approval_required: true,
    auto_approve_low_risk: false,
    exchange_timeout_days: 7,
    max_hours_without_approval: 5,
    confirmation_deadline_hours: 48,
    allow_hour_adjustment: false,
    max_hour_variance_percent: 20,
    expiry_hours: 168,
    broker_visible_to_members: false,
    show_broker_name: false,
    broker_contact_email: '',
    copy_first_contact: true,
    copy_new_member_messages: true,
    copy_high_risk_listing_messages: true,
    random_sample_percentage: 0,
    retention_days: 90,
    insurance_enabled: false,
    enforce_insurance_on_exchanges: false,
    insurance_expiry_warning_days: 30,
  });

  const role = (user?.role as string) || '';
  const userRecord = user as Record<string, unknown> | null;
  const isAdminTier =
    role === 'admin' ||
    role === 'tenant_admin' ||
    role === 'super_admin' ||
    role === 'god' ||
    userRecord?.is_admin === true ||
    userRecord?.is_super_admin === true ||
    userRecord?.is_tenant_super_admin === true ||
    userRecord?.is_god === true;

  const canEditKey = (key: keyof BrokerConfig) =>
    isAdminTier || !ADMIN_ONLY_CONFIG_KEYS.includes(key as (typeof ADMIN_ONLY_CONFIG_KEYS)[number]);

  /** true when the row's control is an admin-only policy the current user can't change. */
  const isLocked = (key: keyof BrokerConfig) => !canEditKey(key);

  // The configuration as the server last returned it, so a broker's save can
  // send only what the broker changed (F-547).
  const savedConfigRef = useRef<Partial<BrokerConfig>>({});

  // Stash t/toast in refs so loadConfig's identity never churns (a t/toast
  // dependency would refetch on every language switch and can loop vitest).
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getConfiguration();
      if (res.success && res.data) {
        savedConfigRef.current = res.data;
        setConfig(res.data);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
      toastRef.current.error(tRef.current('configuration.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function handleSave() {
    setSaving(true);
    try {
      // F-547: a non-admin sends only the settings they changed. The server
      // refuses the whole save if it contains any admin-only key, even
      // unchanged — and the loaded config carries admin-only keys this page
      // never shows (e.g. exchange_workflow_enabled) or that an admin set to
      // an admin-only value (random_sample_percentage at 100, F-242).
      const saved = savedConfigRef.current;
      const payload = isAdminTier
        ? config
        : (Object.fromEntries(
            Object.entries(config).filter(([key, value]) =>
              canEditKey(key as keyof BrokerConfig)
              && value !== saved[key as keyof BrokerConfig])
          ) as Partial<BrokerConfig>);

      const res = await adminBroker.saveConfiguration(payload);
      if (res.success) {
        savedConfigRef.current = { ...saved, ...config, ...res.data };
        if (res.data) {
          setConfig(prev => ({ ...prev, ...res.data }));
        }
        setDirty(false);
        toast.success(t('configuration.save_success'));
      } else {
        toast.error(t('configuration.save_failed'));
      }
    } catch {
      toast.error(t('configuration.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  function updateConfig<K extends keyof BrokerConfig>(key: K, value: BrokerConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_role', articleId: 'broker_configuration' }}
      title={t('configuration.title')}
      description={t('configuration.description')}
      icon={Settings}
      color="neutral"
      actions={
        <>
          {dirty && !loading && !loadError && (
            <Chip size="sm" variant="soft" color="warning" className="shrink-0">
              {t('configuration.unsaved_changes')}
            </Chip>
          )}
          <Button
            startContent={<Save className="w-4 h-4" />}
            onPress={handleSave}
            isLoading={saving}
            isDisabled={loading || loadError}
            size="sm"
          >
            {t('configuration.save_changes')}
          </Button>
        </>
      }
    >
      {loading ? (
        <BrokerSkeleton variant="cards" count={4} />
      ) : loadError ? (
        // Honest error state — never render editable defaults over a failed
        // load, where "Save" would silently overwrite the tenant's settings.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('configuration.load_error_title')}
          hint={t('configuration.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={loadConfig}>
              {t('configuration.retry')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {!isAdminTier && (
            <Card className="rounded-2xl border border-warning/30 bg-warning/10 shadow-sm shadow-black/[0.03]">
              <CardBody className="flex flex-row items-start gap-3 py-3">
                <Lock size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-warning">
                    {t('configuration.limited_access_title')}
                  </p>
                  <p className="text-muted">{t('configuration.limited_access_body')}</p>
                </div>
              </CardBody>
            </Card>
          )}

          {/* ── Messaging ─────────────────────────────────────────────────── */}
          <SectionCard
            icon={MessageSquare}
            color="warning"
            title={t('configuration.section_messaging')}
            description={t('configuration.section_messaging_desc')}
          >
            <SettingRow
              label={t('configuration.field_broker_messaging_enabled_label')}
              help={t('configuration.field_broker_messaging_enabled_help')}
              locked={isLocked('broker_messaging_enabled')}
            >
              <Switch
                aria-label={t('configuration.field_broker_messaging_enabled_label')}
                isSelected={config.broker_messaging_enabled}
                onValueChange={v => updateConfig('broker_messaging_enabled', v)}
                isDisabled={!canEditKey('broker_messaging_enabled')}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_broker_copy_all_messages_label')}
              help={t('configuration.field_broker_copy_all_messages_help')}
              locked={isLocked('broker_copy_all_messages')}
            >
              <Switch
                aria-label={t('configuration.field_broker_copy_all_messages_label')}
                isSelected={config.broker_copy_all_messages}
                onValueChange={v => updateConfig('broker_copy_all_messages', v)}
                isDisabled={!canEditKey('broker_copy_all_messages')}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_broker_copy_threshold_hours_label')}
              help={t('configuration.field_broker_copy_threshold_hours_help')}
            >
              <Input
                type="number"
                aria-label={t('configuration.field_broker_copy_threshold_hours_aria')}
                value={String(config.broker_copy_threshold_hours)}
                onValueChange={v => updateConfig('broker_copy_threshold_hours', parseInt(v) || 0)}
                className="w-24 tabular-nums"
                min={0}
                max={100}
                size="sm"
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_new_member_monitoring_days_label')}
              help={t('configuration.field_new_member_monitoring_days_help')}
            >
              <Input
                type="number"
                aria-label={t('configuration.field_new_member_monitoring_days_aria')}
                value={String(config.new_member_monitoring_days)}
                onValueChange={v => updateConfig('new_member_monitoring_days', parseInt(v) || 0)}
                className="w-24 tabular-nums"
                min={0}
                max={365}
                size="sm"
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_require_exchange_for_listings_label')}
              help={t('configuration.field_require_exchange_for_listings_help')}
              locked={isLocked('require_exchange_for_listings')}
            >
              <Switch
                aria-label={t('configuration.field_require_exchange_for_listings_label')}
                isSelected={config.require_exchange_for_listings}
                onValueChange={v => updateConfig('require_exchange_for_listings', v)}
                isDisabled={!canEditKey('require_exchange_for_listings')}
              />
            </SettingRow>
          </SectionCard>

          {/* ── Risk Tagging ──────────────────────────────────────────────── */}
          <SectionCard
            icon={ShieldAlert}
            color="danger"
            title={t('configuration.section_risk_tagging')}
            description={t('configuration.section_risk_tagging_desc')}
          >
            <SettingRow
              label={t('configuration.field_risk_tagging_enabled_label')}
              help={t('configuration.field_risk_tagging_enabled_help')}
              locked={isLocked('risk_tagging_enabled')}
            >
              <Switch
                aria-label={t('configuration.field_risk_tagging_enabled_label')}
                isSelected={config.risk_tagging_enabled}
                onValueChange={v => updateConfig('risk_tagging_enabled', v)}
                isDisabled={!canEditKey('risk_tagging_enabled')}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_auto_flag_high_risk_label')}
              help={t('configuration.field_auto_flag_high_risk_help')}
              locked={isLocked('auto_flag_high_risk')}
            >
              <Switch
                aria-label={t('configuration.field_auto_flag_high_risk_label')}
                isSelected={config.auto_flag_high_risk}
                onValueChange={v => updateConfig('auto_flag_high_risk', v)}
                isDisabled={!canEditKey('auto_flag_high_risk')}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_require_approval_high_risk_label')}
              help={t('configuration.field_require_approval_high_risk_help')}
              locked={isLocked('require_approval_high_risk')}
            >
              <Switch
                aria-label={t('configuration.field_require_approval_high_risk_label')}
                isSelected={config.require_approval_high_risk}
                onValueChange={v => updateConfig('require_approval_high_risk', v)}
                isDisabled={!canEditKey('require_approval_high_risk')}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_notify_on_high_risk_match_label')}
              help={t('configuration.field_notify_on_high_risk_match_help')}
              locked={isLocked('notify_on_high_risk_match')}
            >
              <Switch
                aria-label={t('configuration.field_notify_on_high_risk_match_label')}
                isSelected={config.notify_on_high_risk_match}
                onValueChange={v => updateConfig('notify_on_high_risk_match', v)}
                isDisabled={!canEditKey('notify_on_high_risk_match')}
              />
            </SettingRow>
          </SectionCard>

          {/* ── Exchange Workflow — only when the tenant has the feature ──── */}
          {hasFeature('exchange_workflow') && (
            <SectionCard
              icon={ArrowLeftRight}
              color="accent"
              title={t('configuration.section_exchange_workflow')}
              description={t('configuration.section_exchange_workflow_desc')}
            >
              <SettingRow
                label={t('configuration.field_broker_approval_required_label')}
                help={t('configuration.field_broker_approval_required_help')}
                locked={isLocked('broker_approval_required')}
              >
                <Switch
                  aria-label={t('configuration.field_broker_approval_required_label')}
                  isSelected={config.broker_approval_required}
                  onValueChange={v => updateConfig('broker_approval_required', v)}
                  isDisabled={!canEditKey('broker_approval_required')}
                />
              </SettingRow>
              <SettingRow
                label={t('configuration.field_auto_approve_low_risk_label')}
                help={t('configuration.field_auto_approve_low_risk_help')}
                locked={isLocked('auto_approve_low_risk')}
              >
                <Switch
                  aria-label={t('configuration.field_auto_approve_low_risk_label')}
                  isSelected={config.auto_approve_low_risk}
                  onValueChange={v => updateConfig('auto_approve_low_risk', v)}
                  isDisabled={!canEditKey('auto_approve_low_risk')}
                />
              </SettingRow>
              <SettingRow
                label={t('configuration.field_exchange_timeout_days_label')}
                help={t('configuration.field_exchange_timeout_days_help')}
              >
                <Input
                  type="number"
                  aria-label={t('configuration.field_exchange_timeout_days_aria')}
                  value={String(config.exchange_timeout_days)}
                  onValueChange={v => updateConfig('exchange_timeout_days', parseInt(v) || 7)}
                  className="w-24 tabular-nums"
                  min={1}
                  max={90}
                  size="sm"
                />
              </SettingRow>
              <SettingRow
                label={t('configuration.field_max_hours_without_approval_label')}
                help={t('configuration.field_max_hours_without_approval_help')}
                locked={isLocked('max_hours_without_approval')}
              >
                <Input
                  type="number"
                  aria-label={t('configuration.field_max_hours_without_approval_aria')}
                  value={String(config.max_hours_without_approval)}
                  onValueChange={v =>
                    updateConfig('max_hours_without_approval', v === '' ? 0 : parseFloat(v))
                  }
                  className="w-24 tabular-nums"
                  min={0}
                  max={24}
                  step={0.5}
                  size="sm"
                  isDisabled={!canEditKey('max_hours_without_approval')}
                />
              </SettingRow>
              <SettingRow
                label={t('configuration.field_confirmation_deadline_hours_label')}
                help={t('configuration.field_confirmation_deadline_hours_help')}
              >
                <Input
                  type="number"
                  aria-label={t('configuration.field_confirmation_deadline_hours_aria')}
                  value={String(config.confirmation_deadline_hours)}
                  onValueChange={v => updateConfig('confirmation_deadline_hours', parseInt(v) || 48)}
                  className="w-24 tabular-nums"
                  min={1}
                  max={720}
                  size="sm"
                />
              </SettingRow>
              <SettingRow
                label={t('configuration.field_expiry_hours_label')}
                help={t('configuration.field_expiry_hours_help')}
              >
                <Input
                  type="number"
                  aria-label={t('configuration.field_expiry_hours_aria')}
                  value={String(config.expiry_hours)}
                  onValueChange={v => updateConfig('expiry_hours', parseInt(v) || 168)}
                  className="w-24 tabular-nums"
                  min={1}
                  max={720}
                  size="sm"
                />
              </SettingRow>
              <SettingRow
                label={t('configuration.field_allow_hour_adjustment_label')}
                help={t('configuration.field_allow_hour_adjustment_help')}
              >
                <Switch
                  aria-label={t('configuration.field_allow_hour_adjustment_label')}
                  isSelected={config.allow_hour_adjustment}
                  onValueChange={v => updateConfig('allow_hour_adjustment', v)}
                />
              </SettingRow>
              {config.allow_hour_adjustment && (
                <SettingRow
                  label={t('configuration.field_max_hour_variance_percent_label')}
                  help={t('configuration.field_max_hour_variance_percent_help')}
                >
                  <Input
                    type="number"
                    aria-label={t('configuration.field_max_hour_variance_percent_aria')}
                    value={String(config.max_hour_variance_percent)}
                    onValueChange={v =>
                      updateConfig('max_hour_variance_percent', parseInt(v) || 0)
                    }
                    className="w-24 tabular-nums"
                    min={0}
                    max={100}
                    size="sm"
                  />
                </SettingRow>
              )}
            </SectionCard>
          )}

          {/* ── Broker Visibility ─────────────────────────────────────────── */}
          <SectionCard
            icon={Eye}
            color="neutral"
            title={t('configuration.section_broker_visibility')}
            description={t('configuration.section_broker_visibility_desc')}
          >
            <SettingRow
              label={t('configuration.field_broker_visible_to_members_label')}
              help={t('configuration.field_broker_visible_to_members_help')}
            >
              <Switch
                aria-label={t('configuration.field_broker_visible_to_members_label')}
                isSelected={config.broker_visible_to_members}
                onValueChange={v => updateConfig('broker_visible_to_members', v)}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_show_broker_name_label')}
              help={t('configuration.field_show_broker_name_help')}
            >
              <Switch
                aria-label={t('configuration.field_show_broker_name_label')}
                isSelected={config.show_broker_name}
                onValueChange={v => updateConfig('show_broker_name', v)}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_broker_contact_email_label')}
              help={t('configuration.field_broker_contact_email_help')}
            >
              <Input
                type="email"
                aria-label={t('configuration.field_broker_contact_email_aria')}
                value={config.broker_contact_email}
                onValueChange={v => updateConfig('broker_contact_email', v)}
                placeholder={t('configuration.field_broker_contact_email_placeholder')}
                className="w-48 sm:w-64"
                size="sm"
              />
            </SettingRow>
          </SectionCard>

          {/* ── Message Copy Rules ────────────────────────────────────────── */}
          <SectionCard
            icon={Copy}
            color="warning"
            title={t('configuration.section_message_copy_rules')}
            description={t('configuration.section_message_copy_rules_desc')}
          >
            <SettingRow
              label={t('configuration.field_copy_first_contact_label')}
              help={t('configuration.field_copy_first_contact_help')}
            >
              <Switch
                aria-label={t('configuration.field_copy_first_contact_label')}
                isSelected={config.copy_first_contact}
                onValueChange={v => updateConfig('copy_first_contact', v)}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_copy_new_member_messages_label')}
              help={t('configuration.field_copy_new_member_messages_help')}
            >
              <Switch
                aria-label={t('configuration.field_copy_new_member_messages_label')}
                isSelected={config.copy_new_member_messages}
                onValueChange={v => updateConfig('copy_new_member_messages', v)}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_copy_high_risk_listing_messages_label')}
              help={t('configuration.field_copy_high_risk_listing_messages_help')}
            >
              <Switch
                aria-label={t('configuration.field_copy_high_risk_listing_messages_label')}
                isSelected={config.copy_high_risk_listing_messages}
                onValueChange={v => updateConfig('copy_high_risk_listing_messages', v)}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_random_sample_percentage_label')}
              help={t('configuration.field_random_sample_percentage_help')}
            >
              <Input
                type="number"
                aria-label={t('configuration.field_random_sample_percentage_aria')}
                value={String(config.random_sample_percentage)}
                onValueChange={v => updateConfig('random_sample_percentage', parseInt(v) || 0)}
                className="w-24 tabular-nums"
                min={0}
                max={100}
                size="sm"
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_retention_days_label')}
              help={t('configuration.field_retention_days_help')}
            >
              <Input
                type="number"
                aria-label={t('configuration.field_retention_days_aria')}
                value={String(config.retention_days)}
                onValueChange={v => updateConfig('retention_days', parseInt(v) || 90)}
                className="w-24 tabular-nums"
                min={1}
                max={3650}
                size="sm"
              />
            </SettingRow>
          </SectionCard>

          {/* ── Compliance & Safeguarding ─────────────────────────────────── */}
          <SectionCard
            icon={ShieldCheck}
            color="success"
            title={t('configuration.section_compliance_safeguarding')}
            description={t('configuration.section_compliance_safeguarding_desc')}
          >
            <SettingRow
              label={t('configuration.field_insurance_enabled_label')}
              help={t('configuration.field_insurance_enabled_help')}
              locked={isLocked('insurance_enabled')}
            >
              <Switch
                aria-label={t('configuration.field_insurance_enabled_label')}
                isSelected={config.insurance_enabled}
                onValueChange={v => updateConfig('insurance_enabled', v)}
                isDisabled={!canEditKey('insurance_enabled')}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_enforce_insurance_on_exchanges_label')}
              help={t('configuration.field_enforce_insurance_on_exchanges_help')}
              locked={isLocked('enforce_insurance_on_exchanges')}
            >
              <Switch
                aria-label={t('configuration.field_enforce_insurance_on_exchanges_label')}
                isSelected={config.enforce_insurance_on_exchanges}
                onValueChange={v => updateConfig('enforce_insurance_on_exchanges', v)}
                isDisabled={!config.insurance_enabled || !canEditKey('enforce_insurance_on_exchanges')}
              />
            </SettingRow>
            <SettingRow
              label={t('configuration.field_insurance_expiry_warning_days_label')}
              help={t('configuration.field_insurance_expiry_warning_days_help')}
            >
              <Input
                type="number"
                aria-label={t('configuration.field_insurance_expiry_warning_days_aria')}
                value={String(config.insurance_expiry_warning_days)}
                onValueChange={v => updateConfig('insurance_expiry_warning_days', parseInt(v) || 30)}
                className="w-24 tabular-nums"
                min={1}
                max={365}
                size="sm"
                isDisabled={!config.insurance_enabled}
              />
            </SettingRow>
          </SectionCard>
        </div>
      )}
    </BrokerPageShell>
  );
}
