// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Button, Chip, Input, Spinner, Code, Snippet, Accordion, AccordionItem, Switch } from '@/components/ui';
import {
  useState,
  useCallback,
  useEffect,
  useRef } from 'react';
import { Link } from 'react-router-dom';

import { Separator } from '@/components/ui';
import Globe from 'lucide-react/icons/globe';
import Shield from 'lucide-react/icons/shield';
import Lock from 'lucide-react/icons/lock';
import Unlock from 'lucide-react/icons/lock-open';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Network from 'lucide-react/icons/network';
import Trash2 from 'lucide-react/icons/trash-2';
import Plus from 'lucide-react/icons/plus';
import Activity from 'lucide-react/icons/activity';
import ArrowRight from 'lucide-react/icons/arrow-right';
import ListChecks from 'lucide-react/icons/list-checks';
import Users from 'lucide-react/icons/users';
import Handshake from 'lucide-react/icons/handshake';
import KeyRound from 'lucide-react/icons/key-round';
import { usePageTitle } from '@/hooks';
import { useToast,
  useTenant } from '@/contexts';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { StatCard } from '../../components/StatCard';
import type { FederationSystemControls as FederationSystemControlsType, FederationWhitelistEntry, FederationPartnership, FederationExternalStatus } from '../../api/types';
import { useTranslation } from 'react-i18next';

/**
 * Federation Control Center
 * Super-admin hub for federation management: system status, feature toggles, * whitelist, partnerships, and quick links to sub-pages.
 */

const colorClasses: Record<string, { bg: string; text: string }> = {
  accent: { bg: 'bg-accent/10', text: 'text-accent' },
  success: { bg: 'bg-success/10', text: 'text-success' },
  default: { bg: 'bg-surface-tertiary', text: 'text-muted' },
  warning: { bg: 'bg-warning/10', text: 'text-warning' },
  danger: { bg: 'bg-danger/10', text: 'text-danger' },
};

export function FederationControls() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.federation_controls_title'));
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { tenantPath } = useTenant();

  const [controls, setControls] = useState<FederationSystemControlsType | null>(null);
  const [whitelist, setWhitelist] = useState<FederationWhitelistEntry[]>([]);
  const [partnerships, setPartnerships] = useState<FederationPartnership[]>([]);
  const [jwtStatus, setJwtStatus] = useState<{ configured: boolean; issuer: string; key_bits: number; recommended_bits: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [lockdownConfirm, setLockdownConfirm] = useState(false);
  const [lockdownReason, setLockdownReason] = useState('');
  const [addTenantId, setAddTenantId] = useState('');
  const [partnerAction, setPartnerAction] = useState<{ type: 'suspend' | 'terminate' | 'reactivate'; id: number } | null>(null);
  const [externalStatus, setExternalStatus] = useState<FederationExternalStatus | null>(null);
  const [externalConfirm, setExternalConfirm] = useState(false);
  const [externalReason, setExternalReason] = useState('');
  const [partnerApiConfirm, setPartnerApiConfirm] = useState(false);
  const [partnerApiReason, setPartnerApiReason] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ctrlRes, wlRes, pRes, jwtRes, extRes] = await Promise.all([
        adminSuper.getSystemControls(),
        adminSuper.getWhitelist(),
        adminSuper.getFederationPartnerships(),
        adminSuper.getFederationJwtStatus(),
        adminSuper.getFederationExternalStatus(),
      ]);
      if (ctrlRes.success && ctrlRes.data) setControls(ctrlRes.data);
      if (wlRes.success && wlRes.data) setWhitelist(Array.isArray(wlRes.data) ? wlRes.data : []);
      if (pRes.success && pRes.data) setPartnerships(Array.isArray(pRes.data) ? pRes.data : []);
      if (jwtRes.success && jwtRes.data) setJwtStatus(jwtRes.data);
      if (extRes.success && extRes.data) setExternalStatus(extRes.data);
    } catch {
      toastRef.current.error(t('super.federation_error'));
    }
    setLoading(false);
  }, [t])

  useEffect(() => { loadData(); }, [loadData]);

  const updateControl = async (key: string, value: boolean | number) => {
    setSaving(key);
    try {
      const res = await adminSuper.updateSystemControls({ [key]: value });
      if (res?.success) {
        setControls(prev => prev ? { ...prev, [key]: value } : prev);
      } else {
        toastRef.current.error(t('super.failed_to_update_setting'));
      }
    } catch {
      toastRef.current.error(t('super.failed_to_update_setting_detail'));
    } finally {
      setSaving(null);
    }
  };

  /**
   * The external master switch is the safety gate, so turning it OFF is
   * confirm-gated and requires a reason. Turning it back ON needs no
   * confirmation — restoring service is not the dangerous direction.
   */
  const applyExternalMaster = async (enabled: boolean, reason?: string) => {
    setSaving('external_federation_enabled');
    try {
      const res = await adminSuper.updateSystemControls({
        external_federation_enabled: enabled,
        ...(enabled ? {} : { reason }),
      });
      if (res?.success) {
        setControls(prev => (prev ? { ...prev, external_federation_enabled: enabled } : prev));
        loadData();
      } else {
        toastRef.current.error(t('super.failed_to_update_setting'));
      }
    } catch {
      toastRef.current.error(t('super.failed_to_update_setting_detail'));
    } finally {
      setSaving(null);
    }
  };

  /** Sibling switch for the AG60 Partner API — same confirm-on-disable shape. */
  const applyPartnerApi = async (enabled: boolean, reason?: string) => {
    setSaving('partner_api_enabled');
    try {
      const res = await adminSuper.updateSystemControls({
        partner_api_enabled: enabled,
        ...(enabled ? {} : { reason }),
      });
      if (res?.success) {
        setControls(prev => (prev ? { ...prev, partner_api_enabled: enabled } : prev));
        loadData();
      } else {
        toastRef.current.error(t('super.failed_to_update_setting'));
      }
    } catch {
      toastRef.current.error(t('super.failed_to_update_setting_detail'));
    } finally {
      setSaving(null);
    }
  };

  const handlePartnerApiToggle = (enabled: boolean) => {
    if (enabled) {
      applyPartnerApi(true);
      return;
    }
    setPartnerApiReason('');
    setPartnerApiConfirm(true);
  };

  const handleExternalMasterToggle = (enabled: boolean) => {
    if (enabled) {
      applyExternalMaster(true);
      return;
    }
    setExternalReason('');
    setExternalConfirm(true);
  };

  const handleLockdown = async () => {
    try {
      if (controls?.emergency_lockdown_active) {
        const res = await adminSuper.liftLockdown();
        if (res?.success) { toastRef.current.success(t('super.lockdown_lifted')); loadData(); }
        else toastRef.current.error(t('super.failed_to_lift_lockdown'));
      } else {
        if (!lockdownReason.trim()) {
          toastRef.current.error(t('super.please_provide_a_reason_for_the_lockdown'));
          return;
        }
        const res = await adminSuper.emergencyLockdown(lockdownReason);
        if (res?.success) { toastRef.current.success(t('super.lockdown_activated')); loadData(); }
        else toastRef.current.error(t('super.failed_to_activate_lockdown'));
      }
    } catch {
      toastRef.current.error(t('super.lockdown_action_failed_detail'));
    } finally {
      setLockdownConfirm(false);
    }
  };

  const handleAddWhitelist = async () => {
    if (!addTenantId) return;
    const res = await adminSuper.addToWhitelist(Number(addTenantId));
    if (res?.success) { toastRef.current.success(t('super.added_to_whitelist')); setAddTenantId(''); loadData(); }
    else toastRef.current.error(t('super.failed_to_add_to_whitelist'));
  };

  const handleRemoveWhitelist = async (tenantId: number) => {
    const res = await adminSuper.removeFromWhitelist(tenantId);
    if (res?.success) { toastRef.current.success(t('super.removed_from_whitelist')); loadData(); }
    else toastRef.current.error(t('super.failed_to_remove_from_whitelist'));
  };

  const handlePartnerAction = async () => {
    if (!partnerAction) return;
    let res;
    if (partnerAction.type === 'suspend') {
      res = await adminSuper.suspendPartnership(partnerAction.id, t('super.suspended_by_super_admin'));
    } else if (partnerAction.type === 'terminate') {
      res = await adminSuper.terminatePartnership(partnerAction.id, t('super.terminated_by_super_admin'));
    } else {
      res = await adminSuper.reactivatePartnership(partnerAction.id);
    }
    if (res?.success) {
      toastRef.current.success(
        partnerAction.type === 'suspend'
          ? t('super.partnership_suspended')
          : partnerAction.type === 'terminate'
          ? t('super.partnership_terminated')
          : t('super.partnership_reactivated')
      );
      loadData();
    } else {
      toastRef.current.error(t('super.action_failed'));
    }
    setPartnerAction(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('super.loading_federation_controls')} /></div>
      </div>
    );
  }

  if (!controls) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertTriangle aria-hidden="true" size={48} className="text-warning" />
        <p className="text-lg text-muted">{t('super.failed_to_load_federation_controls')}</p>
        <Button onPress={loadData}>{t('super.retry')}</Button>
      </div>
    );
  }

  type BooleanControlKey = Exclude<{
    [K in keyof FederationSystemControlsType]: FederationSystemControlsType[K] extends boolean ? K : never;
  }[keyof FederationSystemControlsType], undefined>;

  const featureToggles: Array<{ key: BooleanControlKey; label: string; description: string }> = [
    { key: 'cross_tenant_profiles_enabled', label: t('super.toggle_profile_sharing'), description: t('super.toggle_profile_sharing_desc') },
    { key: 'cross_tenant_messaging_enabled', label: t('super.toggle_cross_messaging'), description: t('super.toggle_cross_messaging_desc') },
    { key: 'cross_tenant_transactions_enabled', label: t('super.toggle_cross_transactions'), description: t('super.toggle_cross_transactions_desc') },
    { key: 'cross_tenant_listings_enabled', label: t('super.toggle_listing_discovery'), description: t('super.toggle_listing_discovery_desc') },
    { key: 'cross_tenant_events_enabled', label: t('super.toggle_event_sharing'), description: t('super.toggle_event_sharing_desc') },
    { key: 'cross_tenant_groups_enabled', label: t('super.toggle_group_federation'), description: t('super.toggle_group_federation_desc') },
  ];

  // External partner protocols — traffic to/from OTHER installations. Each has
  // its own switch so a protocol can be restored as soon as its audit passes,
  // without re-opening the rest.
  const externalProtocolToggles: Array<{ key: BooleanControlKey; protocol: string; label: string; description: string }> = [
    { key: 'external_protocol_nexus_enabled', protocol: 'nexus', label: t('super.external_protocol_nexus'), description: t('super.external_protocol_nexus_desc') },
    { key: 'external_protocol_komunitin_enabled', protocol: 'komunitin', label: t('super.external_protocol_komunitin'), description: t('super.external_protocol_komunitin_desc') },
    { key: 'external_protocol_credit_commons_enabled', protocol: 'credit_commons', label: t('super.external_protocol_credit_commons'), description: t('super.external_protocol_credit_commons_desc') },
    { key: 'external_protocol_legacy_v1_enabled', protocol: 'legacy_v1', label: t('super.external_protocol_legacy_v1'), description: t('super.external_protocol_legacy_v1_desc') },
    { key: 'external_protocol_webhooks_enabled', protocol: 'webhooks', label: t('super.external_protocol_webhooks'), description: t('super.external_protocol_webhooks_desc') },
    { key: 'external_protocol_hour_transfer_enabled', protocol: 'hour_transfer', label: t('super.external_protocol_hour_transfer'), description: t('super.external_protocol_hour_transfer_desc') },
    { key: 'external_protocol_aggregates_enabled', protocol: 'aggregates', label: t('super.external_protocol_aggregates'), description: t('super.external_protocol_aggregates_desc') },
  ];

  const activePartnerships = partnerships.filter(p => p.status === 'active').length;

  const partnershipStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return t('super.status_active');
      case 'pending':
        return t('super.status_pending');
      case 'suspended':
        return t('super.status_suspended');
      case 'terminated':
        return t('super.status_terminated');
      default:
        return status;
    }
  };

  const quickLinks = [
    { label: t('super.link_whitelist'), description: t('super.link_whitelist_desc'), href: '/super-admin/federation/whitelist', icon: ListChecks, color: 'success' as const },
    { label: t('super.link_partnerships'), description: t('super.link_partnerships_desc'), href: '/super-admin/federation/partnerships', icon: Handshake, color: 'default' as const },
    { label: t('super.link_audit_log'), description: t('super.link_audit_log_desc'), href: '/super-admin/federation/audit', icon: Activity, color: 'warning' as const },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label={t('super.breadcrumb_nav_aria')} className="flex items-center gap-1 text-sm text-muted">
        <Link to={tenantPath('/super-admin')} className="hover:text-accent">{t('super.breadcrumb_super_admin')}</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{t('super.breadcrumb_federation_controls')}</span>
      </nav>

      <PageHeader
        title={t('super.federation_controls_title')}
        description={t('super.federation_controls_desc')}
      />

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('super.label_federation_status')}
          value={controls.federation_enabled ? t('super.status_active') : t('super.status_disabled')}
          icon={Globe}
          color={controls.federation_enabled ? 'success' : 'danger'}
        />
        <StatCard
          label={t('super.label_whitelisted_tenants')}
          value={whitelist.length}
          icon={Shield}
          color="success"
        />
        <StatCard
          label={t('super.label_active_partnerships')}
          value={activePartnerships}
          icon={Handshake}
          color="default"
        />
        <StatCard
          label={t('super.label_external_federation')}
          value={controls.external_federation_enabled ? t('super.status_active') : t('super.status_disabled')}
          icon={Network}
          color={controls.external_federation_enabled ? 'success' : 'danger'}
        />
        <StatCard
          label={t('super.label_system_status')}
          value={controls.emergency_lockdown_active ? t('super.status_lockdown') : t('super.status_normal')}
          icon={controls.emergency_lockdown_active ? Lock : Unlock}
          color={controls.emergency_lockdown_active ? 'danger' : 'success'}
        />
      </div>

      {/* JWT Auth Configuration — platform-level setup that is easy to forget.
          Displayed prominently so operators notice when it is missing. */}
      <Card className={jwtStatus && !jwtStatus.configured ? 'border-2 border-warning' : ''}>
        <CardHeader className="flex items-center gap-3">
          <KeyRound aria-hidden="true" size={20} className={jwtStatus?.configured ? 'text-success' : 'text-warning'} />
          <div className="flex-1">
            <p className="font-semibold">{t('super.jwt_auth_title')}</p>
            <p className="text-xs text-muted">
              {t('super.jwt_auth_subtitle')}
            </p>
          </div>
          {jwtStatus ? (
            jwtStatus.configured ? (
              <Chip color="success" variant="soft" size="sm">{t('super.status_configured')}</Chip>
            ) : (
              <Chip color="warning" variant="soft" size="sm" startContent={<AlertTriangle aria-hidden="true" size={14} />}>{t('super.status_not_configured')}</Chip>
            )
          ) : (
            <Chip variant="soft" size="sm">…</Chip>
          )}
        </CardHeader>
        <CardBody className="gap-3 text-sm">
          {jwtStatus?.configured && jwtStatus.key_bits < jwtStatus.recommended_bits && (
            <div className="rounded-md border border-warning bg-warning-50 dark:bg-warning-950 p-3 text-warning-700 dark:text-warning-300">
              <strong>{t('super.jwt_warn_weak_key')}</strong>{' '}
              {t('super.jwt_warn_weak_key_body')}
            </div>
          )}

          {!jwtStatus?.configured && (
            <div className="rounded-md border border-warning bg-warning-50 dark:bg-warning-950 p-3 text-warning-700 dark:text-warning-300">
              <strong>{t('super.jwt_warn_not_set')}</strong>{' '}
              {t('super.jwt_warn_not_set_body')}
            </div>
          )}

          <div className="text-muted">
            <span className="font-medium">{t('super.jwt_issuer')}</span>{' '}
            <Code size="sm">{jwtStatus?.issuer || t('super.jwt_issuer_not_set')}</Code>
          </div>

          <Separator />

          <Accordion>
            <AccordionItem
              key="what" id="what"
              aria-label={t('super.jwt_accordion_what')}
              title={<span className="font-medium">{t('super.jwt_accordion_what')}</span>}
            >
              <div className="space-y-2 text-muted">
                <p>
                  {t('super.jwt_what_p1_intro')}{' '}
                  {/* eslint-disable-next-line i18next/no-literal-string -- Authentication method identifier must remain verbatim. */}
                  <strong>api_key</strong>,
                  {/* eslint-disable-next-line i18next/no-literal-string -- Authentication method identifier must remain verbatim. */}
                  <strong>hmac</strong>,
                  {/* eslint-disable-next-line i18next/no-literal-string -- Authentication method identifier must remain verbatim. */}
                  <strong>oauth2</strong>, {t('super.common_and')}{' '}
                  {/* eslint-disable-next-line i18next/no-literal-string -- Authentication method identifier must remain verbatim. */}
                  <strong>jwt</strong>. {t('super.jwt_what_p1_suffix')}
                </p>
                <p>
                  {t('super.jwt_what_p2')}
                </p>
                <p>
                  {t('super.jwt_what_p3_prefix')}{' '}
                  <strong>{t('super.jwt_based_federation_partnerships')}</strong>, {t('super.jwt_what_p3_suffix')}
                </p>
              </div>
            </AccordionItem>

            <AccordionItem
              key="setup" id="setup"
              aria-label={t('super.jwt_accordion_setup')}
              title={<span className="font-medium">{t('super.jwt_accordion_setup')}</span>}
            >
              <div className="space-y-3 text-muted">
                <div>
                  <p className="mb-1"><strong>{t('super.step_number', { number: 1 })}</strong> {t('super.jwt_setup_step_1')}</p>
                  {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                  <Snippet size="sm" symbol="$" hideCopyButton={false}>openssl rand -hex 32</Snippet>
                  <p className="text-xs text-muted mt-1">{t('super.jwt_setup_step_1_note')}</p>
                </div>

                <div>
                  <p className="mb-1"><strong>{t('super.step_number', { number: 2 })}</strong> {t('super.jwt_setup_step_2')}</p>
                  <ul className="list-disc pl-5 space-y-1 text-xs">
                    <li><strong>{t('super.jwt_setup_docker_env')}</strong> {t('super.jwt_setup_append_to')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- Environment file path must remain verbatim. */}
                      <Code size="sm">/opt/nexus-php/.env</Code>:<br/>
                      {/* eslint-disable-next-line i18next/no-literal-string -- Environment assignment must remain verbatim. */}
                      <Code size="sm">FEDERATION_JWT_SECRET=&lt;paste 64-char hex&gt;</Code><br/>
                      {/* eslint-disable-next-line i18next/no-literal-string -- Environment assignment must remain verbatim. */}
                      <Code size="sm">FEDERATION_JWT_ISSUER=https://api.your-domain.com</Code>
                    </li>
                    <li><strong>{t('super.jwt_setup_docker_no_env')}</strong> {t('super.jwt_setup_docker_no_env_body')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- Compose key must remain verbatim. */}
                      <Code size="sm">environment:</Code> {t('super.jwt_setup_compose_key_suffix')}
                    </li>
                    <li><strong>{t('super.jwt_setup_kubernetes')}</strong> {t('super.jwt_setup_kubernetes_body')} <Code size="sm">{t('super.kubernetes_secret_resource')}</Code> {t('super.jwt_setup_and_reference')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- Kubernetes key must remain verbatim. */}
                      <Code size="sm">envFrom</Code> {t('super.common_or')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- Kubernetes key path must remain verbatim. */}
                      <Code size="sm">env.valueFrom.secretKeyRef</Code>.
                    </li>
                    <li><strong>{t('super.jwt_setup_aws')}</strong> {t('super.jwt_setup_aws_body')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- AWS configuration key must remain verbatim. */}
                      <Code size="sm">secrets</Code> {t('super.jwt_setup_aws_middle')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- AWS configuration key must remain verbatim. */}
                      <Code size="sm">environment</Code> {t('super.jwt_setup_aws_suffix')}
                    </li>
                    <li><strong>{t('super.jwt_setup_paas')}</strong>{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                      <Code size="sm">heroku config:set FEDERATION_JWT_SECRET=&lt;hex&gt;</Code> {t('super.jwt_setup_paas_suffix')}
                    </li>
                    <li><strong>{t('super.jwt_setup_systemd')}</strong> {t('super.jwt_setup_systemd_body')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- systemd assignment must remain verbatim. */}
                      <Code size="sm">Environment=&quot;FEDERATION_JWT_SECRET=&lt;hex&gt;&quot;</Code> {t('super.jwt_setup_systemd_suffix')}
                    </li>
                    <li><strong>{t('super.jwt_setup_hosting_panel')}</strong> {t('super.jwt_setup_hosting_panel_body')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- Hosting-panel XML element must remain verbatim. */}
                      <Code size="sm">&lt;environmentVariables&gt;</Code>).
                    </li>
                  </ul>
                </div>

                <div>
                  <p className="mb-1"><strong>{t('super.step_number', { number: 3 })}</strong> {t('super.jwt_setup_step_3_prefix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                    <Code size="sm">php artisan config:cache</Code>{t('super.jwt_setup_step_3_suffix')}
                  </p>
                </div>

                <div>
                  <p className="mb-1"><strong>{t('super.step_number', { number: 4 })}</strong> {t('super.jwt_setup_step_4')}</p>
                </div>
              </div>
            </AccordionItem>

            <AccordionItem
              key="rotate" id="rotate"
              aria-label={t('super.jwt_accordion_rotate')}
              title={<span className="font-medium">{t('super.jwt_accordion_rotate')}</span>}
            >
              <div className="space-y-2 text-muted">
                <p>{t('super.jwt_rotate_intro')}</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('super.jwt_rotate_reason_exposed')}</li>
                  <li>{t('super.jwt_rotate_reason_abuse')}</li>
                  <li>{t('super.jwt_rotate_reason_routine')}</li>
                </ul>
                <p><strong>{t('super.jwt_rotation_procedure')}</strong></p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>{t('super.jwt_rotate_step_1')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                    <Code size="sm">openssl rand -hex 32</Code>.
                  </li>
                  <li>{t('super.jwt_rotate_step_2_prefix')} <Code size="sm">FEDERATION_JWT_SECRET</Code> {t('super.jwt_rotate_step_2_suffix')}</li>
                  <li>{t('super.jwt_rotate_step_3')}</li>
                  <li>{t('super.jwt_rotate_step_4')}</li>
                </ol>
                <p className="text-xs text-muted">
                  {t('super.jwt_rotate_note')}
                </p>
              </div>
            </AccordionItem>

            <AccordionItem
              key="troubleshoot" id="troubleshoot"
              aria-label={t('super.jwt_accordion_troubleshoot')}
              title={<span className="font-medium">{t('super.jwt_accordion_troubleshoot')}</span>}
            >
              <div className="space-y-2 text-muted text-xs">
                <p><strong>{t('super.jwt_troubleshoot_not_configured')}</strong></p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('super.jwt_troubleshoot_restart')}</li>
                  <li>{t('super.jwt_troubleshoot_config_cache_prefix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                    <Code size="sm">php artisan config:cache</Code>{t('super.jwt_troubleshoot_config_cache_suffix')}
                  </li>
                  <li>{t('super.jwt_troubleshoot_printenv')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                    <Code size="sm">docker exec nexus-php-app printenv FEDERATION_JWT_SECRET</Code>.
                  </li>
                </ul>
                <p className="pt-2"><strong>{t('super.jwt_troubleshoot_low_bits')}</strong></p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('super.jwt_troubleshoot_low_bits_body_prefix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                    <Code size="sm">openssl rand -hex 32</Code> {t('super.jwt_troubleshoot_low_bits_body_suffix')}
                  </li>
                </ul>
                <p className="pt-2"><strong>{t('super.jwt_troubleshoot_needed')}</strong></p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('super.jwt_troubleshoot_needed_body')}</li>
                </ul>
              </div>
            </AccordionItem>
          </Accordion>
        </CardBody>
      </Card>

      {/* Quick Navigation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickLinks.map((link) => (
          <Card
            key={link.href}
            as={Link}
            to={tenantPath(link.href)}
            isPressable
            className="hover:shadow-md transition-shadow"
          >
            <CardBody className="flex flex-row items-center gap-3">
              <div className={`p-2 rounded-lg ${colorClasses[link.color]?.bg ?? ''}`}>
                <link.icon aria-hidden="true" size={20} className={colorClasses[link.color]?.text ?? ''} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{link.label}</p>
                <p className="text-xs text-muted truncate">{link.description}</p>
              </div>
              <ArrowRight aria-hidden="true" size={16} className="text-muted shrink-0" />
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Lockdown Banner */}
      {controls.emergency_lockdown_active && (
        <Card className="border-2 border-danger bg-danger-50 dark:bg-danger-950">
          <CardBody className="flex flex-row items-center gap-4">
            <Lock aria-hidden="true" size={24} className="text-danger shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-danger">{t('super.emergency_lockdown_active')}</p>
              <p className="text-sm text-danger-600 dark:text-danger-400">
                {controls.emergency_lockdown_reason || t('super.all_federation_disabled')}
              </p>
            </div>
            <Button
              variant="secondary"
              className="text-success"
              size="sm"
              startContent={<Unlock aria-hidden="true" size={16} />}
              onPress={() => setLockdownConfirm(true)}
            >
              {t('super.lift_lockdown')}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* External Partner Federation — the safety gate for traffic to/from
          OTHER installations. Placed above the internal cross-tenant controls
          so the severity order reads lockdown → external → internal. */}
      <Card className={!controls.external_federation_enabled ? 'border-2 border-danger' : ''}>
        <CardHeader className="flex gap-2 items-center pb-0">
          <Network aria-hidden="true" size={20} className={controls.external_federation_enabled ? 'text-accent' : 'text-danger'} />
          <div className="flex-1">
            <h3 className="font-semibold text-lg">{t('super.external_federation_title')}</h3>
            <p className="text-xs text-muted">{t('super.external_federation_desc')}</p>
          </div>
          <Chip
            color={controls.external_federation_enabled ? 'success' : 'danger'}
            variant="soft"
            size="sm"
          >
            {controls.external_federation_enabled ? t('super.status_active') : t('super.status_disabled')}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {/* This note is load-bearing: without it a future operator may
              "fix" the disabled switch fearing it broke internal federation. */}
          <div className="rounded-lg bg-surface-tertiary p-3">
            <p className="text-xs text-muted">{t('super.external_federation_internal_unaffected_note')}</p>
          </div>

          {!controls.external_federation_enabled && (
            <div className="flex items-start gap-3 rounded-lg border border-danger bg-danger-50 p-3 dark:bg-danger-950">
              <AlertTriangle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-medium text-danger">{t('super.external_federation_blocked_notice')}</p>
                {controls.external_federation_disabled_reason ? (
                  <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">
                    {controls.external_federation_disabled_reason}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{t('super.external_federation_master_label')}</p>
              <p className="text-xs text-muted">{t('super.external_federation_master_desc')}</p>
            </div>
            <Switch
              isSelected={controls.external_federation_enabled}
              isDisabled={!!saving}
              onValueChange={handleExternalMasterToggle}
            />
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {t('super.external_protocols_heading')}
          </p>

          {externalProtocolToggles.map(toggle => {
            const blocked = externalStatus?.blocked_last_24h?.[toggle.protocol] ?? 0;
            return (
              <div key={toggle.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{toggle.label}</p>
                    {blocked > 0 && (
                      <Chip color="warning" variant="soft" size="sm">
                        {t('super.external_protocol_blocked_count', { count: blocked })}
                      </Chip>
                    )}
                  </div>
                  <p className="text-xs text-muted">{toggle.description}</p>
                </div>
                <Switch
                  size="sm"
                  isSelected={!!controls[toggle.key]}
                  isDisabled={!!saving || !controls.external_federation_enabled}
                  onValueChange={(v) => updateControl(toggle.key, v)}
                />
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* Partner API — a SIBLING switch, not part of federation. Different
          system (third-party bearer tokens over members, listings and the
          wallet), so it gets its own control rather than being folded into the
          federation master, which would make that label untrue. */}
      <Card className={!controls.partner_api_enabled ? 'border-2 border-danger' : ''}>
        <CardHeader className="flex gap-2 items-center pb-0">
          <KeyRound aria-hidden="true" size={20} className={controls.partner_api_enabled ? 'text-accent' : 'text-danger'} />
          <div className="flex-1">
            <h3 className="font-semibold text-lg">{t('super.partner_api_title')}</h3>
            <p className="text-xs text-muted">{t('super.partner_api_desc')}</p>
          </div>
          <Chip color={controls.partner_api_enabled ? 'success' : 'danger'} variant="soft" size="sm">
            {controls.partner_api_enabled ? t('super.status_active') : t('super.status_disabled')}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <div className="rounded-lg bg-surface-tertiary p-3">
            <p className="text-xs text-muted">{t('super.partner_api_scope_note')}</p>
          </div>

          {!controls.partner_api_enabled && (
            <div className="flex items-start gap-3 rounded-lg border border-danger bg-danger-50 p-3 dark:bg-danger-950">
              <AlertTriangle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-medium text-danger">{t('super.partner_api_blocked_notice')}</p>
                {controls.partner_api_disabled_reason ? (
                  <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">
                    {controls.partner_api_disabled_reason}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{t('super.partner_api_master_label')}</p>
              <p className="text-xs text-muted">{t('super.partner_api_master_desc')}</p>
            </div>
            <Switch
              isSelected={controls.partner_api_enabled}
              isDisabled={!!saving}
              onValueChange={handlePartnerApiToggle}
            />
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Status */}
        <Card>
          <CardHeader className="flex gap-2 items-center pb-0">
            <Globe aria-hidden="true" size={20} className="text-accent" />
            <h3 className="font-semibold text-lg">{t('super.system_status')}</h3>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('super.federation_label')}</p>
                <p className="text-xs text-muted">{t('super.federation_desc')}</p>
              </div>
              <Switch
                isSelected={controls.federation_enabled}
                isDisabled={!!saving}
                onValueChange={(v) => updateControl('federation_enabled', v)}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('super.whitelist_mode')}</p>
                <p className="text-xs text-muted">{t('super.whitelist_mode_desc')}</p>
              </div>
              <Switch
                isSelected={controls.whitelist_mode_enabled}
                isDisabled={!!saving}
                onValueChange={(v) => updateControl('whitelist_mode_enabled', v)}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {controls.emergency_lockdown_active ? <Lock aria-hidden="true" size={16} className="text-danger" /> : <Unlock aria-hidden="true" size={16} className="text-success" />}
                <div>
                  <p className="font-medium">{t('super.lockdown_status')}</p>
                  <p className="text-xs text-muted">{t('super.lockdown_status_desc')}</p>
                </div>
              </div>
              <Chip color={controls.emergency_lockdown_active ? 'danger' : 'success'} variant="soft" size="sm">
                {controls.emergency_lockdown_active ? t('super.locked_down') : t('super.status_normal')}
              </Chip>
            </div>
            {!controls.emergency_lockdown_active && (
              <Button
                variant="danger-soft"
                size="sm"
                startContent={<AlertTriangle aria-hidden="true" size={16} />}
                onPress={() => setLockdownConfirm(true)}
              >
                {t('super.emergency_lockdown')}
              </Button>
            )}
          </CardBody>
        </Card>

        {/* Feature Toggles */}
        <Card>
          <CardHeader className="flex gap-2 items-center pb-0">
            <Shield aria-hidden="true" size={20} className="text-accent" />
            <h3 className="font-semibold text-lg">{t('super.cross_tenant_features')}</h3>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {featureToggles.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted">{description}</p>
                </div>
                <Switch
                  size="sm"
                  isSelected={controls[key]}
                  isDisabled={!!saving}
                  onValueChange={(v) => updateControl(key, v)}
                />
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Whitelist */}
        <Card>
          <CardHeader className="flex justify-between items-center pb-0">
            <div className="flex gap-2 items-center">
              <Network aria-hidden="true" size={20} className="text-success" />
              <h3 className="font-semibold text-lg">{t('super.whitelist')}</h3>
              <Chip size="sm" variant="soft">{whitelist.length}</Chip>
            </div>
            <Button
              as={Link}
              to={tenantPath('/super-admin/federation/whitelist')}
              size="sm"
              variant="tertiary"
              endContent={<ArrowRight aria-hidden="true" size={14} />}
            >
              {t('super.manage')}
            </Button>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                size="sm"
                label={t('super.label_tenant_id')}
                value={addTenantId}
                onValueChange={setAddTenantId}
                className="max-w-[120px]"
                variant="secondary"
              />
              <Button size="sm" startContent={<Plus aria-hidden="true" size={14} />} onPress={handleAddWhitelist}>
                {t('super.add')}
              </Button>
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {whitelist.map((entry) => (
                <div key={entry.tenant_id} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                  <span>
                    <Link to={tenantPath(`/super-admin/tenants/${entry.tenant_id}`)} className="hover:text-accent font-medium text-sm">
                      {entry.tenant_name}
                    </Link>
                    {' '}<span className="text-xs text-muted">{t('super.tenant_id_compact', { id: entry.tenant_id })}</span>
                  </span>
                  <Button size="sm" variant="danger-soft" isIconOnly aria-label={t('super.remove_from_whitelist')} onPress={() => handleRemoveWhitelist(entry.tenant_id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {whitelist.length === 0 && <p className="text-muted text-sm py-4 text-center">{t('super.no_whitelisted_tenants')}</p>}
            </div>
          </CardBody>
        </Card>

        {/* Partnerships */}
        <Card>
          <CardHeader className="flex justify-between items-center pb-0">
            <div className="flex gap-2 items-center">
              <Handshake aria-hidden="true" size={20} className="text-accent" />
              <h3 className="font-semibold text-lg">{t('super.partnerships')}</h3>
              <Chip size="sm" variant="soft">{partnerships.length}</Chip>
            </div>
            <Button
              as={Link}
              to={tenantPath('/super-admin/federation/partnerships')}
              size="sm"
              variant="tertiary"
              endContent={<ArrowRight aria-hidden="true" size={14} />}
            >
              {t('super.manage')}
            </Button>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            <div className="max-h-[240px] overflow-y-auto">
              {partnerships.map((p) => {
                const statusColor = p.status === 'active' ? 'success'
                  : p.status === 'pending' ? 'warning'
                  : p.status === 'suspended' ? 'danger' : 'default';
                return (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <Users aria-hidden="true" size={14} className="text-muted shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {p.tenant_1_name}
                      </span>
                      <span className="text-muted shrink-0">&harr;</span>
                      <span className="text-sm font-medium truncate">
                        {p.tenant_2_name}
                      </span>
                      <Chip size="sm" variant="soft" color={statusColor} className="shrink-0">
                        {partnershipStatusLabel(p.status)}
                      </Chip>
                    </div>
                    {p.status === 'active' && (
                      <div className="flex gap-1 shrink-0 ml-2">
                        <Button size="sm" variant="secondary" className="text-warning" onPress={() => setPartnerAction({ type: 'suspend', id: p.id })}>
                          {t('super.suspend')}
                        </Button>
                        <Button size="sm" variant="danger-soft" onPress={() => setPartnerAction({ type: 'terminate', id: p.id })}>
                          {t('super.end')}
                        </Button>
                      </div>
                    )}
                    {p.status === 'suspended' && (
                      <div className="flex gap-1 shrink-0 ml-2">
                        <Button size="sm" variant="secondary" className="text-success" onPress={() => setPartnerAction({ type: 'reactivate', id: p.id })}>
                          {t('super.reactivate')}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {partnerships.length === 0 && <p className="text-muted text-sm py-4 text-center">{t('super.no_partnerships')}</p>}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Lockdown Confirm Modal */}
      <ConfirmModal
        isOpen={lockdownConfirm}
        onClose={() => { setLockdownConfirm(false); setLockdownReason(''); }}
        onConfirm={handleLockdown}
        title={controls.emergency_lockdown_active ? t('super.lift_lockdown') : t('super.emergency_lockdown')}
        message={controls.emergency_lockdown_active
          ? t('super.lift_lockdown_confirm')
          : t('super.emergency_lockdown_confirm')}
        confirmLabel={controls.emergency_lockdown_active ? t('super.lift_lockdown') : t('super.activate_lockdown')}
        confirmColor={controls.emergency_lockdown_active ? 'primary' : 'danger'}
      >
        {!controls.emergency_lockdown_active && (
          <Input
            label={t('super.lockdown_reason')}
            placeholder={t('super.lockdown_reason_placeholder')}
            value={lockdownReason}
            onValueChange={setLockdownReason}
            className="mt-3"
            variant="secondary"
          />
        )}
      </ConfirmModal>

      {/* External federation withdrawal — confirm + reason, since this is the
          switch that stops all partner traffic. */}
      <ConfirmModal
        isOpen={externalConfirm}
        onClose={() => { setExternalConfirm(false); setExternalReason(''); }}
        onConfirm={async () => {
          await applyExternalMaster(false, externalReason.trim() || undefined);
          setExternalConfirm(false);
          setExternalReason('');
        }}
        title={t('super.external_federation_disable_title')}
        message={t('super.external_federation_disable_confirm')}
        confirmLabel={t('super.external_federation_disable_action')}
        confirmColor="danger"
      >
        <Input
          label={t('super.external_federation_reason_label')}
          placeholder={t('super.external_federation_reason_placeholder')}
          value={externalReason}
          onValueChange={setExternalReason}
          className="mt-3"
          variant="secondary"
        />
      </ConfirmModal>

      {/* Partner API withdrawal — confirm + reason. */}
      <ConfirmModal
        isOpen={partnerApiConfirm}
        onClose={() => { setPartnerApiConfirm(false); setPartnerApiReason(''); }}
        onConfirm={async () => {
          await applyPartnerApi(false, partnerApiReason.trim() || undefined);
          setPartnerApiConfirm(false);
          setPartnerApiReason('');
        }}
        title={t('super.partner_api_disable_title')}
        message={t('super.partner_api_disable_confirm')}
        confirmLabel={t('super.partner_api_disable_action')}
        confirmColor="danger"
      >
        <Input
          label={t('super.external_federation_reason_label')}
          placeholder={t('super.partner_api_reason_placeholder')}
          value={partnerApiReason}
          onValueChange={setPartnerApiReason}
          className="mt-3"
          variant="secondary"
        />
      </ConfirmModal>

      {/* Partnership Action Modal */}
      <ConfirmModal
        isOpen={!!partnerAction}
        onClose={() => setPartnerAction(null)}
        onConfirm={handlePartnerAction}
        title={partnerAction
          ? (partnerAction.type === 'suspend'
            ? t('super.suspend_partnership')
            : partnerAction.type === 'terminate'
            ? t('super.terminate_partnership')
            : t('super.reactivate_partnership'))
          : ''}
        message={partnerAction?.type === 'suspend'
          ? t('super.suspend_partnership_confirm')
          : partnerAction?.type === 'terminate'
          ? t('super.terminate_partnership_confirm')
          : t('super.reactivate_partnership_confirm')}
        confirmLabel={
          partnerAction?.type === 'suspend'
            ? t('super.suspend')
            : partnerAction?.type === 'terminate'
            ? t('super.terminate')
            : t('super.reactivate')
        }
        confirmColor={partnerAction?.type === 'reactivate' ? 'primary' : 'danger'}
      />
    </div>
  );
}

export default FederationControls;
