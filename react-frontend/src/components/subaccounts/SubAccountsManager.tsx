import { useDisclosure, Button, Chip, Spinner, Input, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter, Avatar, Switch, Select, SelectItem } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SubAccountsManager - manage delegated account relationships.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';

import Users from 'lucide-react/icons/users';
import Plus from 'lucide-react/icons/plus';
import UserPlus from 'lucide-react/icons/user-plus';
import Shield from 'lucide-react/icons/shield';
import Trash2 from 'lucide-react/icons/trash-2';
import Mail from 'lucide-react/icons/mail';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';
import { SupportPrepareModal, type PrepareActionType } from './SupportPrepareModal';
import { SupportActivityModal } from './SupportActivityModal';

type RelationshipStatus = 'active' | 'pending' | 'revoked' | 'rejected';
type PermissionKey = 'can_view_activity' | 'can_manage_listings' | 'can_transact' | 'can_view_messages';

/**
 * Support tiers (guardian redesign): per-capability levels mirroring the
 * Assisted Decision-Making (Capacity) Act 2015. The backend authority is
 * App\Support\Safeguarding\SupportTiers — the derivation in parseTiers()
 * below MUST match its resolve() (tiers object wins, legacy booleans are the
 * floor, corrupted values degrade to less power).
 */
type SupportTier = 'none' | 'assist' | 'co_decide' | 'represent';
type TierCapability = 'activity' | 'listings' | 'credits';

/** The tiers a member can grant for listings/credits. `assist` is not offered
 *  here: there is no draft-only UI yet, so offering "see only" for listings
 *  would present a state that does nothing (rule: never show what does not
 *  work). */
const GRANTABLE_ACTION_TIERS: SupportTier[] = ['none', 'co_decide', 'represent'];

interface AccountRelationshipRow {
  relationship_id: number;
  relationship_type: string;
  permissions:
    | (Partial<Record<PermissionKey, boolean>> & { tiers?: Partial<Record<TierCapability, SupportTier>> })
    | string
    | null;
  status: RelationshipStatus;
  approved_at?: string | null;
  created_at: string;
  user_id: number;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  email: string;
}

interface NormalizedRelationship extends Omit<AccountRelationshipRow, 'permissions'> {
  permissions: Record<PermissionKey, boolean>;
  tiers: Record<TierCapability, SupportTier>;
}

/**
 * The permissions actually OFFERED to members — i.e. the ones the backend
 * enforces.
 *
 * 🔴 `can_view_messages` is deliberately absent. It was rendered here as a
 * fourth switch, identical to the other three, labelled "View messages" — and
 * nothing in the backend ever checked it. `SubAccountService::hasPermission()`
 * is never consulted for it. So a family could switch it on, see it save, and
 * reasonably believe a carer could read a dependent's conversations, when no
 * such thing happened. In a safeguarding feature that is worse than the
 * capability being absent.
 *
 * Corroboration that it was never designed: the `account_relationships`
 * `permissions` column comment lists three keys — can_view_activity,
 * can_manage_listings, can_transact. The fourth reached the UI and never the
 * schema.
 *
 * It is NOT simply "unbuilt". Letting a carer read a dependent's messages
 * exposes the OTHER party to that conversation, who never agreed to it. The
 * platform's established answer for oversight is to notify — see
 * BrokerMessageVisibilityService::getUserRestrictionStatus()'s
 * `review_notice_required`. Until that notice exists for carers, do not offer
 * this, and do not re-add it to this list to "match the type".
 *
 * The key stays in PermissionKey and DEFAULT_PERMISSIONS so historical rows
 * that already stored it still parse.
 */
const PERMISSION_KEYS: PermissionKey[] = [
  'can_view_activity',
  'can_manage_listings',
  'can_transact',
];

const DEFAULT_PERMISSIONS: Record<PermissionKey, boolean> = {
  can_view_activity: true,
  can_manage_listings: false,
  can_transact: false,
  can_view_messages: false,
};

function parsePermissions(
  permissions: AccountRelationshipRow['permissions'],
): Record<PermissionKey, boolean> {
  let parsed = permissions;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as Partial<Record<PermissionKey, boolean>>;
    } catch {
      parsed = null;
    }
  }

  return PERMISSION_KEYS.reduce<Record<PermissionKey, boolean>>((acc, key) => {
    acc[key] = Boolean((parsed as Partial<Record<PermissionKey, boolean>> | null)?.[key] ?? DEFAULT_PERMISSIONS[key]);
    return acc;
  }, { ...DEFAULT_PERMISSIONS });
}

const TIER_RANK: Record<SupportTier, number> = { none: 0, assist: 1, co_decide: 2, represent: 3 };

function isSupportTier(value: unknown): value is SupportTier {
  return typeof value === 'string' && value in TIER_RANK;
}

/**
 * Mirror of the backend's SupportTiers::resolve(): explicit tiers win per
 * capability, legacy booleans are the floor, anything unrecognised degrades
 * toward LESS power.
 */
function parseTiers(permissions: AccountRelationshipRow['permissions']): Record<TierCapability, SupportTier> {
  let parsed = permissions;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as Exclude<AccountRelationshipRow['permissions'], string>;
    } catch {
      parsed = null;
    }
  }

  const resolved: Record<TierCapability, SupportTier> = {
    activity: parsed && !Array.isArray(parsed) && parsed.can_view_activity ? 'assist' : 'none',
    listings: parsed && !Array.isArray(parsed) && parsed.can_manage_listings ? 'represent' : 'none',
    credits: parsed && !Array.isArray(parsed) && parsed.can_transact ? 'represent' : 'none',
  };

  const tiers = parsed && !Array.isArray(parsed) ? parsed.tiers : undefined;
  if (tiers && typeof tiers === 'object') {
    for (const capability of ['activity', 'listings', 'credits'] as TierCapability[]) {
      const value = tiers[capability];
      if (isSupportTier(value)) resolved[capability] = value;
    }
  }

  return resolved;
}

function normalizeRelationship(row: AccountRelationshipRow): NormalizedRelationship {
  return {
    ...row,
    permissions: parsePermissions(row.permissions),
    tiers: parseTiers(row.permissions),
  };
}

function getDisplayName(account: NormalizedRelationship, unknownLabel: string): string {
  const name = [account.first_name, account.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');

  return name || account.email || unknownLabel;
}

export function SubAccountsManager() {
  const toast = useToast();
  const { t } = useTranslation('settings');
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [managedAccounts, setManagedAccounts] = useState<NormalizedRelationship[]>([]);
  const [managerAccounts, setManagerAccounts] = useState<NormalizedRelationship[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [busyRelationshipId, setBusyRelationshipId] = useState<number | null>(null);
  // Prepare-on-behalf modal (guardian redesign phase 4): which action, for
  // whom, and at which tier the supporter holds the capability.
  const [preparing, setPreparing] = useState<{
    actionType: PrepareActionType;
    supportedUserId: number;
    supportedName: string;
    tier: 'co_decide' | 'represent';
  } | null>(null);
  // Read-only activity view — the `assist` tier's one capability. Kept apart
  // from `preparing`: seeing and doing are different tiers by design.
  const [viewingActivity, setViewingActivity] = useState<{
    supportedUserId: number;
    supportedName: string;
  } | null>(null);

  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadSubAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [childrenResponse, parentsResponse] = await Promise.all([
        api.get<AccountRelationshipRow[]>('/v2/users/me/sub-accounts'),
        api.get<AccountRelationshipRow[]>('/v2/users/me/parent-accounts'),
      ]);

      if (!childrenResponse.success || !parentsResponse.success) {
        setError(tRef.current('sub_accounts.load_failed'));
        return;
      }

      setManagedAccounts((childrenResponse.data ?? []).map(normalizeRelationship));
      setManagerAccounts((parentsResponse.data ?? []).map(normalizeRelationship));
    } catch (err) {
      logError('Failed to load sub-accounts', err);
      setError(tRef.current('sub_accounts.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubAccounts();
  }, [loadSubAccounts]);

  const handleAdd = async () => {
    const email = addEmail.trim();
    if (!email) {
      toastRef.current.error(tRef.current('toasts.subaccount_enter_email'));
      return;
    }

    try {
      setIsAdding(true);
      const response = await api.post('/v2/users/me/sub-accounts', { email });

      if (response.success) {
        toastRef.current.success(tRef.current('toasts.subaccount_request_sent'));
        setAddEmail('');
        onClose();
        await loadSubAccounts();
      } else {
        toastRef.current.error(response.error || tRef.current('sub_accounts.add_failed'));
      }
    } catch (err) {
      logError('Failed to add sub-account', err);
      toastRef.current.error(tRef.current('toasts.subaccount_send_failed'));
    } finally {
      setIsAdding(false);
    }
  };

  const handlePermissionChange = async (
    relationshipId: number,
    permission: PermissionKey,
    value: boolean,
  ) => {
    const previousAccounts = managedAccounts;

    setManagedAccounts((prev) =>
      prev.map((account) =>
        account.relationship_id === relationshipId
          ? { ...account, permissions: { ...account.permissions, [permission]: value } }
          : account,
      ),
    );

    try {
      const response = await api.put(`/v2/users/me/sub-accounts/${relationshipId}/permissions`, {
        permissions: { [permission]: value },
      });

      if (!response.success) {
        setManagedAccounts(previousAccounts);
        toastRef.current.error(response.error || tRef.current('toasts.subaccount_permission_failed'));
      }
    } catch (err) {
      setManagedAccounts(previousAccounts);
      logError('Failed to update permission', err);
      toastRef.current.error(tRef.current('toasts.subaccount_permission_failed'));
    }
  };

  /**
   * Change one capability's support tier. Sends the explicit `tiers` object —
   * the endpoint keeps the legacy booleans in sync server-side, so no boolean
   * needs to travel with it. Raising a tier re-triggers the safeguarding
   * contact re-check on the backend; a refusal arrives as an error here and
   * the optimistic update is rolled back.
   */
  const handleTierChange = async (
    relationshipId: number,
    capability: TierCapability,
    tier: SupportTier,
  ) => {
    const previousAccounts = managedAccounts;

    setManagedAccounts((prev) =>
      prev.map((account) =>
        account.relationship_id === relationshipId
          ? { ...account, tiers: { ...account.tiers, [capability]: tier } }
          : account,
      ),
    );

    try {
      const response = await api.put(`/v2/users/me/sub-accounts/${relationshipId}/permissions`, {
        permissions: { tiers: { [capability]: tier } },
      });

      if (!response.success) {
        setManagedAccounts(previousAccounts);
        toastRef.current.error(response.error || tRef.current('toasts.subaccount_permission_failed'));
      }
    } catch (err) {
      setManagedAccounts(previousAccounts);
      logError('Failed to update support tier', err);
      toastRef.current.error(tRef.current('toasts.subaccount_permission_failed'));
    }
  };

  const handleRemove = async (relationshipId: number) => {
    try {
      setBusyRelationshipId(relationshipId);
      const response = await api.delete(`/v2/users/me/sub-accounts/${relationshipId}`);

      if (response.success) {
        toastRef.current.success(tRef.current('toasts.subaccount_removed'));
        setManagedAccounts((prev) => prev.filter((account) => account.relationship_id !== relationshipId));
        setManagerAccounts((prev) => prev.filter((account) => account.relationship_id !== relationshipId));
      } else {
        toastRef.current.error(response.error || tRef.current('sub_accounts.remove_failed'));
      }
    } catch (err) {
      logError('Failed to remove sub-account relationship', err);
      toastRef.current.error(tRef.current('toasts.subaccount_remove_failed'));
    } finally {
      setBusyRelationshipId(null);
    }
  };

  const handleApprove = async (relationshipId: number) => {
    try {
      setBusyRelationshipId(relationshipId);
      const response = await api.put(`/v2/users/me/sub-accounts/${relationshipId}/approve`);

      if (response.success) {
        toastRef.current.success(tRef.current('toasts.subaccount_approved'));
        await loadSubAccounts();
      } else {
        toastRef.current.error(response.error || tRef.current('sub_accounts.approve_failed'));
      }
    } catch (err) {
      logError('Failed to approve sub-account relationship', err);
      toastRef.current.error(tRef.current('toasts.subaccount_approve_failed'));
    } finally {
      setBusyRelationshipId(null);
    }
  };

  const statusConfig: Record<RelationshipStatus, { label: string; color: 'success' | 'warning' | 'danger' | 'default'; icon: ReactNode }> = {
    active: { label: t('sub_accounts.status_active'), color: 'success', icon: <CheckCircle className="w-3 h-3" /> },
    pending: { label: t('sub_accounts.status_pending'), color: 'warning', icon: <Clock className="w-3 h-3" /> },
    revoked: { label: t('sub_accounts.status_revoked'), color: 'default', icon: <AlertTriangle className="w-3 h-3" /> },
    rejected: { label: t('sub_accounts.status_rejected'), color: 'danger', icon: <AlertTriangle className="w-3 h-3" /> },
  };

  const renderRelationshipCard = (
    account: NormalizedRelationship,
    options: { canManagePermissions: boolean; canApprove: boolean; pendingMessageKey: string },
  ) => {
    const name = getDisplayName(account, t('sub_accounts.unknown_member'));
    const status = statusConfig[account.status] ?? {
      label: t('sub_accounts.status_unknown'),
      color: 'default' as const,
      icon: <AlertTriangle className="w-3 h-3" />,
    };
    const isBusy = busyRelationshipId === account.relationship_id;

    return (
      <div
        key={account.relationship_id}
        className="rounded-lg border border-theme-default bg-theme-elevated/60 p-4"
      >
        <div className="flex items-start gap-4">
          <Avatar
            src={resolveAvatarUrl(account.avatar_url)}
            name={name}
            size="md"
            className="ring-2 ring-theme-muted/20 flex-shrink-0"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-medium text-theme-primary">{name}</h4>
              <Chip size="sm" variant="flat" color={status.color} startContent={status.icon}>
                {status.label}
              </Chip>
            </div>
            <p className="text-xs text-theme-subtle break-all">{account.email}</p>

            {options.canManagePermissions && account.status === 'active' && (
              <div className="mt-4 space-y-3">
                <p className="text-xs font-medium text-theme-muted flex items-center gap-1">
                  <Shield className="w-3 h-3" aria-hidden="true" />
                  {t('sub_accounts.permissions_label')}
                </p>
                {/*
                  Three-tier support model (guardian redesign). Activity is a
                  simple see/don't-see switch. Listings and credits offer three
                  levels: Off, "Prepare only" (co_decide — the supporter
                  prepares, THIS member approves each one before it happens),
                  and "Act alone" (represent — fully logged and attributed).
                  The old on/off switches mapped to Off/Act alone only; the
                  middle level is the Act's co-decision-maker arrangement and
                  the right default for most families.
                */}
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <span className="text-xs text-theme-muted">{t('sub_accounts.permissions.can_view_activity')}</span>
                  <Switch
                    size="sm"
                    className="shrink-0"
                    isSelected={account.tiers.activity !== 'none'}
                    onValueChange={(value) =>
                      handlePermissionChange(account.relationship_id, 'can_view_activity', value)
                    }
                    aria-label={t('sub_accounts.permission_aria', { permission: t('sub_accounts.permissions.can_view_activity'), name })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['listings', 'credits'] as const).map((capability) => {
                    const label = t(`sub_accounts.tiers.capability_${capability}`);
                    return (
                      <Select
                        key={capability}
                        size="sm"
                        label={label}
                        selectedKeys={[account.tiers[capability]]}
                        onSelectionChange={(keys) => {
                          const value = Array.from(keys)[0] as string | undefined;
                          if (isSupportTier(value) && value !== account.tiers[capability]) {
                            handleTierChange(account.relationship_id, capability, value);
                          }
                        }}
                        aria-label={t('sub_accounts.tiers.tier_aria', { capability: label, name })}
                      >
                        {GRANTABLE_ACTION_TIERS.map((tier) => (
                          <SelectItem key={tier} id={tier}>
                            {t(`sub_accounts.tiers.option_${tier}`)}
                          </SelectItem>
                        ))}
                      </Select>
                    );
                  })}
                </div>
                <p className="text-xs text-theme-muted">
                  {t('sub_accounts.tiers.co_decide_explainer')}
                </p>
                {/*
                  Acting on the grant. Offered only when a tier actually
                  permits it — co_decide prepares (the member approves each
                  one), represent acts immediately. The modal states which
                  before any field is filled in.
                */}
                {account.tiers.activity !== 'none' || (account.tiers.listings !== 'none' && account.tiers.listings !== 'assist') || (account.tiers.credits !== 'none' && account.tiers.credits !== 'assist') ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {account.tiers.activity !== 'none' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => setViewingActivity({
                          supportedUserId: account.user_id,
                          supportedName: name,
                        })}
                      >
                        {t('support_activity.view_button')}
                      </Button>
                    )}
                    {account.tiers.listings !== 'none' && account.tiers.listings !== 'assist' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => setPreparing({
                          actionType: 'listing_create',
                          supportedUserId: account.user_id,
                          supportedName: name,
                          tier: account.tiers.listings as 'co_decide' | 'represent',
                        })}
                      >
                        {t('support_actions.prepare_listing_button')}
                      </Button>
                    )}
                    {account.tiers.credits !== 'none' && account.tiers.credits !== 'assist' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => setPreparing({
                          actionType: 'credit_transfer',
                          supportedUserId: account.user_id,
                          supportedName: name,
                          tier: account.tiers.credits as 'co_decide' | 'represent',
                        })}
                      >
                        {t('support_actions.prepare_transfer_button')}
                      </Button>
                    )}
                  </div>
                ) : null}
                {/*
                  Stated explicitly rather than left as an absence. A family that
                  previously switched "View messages" on needs to know it never
                  did anything and is not being offered — silently dropping the
                  control would leave them believing it was still in force.
                */}
                <p className="text-xs text-theme-muted">
                  {t('sub_accounts.messages_not_offered')}
                </p>
              </div>
            )}

            {account.status === 'pending' && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {options.canApprove ? (
                  <>
                    <Button
                      size="sm"
                      color="success"
                      variant="flat"
                      isLoading={isBusy}
                      onPress={() => handleApprove(account.relationship_id)}
                    >
                      {t('sub_accounts.approve')}
                    </Button>
                    <Button
                      size="sm"
                      color="danger"
                      variant="flat"
                      isDisabled={isBusy}
                      onPress={() => handleRemove(account.relationship_id)}
                    >
                      {t('sub_accounts.decline')}
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-theme-muted">
                    {t(options.pendingMessageKey)}
                  </p>
                )}
              </div>
            )}
          </div>

          <Button
            isIconOnly
            size="sm"
            variant="light"
            color="danger"
            isLoading={isBusy && account.status !== 'pending'}
            onPress={() => handleRemove(account.relationship_id)}
            aria-label={t('sub_accounts.remove_aria', { name })}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  };

  const renderSection = (
    titleKey: string,
    descriptionKey: string,
    emptyKey: string,
    accounts: NormalizedRelationship[],
    options: { canManagePermissions: boolean; canApprove: boolean; pendingMessageKey: string },
  ) => (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-theme-primary">{t(titleKey)}</h4>
        <p className="text-xs text-theme-muted">{t(descriptionKey)}</p>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-theme-default p-4 text-sm text-theme-muted">
          {t(emptyKey)}
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => renderRelationshipCard(account, options))}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="w-5 h-5 text-accent" aria-hidden="true" />
          <h3 className="font-semibold text-theme-primary">{t('sub_accounts.title')}</h3>
        </div>
        <Button
          size="sm"
          variant="flat"
          className="shrink-0 bg-accent/10 text-accent dark:text-accent"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          onPress={onOpen}
        >
          {t('sub_accounts.add_button')}
        </Button>
      </div>

      <p className="text-sm text-theme-subtle">{t('sub_accounts.description')}</p>

      {/*
        🔴 Disambiguation, not decoration. A link created here can be typed
        "guardian", and coordinators separately record "guardian arrangements" in
        safeguarding_assignments — two unrelated systems that share a word, with
        no foreign key and no file in the codebase touching both. Without this
        note a member cannot tell which one they are looking at, and the two carry
        completely different consequences: a link here can grant real abilities,
        while a safeguarding arrangement grants none.
      */}
      <p className="text-xs text-theme-muted">{t('sub_accounts.scope_note')}</p>

      {isLoading && (
        <div className="flex justify-center py-8" role="status" aria-busy="true" aria-label={t('common:loading')}>
          <Spinner size="lg" />
        </div>
      )}

      {error && !isLoading && (
        <div role="alert" className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-[var(--color-warning)] mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-theme-muted mb-3">{error}</p>
          <Button
            size="sm"
            variant="flat"
            startContent={<RefreshCw className="w-3 h-3" aria-hidden="true" />}
            onPress={loadSubAccounts}
          >
            {t('sub_accounts.retry')}
          </Button>
        </div>
      )}

      {!isLoading && !error && managedAccounts.length === 0 && managerAccounts.length === 0 ? (
        <EmptyState
          icon={<UserPlus className="w-10 h-10" aria-hidden="true" />}
          title={t('sub_accounts.empty_title')}
          description={t('sub_accounts.empty_description')}
          action={
            <Button
              variant="flat"
              className="bg-accent/10 text-accent dark:text-accent"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={onOpen}
            >
              {t('sub_accounts.add_button')}
            </Button>
          }
        />
      ) : null}

      {!isLoading && !error && (managedAccounts.length > 0 || managerAccounts.length > 0) && (
        <div className="space-y-6">
          {renderSection(
            'sub_accounts.managed_title',
            'sub_accounts.managed_description',
            'sub_accounts.managed_empty',
            managedAccounts,
            {
              canManagePermissions: true,
              canApprove: false,
              pendingMessageKey: 'sub_accounts.pending_member_approval',
            },
          )}

          {renderSection(
            'sub_accounts.managers_title',
            'sub_accounts.managers_description',
            'sub_accounts.managers_empty',
            managerAccounts,
            {
              canManagePermissions: false,
              canApprove: true,
              pendingMessageKey: 'sub_accounts.pending_your_approval',
            },
          )}
        </div>
      )}

      <Modal
        isOpen={isOpen}
        onClose={onClose}
        classNames={{
          base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)]',
          backdrop: 'bg-black/60 backdrop-blur-sm',
        }}
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-3 text-theme-primary">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-accent" aria-hidden="true" />
            </div>
            <ModalHeading>{t('sub_accounts.modal_title')}</ModalHeading>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-theme-muted mb-3">
              {t('sub_accounts.modal_description')}
            </p>
            <Input
              label={t('sub_accounts.email_label')}
              placeholder={t('sub_accounts.email_placeholder')}
              value={addEmail}
              onChange={(event) => setAddEmail(event.target.value)}
              type="email"
              startContent={<Mail className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose} className="text-theme-muted">
              {t('sub_accounts.cancel')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              onPress={handleAdd}
              isLoading={isAdding}
              isDisabled={!addEmail.trim()}
            >
              {t('sub_accounts.send_request')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {preparing && (
        <SupportPrepareModal
          isOpen
          onOpenChange={(open) => { if (!open) setPreparing(null); }}
          actionType={preparing.actionType}
          supportedUserId={preparing.supportedUserId}
          supportedName={preparing.supportedName}
          tier={preparing.tier}
        />
      )}

      {viewingActivity && (
        <SupportActivityModal
          isOpen
          onOpenChange={(open) => { if (!open) setViewingActivity(null); }}
          supportedUserId={viewingActivity.supportedUserId}
          supportedName={viewingActivity.supportedName}
        />
      )}
    </div>
  );
}

export default SubAccountsManager;
