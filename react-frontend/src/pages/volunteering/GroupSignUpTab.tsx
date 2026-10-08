// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GroupSignUpTab - View and manage group/team shift reservations (V3)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';

import Users from 'lucide-react/icons/users';
import UserPlus from 'lucide-react/icons/user-plus';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Building2 from 'lucide-react/icons/building-2';
import MapPin from 'lucide-react/icons/map-pin';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Crown from 'lucide-react/icons/crown';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import LogOut from 'lucide-react/icons/log-out';
import UserMinus from 'lucide-react/icons/user-minus';
import XCircle from 'lucide-react/icons/circle-x';
import Plus from 'lucide-react/icons/plus';
import { Avatar, AvatarGroup } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useAuth, useToast } from '@/contexts';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';

/* ───────────────────────── Types ───────────────────────── */

// The API lists only confirmed members (a removed member keeps a 'cancelled'
// row server-side and is no longer part of the group).
interface GroupMember {
  id: number;
  name: string;
  avatar_url: string | null;
  status: 'confirmed' | 'cancelled';
}

interface GroupReservation {
  id: number;
  group_name: string;
  status: 'active' | 'cancelled' | 'completed';
  is_leader: boolean;
  shift: {
    id: number;
    start_time: string;
    end_time: string;
  };
  opportunity: {
    id: number;
    title: string;
    location: string;
  };
  organization: {
    id: number;
    name: string;
    logo_url: string | null;
  };
  members: GroupMember[];
  max_members: number | null;
  created_at: string;
}

interface GroupOption {
  id: number;
  name: string;
  owner_id?: number | string | null;
  viewer_membership?: {
    status?: string;
    role?: string | null;
    is_admin?: boolean;
  } | null;
}

interface OpportunityOption {
  id: number;
  title: string;
  organization?: {
    name?: string;
  };
}

interface ShiftOption {
  id: number;
  start_time: string;
  end_time: string;
  capacity: number | null;
  signup_count?: number;
  spots_available?: number | null;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/* ───────────────────────── Component ───────────────────────── */

const statusColor = (status: string) => {
  switch (status) {
    case 'active': return 'success';
    case 'cancelled': return 'danger';
    default: return 'default';
  }
};

/** What the confirmation dialog is asking before a destructive call. */
interface PendingAction {
  kind: 'remove' | 'leave' | 'cancel';
  reservationId: number;
  groupName: string;
  memberId?: number;
  memberName?: string;
}

function extractItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const wrapped = payload as { items?: T[]; data?: T[] | { items?: T[] } };
    if (Array.isArray(wrapped.items)) return wrapped.items;
    if (Array.isArray(wrapped.data)) return wrapped.data;
    if (wrapped.data && typeof wrapped.data === 'object' && Array.isArray(wrapped.data.items)) {
      return wrapped.data.items;
    }
  }
  return [];
}

export function GroupSignUpTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const { user } = useAuth();
  const [reservations, setReservations] = useState<GroupReservation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add member modal
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedReservationId, setSelectedReservationId] = useState<number | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<{ id: number; name: string } | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Create reservation modal
  const reservationModal = useDisclosure();
  const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);
  const [opportunityOptions, setOpportunityOptions] = useState<OpportunityOption[]>([]);
  const [shiftOptions, setShiftOptions] = useState<ShiftOption[]>([]);
  const [reserveGroupId, setReserveGroupId] = useState('');
  const [reserveOpportunityId, setReserveOpportunityId] = useState('');
  const [reserveShiftId, setReserveShiftId] = useState('');
  const [reserveSlots, setReserveSlots] = useState('1');
  const [reserveNotes, setReserveNotes] = useState('');
  const [isLoadingReservationOptions, setIsLoadingReservationOptions] = useState(false);
  const [isLoadingShifts, setIsLoadingShifts] = useState(false);
  const [isReserving, setIsReserving] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);

  // Remove a member / leave / cancel the whole reservation — each asks first.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isActing, setIsActing] = useState(false);
  const currentUserId = user?.id !== undefined && user?.id !== null ? Number(user.id) : null;

  // Debounced member search state — /v2/users never returns email, so members
  // are matched by selecting a suggestion (id), not by typing an email.
  const [searchResults, setSearchResults] = useState<{ id: number; name: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<GroupReservation[]>(
        '/v2/volunteering/group-reservations'
      );

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];
        setReservations(items);
      } else {
        setError(tRef.current('group_signup.error_load'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load group reservations', err);
      setError(tRef.current('group_signup.error_load_generic'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const searchMembers = useCallback((query: string) => {
    // Clear any pending debounce
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      // Abort any in-flight search request
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      try {
        const searchRes = await api.get<{ id: number; name: string }[]>(
          `/v2/users?q=${encodeURIComponent(query.trim())}&limit=5`
        );
        if (controller.signal.aborted) return;
        if (searchRes.success && Array.isArray(searchRes.data)) {
          setSearchResults(searchRes.data);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        logError('Member search failed', err);
        setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);
  }, []);

  const openAddMemberModal = (reservationId: number) => {
    setSelectedReservationId(reservationId);
    setMemberQuery('');
    setSelectedMember(null);
    setAddError(null);
    setSearchResults([]);
    setIsSearching(false);
    onOpen();
  };

  const resetReservationForm = () => {
    setReserveGroupId(groupOptions.length === 1 ? String(groupOptions[0]?.id ?? '') : '');
    setReserveOpportunityId('');
    setReserveShiftId('');
    setReserveSlots('1');
    setReserveNotes('');
    setShiftOptions([]);
    setReservationError(null);
  };

  const loadReservationOptions = useCallback(async () => {
    try {
      setIsLoadingReservationOptions(true);
      setReservationError(null);
      const [groupsRes, opportunitiesRes] = await Promise.all([
        api.get<GroupOption[]>('/v2/groups?member=me&per_page=100'),
        api.get<OpportunityOption[]>('/v2/volunteering/opportunities?per_page=100'),
      ]);

      const groups = groupsRes.success ? extractItems<GroupOption>(groupsRes.data) : [];
      const userId = user?.id !== undefined && user?.id !== null ? Number(user.id) : null;
      const manageableGroups = groups.filter((group) => {
        const membership = group.viewer_membership;
        const role = membership?.role ?? '';
        return (userId !== null && group.owner_id !== undefined && group.owner_id !== null && Number(group.owner_id) === userId)
          || (membership?.status === 'active' && (membership.is_admin === true || role === 'owner' || role === 'admin'));
      });
      const opportunities = opportunitiesRes.success ? extractItems<OpportunityOption>(opportunitiesRes.data) : [];
      setGroupOptions(manageableGroups);
      setOpportunityOptions(opportunities);
      if (manageableGroups.length === 1) {
        setReserveGroupId(String(manageableGroups[0]?.id ?? ''));
      }
    } catch (err) {
      logError('Failed to load group reservation options', err);
      setReservationError(tRef.current('group_signup.reserve_load_error'));
    } finally {
      setIsLoadingReservationOptions(false);
    }
  }, [user?.id]);

  const openReservationModal = () => {
    resetReservationForm();
    reservationModal.onOpen();
    loadReservationOptions();
  };

  const loadShiftsForOpportunity = async (opportunityId: string) => {
    setReserveOpportunityId(opportunityId);
    setReserveShiftId('');
    setShiftOptions([]);
    if (!opportunityId) return;

    try {
      setIsLoadingShifts(true);
      setReservationError(null);
      const response = await api.get<ShiftOption[]>(`/v2/volunteering/opportunities/${opportunityId}/shifts`);
      if (response.success) {
        const now = Date.now();
        setShiftOptions(
          extractItems<ShiftOption>(response.data).filter((shift) => new Date(shift.start_time).getTime() >= now),
        );
      } else {
        setReservationError(response.error || tRef.current('group_signup.reserve_shifts_error'));
      }
    } catch (err) {
      logError('Failed to load shifts for group reservation', err);
      setReservationError(tRef.current('group_signup.reserve_shifts_error'));
    } finally {
      setIsLoadingShifts(false);
    }
  };

  // Clean up debounce timer and abort controller on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  const handleAddMember = async () => {
    if (!selectedReservationId || !selectedMember) return;

    try {
      setIsAdding(true);
      setAddError(null);

      const response = await api.post(
        `/v2/volunteering/group-reservations/${selectedReservationId}/members`,
        { user_id: selectedMember.id }
      );

      if (response.success) {
        toastRef.current.success(tRef.current('group_signup.member_added'));
        onClose();
        setMemberQuery('');
        setSelectedMember(null);
        setSearchResults([]);
        load();
      } else {
        setAddError(tRef.current('group_signup.add_member_error'));
      }
    } catch (err) {
      logError('Failed to add member', err);
      setAddError(tRef.current('group_signup.add_member_error_generic'));
    } finally {
      setIsAdding(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const { kind, reservationId, memberId } = pendingAction;
    const url = kind === 'cancel'
      ? `/v2/volunteering/group-reservations/${reservationId}`
      : `/v2/volunteering/group-reservations/${reservationId}/members/${memberId}`;
    const doneKey = kind === 'remove'
      ? 'group_signup.remove_member_done'
      : kind === 'leave' ? 'group_signup.leave_done' : 'group_signup.cancel_reservation_done';

    try {
      setIsActing(true);
      const response = await api.delete(url);
      if (response.success) {
        toastRef.current.success(tRef.current(doneKey));
        setPendingAction(null);
        load();
      } else {
        toastRef.current.error(response.error || tRef.current('group_signup.action_error'));
      }
    } catch (err) {
      logError('Group reservation action failed', err);
      toastRef.current.error(tRef.current('group_signup.action_error'));
    } finally {
      setIsActing(false);
    }
  };

  const pendingActionCopy = pendingAction ? {
    title: t(`group_signup.confirm_${pendingAction.kind}_title`),
    body: t(`group_signup.confirm_${pendingAction.kind}_body`, { name: pendingAction.memberName ?? '', group: pendingAction.groupName }),
    action: t(`group_signup.confirm_${pendingAction.kind}_action`),
  } : null;

  const handleCreateReservation = async () => {
    if (!reserveGroupId || !reserveShiftId || !reserveSlots) {
      setReservationError(tRef.current('group_signup.reserve_required'));
      return;
    }

    // Client-side guard (server stays authoritative): reserved slots must be a
    // whole number of at least 1 — blocks fractional/zero/NaN values.
    const slots = parseInt(reserveSlots, 10);
    if (!Number.isInteger(slots) || slots < 1) {
      setReservationError(tRef.current('group_signup.reserve_invalid_slots'));
      return;
    }

    try {
      setIsReserving(true);
      setReservationError(null);
      const response = await api.post(`/v2/volunteering/shifts/${reserveShiftId}/group-reserve`, {
        group_id: parseInt(reserveGroupId, 10),
        reserved_slots: slots,
        notes: reserveNotes.trim() || undefined,
      });

      if (response.success) {
        toastRef.current.success(tRef.current('group_signup.reserve_success'));
        reservationModal.onClose();
        resetReservationForm();
        load();
      } else {
        setReservationError(response.error || tRef.current('group_signup.reserve_error'));
      }
    } catch (err) {
      logError('Failed to create group reservation', err);
      setReservationError(tRef.current('group_signup.reserve_error'));
    } finally {
      setIsReserving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-violet-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('group_signup.title')}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            onPress={openReservationModal}
          >
            {t('group_signup.reserve_slots')}
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={load}
            isDisabled={isLoading}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={load}>
            {t('common.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!error && !isLoading && reservations.length === 0 && (
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title={t('group_signup.empty_title')}
          description={t('group_signup.empty_description')}
        />
      )}

      {/* Reservations List */}
      {!error && !isLoading && reservations.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          {reservations.map((res) => (
            <motion.div key={res.id} variants={itemVariants}>
              <GlassCard className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-semibold text-theme-primary text-lg">
                        {res.group_name}
                      </h3>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={statusColor(res.status)}
                      >
                        {t(`group_signup.status.${res.status}`)}
                      </Chip>
                      {res.is_leader && (
                        <Chip
                          size="sm"
                          variant="soft"
                          color="warning"
                          startContent={<Crown className="w-3 h-3" />}
                        >
                          {t('group_signup.leader')}
                        </Chip>
                      )}
                    </div>

                    {/* Shift details */}
                    <p className="text-sm font-medium text-theme-primary mb-1">
                      {res.opportunity.title}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle mb-3">
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" aria-hidden="true" />
                        {res.organization.name}
                      </span>
                      {res.opportunity.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          {res.opportunity.location}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        {new Date(res.shift.start_time).toLocaleDateString(getFormattingLocale())}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {new Date(res.shift.start_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {new Date(res.shift.end_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Members */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-theme-muted flex items-center gap-1">
                          <Users className="w-3 h-3" aria-hidden="true" />
                          {t('group_signup.members')} ({res.members.length}{res.max_members ? `/${res.max_members}` : ''})
                        </p>
                      </div>

                      {/* Avatar group */}
                      {res.members.length > 0 && (
                        <AvatarGroup max={5} size="sm">
                          {res.members.map((member) => (
                            <Avatar
                              key={member.id}
                              name={member.name}
                              src={resolveAvatarUrl(member.avatar_url) || undefined}
                              size="sm"
                            />
                          ))}
                        </AvatarGroup>
                      )}

                      {/* Member list — every listed member is signed up for the shift */}
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {res.members.map((member) => {
                          const canRemove = res.is_leader && res.status === 'active';
                          const canLeave = !res.is_leader && res.status === 'active' && currentUserId !== null && member.id === currentUserId;
                          return (
                            <div
                              key={member.id}
                              className="flex items-center gap-1 text-xs text-theme-subtle"
                            >
                              <CheckCircle className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                              <span>{member.name}</span>
                              {canRemove && (
                                <Button
                                  size="sm"
                                  variant="tertiary"
                                  className="min-h-7 px-2 text-xs"
                                  startContent={<UserMinus className="w-3 h-3" aria-hidden="true" />}
                                  aria-label={t('group_signup.remove_member_named', { name: member.name })}
                                  onPress={() => setPendingAction({ kind: 'remove', reservationId: res.id, groupName: res.group_name, memberId: member.id, memberName: member.name })}
                                >
                                  {t('group_signup.remove_member')}
                                </Button>
                              )}
                              {canLeave && (
                                <Button
                                  size="sm"
                                  variant="tertiary"
                                  className="min-h-7 px-2 text-xs"
                                  startContent={<LogOut className="w-3 h-3" aria-hidden="true" />}
                                  onPress={() => setPendingAction({ kind: 'leave', reservationId: res.id, groupName: res.group_name, memberId: member.id, memberName: member.name })}
                                >
                                  {t('group_signup.leave')}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <p className="text-xs text-theme-subtle mt-2">
                      {t('group_signup.created')} {new Date(res.created_at).toLocaleDateString(getFormattingLocale())}
                    </p>
                  </div>

                  {/* Leader controls: name a member, or cancel the whole booking */}
                  {res.is_leader && res.status === 'active' && (
                    <div className="flex flex-wrap gap-2 sm:flex-shrink-0 sm:flex-col sm:items-end">
                      <Button
                        size="sm"
                        className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                        startContent={<UserPlus className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => openAddMemberModal(res.id)}
                        isDisabled={res.max_members !== null && res.members.length >= res.max_members}
                      >
                        {t('group_signup.add_member')}
                      </Button>
                      <Button
                        size="sm"
                        variant="tertiary"
                        startContent={<XCircle className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => setPendingAction({ kind: 'cancel', reservationId: res.id, groupName: res.group_name })}
                      >
                        {t('group_signup.cancel_reservation')}
                      </Button>
                    </div>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Add Member Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="md" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('group_signup.add_group_member')}</ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-sm text-theme-muted">
              {t('group_signup.search_description')}
            </p>
            <Input
              type="text"
              label={t('group_signup.search_label')}
              placeholder={t('group_signup.search_placeholder')}
              value={memberQuery}
              onChange={(e) => {
                const val = e.target.value;
                setMemberQuery(val);
                setSelectedMember(null);
                searchMembers(val);
              }}
              isRequired
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
            {isSearching && (
              <p className="text-xs text-theme-subtle">{t('group_signup.searching')}</p>
            )}
            {!isSearching && !selectedMember && memberQuery.trim().length >= 2 && searchResults.length === 0 && (
              <p className="text-xs text-theme-subtle">{t('group_signup.no_results')}</p>
            )}
            {!isSearching && searchResults.length > 0 && (
              <div className="space-y-1">
                {searchResults.map((user) => (
                  <Button
                    key={user.id}
                    variant="tertiary"
                    className="min-h-10 w-full min-w-0 justify-start rounded-lg px-3 py-2 text-left text-sm text-theme-primary"
                    onPress={() => {
                      setSelectedMember({ id: user.id, name: user.name });
                      setMemberQuery(user.name);
                      setSearchResults([]);
                    }}
                  >
                    <span className="font-medium">{user.name}</span>
                  </Button>
                ))}
              </div>
            )}
            {addError && (
              <p className="text-sm text-danger">{addError}</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              onPress={handleAddMember}
              isLoading={isAdding}
              isDisabled={!selectedMember}
              startContent={<UserPlus className="w-4 h-4" aria-hidden="true" />}
            >
              {t('group_signup.add_member')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Confirm remove / leave / cancel */}
      <Modal isOpen={pendingAction !== null} onClose={() => { if (!isActing) setPendingAction(null); }} size="md" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{pendingActionCopy?.title}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-theme-muted">{pendingActionCopy?.body}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setPendingAction(null)} isDisabled={isActing}>{t('common.cancel')}</Button>
            <Button variant="danger" onPress={handleConfirmAction} isLoading={isActing}>
              {pendingActionCopy?.action}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Create Reservation Modal */}
      <Modal isOpen={reservationModal.isOpen} onClose={reservationModal.onClose} size="lg" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('group_signup.reserve_modal_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            {reservationError && (
              <p className="text-sm text-danger">{reservationError}</p>
            )}
            <Select
              label={t('group_signup.reserve_group')}
              selectedKeys={reserveGroupId ? [reserveGroupId] : []}
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0] as string | undefined;
                setReserveGroupId(value ?? '');
              }}
              isLoading={isLoadingReservationOptions}
              isDisabled={isLoadingReservationOptions}
              variant="secondary"
              isRequired
            >
              {groupOptions.map((group) => (
                <SelectItem key={group.id.toString()} id={group.id.toString()}>
                  {group.name}
                </SelectItem>
              ))}
            </Select>
            <Select
              label={t('group_signup.reserve_opportunity')}
              selectedKeys={reserveOpportunityId ? [reserveOpportunityId] : []}
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0] as string | undefined;
                loadShiftsForOpportunity(value ?? '');
              }}
              isLoading={isLoadingReservationOptions}
              isDisabled={isLoadingReservationOptions}
              variant="secondary"
              isRequired
            >
              {opportunityOptions.map((opportunity) => (
                <SelectItem key={opportunity.id.toString()} id={opportunity.id.toString()}>
                  {opportunity.organization?.name
                    ? t('group_signup.reserve_opportunity_option', { title: opportunity.title, organization: opportunity.organization.name })
                    : opportunity.title}
                </SelectItem>
              ))}
            </Select>
            <Select
              label={t('group_signup.reserve_shift')}
              selectedKeys={reserveShiftId ? [reserveShiftId] : []}
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0] as string | undefined;
                setReserveShiftId(value ?? '');
              }}
              isLoading={isLoadingShifts}
              isDisabled={!reserveOpportunityId || isLoadingShifts}
              variant="secondary"
              isRequired
            >
              {shiftOptions.map((shift) => (
                <SelectItem key={shift.id.toString()} id={shift.id.toString()}>
                  {t('group_signup.reserve_shift_option', {
                    date: new Date(shift.start_time).toLocaleDateString(getFormattingLocale()),
                    start: new Date(shift.start_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' }),
                    end: new Date(shift.end_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' }),
                  })}
                </SelectItem>
              ))}
            </Select>
            <Input
              label={t('group_signup.reserve_slots_label')}
              type="number"
              min="1"
              value={reserveSlots}
              onValueChange={setReserveSlots}
              variant="secondary"
              isRequired
            />
            <Textarea
              label={t('group_signup.reserve_notes')}
              value={reserveNotes}
              onValueChange={setReserveNotes}
              variant="secondary"
              minRows={2}
              maxRows={4}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={reservationModal.onClose}>{t('common.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              onPress={handleCreateReservation}
              isLoading={isReserving}
              isDisabled={!reserveGroupId || !reserveShiftId || isLoadingReservationOptions || isLoadingShifts}
            >
              {t('group_signup.reserve_submit')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default GroupSignUpTab;
