import { Card, CardBody, CardHeader, Button, Chip, Spinner, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';

import { Separator } from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Edit from 'lucide-react/icons/square-pen';
import Shield from 'lucide-react/icons/shield';
import ShieldOff from 'lucide-react/icons/shield-off';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Crown from 'lucide-react/icons/crown';
import CrownIcon from 'lucide-react/icons/crown';
import MapPin from 'lucide-react/icons/map-pin';
import Phone from 'lucide-react/icons/phone';
import Clock from 'lucide-react/icons/clock';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Wallet from 'lucide-react/icons/wallet';
import User from 'lucide-react/icons/user';
import Building2 from 'lucide-react/icons/building-2';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import UserCog from 'lucide-react/icons/user-cog';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { canAccessSuperPanel } from '@/lib/access';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { SuperAdminUserDetail, SuperAdminTenant } from '../../api/types';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


type ConfirmActionType =
  | 'grant-sa'
  | 'revoke-sa'
  | 'grant-global'
  | 'revoke-global';

function getPrivilegeLevel(user: SuperAdminUserDetail) {
  if (user.is_super_admin) return { labelKey: 'super.privilege_global_super_admin', color: 'danger' as const, level: 4 };
  if (user.is_tenant_super_admin) return { labelKey: 'super.privilege_tenant_super_admin', color: 'default' as const, level: 3 };
  if (user.role === 'admin' || user.role === 'tenant_admin') return { labelKey: 'super.privilege_admin', color: 'accent' as const, level: 2 };
  return { labelKey: 'super.privilege_regular_member', color: 'default' as const, level: 1 };
}

function formatDate(dateStr: string | null | undefined, neverLabel: string): string {
  if (!dateStr) return neverLabel;
  return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function UserShow() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.users'));
  const { id } = useParams<{ id: string }>();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  // Impersonation modal state
  const [impersonateModalOpen, setImpersonateModalOpen] = useState(false);
  const [impersonateLoading, setImpersonateLoading] = useState(false);

  const [user, setUser] = useState<SuperAdminUserDetail | null>(null);
  const [tenants, setTenants] = useState<SuperAdminTenant[]>([]);
  const [loading, setLoading] = useState(true);

  /*
   * 🔴 The impersonation button is gated on what the SERVER will actually do,
   * not on being a platform administrator.
   *
   * `POST /v2/admin/super/users/{id}/impersonate` is tier A: it admits the
   * super-admin of a branch community and scopes them with
   * `SuperPanelAccess::canAccessTenant()` on the TARGET's tenant. Verified by
   * hand on 2026-08-06 as a regional super-admin: a member of their own branch
   * is allowed, a member of an unrelated community is 403, the platform owner
   * is 403, and themselves is 422.
   *
   * Gating the button on `is_super_admin` alone made the client STRICTER than
   * the endpoint, so a network administrator could not reach a power they are
   * entitled to. A client gate must never be stricter than its server — the
   * server is the authority, and a hidden-but-permitted action is simply
   * invisible with nothing to explain it.
   *
   * The conditions below mirror the server's own refusals, so the button is not
   * offered where it would answer 403 or 422:
   *   - never a platform administrator (impersonation is not peer escalation)
   *   - never yourself
   *   - only an active account
   * The subtree rule is deliberately NOT duplicated here: only the server can
   * evaluate it, and a guess would either hide a legitimate action or offer an
   * illegitimate one.
   */
  const targetIsPlatformAdmin =
    user?.is_super_admin === true ||
    (user as { is_god?: boolean } | null)?.is_god === true ||
    ((user?.role as string | undefined) ?? '') === 'super_admin' ||
    ((user?.role as string | undefined) ?? '') === 'god';

  const canImpersonate =
    canAccessSuperPanel(currentUser) &&
    user !== null &&
    !targetIsPlatformAdmin &&
    user.id !== currentUser?.id &&
    user.status === 'active';

  // Confirm modal state
  const [confirmAction, setConfirmAction] = useState<ConfirmActionType | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Move to Tenant modal
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTargetTenant, setMoveTargetTenant] = useState<string>('');
  const [moveLoading, setMoveLoading] = useState(false);

  // Move and Promote modal
  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [promoteTargetTenant, setPromoteTargetTenant] = useState<string>('');
  const [promoteLoading, setPromoteLoading] = useState(false);

  const loadUser = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await adminSuper.getUser(Number(id));
    if (res.success && res.data) {
      setUser(res.data as SuperAdminUserDetail);
    }
    setLoading(false);
  }, [id]);

  const loadTenants = useCallback(async () => {
    const res = await adminSuper.listTenants();
    if (res.success && res.data) {
      setTenants(Array.isArray(res.data) ? res.data as SuperAdminTenant[] : []);
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { loadTenants(); }, [loadTenants]);

  const handleConfirmAction = async () => {
    if (!confirmAction || !user) return;
    setActionLoading(true);
    let res;
    switch (confirmAction) {
      case 'grant-sa': res = await adminSuper.grantSuperAdmin(user.id); break;
      case 'revoke-sa': res = await adminSuper.revokeSuperAdmin(user.id); break;
      case 'grant-global': res = await adminSuper.grantGlobalSuperAdmin(user.id); break;
      case 'revoke-global': res = await adminSuper.revokeGlobalSuperAdmin(user.id); break;
    }
    if (res?.success) {
      toast.success(t('super.user_updated_successfully'));
      loadUser();
    } else {
      toast.error(t('super.operation_failed'));
    }
    setActionLoading(false);
    setConfirmAction(null);
  };

  const handleMoveTenant = async () => {
    if (!user || !moveTargetTenant) return;
    setMoveLoading(true);
    const res = await adminSuper.moveUserTenant(user.id, Number(moveTargetTenant));
    if (res?.success) {
      toast.success(t('super.user_moved_to_new_tenant'));
      setMoveModalOpen(false);
      setMoveTargetTenant('');
      loadUser();
    } else {
      toast.error(t('super.failed_to_move_user'));
    }
    setMoveLoading(false);
  };

  const handleMoveAndPromote = async () => {
    if (!user || !promoteTargetTenant) return;
    setPromoteLoading(true);
    const res = await adminSuper.moveAndPromote(user.id, Number(promoteTargetTenant));
    if (res?.success) {
      toast.success(t('super.user_moved_and_promoted_to_tenant_super_admin'));
      setPromoteModalOpen(false);
      setPromoteTargetTenant('');
      loadUser();
    } else {
      toast.error(t('super.failed_to_move_and_promote'));
    }
    setPromoteLoading(false);
  };

  const handleImpersonate = async () => {
    if (!user) return;
    setImpersonateLoading(true);
    try {
      // Super-panel targets are routinely in another community, so this uses the
      // cross-tenant endpoint. The tenant-scoped adminUsers.impersonate returns
      // 404 "user not found" for exactly those users.
      const res = await adminSuper.impersonate(user.id);
      if (res?.success && res.data?.token) {
        toast.success(t('super.impersonation_started'));
        // Hand the proof to a NEW tab on the target community's URL and let it
        // exchange the proof for a real session there. Storing the proof locally
        // and navigating this tab cannot work: the proof is not a credential,
        // and this tab must stay signed in as the admin.
        const tenantSlug = res.data.tenant_slug || '';
        const targetUrl = tenantSlug
          ? `${window.location.origin}/${tenantSlug}/dashboard`
          : `${window.location.origin}${tenantPath('/dashboard')}`;
        const { sendImpersonationToken } = await import('@/lib/impersonate');
        sendImpersonationToken(res.data.token, targetUrl, {
          tenantId: res.data.tenant_id ?? null,
          tenantSlug: tenantSlug || null,
        });
        setImpersonateModalOpen(false);
      } else {
        // admin-i18n-ignore: localized server message — the impersonation
        // controller's refusals are __() keys.
        toast.error(res.error || t('super.impersonation_failed'));
      }
    } catch {
      toast.error(t('super.impersonation_failed'));
    }
    setImpersonateLoading(false);
  };

  const confirmMessages: Record<ConfirmActionType, { title: string; message: string; label: string; color: 'danger' | 'warning' | 'primary' }> = {
    'grant-sa': {
      title: t('super.confirm_grant_sa_title'),
      message: t('super.confirm_grant_sa_message_detail'),
      label: t('super.grant_tenant_sa'),
      color: 'primary',
    },
    'revoke-sa': {
      title: t('super.confirm_revoke_sa_title'),
      message: t('super.confirm_revoke_sa_message_detail'),
      label: t('super.revoke_tenant_sa'),
      color: 'danger',
    },
    'grant-global': {
      title: t('super.confirm_grant_global_title'),
      message: t('super.confirm_grant_global_message_detail'),
      label: t('super.grant_global_sa'),
      color: 'danger',
    },
    'revoke-global': {
      title: t('super.confirm_revoke_global_title'),
      message: t('super.confirm_revoke_global_message_detail'),
      label: t('super.revoke_global_sa'),
      color: 'danger',
    },
  };

  // Hub tenants for move-and-promote
  const hubTenants = tenants.filter(t => t.allows_subtenants === true);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('super.loading_user_details')} /></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted">{t('super.user_not_found')}</p>
        <Button className="mt-4" variant="secondary" onPress={() => navigate(tenantPath('/super-admin/users'))}>
          {t('super.back_to_users')}
        </Button>
      </div>
    );
  }

  const privilege = getPrivilegeLevel(user);

  return (
    <div>
      <PageHeader
        title={user.name}
        description={t('super.cross_tenant_user_details')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              startContent={<Edit aria-hidden="true" size={16} />}
              onPress={() => navigate(tenantPath(`/super-admin/users/${user.id}/edit`))}
            >
              {t('super.edit')}
            </Button>
            <Button
              variant="secondary"
              startContent={<ArrowLeft aria-hidden="true" size={16} />}
              onPress={() => navigate(tenantPath('/super-admin/users'))}
            >
              {t('super.back_to_users')}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - 2/3 width */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* User Information */}
          <Card>
            <CardHeader className="font-semibold text-lg flex items-center gap-2">
              <User aria-hidden="true" size={18} />
              {t('super.user_information')}
            </CardHeader>
            <Separator />
            <CardBody>
              <div className="flex items-start gap-4">
                <Avatar
                  name={user.name}
                  src={resolveAvatarUrl(user.avatar) || undefined}
                  size="lg"
                  className="shrink-0"
                />
                <div className="flex flex-col gap-2 flex-1">
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{user.first_name} {user.last_name}</h2>
                    <p className="text-muted">{user.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Chip
                      size="sm"
                      variant="soft"
                      color={user.role === 'admin' || user.role === 'tenant_admin' ? 'accent' : 'default'}
                      data-testid="user-role-chip"
                      data-role={user.role}
                    >
                      {t(`super.role_${user.role}`, { defaultValue: t('super.role_unknown') })}
                    </Chip>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={user.status === 'active' ? 'success' : user.status === 'pending' ? 'warning' : 'danger'}
                      data-testid="user-status-chip"
                      data-status={user.status}
                    >
                      {t(`super.status_${user.status}`, { defaultValue: t('super.status_unknown') })}
                    </Chip>
                    {user.is_super_admin && (
                      <Chip size="sm" variant="soft" color="danger" startContent={<ShieldAlert aria-hidden="true" size={12} />}>
                        {t('super.privilege_global_super_admin')}
                      </Chip>
                    )}
                    {user.is_tenant_super_admin && (
                      <Chip size="sm" variant="soft" color="default" startContent={<Shield aria-hidden="true" size={12} />}>
                        {t('super.privilege_tenant_super_admin')}
                      </Chip>
                    )}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Profile Info */}
          <Card>
            <CardHeader className="font-semibold text-lg">{t('super.profile_info')}</CardHeader>
            <Separator />
            <CardBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <MapPin aria-hidden="true" size={16} className="text-muted shrink-0" />
                  <div>
                    <p className="text-xs text-muted">{t('super.label_location')}</p>
                    <p className="text-sm text-foreground">{user.location || t('super.not_set')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Phone aria-hidden="true" size={16} className="text-muted shrink-0" />
                  <div>
                    <p className="text-xs text-muted">{t('super.label_phone')}</p>
                    <p className="text-sm text-foreground">{user.phone || t('super.not_set')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <CalendarDays aria-hidden="true" size={16} className="text-muted shrink-0" />
                  <div>
                    <p className="text-xs text-muted">{t('super.label_member_since')}</p>
                    <p className="text-sm text-foreground">{formatDate(user.created_at, t('super.never'))}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock aria-hidden="true" size={16} className="text-muted shrink-0" />
                  <div>
                    <p className="text-xs text-muted">{t('super.label_last_login')}</p>
                    <p className="text-sm text-foreground">{formatDate(user.last_login_at, t('super.never'))}</p>
                  </div>
                </div>
                {user.balance !== undefined && (
                  <div className="flex items-center gap-3">
                    <Wallet aria-hidden="true" size={16} className="text-muted shrink-0" />
                    <div>
                      <p className="text-xs text-muted">{t('super.label_time_balance')}</p>
                      <p className="text-sm font-medium text-foreground">{user.balance} {t('super.hours')}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Tenant Association */}
          <Card>
            <CardHeader className="font-semibold text-lg flex items-center gap-2">
              <Building2 aria-hidden="true" size={18} />
              {t('super.tenant_association')}
            </CardHeader>
            <Separator />
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-xs text-muted">{t('super.label_current_tenant')}</p>
                  <Link
                    to={tenantPath(`/super-admin/tenants/${user.tenant_id}`)}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {user.tenant_name || t('super.tenant_with_id', { id: user.tenant_id })}
                  </Link>
                </div>
                <div>
                  <p className="text-xs text-muted">{t('super.label_tenant_id')}</p>
                  <p className="text-sm text-foreground">{user.tenant_id}</p>
                </div>
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <Button
                  variant="secondary"
                  startContent={<ArrowRightLeft aria-hidden="true" size={16} />}
                  onPress={() => setMoveModalOpen(true)}
                >
                  {t('super.move_to_different_tenant')}
                </Button>
                <Button
                  variant="secondary"
                  startContent={<Crown aria-hidden="true" size={16} />}
                  onPress={() => setPromoteModalOpen(true)}
                >
                  {t('super.move_and_promote_to_hub')}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Right column - 1/3 width */}
        <div className="flex flex-col gap-6">
          {/* GOD-Level Super Admin Actions */}
          <Card className="bg-gradient-to-br from-accent/10 to-pink-500/10 border-2 border-accent/30">
            <CardHeader className="font-semibold text-lg flex items-center gap-2">
              <ShieldAlert aria-hidden="true" size={18} className="text-accent dark:text-accent" />
              <span className="bg-gradient-to-r from-accent to-pink-600 bg-clip-text text-transparent">
                {t('super.god_level_access')}
              </span>
            </CardHeader>
            <Separator className="bg-accent/20" />
            <CardBody className="flex flex-col gap-3">
              <p className="text-xs text-muted">
                {t('super.god_level_desc')}
              </p>
              {user.is_super_admin ? (
                <Button
                  variant="danger-soft"
                  className="bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-500/30"
                  startContent={<ShieldOff aria-hidden="true" size={16} />}
                  onPress={() => setConfirmAction('revoke-global')}
                >
                  <span className="bg-gradient-to-r from-red-600 to-pink-600 bg-clip-text text-transparent font-medium">
                    {t('super.revoke_global_sa')}
                  </span>
                </Button>
              ) : (
                <div>
                  <Button
                    variant="secondary"
                    className="bg-gradient-to-r from-accent/20 to-pink-500/20 border-2 border-accent/50 w-full"
                    startContent={<ShieldAlert aria-hidden="true" size={16} />}
                    onPress={() => setConfirmAction('grant-global')}
                  >
                    <span className="bg-gradient-to-r from-accent to-pink-600 bg-clip-text text-transparent font-semibold">
                      {t('super.grant_global_sa')}
                    </span>
                  </Button>
                  <p className="text-[10px] text-accent dark:text-accent mt-2 text-center font-medium">
                    {t('super.god_level_caution')}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Tenant Super Admin Toggle */}
          <Card>
            <CardHeader className="font-semibold text-lg flex items-center gap-2">
              <Shield aria-hidden="true" size={18} />
              {t('super.tenant_super_admin')}
            </CardHeader>
            <Separator />
            <CardBody className="flex flex-col gap-3">
              <p className="text-xs text-muted">
                {t('super.tenant_sa_desc')}
              </p>
              {user.is_tenant_super_admin ? (
                <Button
                  variant="secondary"
                  className="text-warning"
                  startContent={<ShieldOff aria-hidden="true" size={16} />}
                  onPress={() => setConfirmAction('revoke-sa')}
                >
                  {t('super.revoke_tenant_sa')}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  startContent={<Shield aria-hidden="true" size={16} />}
                  onPress={() => setConfirmAction('grant-sa')}
                >
                  {t('super.grant_tenant_sa')}
                </Button>
              )}
            </CardBody>
          </Card>

          {/* Privilege Level */}
          <Card>
            <CardHeader className="font-semibold text-lg">{t('super.privilege_level')}</CardHeader>
            <Separator />
            <CardBody>
              <div className="flex flex-col items-center gap-3 py-2">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                  privilege.level === 4 ? 'bg-gradient-to-br from-accent/20 to-pink-500/20' :
                  privilege.level === 3 ? 'bg-accent-soft' :
                  privilege.level === 2 ? 'bg-accent/10' :
                  'bg-surface-tertiary'
                }`}>
                  {privilege.level >= 3 ? (
                    <CrownIcon aria-hidden="true" size={28} className={
                      privilege.level === 4 ? 'text-accent' : 'text-accent'
                    } />
                  ) : (
                    <Shield aria-hidden="true" size={28} className={
                      privilege.level === 2 ? 'text-accent' : 'text-muted'
                    } />
                  )}
                </div>
                <Chip size="lg" variant="soft" color={privilege.color}>
                  {t(privilege.labelKey)}
                </Chip>
                {/* Privilege bar */}
                <div className="w-full flex gap-1 mt-1">
                  {[1, 2, 3, 4].map(level => (
                    <div
                      key={level}
                      className={`h-2 flex-1 rounded-full ${
                        level <= privilege.level
                          ? privilege.level === 4 ? 'bg-gradient-to-r from-accent to-pink-500'
                            : privilege.level === 3 ? 'bg-muted'
                            : privilege.level === 2 ? 'bg-accent'
                            : 'bg-muted/50'
                          : 'bg-surface-tertiary'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex justify-between w-full text-[10px] text-muted">
                  <span>{t('super.privilege_member_short')}</span>
                  <span>{t('super.privilege_admin_short')}</span>
                  <span>{t('super.privilege_tsa_short')}</span>
                  <span>{t('super.privilege_gsa_short')}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="font-semibold text-lg">{t('super.quick_actions')}</CardHeader>
            <Separator />
            <CardBody>
              <div className="flex flex-col gap-2">
                <Button
                  variant="primary"
                  startContent={<Edit aria-hidden="true" size={16} />}
                  fullWidth
                  onPress={() => navigate(tenantPath(`/super-admin/users/${user.id}/edit`))}
                >
                  {t('super.edit_user')}
                </Button>
                {canImpersonate && (
                  <Button
                    variant="secondary"
                    className="text-warning"
                    startContent={<UserCog aria-hidden="true" size={16} />}
                    fullWidth
                    onPress={() => setImpersonateModalOpen(true)}
                  >
                    {t('super.impersonate_user')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  startContent={<ArrowLeft aria-hidden="true" size={16} />}
                  fullWidth
                  onPress={() => navigate(tenantPath('/super-admin/users'))}
                >
                  {t('super.back_to_users')}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Confirm Action Modal */}
      {confirmAction && (
        <ConfirmModal
          isOpen={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={handleConfirmAction}
          title={confirmMessages[confirmAction].title}
          message={confirmMessages[confirmAction].message}
          confirmLabel={confirmMessages[confirmAction].label}
          confirmColor={confirmMessages[confirmAction].color}
          isLoading={actionLoading}
        />
      )}

      {/* Move to Tenant Modal */}
      <Modal isOpen={moveModalOpen} onClose={() => { setMoveModalOpen(false); setMoveTargetTenant(''); }} size="md">
        <ModalContent>
          <ModalHeader>{t('super.move_user_to_tenant_title')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted mb-3">
              {t('super.move_user_to_tenant_desc')}
            </p>

            <Select
              variant="secondary"
              label={t('super.target_tenant')}
              placeholder={t('super.select_tenant')}
              selectedKeys={moveTargetTenant ? [moveTargetTenant] : []}
              onSelectionChange={(keys) => setMoveTargetTenant(String(Array.from(keys)[0] || ''))}
            >
              {tenants
                .filter(t => t.id !== user.tenant_id)
                .map(t => <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>)}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => { setMoveModalOpen(false); setMoveTargetTenant(''); }} isDisabled={moveLoading}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onPress={handleMoveTenant}
              isLoading={moveLoading}
              isDisabled={!moveTargetTenant}
            >
              {t('super.move_user')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Impersonation Modal */}
      <Modal
        isOpen={impersonateModalOpen}
        onClose={() => setImpersonateModalOpen(false)}
        size="md"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <UserCog aria-hidden="true" size={20} className="text-warning" />
            {t('super.impersonate_user_title')}
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted">
              {t('super.impersonate_user_desc', {
                name: user.name,
              })}
            </p>
            <div className="bg-warning-50 dark:bg-warning-50/10 border border-warning-200 dark:border-warning-200/20 rounded-lg p-3 mt-3">
              <p className="text-xs text-warning-700 dark:text-warning-400">
                {t('super.impersonate_user_warning')}
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={() => setImpersonateModalOpen(false)}
              isDisabled={impersonateLoading}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              className="text-warning"
              onPress={handleImpersonate}
              isLoading={impersonateLoading}
              startContent={<UserCog aria-hidden="true" size={16} />}
            >
              {t('super.impersonate_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Move and Promote Modal */}
      <Modal isOpen={promoteModalOpen} onClose={() => { setPromoteModalOpen(false); setPromoteTargetTenant(''); }} size="md">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Crown aria-hidden="true" size={20} className="text-accent" />
            {t('super.move_and_promote')}
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted mb-3">
              {t('super.move_and_promote_desc')}
            </p>
            <div className="bg-warning-50 dark:bg-warning-50/10 border border-warning-200 dark:border-warning-200/20 rounded-lg p-3 mb-3">
              <p className="text-xs text-warning-700 dark:text-warning-400">
                {t('super.move_and_promote_warning')}
              </p>
            </div>
            <Select
              variant="secondary"
              label={t('super.target_hub_tenant')}
              placeholder={t('super.select_hub_tenant')}
              selectedKeys={promoteTargetTenant ? [promoteTargetTenant] : []}
              onSelectionChange={(keys) => setPromoteTargetTenant(String(Array.from(keys)[0] || ''))}
            >
              {hubTenants
                .filter(t => t.id !== user.tenant_id)
                .map(t => <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>)}
            </Select>
            {hubTenants.filter(t => t.id !== user.tenant_id).length === 0 && (
              <p className="text-xs text-muted mt-1">{t('super.no_hub_tenants_found')}</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => { setPromoteModalOpen(false); setPromoteTargetTenant(''); }} isDisabled={promoteLoading}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              onPress={handleMoveAndPromote}
              isLoading={promoteLoading}
              isDisabled={!promoteTargetTenant}
            >
              {t('super.move_and_promote')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default UserShow;
