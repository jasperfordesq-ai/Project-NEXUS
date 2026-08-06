import { Card, CardBody, CardHeader, Input, Button, Textarea, Chip, Spinner, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Switch } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, Link } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import Trash2 from 'lucide-react/icons/trash-2';
import LogIn from 'lucide-react/icons/log-in';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Coins from 'lucide-react/icons/coins';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import KeyRound from 'lucide-react/icons/key-round';
import Mail from 'lucide-react/icons/mail';
import Building2 from 'lucide-react/icons/building-2';
import ShieldCheck from 'lucide-react/icons/shield-check';
import FileCheck from 'lucide-react/icons/file-check';
import Landmark from 'lucide-react/icons/landmark';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { formatNumber, resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { api } from '@/lib/api';
import { adminUsers, adminTimebanking, adminVetting, adminInsurance } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { AdminUserDetail, AdminBadge, UpdateUserPayload, UserConsent, VettingAttestation, InsuranceCertificate } from '../../api/types';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin User Edit
 * Edit user details, role, status, profile info, manage badges, password, consents.
 * Parity: PHP Admin\UserController::edit() — all legacy gaps closed
 */


export function UserEdit() {
  const { t } = useTranslation('admin_users', { keyPrefix: 'user_edit' });
  const { t: tAdmin } = useTranslation('admin_users');
  const { id } = useParams<{ id: string }>();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.is_super_admin === true
    || currentUser?.is_tenant_super_admin === true
    || currentUser?.role === 'super_admin';
  const isGod = currentUser?.is_god === true;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<AdminUserDetail | null>(null);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [bio, setBio] = useState('');
  const [tagline, setTagline] = useState('');
  const [location, setLocation] = useState('');
  const [profileType, setProfileType] = useState<'individual' | 'organisation'>('individual');
  const [organizationName, setOrganizationName] = useState('');

  // Tenant super admin toggle (hierarchy-scoped)
  const [isTenantSuperAdmin, setIsTenantSuperAdmin] = useState(false);
  const [tenantSuperAdminLoading, setTenantSuperAdminLoading] = useState(false);

  // Global super admin toggle (god-only, bypasses all tenant isolation)
  const [isGlobalSuperAdmin, setIsGlobalSuperAdmin] = useState(false);
  const [globalSuperAdminLoading, setGlobalSuperAdminLoading] = useState(false);

  // Municipal Announcer role (AG14)
  const [isMunicipalityAnnouncer, setIsMunicipalityAnnouncer] = useState(false);
  const [announcerLoading, setAnnouncerLoading] = useState(false);

  // Impersonate
  const [impersonateLoading, setImpersonateLoading] = useState(false);

  // Adjust balance modal
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceReason, setBalanceReason] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Badge removal
  const [badgeToRemove, setBadgeToRemove] = useState<AdminBadge | null>(null);
  const [removingBadge, setRemovingBadge] = useState(false);
  const [recheckingBadges, setRecheckingBadges] = useState(false);

  // Password management
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [resetEmailLoading, setResetEmailLoading] = useState(false);

  // Welcome email
  const [welcomeEmailLoading, setWelcomeEmailLoading] = useState(false);
  const [verificationEmailLoading, setVerificationEmailLoading] = useState(false);

  // GDPR Consents
  const [consents, setConsents] = useState<UserConsent[]>([]);
  const [consentsLoading, setConsentsLoading] = useState(false);

  // Metadata-only contact attestations and insurance records
  const [vettingRecords, setVettingRecords] = useState<VettingAttestation[]>([]);
  const [insuranceRecords, setInsuranceRecords] = useState<InsuranceCertificate[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});

  usePageTitle(user ? t('meta.edit_named', { name: user.name }) : t('meta.edit_user'));

  const loadUser = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminUsers.get(Number(id));
      if (res.success && res.data) {
        const userData = res.data as AdminUserDetail;
        setUser(userData);
        setFirstName(userData.first_name || '');
        setLastName(userData.last_name || '');
        setEmail(userData.email || '');
        setPhone(userData.phone || '');
        setRole(userData.role || 'member');
        setStatus(userData.status || 'active');
        setBio(userData.bio || '');
        setTagline(userData.tagline || '');
        setLocation(userData.location || '');
        setProfileType(userData.profile_type || 'individual');
        setOrganizationName(userData.organization_name || '');
        setIsTenantSuperAdmin(userData.is_tenant_super_admin || false);
        setIsGlobalSuperAdmin(userData.is_super_admin || false);
        setIsMunicipalityAnnouncer(Array.isArray(userData.roles) ? userData.roles.includes('municipality_announcer') : false);
      } else {
        setLoadError(t('errors.load_error'));
      }
    } catch {
      setLoadError(t('errors.load_unexpected'));
    } finally {
      setLoading(false);
    }
  }, [id, t])


  const loadConsents = useCallback(async () => {
    if (!id) return;
    setConsentsLoading(true);
    try {
      const res = await adminUsers.getConsents(Number(id));
      if (res.success && Array.isArray(res.data)) {
        setConsents(res.data as UserConsent[]);
      }
    } catch {
      // Consents table may not exist — silently fail
    } finally {
      setConsentsLoading(false);
    }
  }, [id]);

  const loadComplianceRecords = useCallback(async () => {
    if (!id) return;
    setComplianceLoading(true);
    try {
      const [vRes, iRes] = await Promise.all([
        adminVetting.getUserRecords(Number(id)).catch(() => null),
        adminInsurance.getUserCertificates(Number(id)).catch(() => null),
      ]);
      if (vRes?.success && Array.isArray(vRes.data)) setVettingRecords(vRes.data as VettingAttestation[]);
      if (iRes?.success && Array.isArray(iRes.data)) setInsuranceRecords(iRes.data as InsuranceCertificate[]);
    } catch {
      // Compliance tables may not exist
    } finally {
      setComplianceLoading(false);
    }
  }, [id]);

  useEffect(() => { loadUser(); loadConsents(); loadComplianceRecords(); }, [loadUser, loadConsents, loadComplianceRecords]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.first_name = t('validation.first_name_required');
    if (!lastName.trim()) newErrors.last_name = t('validation.last_name_required');
    if (!email.trim()) {
      newErrors.email = t('validation.email_required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = t('validation.email_invalid');
    }
    if (!role) newErrors.role = t('validation.role_required');
    if (!status) newErrors.status = t('validation.status_required');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !id) return;
    setSubmitting(true);
    try {
      const payload: UpdateUserPayload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role,
        status,
        bio: bio.trim(),
        tagline: tagline.trim(),
        location: location.trim(),
        profile_type: profileType,
        organization_name: organizationName.trim(),
      };
      const res = await adminUsers.update(Number(id), payload);
      if (res.success) {
        toast.success(t('toasts.update_success'));
        loadUser();
      } else {
        toast.error(t('toasts.update_failed'));
      }
    } catch {
      toast.error(t('toasts.generic_error'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleTenantSuperAdmin() {
    if (!id || !user) return;
    setTenantSuperAdminLoading(true);
    try {
      const res = await adminUsers.setSuperAdmin(Number(id), !isTenantSuperAdmin);
      if (res.success) {
        setIsTenantSuperAdmin(!isTenantSuperAdmin);
        toast.success(!isTenantSuperAdmin ? t('toasts.tenant_super_admin_granted') : t('toasts.tenant_super_admin_revoked'));
      } else {
        toast.error(t('toasts.tenant_super_admin_failed'));
      }
    } catch {
      toast.error(t('toasts.tenant_super_admin_failed'));
    } finally {
      setTenantSuperAdminLoading(false);
    }
  }

  async function handleToggleGlobalSuperAdmin() {
    if (!id || !user) return;
    setGlobalSuperAdminLoading(true);
    try {
      const res = await adminUsers.setGlobalSuperAdmin(Number(id), !isGlobalSuperAdmin);
      if (res.success) {
        setIsGlobalSuperAdmin(!isGlobalSuperAdmin);
        toast.success(!isGlobalSuperAdmin ? t('toasts.global_super_admin_granted') : t('toasts.global_super_admin_revoked'));
      } else {
        toast.error(t('toasts.global_super_admin_failed'));
      }
    } catch {
      toast.error(t('toasts.global_super_admin_failed'));
    } finally {
      setGlobalSuperAdminLoading(false);
    }
  }

  async function handleToggleMunicipalityAnnouncer() {
    if (!id) return;
    setAnnouncerLoading(true);
    try {
      if (isMunicipalityAnnouncer) {
        const res = await api.delete(`/v2/admin/feed/revoke-announcer/${id}`);
        if (res.success) {
          setIsMunicipalityAnnouncer(false);
          toast.success(t('toasts.announcer_revoked'));
        } else {
          toast.error(t('toasts.announcer_failed'));
        }
      } else {
        const res = await api.post('/v2/admin/feed/grant-announcer', { user_id: Number(id) });
        if (res.success) {
          setIsMunicipalityAnnouncer(true);
          toast.success(t('toasts.announcer_granted'));
        } else {
          toast.error(t('toasts.announcer_failed'));
        }
      }
    } catch {
      toast.error(t('toasts.announcer_failed'));
    } finally {
      setAnnouncerLoading(false);
    }
  }

  async function handleImpersonate() {
    if (!id) return;
    setImpersonateLoading(true);
    try {
      const res = await adminUsers.impersonate(Number(id));
      if (res.success && res.data) {
        const data = res.data as Record<string, unknown>;
        const token = (data.access_token as string) || (data.token as string);
        const tenantSlug = (data.tenant_slug as string) || '';
        const tenantId = (data.tenant_id as number | undefined) ?? null;
        if (token) {
          // Open the new tab on the IMPERSONATED user's tenant URL — without
          // this, the new tab inherits the admin's slug from localStorage and
          // the impersonation token is rejected as a tenant_mismatch on /me.
          const targetUrl = tenantSlug
            ? `${window.location.origin}/${tenantSlug}/`
            : `${window.location.origin}/`;
          const { sendImpersonationToken } = await import('@/lib/impersonate');
          sendImpersonationToken(token, targetUrl, { tenantId, tenantSlug });
          toast.success(t('toasts.impersonate_success'));
        }
      } else {
        toast.error(t('toasts.impersonate_failed'));
      }
    } catch {
      toast.error(t('toasts.impersonate_failed'));
    } finally {
      setImpersonateLoading(false);
    }
  }

  async function handleAdjustBalance() {
    if (!id || !balanceAmount.trim() || !balanceReason.trim()) return;
    const amount = parseFloat(balanceAmount);
    if (isNaN(amount) || amount === 0) { toast.error(t('toasts.balance_invalid')); return; }
    setBalanceLoading(true);
    try {
      const res = await adminTimebanking.adjustBalance(Number(id), amount, balanceReason.trim());
      if (res.success) {
        toast.success(t('toasts.balance_adjusted'));
        setBalanceModalOpen(false);
        setBalanceAmount('');
        setBalanceReason('');
        loadUser();
      } else {
        toast.error(t('toasts.balance_failed'));
      }
    } catch {
      toast.error(t('toasts.balance_failed'));
    } finally {
      setBalanceLoading(false);
    }
  }

  async function handleRemoveBadge() {
    if (!badgeToRemove || !id) return;
    setRemovingBadge(true);
    try {
      const res = await adminUsers.removeBadge(Number(id), badgeToRemove.id);
      if (res.success) {
        toast.success(t('toasts.remove_badge_success'));
        setUser((prev) =>
          prev ? { ...prev, badges: prev.badges.filter((b) => b.id !== badgeToRemove.id) } : prev
        );
      } else {
        toast.error(t('toasts.remove_badge_failed'));
      }
    } catch {
      toast.error(t('toasts.generic_error'));
    } finally {
      setRemovingBadge(false);
      setBadgeToRemove(null);
    }
  }

  async function handleRecheckBadges() {
    if (!id) return;
    setRecheckingBadges(true);
    try {
      const res = await adminUsers.recheckUserBadges(Number(id));
      if (res.success && res.data) {
        const data = res.data as { badges?: AdminBadge[] };
        if (data.badges) {
          setUser((prev) => prev ? { ...prev, badges: data.badges! } : prev);
        }
        toast.success(t('toasts.recheck_complete'));
      } else {
        toast.error(t('toasts.recheck_failed'));
      }
    } catch {
      toast.error(t('toasts.recheck_failed'));
    } finally {
      setRecheckingBadges(false);
    }
  }

  async function handleSetPassword() {
    if (!id || !newPassword.trim()) return;
    if (newPassword.length < 8) { toast.error(t('validation.password_min')); return; }
    setPasswordLoading(true);
    try {
      const res = await adminUsers.setPassword(Number(id), newPassword);
      if (res.success) {
        toast.success(t('toasts.password_updated'));
        setPasswordModalOpen(false);
        setNewPassword('');
      } else {
        toast.error(t('toasts.password_failed'));
      }
    } catch {
      toast.error(t('toasts.password_failed'));
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleSendPasswordReset() {
    if (!id) return;
    setResetEmailLoading(true);
    try {
      const res = await adminUsers.sendPasswordReset(Number(id));
      if (res.success) {
        toast.success(t('toasts.password_reset_sent'));
      } else {
        toast.error(t('toasts.password_reset_failed'));
      }
    } catch {
      toast.error(t('toasts.password_reset_failed'));
    } finally {
      setResetEmailLoading(false);
    }
  }

  async function handleSendWelcomeEmail() {
    if (!id) return;
    setWelcomeEmailLoading(true);
    try {
      const res = await adminUsers.sendWelcomeEmail(Number(id));
      if (res.success) {
        toast.success(t('toasts.welcome_email_sent'));
      } else {
        toast.error(t('toasts.welcome_email_failed'));
      }
    } catch {
      toast.error(t('toasts.welcome_email_failed'));
    } finally {
      setWelcomeEmailLoading(false);
    }
  }

  async function handleSendVerificationEmail() {
    if (!id) return;
    setVerificationEmailLoading(true);
    try {
      const res = await adminUsers.sendVerificationEmail(Number(id));
      if (res.success) {
        const data = res.data as { already_verified?: boolean } | undefined;
        if (data?.already_verified) {
          toast.success(t('toasts.email_already_activated'));
          loadUser();
        } else {
          toast.success(t('toasts.verification_email_sent'));
        }
      } else {
        toast.error(t('toasts.verification_email_failed'));
      }
    } catch {
      toast.error(t('toasts.verification_email_failed'));
    } finally {
      setVerificationEmailLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('loading.user')} /></div>
      </div>
    );
  }

  if (loadError || !user) {
    return (
      <div>
        <PageHeader
          title={t('meta.edit_user')}
          actions={
            <Button variant="tertiary" startContent={<ArrowLeft aria-hidden="true" size={16} />} onPress={() => navigate(tenantPath('/admin/users'))}>
              {t('actions.back_to_users')}
            </Button>
          }
        />
        <Card className="max-w-2xl">
          <CardBody className="p-6">
            <p className="text-center text-danger">{loadError || t('errors.user_not_found')}</p>
            <div className="mt-4 flex justify-center">
              <Button variant="tertiary" onPress={() => navigate(tenantPath('/admin/users'))}>{t('actions.return_to_list')}</Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const canImpersonate = isSuperAdmin && !user.is_super_admin && !user.is_god && user.id !== currentUser?.id;
  const emailActivated = Boolean(user.email_verified_at);
  const emailActivatedDate = user.email_verified_at
    ? new Date(user.email_verified_at).toLocaleString(getFormattingLocale())
    : null;

  return (
    <div>
      <PageHeader
        title={t('meta.edit_user')}
        description={t('meta.user_id_joined')}
        actions={
          <div className="flex items-center gap-2">
            {canImpersonate && (
              <Button
                variant="tertiary"
                color="warning"
                startContent={<LogIn aria-hidden="true" size={16} />}
                onPress={handleImpersonate}
                isLoading={impersonateLoading}
                size="sm"
              >
                {t('actions.impersonate')}
              </Button>
            )}
            <Button variant="tertiary" startContent={<ArrowLeft aria-hidden="true" size={16} />} onPress={() => navigate(tenantPath('/admin/users'))}>
              {t('actions.back_to_users')}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-6 max-w-2xl">
        {/* User Details Form */}
        <form onSubmit={handleSubmit} aria-label={t('aria.edit_user_form')}>
          <Card>
            <CardHeader className="px-6 pt-5 pb-0">
              <div className="flex items-center gap-4">
                <Avatar src={resolveAvatarUrl(user.avatar_url || user.avatar) || undefined} name={user.name} size="lg" />
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{user.name}</h3>
                  <p className="text-sm text-muted">{user.email}</p>
                  {user.balance !== undefined && (
                    <p className="text-xs text-muted mt-0.5">{t('fields.balance')}</p>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardBody className="gap-5 p-6">
              {/* Name */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('fields.first_name')} placeholder={t('placeholders.first_name')} value={firstName} onValueChange={setFirstName}
                  isRequired isInvalid={!!errors.first_name} errorMessage={errors.first_name} isDisabled={submitting} />
                <Input label={t('fields.last_name')} placeholder={t('placeholders.last_name')} value={lastName} onValueChange={setLastName}
                  isRequired isInvalid={!!errors.last_name} errorMessage={errors.last_name} isDisabled={submitting} />
              </div>

              {/* Email + Phone */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('fields.email')} type="email" placeholder={t('placeholders.email')} value={email} onValueChange={setEmail}
                  isRequired isInvalid={!!errors.email} errorMessage={errors.email} isDisabled={submitting} />
                <Input label={t('fields.phone')} type="tel" placeholder={t('placeholders.phone')} value={phone}
                  onValueChange={setPhone} isDisabled={submitting} />
              </div>

              {/* Role + Status */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select label={t('fields.role')} placeholder={t('placeholders.role')} selectedKeys={role ? [role] : []}
                  onSelectionChange={(keys) => setRole(Array.from(keys)[0] as string)}
                  isRequired isInvalid={!!errors.role} errorMessage={errors.role} isDisabled={submitting}>
                  <SelectItem key="member" id="member">{t('roles.member')}</SelectItem>
                  <SelectItem key="broker" id="broker">{t('roles.broker')}</SelectItem>
                  <SelectItem key="admin" id="admin">{t('roles.admin')}</SelectItem>
                </Select>
                <Select label={t('fields.status')} placeholder={t('placeholders.status')} selectedKeys={status ? [status] : []}
                  onSelectionChange={(keys) => setStatus(Array.from(keys)[0] as string)}
                  isRequired isInvalid={!!errors.status} errorMessage={errors.status} isDisabled={submitting}>
                  <SelectItem key="active" id="active">{t('statuses.active')}</SelectItem>
                  <SelectItem key="pending" id="pending">{t('statuses.pending')}</SelectItem>
                  <SelectItem key="suspended" id="suspended">{t('statuses.suspended')}</SelectItem>
                  <SelectItem key="banned" id="banned">{t('statuses.banned')}</SelectItem>
                </Select>
              </div>

              {/* Profile Type + Organization */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label={t('fields.profile_type')}
                  placeholder={t('placeholders.profile_type')}
                  selectedKeys={[profileType]}
                  onSelectionChange={(keys) => setProfileType(Array.from(keys)[0] as 'individual' | 'organisation')}
                  isDisabled={submitting}
                >
                  <SelectItem key="individual" id="individual">{t('profile_types.individual')}</SelectItem>
                  <SelectItem key="organisation" id="organisation">{t('profile_types.organisation')}</SelectItem>
                </Select>
                {profileType === 'organisation' && (
                  <Input
                  label={t('fields.organisation_name')}
                  placeholder={t('placeholders.organisation_name')}
                    value={organizationName}
                    onValueChange={setOrganizationName}
                    startContent={<Building2 aria-hidden="true" size={14} className="text-muted" />}
                    isDisabled={submitting}
                  />
                )}
              </div>

              {/* Bio */}
              <Textarea label={t('fields.bio')} placeholder={t('placeholders.bio')} value={bio} onValueChange={setBio}
                minRows={3} maxRows={6} isDisabled={submitting} />

              {/* Tagline + Location */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label={t('fields.tagline')} placeholder={t('placeholders.tagline')} value={tagline}
                  onValueChange={setTagline} isDisabled={submitting} />
              <Input label={t('fields.location')} placeholder={t('placeholders.location')} value={location}
                  onValueChange={setLocation} isDisabled={submitting} />
              </div>

              {/* Submit */}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="tertiary" onPress={() => navigate(tenantPath('/admin/users'))} isDisabled={submitting}>
                {t('actions.cancel')}
                </Button>
          <Button type="submit" startContent={!submitting ? <Save size={16} /> : undefined}
                  isLoading={submitting}>
                {t('actions.save_changes')}
                </Button>
              </div>
            </CardBody>
          </Card>
        </form>

        {/* Email Activation */}
        <Card>
          <CardHeader className="px-6 pt-5 pb-0">
            <div className="flex items-center gap-2">
              <Mail aria-hidden="true" size={18} className="text-accent" />
              <h3 className="text-lg font-semibold text-foreground">{t('sections.email_activation')}</h3>
            </div>
          </CardHeader>
          <CardBody className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{t('fields.email_activation_status')}</p>
                  <Chip size="sm" variant="soft" color={emailActivated ? 'success' : 'warning'}>
                    {emailActivated ? t('statuses.email_activated') : t('statuses.email_not_activated')}
                  </Chip>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {emailActivated
                    ? t('descriptions.email_activation_verified')
                    : t('descriptions.email_activation_unverified')}
                </p>
                {emailActivatedDate && (
                  <p className="mt-1 text-xs text-muted">
                    {t('summary.email_activated_on', { date: emailActivatedDate })}
                  </p>
                )}
              </div>
              {!emailActivated && (
                <Button
                  size="sm"
                  variant="secondary"
                  startContent={!verificationEmailLoading ? <Mail aria-hidden="true" size={14} /> : undefined}
                  onPress={handleSendVerificationEmail}
                  isLoading={verificationEmailLoading}
                  className="sm:shrink-0"
                >
                  {t('actions.resend_verification_email')}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Tenant Super Admin (hierarchy-scoped — visible to super admins) */}
        {isSuperAdmin && (
          <Card>
            <CardHeader className="px-6 pt-5 pb-0">
              <div className="flex items-center gap-2">
                <ShieldAlert aria-hidden="true" size={18} className="text-warning" />
                <h3 className="text-lg font-semibold text-foreground">{t('sections.super_admin_access')}</h3>
              </div>
            </CardHeader>
            <CardBody className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">{t('fields.tenant_super_admin')}</p>
                  <p className="text-sm text-muted">
                    {t('descriptions.tenant_super_admin')}
                  </p>
                </div>
                <Switch
                  isSelected={isTenantSuperAdmin}
                  onValueChange={handleToggleTenantSuperAdmin}
                  isDisabled={tenantSuperAdminLoading || user.id === currentUser?.id}
                  color="warning"
                  aria-label={t('aria.toggle_tenant_super_admin')}
                />
              </div>
              {user.id === currentUser?.id && (
                <p className="text-xs text-muted mt-2">{t('descriptions.cannot_modify_self')}</p>
              )}
            </CardBody>
          </Card>
        )}

        {/* Global Super Admin (god-only — bypasses all tenant isolation) */}
        {isGod && (
          <Card className="border-2 border-danger/30">
            <CardHeader className="px-6 pt-5 pb-0">
              <div className="flex items-center gap-2">
                <ShieldAlert aria-hidden="true" size={18} className="text-danger" />
                <h3 className="text-lg font-semibold text-danger">{t('sections.global_super_admin')}</h3>
              </div>
            </CardHeader>
            <CardBody className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">{t('fields.platform_wide_access')}</p>
                  <p className="text-sm text-muted">
                    {t('descriptions.global_super_admin')}
                  </p>
                </div>
                <Switch
                  isSelected={isGlobalSuperAdmin}
                  onValueChange={handleToggleGlobalSuperAdmin}
                  isDisabled={globalSuperAdminLoading || user.id === currentUser?.id}
                  color="danger"
                  aria-label={t('aria.toggle_global_super_admin')}
                />
              </div>
              {user.id === currentUser?.id && (
                <p className="text-xs text-muted mt-2">{t('descriptions.cannot_modify_self')}</p>
              )}
            </CardBody>
          </Card>
        )}

        {/* Municipal Announcer (AG14) */}
        {isSuperAdmin && (
          <Card className="border border-accent/30">
            <CardHeader className="px-6 pt-5 pb-0">
              <div className="flex items-center gap-2">
                <Landmark aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold text-foreground">{t('sections.municipal_announcer')}</h3>
              </div>
            </CardHeader>
            <CardBody className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">{t('fields.official_announcement_channel')}</p>
                  <p className="text-sm text-muted">
                    {t('descriptions.municipal_announcer')}
                  </p>
                </div>
                <Switch
                  isSelected={isMunicipalityAnnouncer}
                  onValueChange={handleToggleMunicipalityAnnouncer}
                  isDisabled={announcerLoading}
                  aria-label={t('aria.toggle_municipal_announcer')}
                />
              </div>
            </CardBody>
          </Card>
        )}

        {/* Password & Email Management */}
        <Card>
          <CardHeader className="px-6 pt-5 pb-0">
            <div className="flex items-center gap-2">
              <KeyRound aria-hidden="true" size={18} className="text-accent" />
              <h3 className="text-lg font-semibold text-foreground">{t('sections.account_actions')}</h3>
            </div>
          </CardHeader>
          <CardBody className="p-6">
            <div className="flex flex-wrap gap-3">
              <Button
                size="sm"
                variant="tertiary"
                startContent={<KeyRound aria-hidden="true" size={14} />}
                onPress={() => setPasswordModalOpen(true)}
              >
                {t('actions.set_password')}
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                startContent={<Mail aria-hidden="true" size={14} />}
                onPress={handleSendPasswordReset}
                isLoading={resetEmailLoading}
              >
                {t('actions.send_password_reset')}
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                startContent={<Mail aria-hidden="true" size={14} />}
                onPress={handleSendWelcomeEmail}
                isLoading={welcomeEmailLoading}
              >
                {t('actions.resend_welcome_email')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Wallet Balance */}
        <Card>
          <CardHeader className="px-6 pt-5 pb-0">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Coins aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold text-foreground">{t('sections.time_credits')}</h3>
              </div>
              <Button size="sm" variant="secondary" onPress={() => setBalanceModalOpen(true)}>
                {t('actions.adjust_balance')}
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-6">
            <div className="flex items-center gap-4">
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(user.balance ?? 0, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' })}
              </div>
              <p className="text-sm text-muted">{t('fields.current_balance')}</p>
            </div>
          </CardBody>
        </Card>

        {/* Badges Section */}
        <Card>
          <CardHeader className="px-6 pt-5 pb-0">
            <div className="flex items-center justify-between w-full">
              <h3 className="text-lg font-semibold text-foreground">{t('sections.badges')}</h3>
              <Button
                size="sm"
                variant="tertiary"
                startContent={<RefreshCw aria-hidden="true" size={14} />}
                onPress={handleRecheckBadges}
                isLoading={recheckingBadges}
              >
                {t('actions.recheck_badges')}
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-6">
            {user.badges && user.badges.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {user.badges.map((badge) => (
                  <Chip
                    key={badge.id}
                    variant="soft"
                    size="lg"
                    startContent={badge.icon ? <span className="text-sm">{badge.icon}</span> : undefined}
                    endContent={
                      <Button isIconOnly variant="tertiary" size="sm" onPress={() => setBadgeToRemove(badge)}
                        className="ml-1 min-w-0 w-5 h-5 rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                        aria-label={t('aria.remove_badge', { name: badge.name })}>
                        <Trash2 size={12} />
                      </Button>
                    }
                  >
                    {badge.name}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">{t('empty.no_badges')}</p>
            )}
          </CardBody>
        </Card>

        {/* GDPR Consents Section */}
        <Card>
          <CardHeader className="px-6 pt-5 pb-0">
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" size={18} className="text-success" />
              <h3 className="text-lg font-semibold text-foreground">{t('sections.gdpr_consents')}</h3>
            </div>
          </CardHeader>
          <CardBody className="p-6">
            {consentsLoading ? (
              <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner size="sm" label={t('loading.consents')} /></div>
            ) : consents.length > 0 ? (
              <div className="flex flex-col gap-3">
                {consents.map((consent) => (
                  <div
                    key={consent.consent_type}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {consent.name || t(`consents.type_${consent.consent_type}`, { defaultValue: t('consents.type_unknown') })}
                        </p>
                        {consent.is_required && (
                          <Chip size="sm" variant="soft" color="warning">{t('badges.required')}</Chip>
                        )}
                      </div>
                      {consent.description && (
                        <p className="text-xs text-muted mt-0.5">{consent.description}</p>
                      )}
                      <p className="text-xs text-muted mt-1">
                        {consent.consent_given
                          ? (consent.given_at ? t('consents.consented_on') : t('consents.consented'))
                          : consent.withdrawn_at
                            ? t('consents.withdrawn_on')
                            : t('consents.not_consented')
                        }
                        {consent.consent_version && ` (v${consent.consent_version})`}
                      </p>
                    </div>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={consent.consent_given ? 'success' : 'danger'}
                    >
                      {consent.consent_given ? t('consents.given') : t('consents.not_given')}
                    </Chip>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">{t('empty.no_consent_records')}</p>
            )}
          </CardBody>
        </Card>

        {/* Safeguarding & Compliance Section */}
        <Card>
          <CardHeader className="px-6 pt-5 pb-0">
            <div className="flex items-center gap-2">
              <ShieldAlert aria-hidden="true" size={18} className="text-warning" />
              <h3 className="text-lg font-semibold text-foreground">{t('sections.safeguarding')}</h3>
            </div>
          </CardHeader>
          <CardBody className="p-6">
            {complianceLoading ? (
              <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner size="sm" label={t('loading.compliance')} /></div>
            ) : (
              <div className="flex flex-col gap-6">
                {/* Safeguarding contact attestation */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck aria-hidden="true" size={16} className="text-accent" />
                      <p className="font-medium text-foreground">{t('sections.contact_attestation')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip
                        size="sm"
                        variant="soft"
                        color={
                          vettingRecords[0]?.decision === 'confirmed' ? 'success'
                            : vettingRecords[0]?.decision === 'revoked' ? 'danger'
                            : 'default'
                        }
                        className="capitalize"
                      >
                        {t(`values.decision_${vettingRecords[0]?.decision ?? 'not_confirmed'}`)}
                      </Chip>
                      <Button
                        as={Link}
                        to={tenantPath(user?.id ? `/broker/vetting?user_id=${user.id}` : '/broker/vetting')}
                        size="sm"
                        variant="tertiary"
                      >
                        {t('actions.manage')}
                      </Button>
                    </div>
                  </div>
                  {vettingRecords.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {vettingRecords.slice(0, 3).map((vr) => (
                        <div key={vr.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {t(`values.attestation_${vr.attestation_code}`, { defaultValue: t('values.safeguarding_confirmation') })}
                            </p>
                            <p className="text-xs text-muted">
                              {vr.confirmed_at ? t('values.confirmed_on', { date: new Date(vr.confirmed_at).toLocaleDateString(getFormattingLocale()) }) : t('values.not_confirmed')}
                            </p>
                          </div>
                          <Chip
                            size="sm"
                            variant="soft"
                            color={
                              vr.decision === 'confirmed' ? 'success'
                                : vr.decision === 'revoked' ? 'danger'
                                : 'default'
                            }
                            className="capitalize"
                          >
                            {t(`values.decision_${vr.decision}`)}
                          </Chip>
                        </div>
                      ))}
                      {vettingRecords.length > 3 && (
                        <p className="text-xs text-muted">{t('summary.more_attestations')}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">{t('empty.no_vetting_records')}</p>
                  )}
                </div>

                {/* Insurance Status */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <FileCheck aria-hidden="true" size={16} className="text-accent" />
                      <p className="font-medium text-foreground">{t('sections.insurance_certificates')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip
                        size="sm"
                        variant="soft"
                        color={
                          user?.insurance_status === 'verified' ? 'success'
                            : user?.insurance_status === 'pending' ? 'warning'
                            : user?.insurance_status === 'expired' ? 'danger'
                            : 'default'
                        }
                        className="capitalize"
                      >
                        {t(`insurance.status_${user?.insurance_status ?? 'none'}`, { defaultValue: t('insurance.status_unknown') })}
                      </Chip>
                      <Button
                        as={Link}
                        to={tenantPath(user?.id ? `/broker/insurance?user_id=${user.id}` : '/broker/insurance')}
                        size="sm"
                        variant="tertiary"
                      >
                        {t('actions.manage')}
                      </Button>
                    </div>
                  </div>
                  {insuranceRecords.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {insuranceRecords.slice(0, 3).map((ic) => (
                        <div key={ic.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {t(`insurance.type_${ic.insurance_type}`, { defaultValue: t('insurance.type_unknown') })}
                            </p>
                            <p className="text-xs text-muted">
                              {ic.provider_name || t('values.unknown_provider')}
                              {ic.expiry_date ? t('values.expires_prefix') : ''}
                            </p>
                          </div>
                          <Chip
                            size="sm"
                            variant="soft"
                            color={
                              ic.status === 'verified' ? 'success'
                                : ic.status === 'pending' || ic.status === 'submitted' ? 'warning'
                                : ic.status === 'rejected' ? 'danger'
                                : 'default'
                            }
                            className="capitalize"
                          >
                            {t(`insurance.status_${ic.status}`, { defaultValue: t('insurance.status_unknown') })}
                          </Chip>
                        </div>
                      ))}
                      {insuranceRecords.length > 3 && (
                        <p className="text-xs text-muted">{t('summary.more_certificates')}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">{t('empty.no_insurance_records')}</p>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Badge Removal Confirmation */}
      {badgeToRemove && (
        <ConfirmModal
          isOpen={!!badgeToRemove}
          onClose={() => setBadgeToRemove(null)}
          onConfirm={handleRemoveBadge}
          title={t('modals.remove_badge.title')}
          message={t('modals.remove_badge.message')}
          confirmLabel={t('actions.remove_badge')}
          confirmColor="danger"
          isLoading={removingBadge}
        />
      )}

      {/* Adjust Balance Modal */}
      <Modal isOpen={balanceModalOpen}
        onClose={() => { setBalanceModalOpen(false); setBalanceAmount(''); setBalanceReason(''); }}
        size="sm">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Coins size={20} className="text-accent" aria-hidden="true" />
            {t('modals.adjust_balance.title')}
          </ModalHeader>
          <ModalBody className="gap-4">
            <p className="text-sm text-muted">{t('fields.current_balance')}</p>
            <Input label={t('fields.amount')} placeholder={t('placeholders.balance_amount')}
              description={t('descriptions.balance_amount')}
              value={balanceAmount} onValueChange={setBalanceAmount}
              type="number" step="0.5" isDisabled={balanceLoading} />
            <Input label={t('fields.reason')} placeholder={t('placeholders.balance_reason')}
              value={balanceReason} onValueChange={setBalanceReason}
              isRequired isDisabled={balanceLoading} />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary"
              onPress={() => { setBalanceModalOpen(false); setBalanceAmount(''); setBalanceReason(''); }}
              isDisabled={balanceLoading}>
              {t('actions.cancel')}
            </Button>
          <Button onPress={handleAdjustBalance} isLoading={balanceLoading}
              isDisabled={!balanceAmount.trim() || !balanceReason.trim() || balanceLoading}>
              {t('actions.apply_adjustment')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Set Password Modal */}
      <Modal isOpen={passwordModalOpen}
        onClose={() => { setPasswordModalOpen(false); setNewPassword(''); }}
        size="sm">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <KeyRound size={20} className="text-accent" aria-hidden="true" />
            {t('modals.set_password.title')}
          </ModalHeader>
          <ModalBody className="gap-4">
            <p className="text-sm text-muted">
              {t('modals.set_password.body')}
            </p>
            <Input
              label={t('fields.new_password')}
              type="password"
              placeholder={t('placeholders.new_password')}
              value={newPassword}
              onValueChange={setNewPassword}
              isDisabled={passwordLoading}
              description={t('validation.password_min')}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary"
              onPress={() => { setPasswordModalOpen(false); setNewPassword(''); }}
              isDisabled={passwordLoading}>
              {t('actions.cancel')}
            </Button>
          <Button onPress={handleSetPassword} isLoading={passwordLoading}
              isDisabled={newPassword.length < 8 || passwordLoading}>
              {t('actions.set_password')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default UserEdit;
