import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Spinner, Chip, Input, Select, SelectItem, useDisclosure, Accordion, AccordionItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Tooltip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, useConfirm } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Save from 'lucide-react/icons/save';
import Info from 'lucide-react/icons/info';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Key from 'lucide-react/icons/key';
import Ticket from 'lucide-react/icons/ticket';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import Copy from 'lucide-react/icons/copy';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import HelpCircle from 'lucide-react/icons/circle-help';
import Lock from 'lucide-react/icons/lock';
import UserCheck from 'lucide-react/icons/user-check';
import Users from 'lucide-react/icons/users';
import Clock from 'lucide-react/icons/clock';
import Mail from 'lucide-react/icons/mail';
import Globe from 'lucide-react/icons/globe';
import Shield from 'lucide-react/icons/shield';
import { VerificationAuditLog } from './VerificationAuditLog';
import { VerificationReviewQueue } from './VerificationReviewQueue';
import { ProviderHealthDashboard } from './ProviderHealthDashboard';
import { RegistrationBreakerCard } from './RegistrationBreakerCard';
import { usePageTitle } from '@/hooks';
import { useToast,
  useAuth } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { SecretInput } from '../../components/SecretInput';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * RegistrationPolicySettings
 * Admin UI for configuring the tenant's registration policy and identity verification.
 */

interface RegistrationPolicy {
  registration_mode: string;
  verification_provider: string | null;
  verification_level: string;
  post_verification: string;
  fallback_mode: string;
  require_email_verify: boolean;
  has_policy: boolean;
}

interface ProviderInfo {
  slug: string;
  name: string;
  levels: string[];
  available: boolean;
  has_credentials: boolean;
}

interface InviteCode {
  id: number;
  code: string;
  max_uses: number;
  uses_count: number;
  note: string | null;
  is_active: number;
  expires_at: string | null;
  created_at: string;
  creator_name: string | null;
}

interface InviteCodesResponse {
  items: InviteCode[];
  total: number;
}

const REGISTRATION_MODE_ICONS: Record<string, typeof Globe> = {
  open: Globe,
  open_with_approval: UserCheck,
  verified_identity: ShieldCheck,
  invite_only: Lock,
  waitlist: Clock,
  government_id: Shield,
};

const REGISTRATION_MODE_COLORS: Record<string, 'success' | 'primary' | 'secondary' | 'warning' | 'default'> = {
  open: 'success',
  open_with_approval: 'primary',
  verified_identity: 'secondary',
  invite_only: 'warning',
  waitlist: 'default',
  government_id: 'default',
};

export function RegistrationPolicySettings() {
  const { t } = useTranslation(['admin_system', 'common']);
  const confirm = useConfirm();
  usePageTitle(t('system.page_title'));
  const toast = useToast();
  const { user } = useAuth();
  const userRecord = user as Record<string, unknown> | null;
  const isGod =
    (user?.role as string) === 'god' ||
    (user?.role as string) === 'super_admin' ||
    userRecord?.is_super_admin === true;

  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Per-provider credential state
  const [credentialInputs, setCredentialInputs] = useState<Record<string, { api_key: string; webhook_secret: string }>>({});
  const [credentialVisibility, setCredentialVisibility] = useState<Record<string, { api_key: boolean; webhook_secret: boolean }>>({});
  const [savingCredentials, setSavingCredentials] = useState<Record<string, boolean>>({});

  // Invite codes state
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [inviteCodesTotal, setInviteCodesTotal] = useState(0);
  const [inviteCodesLoading, setInviteCodesLoading] = useState(false);
  const [generateCount, setGenerateCount] = useState(1);
  const [generateMaxUses, setGenerateMaxUses] = useState(1);
  const [generateExpiry, setGenerateExpiry] = useState('');
  const [generateNote, setGenerateNote] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const generateModal = useDisclosure();

  const REGISTRATION_MODES = [
    { key: 'open', label: t('system.reg.mode_open'), description: t('system.reg.mode_open_desc'), icon: REGISTRATION_MODE_ICONS.open, color: REGISTRATION_MODE_COLORS.open },
    { key: 'open_with_approval', label: t('system.reg.mode_open_approval'), description: t('system.reg.mode_open_approval_desc'), icon: REGISTRATION_MODE_ICONS.open_with_approval, color: REGISTRATION_MODE_COLORS.open_with_approval },
    { key: 'verified_identity', label: t('system.reg.mode_verified'), description: t('system.reg.mode_verified_desc'), icon: REGISTRATION_MODE_ICONS.verified_identity, color: REGISTRATION_MODE_COLORS.verified_identity },
    { key: 'invite_only', label: t('system.reg.mode_invite'), description: t('system.reg.mode_invite_desc'), icon: REGISTRATION_MODE_ICONS.invite_only, color: REGISTRATION_MODE_COLORS.invite_only },
    { key: 'waitlist', label: t('system.reg.mode_waitlist'), description: t('system.reg.mode_waitlist_desc'), icon: REGISTRATION_MODE_ICONS.waitlist, color: REGISTRATION_MODE_COLORS.waitlist },
    { key: 'government_id', label: t('system.reg.mode_gov_id'), description: t('system.reg.mode_gov_id_desc'), icon: REGISTRATION_MODE_ICONS.government_id, color: REGISTRATION_MODE_COLORS.government_id },
  ];

  const VERIFICATION_LEVELS = [
    { key: 'none', label: t('system.reg.level_none'), description: t('system.reg.level_none_desc') },
    { key: 'document_only', label: t('system.reg.level_document'), description: t('system.reg.level_document_desc') },
    { key: 'document_selfie', label: t('system.reg.level_document_selfie'), description: t('system.reg.level_document_selfie_desc') },
    { key: 'reusable_digital_id', label: t('system.reg.level_reusable'), description: t('system.reg.level_reusable_desc') },
    { key: 'manual_review', label: t('system.reg.level_manual'), description: t('system.reg.level_manual_desc') },
  ];

  const POST_VERIFICATION_ACTIONS = [
    { key: 'activate', label: t('system.reg.post_activate'), description: t('system.reg.post_activate_desc') },
    { key: 'admin_approval', label: t('system.reg.post_admin_approval'), description: t('system.reg.post_admin_approval_desc') },
    { key: 'limited_access', label: t('system.reg.post_limited'), description: t('system.reg.post_limited_desc') },
    { key: 'reject_on_fail', label: t('system.reg.post_reject'), description: t('system.reg.post_reject_desc') },
  ];

  const FALLBACK_MODES = [
    { key: 'none', label: t('system.reg.fallback_none'), description: t('system.reg.fallback_none_desc') },
    { key: 'admin_review', label: t('system.reg.fallback_admin'), description: t('system.reg.fallback_admin_desc') },
    { key: 'native_registration', label: t('system.reg.fallback_native'), description: t('system.reg.fallback_native_desc') },
  ];

  const PROVIDER_DESCRIPTIONS: Record<string, string> = {
    stripe_identity: t('system.reg.provider_stripe'),
    veriff: t('system.reg.provider_veriff'),
    jumio: t('system.reg.provider_jumio'),
    onfido: t('system.reg.provider_onfido'),
    idenfy: t('system.reg.provider_idenfy'),
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [policyRes, providersRes] = await Promise.all([
        api.get<RegistrationPolicy>('/v2/admin/config/registration-policy'),
        api.get<ProviderInfo[]>('/v2/admin/identity/providers'),
      ]);
      if (policyRes.data) setPolicy(policyRes.data);
      if (providersRes.data) setProviders(Array.isArray(providersRes.data) ? providersRes.data : []);
    } catch {
      toast.error(t('system.failed_to_load_registration_policy'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  const fetchInviteCodes = useCallback(async () => {
    setInviteCodesLoading(true);
    try {
      const res = await api.get<InviteCodesResponse>('/v2/admin/invite-codes');
      if (res.data) {
        setInviteCodes(res.data.items || []);
        setInviteCodesTotal(res.data.total || 0);
      }
    } catch { /* ignore */ } finally {
      setInviteCodesLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (policy?.registration_mode === 'invite_only') fetchInviteCodes();
  }, [policy?.registration_mode, fetchInviteCodes]);

  const handleSave = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const res = await api.put('/v2/admin/config/registration-policy', {
        registration_mode: policy.registration_mode,
        verification_provider: policy.verification_provider,
        verification_level: policy.verification_level,
        post_verification: policy.post_verification,
        fallback_mode: policy.fallback_mode,
        require_email_verify: policy.require_email_verify,
      });
      if (res.data) {
        toast.success(t('system.registration_policy_saved_successfully'));
        fetchData();
      }
    } catch {
      toast.error(t('system.failed_to_save_registration_policy'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCredentials = async (slug: string) => {
    const input = credentialInputs[slug];
    if (!input?.api_key && !input?.webhook_secret) return;
    setSavingCredentials(prev => ({ ...prev, [slug]: true }));
    try {
      const body: Record<string, string> = {};
      if (input.api_key) body.api_key = input.api_key;
      if (input.webhook_secret) body.webhook_secret = input.webhook_secret;
      const res = await api.put(`/v2/admin/identity/provider-credentials/${slug}`, body);
      if (res.success) {
        toast.success(t('system.reg.credentials_saved'));
        setCredentialInputs(prev => ({ ...prev, [slug]: { api_key: '', webhook_secret: '' } }));
        fetchData();
      } else {
        toast.error(t('system.failed_to_save_credentials_please_check'));
      }
    } catch {
      toast.error(t('system.failed_to_save_credentials_please_check'));
    } finally {
      setSavingCredentials(prev => ({ ...prev, [slug]: false }));
    }
  };

  const handleDeleteCredentials = async (slug: string) => {
    const ok = await confirm({
      title: t('system.reg.credentials_remove_confirm'),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/v2/admin/identity/provider-credentials/${slug}`);
      if (res.success) {
        toast.success(t('system.reg.credentials_removed'));
        fetchData();
      } else {
        toast.error(t('system.failed_to_remove_credentials'));
      }
    } catch {
      toast.error(t('system.failed_to_remove_credentials'));
    }
  };

  const handleGenerateInviteCodes = async () => {
    setGenerating(true);
    try {
      const res = await api.post<{ codes: string[] }>('/v2/admin/invite-codes', {
        count: generateCount,
        max_uses: generateMaxUses,
        expires_at: generateExpiry || undefined,
        note: generateNote || undefined,
      });
      if (res.data?.codes) {
        setGeneratedCodes(res.data.codes);
        fetchInviteCodes();
        toast.success(t('system.reg.codes_generated'));
      }
    } catch {
      toast.error(t('system.failed_to_generate_invite_codes'));
    } finally {
      setGenerating(false);
    }
  };

  const handleDeactivateCode = async (id: number) => {
    try {
      const res = await api.delete(`/v2/admin/invite-codes/${id}`);
      if (res.success) {
        toast.success(t('system.invite_code_deactivated'));
        fetchInviteCodes();
      } else {
        toast.error(t('system.failed_to_deactivate_invite_code'));
      }
    } catch {
      toast.error(t('system.failed_to_deactivate_invite_code'));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('system.copied_to_clipboard'));
  };

  const showVerificationOptions = policy?.registration_mode === 'verified_identity' || policy?.registration_mode === 'government_id';
  const selectedMode = REGISTRATION_MODES.find(m => m.key === policy?.registration_mode);
  const availableProviderCount = providers.filter(p => p.slug !== 'mock' && p.available).length;
  const configuredProviderCount = providers.filter(p => p.slug !== 'mock' && p.has_credentials).length;
  const realProviders = providers.filter(p => p.slug !== 'mock');

  if (loading || !policy) {
    return (
      <div>
        <PageHeader title={t('system.registration_policy_settings_title')} description={t('system.reg.page_description')} />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('system.registration_policy_settings_title')} description={t('system.reg.page_description')} />

      <div className="space-y-6">

        {/* ── Tenant Circuit Breaker (always visible, top of page) ── */}
        <RegistrationBreakerCard />

        {/* ── Section 1: Registration Method ── */}
        <Card>
          <CardHeader className="pb-0">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <ShieldCheck size={20} className="text-accent" /> {t('system.reg.registration_method')}
              </h3>
              <p className="text-sm text-muted mt-1">
                {t('system.reg.registration_method_desc')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="gap-4">
            <Select
              label={t('system.reg.registration_method')}
              selectedKeys={[policy.registration_mode]}
              onSelectionChange={(keys) => {
                const key = Array.from(keys)[0] as string;
                if (key) setPolicy(prev => prev ? { ...prev, registration_mode: key } : prev);
              }}
              variant="secondary"
              classNames={{ description: 'text-muted' }}
              description={selectedMode?.description}
            >
              {REGISTRATION_MODES.map((mode) => {
                const Icon = mode.icon;
                return (
                  <SelectItem key={mode.key} id={mode.key} textValue={mode.label}>
                    <div className="flex items-center gap-2">
                      {Icon && <Icon size={16} />}
                      <span>{mode.label}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </Select>

            {policy.registration_mode === 'government_id' && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 text-warning-soft-foreground">
                <AlertTriangle size={16} className="shrink-0" />
                <span className="text-sm">{t('system.reg.gov_id_future')}</span>
              </div>
            )}

            {policy.registration_mode === 'waitlist' && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-accent-soft text-accent dark:bg-accent-soft dark:text-accent">
                <Users size={16} className="shrink-0" />
                <span className="text-sm">{t('system.reg.waitlist_info')}</span>
              </div>
            )}

            {policy.registration_mode === 'verified_identity' && availableProviderCount === 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/10 text-danger-soft-foreground">
                <AlertTriangle size={16} className="shrink-0" />
                <span className="text-sm">{t('system.reg.no_providers_warning')}</span>
              </div>
            )}
          </CardBody>
        </Card>

        {/* ── Section 2: Identity Verification Settings (conditional) ── */}
        {showVerificationOptions && (
          <Card>
            <CardHeader className="pb-0">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <UserCheck size={20} className="text-accent" /> {t('system.reg.verification_settings')}
                </h3>
                <p className="text-sm text-muted mt-1">
                  {t('system.reg.verification_settings_desc')}
                </p>
              </div>
            </CardHeader>
            <CardBody className="gap-4">
              <Select
                label={t('system.label_verification_provider')}
                selectedKeys={policy.verification_provider ? [policy.verification_provider] : []}
                onSelectionChange={(keys) => {
                  const key = Array.from(keys)[0] as string;
                  setPolicy(prev => prev ? { ...prev, verification_provider: key || null } : prev);
                }}
                variant="secondary"
                description={
                  availableProviderCount > 0
                    ? t('system.reg.providers_available')
                    : t('system.reg.no_providers_yet')
                }
              >
                {providers.map((p) => (
                  <SelectItem key={p.slug} id={p.slug} textValue={p.name}>
                    <div className="flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.available ? (
                        <Chip size="sm" color="success" variant="soft">{t('system.reg.available')}</Chip>
                      ) : (
                        <Chip size="sm" color="danger" variant="soft">{t('system.reg.unavailable')}</Chip>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </Select>

              <Select
                label={t('system.label_verification_level')}
                selectedKeys={[policy.verification_level]}
                onSelectionChange={(keys) => {
                  const key = Array.from(keys)[0] as string;
                  if (key) setPolicy(prev => prev ? { ...prev, verification_level: key } : prev);
                }}
                variant="secondary"
                description={VERIFICATION_LEVELS.find(l => l.key === policy.verification_level)?.description}
              >
                {VERIFICATION_LEVELS.map((level) => (
                  <SelectItem key={level.key} id={level.key}>
                    {level.label}
                  </SelectItem>
                ))}
              </Select>

              <Separator />

              <Select
                label={t('system.label_after_verification_passes')}
                selectedKeys={[policy.post_verification]}
                onSelectionChange={(keys) => {
                  const key = Array.from(keys)[0] as string;
                  if (key) setPolicy(prev => prev ? { ...prev, post_verification: key } : prev);
                }}
                variant="secondary"
                description={POST_VERIFICATION_ACTIONS.find(a => a.key === policy.post_verification)?.description}
              >
                {POST_VERIFICATION_ACTIONS.map((action) => (
                  <SelectItem key={action.key} id={action.key}>
                    {action.label}
                  </SelectItem>
                ))}
              </Select>

              <Select
                label={t('system.label_fallback_if_provider_unavailable')}
                selectedKeys={[policy.fallback_mode]}
                onSelectionChange={(keys) => {
                  const key = Array.from(keys)[0] as string;
                  if (key) setPolicy(prev => prev ? { ...prev, fallback_mode: key } : prev);
                }}
                variant="secondary"
                description={FALLBACK_MODES.find(f => f.key === policy.fallback_mode)?.description}
              >
                {FALLBACK_MODES.map((fb) => (
                  <SelectItem key={fb.key} id={fb.key}>
                    {fb.label}
                  </SelectItem>
                ))}
              </Select>
            </CardBody>
          </Card>
        )}

        {/* ── Section 3: Email Verification ── */}
        <Card>
          <CardHeader className="pb-0">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Mail size={20} className="text-accent" /> {t('system.reg.email_verification')}
              </h3>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{t('system.label_require_email_verification')}</p>
                  {!isGod && (
                    <Tooltip content={t('system.reg.require_email_tooltip')}>
                      <Chip size="sm" color="warning" variant="soft" startContent={<Lock size={10} />}>{t('system.reg.god_only')}</Chip>
                    </Tooltip>
                  )}
                </div>
                <p className="text-sm text-muted">
                  {t('system.reg.require_email_desc')}
                </p>
              </div>
              <Switch
                isSelected={policy.require_email_verify}
                onValueChange={(val) => setPolicy(prev => prev ? { ...prev, require_email_verify: val } : prev)}
                isDisabled={!isGod}
                aria-label={t('system.label_require_email_verification')}
              />
            </div>
          </CardBody>
        </Card>

        {/* ── Save Button ── */}
        <div className="flex justify-end">
          <Button

            size="lg"
            startContent={!saving ? <Save size={18} /> : undefined}
            onPress={handleSave}
            isLoading={saving}
          >
            {t('system.reg.save_policy')}
          </Button>
        </div>

        <Separator className="my-2" />

        {/* ── Section 4: Provider API Credentials (always visible) ── */}
        {realProviders.length > 0 && (
          <Card>
            <CardHeader className="pb-0">
              <div className="w-full">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Key size={20} className="text-warning" /> {t('system.reg.identity_providers')}
                  </h3>
                  <div className="flex items-center gap-2">
                    {configuredProviderCount > 0 && (
                      <Chip size="sm" color="success" variant="soft" startContent={<CheckCircle2 size={12} />}>
                        {t('system.reg.n_configured', { count: configuredProviderCount })}
                      </Chip>
                    )}
          <Chip size="sm" color={availableProviderCount > 0 ? 'success' : 'default'} variant="soft">
                      {t('system.reg.n_available', { count: availableProviderCount })}
                    </Chip>
                  </div>
                </div>
                <p className="text-sm text-muted mt-1">
                  {t('system.reg.provider_credentials_desc')}
                </p>
              </div>
            </CardHeader>
            <CardBody className="gap-3 pt-4">
              <Accordion variant="splitted" selectionMode="multiple">
                {realProviders.map((p) => {
                  const inputs = credentialInputs[p.slug] || { api_key: '', webhook_secret: '' };
                  const visibility = credentialVisibility[p.slug] || { api_key: false, webhook_secret: false };
                  const isSaving = savingCredentials[p.slug] || false;
                  const description = PROVIDER_DESCRIPTIONS[p.slug];

                  return (
                    <AccordionItem
                      key={p.slug} id={p.slug}
                      aria-label={p.name}
                      title={
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{p.name}</span>
                          {p.has_credentials ? (
                            <Chip size="sm" color="success" variant="soft" startContent={<CheckCircle2 size={12} />}>{t('system.reg.credentials_saved_chip')}</Chip>
                          ) : (
                            <Chip size="sm" color="default" variant="soft">{t('system.reg.not_configured')}</Chip>
                          )}
                          {p.available ? (
                            <Chip size="sm" color="success" variant="dot">{t('system.reg.available')}</Chip>
                          ) : (
                            <Chip size="sm" color="danger" variant="dot">{t('system.reg.unavailable')}</Chip>
                          )}
                        </div>
                      }
                    >
                      <div className="space-y-4 pb-2">
                        {description && (
                          <p className="text-sm text-muted">{description}</p>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <SecretInput
                            label={t('system.label_a_p_i_key_secret_key')}
                            placeholder={p.has_credentials ? t('system.reg.placeholder_saved') : t('system.reg.placeholder_api_key')}
                            value={inputs.api_key}
                            onChange={(e) => setCredentialInputs(prev => ({ ...prev, [p.slug]: { ...inputs, api_key: e.target.value } }))}
                            type={visibility.api_key ? 'text' : 'password'}
                            variant="secondary"
                            size="sm"
                            description={t('system.reg.api_key_desc')}
                            endContent={
                              <Button isIconOnly size="sm" variant="tertiary" aria-label={visibility.api_key ? t('system.reg.hide_api_key') : t('system.reg.show_api_key')} onPress={() => setCredentialVisibility(prev => ({ ...prev, [p.slug]: { ...visibility, api_key: !visibility.api_key } }))}>
                                {visibility.api_key ? <EyeOff size={14} /> : <Eye size={14} />}
                              </Button>
                            }
                          />
                          <SecretInput
                            label={t('system.label_webhook_secret')}
                            placeholder={p.has_credentials ? t('system.reg.placeholder_saved') : t('system.reg.placeholder_webhook')}
                            value={inputs.webhook_secret}
                            onChange={(e) => setCredentialInputs(prev => ({ ...prev, [p.slug]: { ...inputs, webhook_secret: e.target.value } }))}
                            type={visibility.webhook_secret ? 'text' : 'password'}
                            variant="secondary"
                            size="sm"
                            description={t('system.reg.webhook_desc')}
                            endContent={
                              <Button isIconOnly size="sm" variant="tertiary" aria-label={visibility.webhook_secret ? t('system.reg.hide_webhook') : t('system.reg.show_webhook')} onPress={() => setCredentialVisibility(prev => ({ ...prev, [p.slug]: { ...visibility, webhook_secret: !visibility.webhook_secret } }))}>
                                {visibility.webhook_secret ? <EyeOff size={14} /> : <Eye size={14} />}
                              </Button>
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            {p.has_credentials && (
                              <Button
                                size="sm"
                                variant="danger"
                                startContent={<Trash2 size={14} />}
                                onPress={() => handleDeleteCredentials(p.slug)}
                              >
                                {t('system.reg.remove_credentials')}
                              </Button>
                            )}
                          </div>
                          {(inputs.api_key || inputs.webhook_secret) && (
                            <Button
                              size="sm"

                              startContent={!isSaving ? <Save size={14} /> : undefined}
                              isLoading={isSaving}
                              onPress={() => handleSaveCredentials(p.slug)}
                            >
                              {t('system.reg.save_credentials')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </AccordionItem>
                  );
                })}
              </Accordion>

              {realProviders.length > 0 && configuredProviderCount === 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-secondary dark:bg-surface/10">
                  <HelpCircle size={16} className="text-muted shrink-0 mt-0.5" />
                  <div className="text-sm text-foreground dark:text-muted">
                    <p className="font-medium">{t('system.reg.how_to_get_credentials')}</p>
                    <ol className="list-decimal list-inside space-y-1 mt-1">
                      <li>{t('system.reg.credential_step_1')}</li>
                      <li>{t('system.reg.credential_step_2')}</li>
                      <li>{t('system.reg.credential_step_3')}</li>
                      <li>{t('system.reg.credential_step_4')}</li>
                    </ol>
                    <p className="mt-2 text-muted">
                      {t('system.reg.credential_note')}
                    </p>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* ── Section 5: Invite Codes (conditional) ── */}
        {policy.registration_mode === 'invite_only' && (
          <Card>
            <CardHeader className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Ticket size={20} className="text-warning" /> {t('system.reg.invite_codes')}
                </h3>
                <p className="text-sm text-muted mt-1">
                  {t('system.reg.invite_codes_desc')}
                </p>
              </div>
              <Button
                size="sm"

                startContent={<Plus size={14} />}
                onPress={() => { setGeneratedCodes([]); setGenerateCount(1); setGenerateMaxUses(1); setGenerateExpiry(''); setGenerateNote(''); generateModal.onOpen(); }}
              >
                {t('system.reg.generate_codes')}
              </Button>
            </CardHeader>
            <CardBody>
              {inviteCodesLoading ? (
                <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner /></div>
              ) : inviteCodes.length === 0 ? (
                <div className="text-center py-8">
              <Ticket size={32} className="mx-auto text-muted mb-2" />
                  <p className="text-sm text-muted">{t('system.reg.no_invite_codes')}</p>
                  <p className="text-xs text-muted mt-1">{t('system.reg.no_invite_codes_hint')}</p>
                </div>
              ) : (
                <Table aria-label={t('system.reg.invite_codes')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('system.reg.col_code')}</TableColumn>
                    <TableColumn>{t('system.reg.col_uses')}</TableColumn>
                    <TableColumn>{t('system.reg.col_status')}</TableColumn>
                    <TableColumn>{t('system.reg.col_note')}</TableColumn>
                    <TableColumn>{t('system.reg.col_expires')}</TableColumn>
                    <TableColumn>{t('system.reg.col_actions')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {inviteCodes.map((ic) => (
                      <TableRow key={ic.id}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <code className="text-sm font-mono">{ic.code}</code>
                            <Button isIconOnly size="sm" variant="tertiary" aria-label={t('system.reg.copy_invite_code')} onPress={() => copyToClipboard(ic.code)}>
                              <Copy size={12} />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={ic.uses_count >= ic.max_uses ? 'text-warning' : ''}>
                            {ic.uses_count}/{ic.max_uses}
                          </span>
                        </TableCell>
                        <TableCell>
                          {!ic.is_active ? (
                            <Chip size="sm" color="default" variant="soft">{t('system.reg.deactivated')}</Chip>
                          ) : ic.uses_count >= ic.max_uses ? (
                            <Chip size="sm" color="warning" variant="soft">{t('system.reg.exhausted')}</Chip>
                          ) : ic.expires_at && new Date(ic.expires_at) < new Date() ? (
                            <Chip size="sm" color="warning" variant="soft">{t('system.reg.expired')}</Chip>
                          ) : (
                            <Chip size="sm" color="success" variant="soft">{t('system.reg.active')}</Chip>
                          )}
                        </TableCell>
                        <TableCell><span className="text-sm text-muted">{ic.note || '—'}</span></TableCell>
                        <TableCell>
                          <span className="text-sm text-muted">
                            {ic.expires_at ? new Date(ic.expires_at).toLocaleDateString(getFormattingLocale()) : t('system.reg.never')}
                          </span>
                        </TableCell>
                        <TableCell>
                          {ic.is_active ? (
                            <Button isIconOnly size="sm" variant="danger" aria-label={t('system.reg.deactivate_invite_code')} onPress={() => handleDeactivateCode(ic.id)}>
                              <Trash2 size={14} />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {inviteCodesTotal > 0 && (
                <p className="text-xs text-muted mt-2">{t('system.reg.total_codes_count', { count: inviteCodesTotal })}</p>
              )}
            </CardBody>
          </Card>
        )}

        {/* Generate Codes Modal */}
        <Modal isOpen={generateModal.isOpen} onOpenChange={generateModal.onOpenChange} size="md">
          <ModalContent>
            <ModalHeader>{t('system.reg.generate_invite_codes')}</ModalHeader>
            <ModalBody>
              {generatedCodes.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted">{t('system.reg.generated_share')}</p>
                  <div className="space-y-1">
                    {generatedCodes.map((code) => (
                      <div key={code} className="flex items-center justify-between p-2 bg-surface-secondary rounded-lg">
                        <code className="font-mono text-sm">{code}</code>
                        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('system.reg.copy_code')} onPress={() => copyToClipboard(code)}>
                          <Copy size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => copyToClipboard(generatedCodes.join('\n'))}
                    startContent={<Copy size={14} />}
                    className="mt-2"
                  >
                    {t('system.reg.copy_all_codes')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Input
                    label={t('system.label_number_of_codes')}
                    type="number"
                    min={1}
                    max={100}
                    value={String(generateCount)}
                    onChange={(e) => setGenerateCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                    variant="secondary"
                    description={t('system.reg.generate_count_desc')}
                  />
                  <Input
                    label={t('system.label_max_uses_per_code')}
                    type="number"
                    min={1}
                    max={1000}
                    value={String(generateMaxUses)}
                    onChange={(e) => setGenerateMaxUses(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                    variant="secondary"
                    description={t('system.reg.max_uses_desc')}
                  />
                  <Input
                    label={t('system.reg.expiry_date')}
                    type="date"
                    value={generateExpiry}
                    onChange={(e) => setGenerateExpiry(e.target.value)}
                    variant="secondary"
                    description={t('system.reg.expiry_desc')}
                  />
                  <Input
                    label={t('system.reg.note_optional')}
                    placeholder={t('system.reg.note_placeholder')}
                    value={generateNote}
                    onChange={(e) => setGenerateNote(e.target.value)}
                    variant="secondary"
                    description={t('system.reg.note_desc')}
                  />
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onPress={generateModal.onClose}>
                {generatedCodes.length > 0 ? t('system.reg.done') : t('system.reg.cancel')}
              </Button>
              {generatedCodes.length === 0 && (
                <Button  onPress={handleGenerateInviteCodes} isLoading={generating} isDisabled={generating}>
                  {t('system.reg.generate')}
                </Button>
              )}
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* ── Section 6: How Registration Modes Work ── */}
        <Card  className="bg-accent-soft dark:bg-accent-soft border border-accent dark:border-accent">
          <CardBody>
            <div className="flex gap-3">
              <Info size={20} className="text-accent shrink-0 mt-0.5" />
              <div className="text-sm space-y-2">
                <p className="font-semibold text-base">{t('system.reg.understanding_modes')}</p>
            <div className="space-y-2 text-foreground dark:text-muted">
                  <div className="flex items-start gap-2">
                    <Globe size={14} className="shrink-0 mt-1 text-success" />
                    <p>{t('system.reg.info_open')}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <UserCheck size={14} className="shrink-0 mt-1 text-accent" />
                    <p>{t('system.reg.info_open_approval')}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={14} className="shrink-0 mt-1 text-accent" />
                    <p>{t('system.reg.info_verified')}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Lock size={14} className="shrink-0 mt-1 text-warning" />
                    <p>{t('system.reg.info_invite')}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock size={14} className="shrink-0 mt-1 text-muted" />
                    <p>{t('system.reg.info_waitlist')}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Shield size={14} className="shrink-0 mt-1 text-muted" />
                    <p>{t('system.reg.info_gov_id')}</p>
                  </div>
                </div>
                <Separator className="my-2" />
                <p className="text-muted">
                  {t('system.reg.tip_change_modes')}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* ── Section 7: Provider Health Dashboard (conditional) ── */}
        {showVerificationOptions && <ProviderHealthDashboard />}

        {/* ── Section 8: Pending Reviews ── */}
        <VerificationReviewQueue />

        {/* ── Section 9: Audit Log ── */}
        <VerificationAuditLog />
      </div>
    </div>
  );
}

export default RegistrationPolicySettings;
