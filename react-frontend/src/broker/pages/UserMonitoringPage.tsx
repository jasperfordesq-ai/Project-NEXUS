// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * User Monitoring
 * View users currently under messaging monitoring restrictions.
 * Parity: PHP BrokerControlsController::monitoring()
 *
 * Restyled to the broker design language: BrokerPageShell frame, KPI header
 * derived from the loaded list (total / messaging disabled / expiring soon),
 * avatar member cells, readable reason column, expiry countdown chips, and
 * honest skeleton / empty / error states. The add/edit/remove modals — and
 * the expiry-preservation logic on edit — are unchanged.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Select,
  SelectItem,
  Button,
  Spinner,
  Input,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Avatar,
  Switch,
  Chip,
} from '@/components/ui';
import Eye from 'lucide-react/icons/eye';
import MessageCircleOff from 'lucide-react/icons/message-circle-off';
import UserPlus from 'lucide-react/icons/user-plus';
import UserMinus from 'lucide-react/icons/user-minus';
import Pencil from 'lucide-react/icons/pencil';
import X from 'lucide-react/icons/x';
import Search from 'lucide-react/icons/search';
import Clock from 'lucide-react/icons/clock';
import ShieldCheck from 'lucide-react/icons/shield-check';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { parseServerTimestamp, formatServerDate } from '@/lib/serverTime';
import { adminBroker, adminUsers } from '@/admin/api/adminApi';
import { DataTable, ConfirmModal, type Column } from '@/admin/components';
import type { MonitoredUser, AdminUser } from '@/admin/api/types';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
} from '../components';

// Duration options offered by the modal's Select (in days). Prefilling the
// Select on edit only reflects a record whose remaining days match one of these.
const DURATION_OPTIONS = ['7', '14', '30', '60', '90'];

const DAY_MS = 86_400_000;
const EXPIRING_SOON_DAYS = 7;

// Countdown state for an expiry timestamp — one source of truth shared by the
// KPI header and the row chips so "expiring soon" always means the same thing.
function expiryState(expiresAt: Date): { days: number; state: 'expired' | 'soon' | 'ok' } {
  if (expiresAt.getTime() <= Date.now()) {
    return { days: 0, state: 'expired' };
  }
  const days = Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS);
  return { days, state: days <= EXPIRING_SOON_DAYS ? 'soon' : 'ok' };
}

export function UserMonitoring() {
  const { t } = useTranslation('broker');
  usePageTitle(t('monitoring.title'));
  const toast = useToast();

  const [items, setItems] = useState<MonitoredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Add to monitoring modal state
  const [monitoringModalOpen, setMonitoringModalOpen] = useState(false);
  const [monitoringReason, setMonitoringReason] = useState('');
  const [messagingDisabled, setMessagingDisabled] = useState(false);
  const [expiresDays, setExpiresDays] = useState('');
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<number | null>(null);

  // Edit state — when set, the modal edits an existing monitoring record rather
  // than adding a new one. `setMonitoring` upserts server-side, so an edit is
  // the same call with the existing user_id. originalExpiresDays preserves the
  // record's remaining expiry when the broker doesn't pick a new duration.
  const [editingItem, setEditingItem] = useState<MonitoredUser | null>(null);
  const [originalExpiresDays, setOriginalExpiresDays] = useState<number | null>(null);

  // User search state
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<AdminUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Stash the latest `t` and `toast` in refs so loadItems' identity is stable —
  // keying the fetch effect on them would refetch on every language switch.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getMonitoring();
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data);
      } else {
        // A malformed or failed response must not masquerade as "all clear".
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
      toastRef.current.error(tRef.current('monitoring.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Debounced user search
  const handleUserSearch = useCallback((query: string) => {
    setUserSearchQuery(query);
    setHighlightedIndex(-1);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query || query.length < 2) {
      setUserSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await adminUsers.list({ search: query, limit: 10 });
        if (res.success && res.data) {
          const results = Array.isArray(res.data) ? res.data : (res.data as { items?: AdminUser[] }).items ?? [];
          setUserSearchResults(results);
          setShowDropdown(results.length > 0);
        }
      } catch {
        setUserSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showDropdown || userSearchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, userSearchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      const user = userSearchResults[highlightedIndex];
      if (user) {
        setSelectedUser(user);
        setShowDropdown(false);
        setUserSearchQuery('');
        setUserSearchResults([]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }, [showDropdown, userSearchResults, highlightedIndex]);

  const selectUser = useCallback((user: AdminUser) => {
    setSelectedUser(user);
    setShowDropdown(false);
    setUserSearchQuery('');
    setUserSearchResults([]);
  }, []);

  const clearSelectedUser = useCallback(() => {
    setSelectedUser(null);
    setUserSearchQuery('');
    setUserSearchResults([]);
    // Focus the search input after clearing
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const resetModalState = useCallback(() => {
    setMonitoringModalOpen(false);
    setSelectedUser(null);
    setEditingItem(null);
    setOriginalExpiresDays(null);
    setUserSearchQuery('');
    setUserSearchResults([]);
    setMonitoringReason('');
    setMessagingDisabled(false);
    setExpiresDays('');
    setShowDropdown(false);
    setHighlightedIndex(-1);
  }, []);

  const openEditModal = useCallback((item: MonitoredUser) => {
    setEditingItem(item);
    setMonitoringReason(item.monitoring_reason || '');
    setMessagingDisabled(!!item.messaging_disabled);
    const expiresAt = parseServerTimestamp(item.monitoring_expires_at);
    if (expiresAt) {
      const remaining = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000));
      setOriginalExpiresDays(remaining);
      // Only reflect it in the Select when it maps to a preset option.
      setExpiresDays(DURATION_OPTIONS.includes(String(remaining)) ? String(remaining) : '');
    } else {
      setOriginalExpiresDays(null);
      setExpiresDays('');
    }
    setMonitoringModalOpen(true);
  }, []);

  const handleSubmitMonitoring = async () => {
    const targetUserId = editingItem ? editingItem.user_id : selectedUser?.id;
    if (!targetUserId) {
      toast.error(t('monitoring.select_user_required'));
      return;
    }
    if (!monitoringReason.trim()) {
      toast.error(t('monitoring.reason_required'));
      return;
    }
    // On edit, if the broker didn't pick a preset duration, preserve the
    // record's existing remaining expiry (or leave it open if it had none) so
    // a reason-only edit never silently clears the expiry.
    const effectiveExpiresDays = expiresDays
      ? Number(expiresDays)
      : editingItem
        ? originalExpiresDays
        : null;
    setMonitoringLoading(true);
    try {
      const res = await adminBroker.setMonitoring(targetUserId, {
        under_monitoring: true,
        reason: monitoringReason,
        messaging_disabled: messagingDisabled,
        ...(effectiveExpiresDays ? { expires_days: effectiveExpiresDays } : {}),
      });
      if (res?.success) {
        toast.success(editingItem ? t('monitoring.edit_success') : t('monitoring.add_success'));
        resetModalState();
        loadItems();
      } else {
        toast.error(res?.error || t('monitoring.add_failed'));
      }
    } catch {
      toast.error(t('monitoring.add_failed'));
    } finally {
      setMonitoringLoading(false);
    }
  };

  const handleRemoveMonitoring = async (userId: number) => {
    setRemovingId(userId);
    try {
      const res = await adminBroker.setMonitoring(userId, { under_monitoring: false });
      if (res?.success) {
        toast.success(t('monitoring.remove_success'));
        loadItems();
      } else {
        toast.error(res?.error || t('monitoring.remove_failed'));
      }
    } catch {
      toast.error(t('monitoring.remove_failed'));
    } finally {
      setRemovingId(null);
    }
  };

  // ── KPI header — derived entirely from the already-loaded list ─────────────
  const initialLoading = loading && items.length === 0;
  const messagingDisabledCount = items.filter((i) => !!i.messaging_disabled).length;
  const expiringSoonCount = items.filter((i) => {
    const expiresAt = parseServerTimestamp(i.monitoring_expires_at);
    return !!expiresAt && expiryState(expiresAt).state === 'soon';
  }).length;

  const columns: Column<MonitoredUser>[] = [
    {
      key: 'user_name',
      label: t('monitoring.col_user'),
      sortable: true,
      render: (item) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={item.user_name} size="sm" className="shrink-0" />
          <p className="min-w-0 truncate text-sm font-medium text-foreground">{item.user_name}</p>
        </div>
      ),
    },
    {
      key: 'under_monitoring',
      label: t('monitoring.col_status'),
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          <Chip
            size="sm"
            variant="soft"
            color={item.under_monitoring ? 'warning' : 'default'}
          >
            <Eye size={12} aria-hidden="true" />
            <Chip.Label>{t('monitoring.status_monitored')}</Chip.Label>
          </Chip>
          {item.messaging_disabled && (
            <Chip
              size="sm"
              variant="soft"
              color="danger"
            >
              <MessageCircleOff size={12} aria-hidden="true" />
              <Chip.Label>{t('monitoring.status_messaging_off')}</Chip.Label>
            </Chip>
          )}
        </div>
      ),
    },
    {
      key: 'monitoring_reason',
      label: t('monitoring.col_reason'),
      render: (item) =>
        item.monitoring_reason ? (
          <p
            className="line-clamp-2 min-w-[12rem] max-w-md whitespace-normal break-words text-sm leading-5 text-foreground/80"
            title={item.monitoring_reason}
          >
            {item.monitoring_reason}
          </p>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
    },
    {
      key: 'monitoring_started_at',
      label: t('monitoring.col_started'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">
          {item.monitoring_started_at
            ? formatServerDate(item.monitoring_started_at)
            : '—'
          }
        </span>
      ),
    },
    {
      key: 'monitoring_expires_at',
      label: t('monitoring.col_expires'),
      sortable: true,
      render: (item) => {
        const expiresAt = parseServerTimestamp(item.monitoring_expires_at);
        if (!expiresAt) {
          return <span className="text-sm text-muted">{t('monitoring.no_expiry')}</span>;
        }
        const { days, state } = expiryState(expiresAt);
        return (
          <div className="flex min-w-[7rem] flex-col items-start gap-1">
            <Chip
              size="sm"
              variant="soft"
              color={state === 'expired' ? 'danger' : state === 'soon' ? 'warning' : 'default'}
              className="tabular-nums"
            >
              <Clock size={12} aria-hidden="true" />
              <Chip.Label>
                {state === 'expired'
                  ? t('status.expired')
                  : t('monitoring.expiry_days_left', { count: days })}
              </Chip.Label>
            </Chip>
            <span className="text-xs tabular-nums text-muted">
              {expiresAt.toLocaleDateString(getFormattingLocale())}
            </span>
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: t('monitoring.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => openEditModal(item)}
            aria-label={t('monitoring.edit_aria')}
          >
            <Pencil size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger-soft"
            onPress={() => setConfirmRemoveUserId(item.user_id)}
            isLoading={removingId === item.user_id}
            aria-label={t('monitoring.remove_aria')}
          >
            <UserMinus size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_user_monitoring' }}
      title={t('monitoring.page_title')}
      description={t('monitoring.page_description')}
      icon={Eye}
      color="warning"
      actions={
        <>
          <Button
            variant="primary"
            startContent={<UserPlus size={16} />}
            size="sm"
            onPress={() => setMonitoringModalOpen(true)}
          >
            {t('monitoring.add_button')}
          </Button>
        </>
      }
    >
      {loadError && items.length === 0 ? (
        // Honest failure state — a load error must never render as an
        // "all clear" queue.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('monitoring.load_error_title')}
          hint={t('monitoring.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={loadItems}>
              {t('monitoring.retry_button')}
            </Button>
          }
        />
      ) : (
        <>
          {/* KPI header — who is monitored, how tightly, and what lapses next */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <BrokerStatCard
              label={t('monitoring.stat_total')}
              value={items.length}
              icon={Eye}
              color="warning"
              loading={initialLoading}
            />
            <BrokerStatCard
              label={t('monitoring.status_messaging_off')}
              value={messagingDisabledCount}
              icon={MessageCircleOff}
              color="danger"
              loading={initialLoading}
            />
            <BrokerStatCard
              label={t('monitoring.stat_expiring_soon')}
              value={expiringSoonCount}
              icon={Clock}
              color="warning"
              loading={initialLoading}
            />
          </div>

          {initialLoading ? (
            <BrokerSkeleton variant="table" count={4} />
          ) : items.length === 0 ? (
            <BrokerEmptyState
              icon={ShieldCheck}
              color="success"
              title={t('monitoring.empty_all_clear_title')}
              hint={t('monitoring.empty_all_clear_hint')}
              action={
                <Button
                  size="sm"
                  variant="primary"
                  startContent={<UserPlus size={14} />}
                  onPress={() => setMonitoringModalOpen(true)}
                >
                  {t('monitoring.add_button')}
                </Button>
              }
            />
          ) : (
            <DataTable
              stickyActions
              mobileCards
              columns={columns}
              data={items}
              isLoading={loading}
              searchable={false}
              onRefresh={loadItems}
            />
          )}
        </>
      )}

      {/* Add to Monitoring Modal */}
      <Modal
        isOpen={monitoringModalOpen}
        onClose={resetModalState}
        size="md"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            {editingItem ? <Pencil size={20} className="text-accent" /> : <UserPlus size={20} className="text-accent" />}
            {editingItem ? t('monitoring.modal_edit_title') : t('monitoring.modal_title')}
          </ModalHeader>
          <ModalBody>
            {/* Member selection — locked when editing an existing record */}
            {editingItem ? (
              <div className="flex items-center gap-3 rounded-lg border border-divider bg-surface-secondary p-3">
                <Eye size={18} className="shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{editingItem.user_name}</p>
                  <p className="text-xs text-muted">{t('monitoring.member_label')}</p>
                </div>
              </div>
            ) : selectedUser ? (
              <div className="flex items-center gap-3 rounded-lg border border-divider p-3">
                <Avatar
                  src={resolveAvatarUrl(selectedUser.avatar_url ?? selectedUser.avatar) || undefined}
                  name={selectedUser.name}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{selectedUser.name}</p>
                  <p className="text-xs text-muted truncate">{selectedUser.email}</p>
                </div>
                <Chip size="sm" variant="tertiary" color={selectedUser.status === 'active' ? 'success' : 'default'}>
                  {t(`status.${selectedUser.status}`)}
                </Chip>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  onPress={clearSelectedUser}
                  aria-label={t('monitoring.clear_selection_aria')}
                >
                  <X size={14} />
                </Button>
              </div>
            ) : (
              <div ref={dropdownRef} className="relative">
                <Input
                  ref={inputRef}
                  label={t('monitoring.search_user_label')}
                  placeholder={t('monitoring.search_user_placeholder')}
                  variant="bordered"
                  isRequired
                  value={userSearchQuery}
                  onValueChange={handleUserSearch}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    if (userSearchResults.length > 0) setShowDropdown(true);
                  }}
                  startContent={<Search size={16} className="text-muted" />}
                  endContent={isSearching ? <Spinner size="sm" /> : null}
                  autoComplete="off"
                />
                {showDropdown && (
                  <ul
                    className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-divider bg-overlay shadow-lg"
                    role="listbox"
                  >
                    {userSearchResults.map((user, index) => (
                      <li
                        key={user.id}
                        role="option"
                        aria-selected={index === highlightedIndex}
                        className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors ${
                          index === highlightedIndex
                            ? 'bg-accent/10'
                            : 'hover:bg-surface-secondary'
                        }`}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onMouseDown={(e) => {
                          e.preventDefault(); // Prevent input blur
                          selectUser(user);
                        }}
                      >
                        <Avatar
                          src={resolveAvatarUrl(user.avatar_url ?? user.avatar) || undefined}
                          name={user.name}
                          size="sm"
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                          <p className="text-xs text-muted truncate">{user.email}</p>
                        </div>
                        <Chip size="sm" variant="tertiary" color={user.status === 'active' ? 'success' : 'default'}>
                          {t(`status.${user.status}`)}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                )}
                {userSearchQuery.length >= 2 && !isSearching && userSearchResults.length === 0 && (
                  <p className="mt-1 text-xs text-muted">{t('monitoring.no_users_found')}</p>
                )}
              </div>
            )}

            <Textarea
              label={t('monitoring.reason_label')}
              placeholder={t('monitoring.reason_placeholder')}
              value={monitoringReason}
              onValueChange={setMonitoringReason}
              minRows={3}
              variant="bordered"
              isRequired
            />
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-foreground/70">{t('monitoring.disable_messaging')}</span>
              <Switch
                isSelected={messagingDisabled}
                onValueChange={setMessagingDisabled}
                size="sm"
              />
            </div>
            <Select
              label={t('monitoring.duration_label')}
              placeholder={t('monitoring.duration_placeholder')}
              variant="bordered"
              selectedKeys={expiresDays ? [expiresDays] : []}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string | undefined;
                setExpiresDays(val ?? '');
              }}
            >
              <SelectItem key="7" id="7">{t('monitoring.duration_7_days')}</SelectItem>
              <SelectItem key="14" id="14">{t('monitoring.duration_14_days')}</SelectItem>
              <SelectItem key="30" id="30">{t('monitoring.duration_30_days')}</SelectItem>
              <SelectItem key="60" id="60">{t('monitoring.duration_60_days')}</SelectItem>
              <SelectItem key="90" id="90">{t('monitoring.duration_90_days')}</SelectItem>
            </Select>
            {editingItem && editingItem.monitoring_expires_at && (
              <p className="text-xs text-muted">
                {t('monitoring.current_expiry', { date: formatServerDate(editingItem.monitoring_expires_at) })}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={resetModalState}
              isDisabled={monitoringLoading}
            >
              {t('monitoring.cancel_button')}
            </Button>
            <Button
              color="primary"
              onPress={handleSubmitMonitoring}
              isLoading={monitoringLoading}
              isDisabled={!editingItem && !selectedUser}
              startContent={!monitoringLoading && (editingItem ? <Pencil size={14} /> : <UserPlus size={14} />)}
            >
              {editingItem ? t('monitoring.save_button') : t('monitoring.add_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Remove from monitoring confirmation modal */}
      <ConfirmModal
        isOpen={confirmRemoveUserId !== null}
        onClose={() => setConfirmRemoveUserId(null)}
        onConfirm={() => {
          if (confirmRemoveUserId !== null) {
            handleRemoveMonitoring(confirmRemoveUserId);
          }
          setConfirmRemoveUserId(null);
        }}
        title={t('monitoring.confirm_remove_title')}
        message={t('monitoring.confirm_remove')}
        confirmLabel={t('monitoring.confirm_remove_confirm')}
        cancelLabel={t('common.cancel')}
        isLoading={removingId !== null}
      />
    </BrokerPageShell>
  );
}

export default UserMonitoring;
