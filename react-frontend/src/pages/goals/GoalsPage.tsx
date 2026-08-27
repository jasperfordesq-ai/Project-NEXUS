// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ConfettiCelebration } from '@/components/ui/ConfettiCelebration';
import { DatePicker } from '@/components/ui/DatePicker';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectItem } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { parseDate } from '@internationalized/date';
/**
 * Goals Page - Personal and community goal tracking
 *
 * Features:
 * - Create, edit, delete goals
 * - Progress tracking with +1 increments
 * - Mark complete with celebration animation
 * - Buddy system for public goals
 * - Goal detail modal with timeline
 * - Discover tab for community goals
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Target from 'lucide-react/icons/target';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Calendar from 'lucide-react/icons/calendar';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Globe from 'lucide-react/icons/globe';
import Lock from 'lucide-react/icons/lock';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Edit3 from 'lucide-react/icons/pen-line';
import Trash2 from 'lucide-react/icons/trash-2';
import Award from 'lucide-react/icons/award';
import Clock from 'lucide-react/icons/clock';
import MessageCircle from 'lucide-react/icons/message-circle';
import Heart from 'lucide-react/icons/heart';
import UserPlus from 'lucide-react/icons/user-plus';
import Sparkles from 'lucide-react/icons/sparkles';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import FileText from 'lucide-react/icons/file-text';
import History from 'lucide-react/icons/history';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getFormattingLocale, resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { GoalTemplatePickerModal } from './components/GoalTemplatePickerModal';
import { GoalCheckinModal } from './components/GoalCheckinModal';
import { GoalReminderToggle } from './components/GoalReminderToggle';
import { GoalProgressHistory } from './components/GoalProgressHistory';
import { GoalInsightsPanel } from './components/GoalInsightsPanel';

/* ───────────────────────── Types ───────────────────────── */

interface Goal {
  id: number;
  user_id: number;
  title: string;
  description: string;
  target_value: number;
  current_value: number;
  deadline: string | null;
  is_public: boolean;
  status: 'active' | 'completed';
  created_at: string;
  updated_at: string;
  checkin_frequency?: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
  streak_count?: number;
  best_streak_count?: number;
  user_name: string;
  user_avatar: string | null;
  progress_percentage: number;
  is_owner?: boolean;
  buddy_id?: number | null;
  buddy_name?: string | null;
  buddy_avatar?: string | null;
  is_buddy?: boolean;
  likes_count?: number;
  comments_count?: number;
  progress_history?: ProgressEntry[];
}

interface ProgressEntry {
  id: number;
  increment: number;
  note: string | null;
  created_at: string;
}

type GoalTab = 'my' | 'buddying' | 'discover';

/* ───────────────────────── Main Component ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const modalClasses = {
  backdrop: 'z-[9998]',
  wrapper: 'z-[9999] items-start px-3 py-4 pt-28 sm:px-4 sm:pt-32',
  base: 'z-[10000] bg-overlay border border-theme-default my-0 max-h-[calc(100dvh_-_8rem)] sm:max-h-[calc(100dvh_-_9rem)]',
  body: 'overflow-y-auto',
};

const inputClasses = {
  input: 'bg-transparent text-theme-primary',
  inputWrapper: 'bg-theme-elevated border-theme-default',
};

export function GoalsPage() {
  const { t } = useTranslation(['gamification', 'goals']);
  usePageTitle(t('goals.page_title'));
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<GoalTab>('my');
  const [hasMore, setHasMore] = useState(false);
  const [, setCursor] = useState<string | undefined>();
  const cursorRef = useRef<string | undefined>(undefined);
  // Re-entry guard for "Load more" — state updates are async, so a ref is the
  // only reliable way to stop a double-click appending the same page twice
  // (duplicate cards with colliding React keys).
  const loadingMoreRef = useRef(false);

  // Create modal
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [newGoal, setNewGoal] = useState({
    title: '',
    description: '',
    target_value: 100,
    checkin_frequency: 'weekly' as const,
    deadline: '',
    is_public: false,
  });
  const [isCreating, setIsCreating] = useState(false);

  // Edit modal
  const { isOpen: isEditOpen, onOpen: onEditOpen, onClose: onEditClose } = useDisclosure();
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    target_value: 100,
    checkin_frequency: 'weekly' as 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly',
    deadline: '',
    is_public: false,
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Delete modal
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const [deleteGoal, setDeleteGoal] = useState<Goal | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Detail modal
  const { isOpen: isDetailOpen, onOpen: onDetailOpen, onClose: onDetailClose } = useDisclosure();
  const [detailGoal, setDetailGoal] = useState<Goal | null>(null);

  // Completion celebration
  const [celebratingId, setCelebratingId] = useState<number | null>(null);

  // G1 - Template picker
  const { isOpen: isTemplateOpen, onOpen: onTemplateOpen, onClose: onTemplateClose } = useDisclosure();

  // G3 - Check-in modal
  const { isOpen: isCheckinOpen, onOpen: onCheckinOpen, onClose: onCheckinClose } = useDisclosure();
  const [checkinGoal, setCheckinGoal] = useState<Goal | null>(null);

  const loadGoals = useCallback(async (append = false) => {
    if (append) {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setIsLoadingMore(true);
    } else {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
    }
    const controller = abortRef.current;
    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      }

      const params = new URLSearchParams();
      params.set('per_page', '20');
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);

      const endpoint = tab === 'discover'
        ? `/v2/goals/discover?${params}`
        : tab === 'buddying'
        ? `/v2/goals/mentoring?${params}`
        : `/v2/goals?${params}&status=all`;

      const response = await api.get<Goal[]>(endpoint);

      if (controller?.signal.aborted) return;
      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];

        if (append) {
          setGoals((prev) => [...prev, ...items]);
        } else {
          setGoals(items);
        }
        setHasMore(response.meta?.has_more ?? false);
        const newCursor = response.meta?.cursor ?? undefined;
        cursorRef.current = newCursor;
        setCursor(newCursor);
      } else {
        if (!append) setError(tRef.current('goals.load_error'));
      }
    } catch (err) {
      if (controller?.signal.aborted) return; // finally still resets the guards
      logError('Failed to load goals', err);
      if (!append) setError(tRef.current('goals.load_error'));
    } finally {
      setIsLoading(false);
      if (append) {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [tab]);

  useEffect(() => {
    cursorRef.current = undefined;
    setCursor(undefined);
    loadGoals();
  }, [tab, loadGoals]);

  const handleCreate = async () => {
    if (!newGoal.title.trim()) return;

    try {
      setIsCreating(true);
      const response = await api.post('/v2/goals', {
        title: newGoal.title,
        description: newGoal.description,
        target_value: newGoal.target_value,
        checkin_frequency: newGoal.checkin_frequency,
        deadline: newGoal.deadline || undefined,
        is_public: newGoal.is_public,
      });

      if (response.success) {
        onClose();
        setNewGoal({ title: '', description: '', target_value: 100, checkin_frequency: 'weekly', deadline: '', is_public: false });
        toastRef.current.success(tRef.current('goals.toast.created'));
        loadGoals();
      } else {
        toastRef.current.error(response.error || tRef.current('goals.toast.create_failed'));
      }
    } catch (err) {
      logError('Failed to create goal', err);
      toastRef.current.error(tRef.current('goals.toast.create_failed'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleProgressUpdate = async (goalId: number, increment: number) => {
    try {
      const response = await api.post(`/v2/goals/${goalId}/progress`, { increment });
      if (response.success) {
        toastRef.current.success(tRef.current('goals.toast.progress_updated'));
        loadGoals();
      } else {
        toastRef.current.error(response.error || tRef.current('goals.toast.progress_failed'));
      }
    } catch (err) {
      logError('Failed to update progress', err);
      toastRef.current.error(tRef.current('goals.toast.progress_failed'));
    }
  };

  // ── Edit ──
  const openEdit = (goal: Goal) => {
    setEditGoal(goal);
    setEditForm({
      title: goal.title,
      description: goal.description || '',
      target_value: goal.target_value,
      checkin_frequency: goal.checkin_frequency ?? 'weekly',
      deadline: goal.deadline ? (goal.deadline.split('T')[0] ?? '') : '',
      is_public: goal.is_public,
    });
    onEditOpen();
  };

  const handleSaveEdit = async () => {
    if (!editGoal || !editForm.title.trim()) return;

    try {
      setIsSavingEdit(true);
      const response = await api.put(`/v2/goals/${editGoal.id}`, {
        title: editForm.title,
        description: editForm.description,
        target_value: editForm.target_value,
        checkin_frequency: editForm.checkin_frequency,
        deadline: editForm.deadline || null,
        is_public: editForm.is_public,
      });

      if (response.success) {
        onEditClose();
        setEditGoal(null);
        toastRef.current.success(tRef.current('goals.toast.updated'));
        loadGoals();
      } else {
        toastRef.current.error(response.error || tRef.current('goals.toast.update_failed'));
      }
    } catch (err) {
      logError('Failed to update goal', err);
      toastRef.current.error(tRef.current('goals.toast.update_failed'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  // ── Delete ──
  const openDelete = (goal: Goal) => {
    setDeleteGoal(goal);
    onDeleteOpen();
  };

  const handleDelete = async () => {
    if (!deleteGoal) return;

    try {
      setIsDeleting(true);
      const response = await api.delete(`/v2/goals/${deleteGoal.id}`);

      if (response.success) {
        onDeleteClose();
        setGoals((prev) => prev.filter((g) => g.id !== deleteGoal.id));
        setDeleteGoal(null);
        toastRef.current.success(tRef.current('goals.toast.deleted'));
      } else {
        toastRef.current.error(response.error || tRef.current('goals.toast.delete_failed'));
      }
    } catch (err) {
      logError('Failed to delete goal', err);
      toastRef.current.error(tRef.current('goals.toast.delete_failed'));
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Complete ──
  const handleComplete = async (goal: Goal) => {
    try {
      const response = await api.post(`/v2/goals/${goal.id}/complete`, {});

      if (response.success) {
        setCelebratingId(goal.id);
        // Update local state immediately
        setGoals((prev) =>
          prev.map((g) =>
            g.id === goal.id
              ? { ...g, status: 'completed' as const, progress_percentage: 100, current_value: g.target_value }
              : g
          )
        );
        toastRef.current.success(tRef.current('goals.toast.completed'));
        // Clear celebration after animation
        setTimeout(() => setCelebratingId(null), 2000);
      } else {
        toastRef.current.error(response.error || tRef.current('goals.toast.complete_failed'));
      }
    } catch (err) {
      logError('Failed to complete goal', err);
      toastRef.current.error(tRef.current('goals.toast.complete_failed'));
    }
  };

  // ── Buddy ──
  const handleBecomeBuddy = async (goal: Goal) => {
    try {
      const response = await api.post(`/v2/goals/${goal.id}/buddy`, {});

      if (response.success) {
        toastRef.current.success(tRef.current('goals.toast.buddy_joined'));
        // Update local state
        setGoals((prev) =>
          prev.map((g) =>
            g.id === goal.id
              ? { ...g, buddy_id: user?.id ?? null, buddy_name: user ? resolveUserDisplayName(user) : null, is_buddy: true }
              : g
          )
        );
      } else {
        toastRef.current.error(tRef.current('goals.toast.buddy_failed'));
      }
    } catch (err) {
      logError('Failed to become buddy', err);
      toastRef.current.error(tRef.current('goals.toast.buddy_failed'));
    }
  };

  const handleBuddyAction = async (goal: Goal, type: 'nudge' | 'encouragement' | 'offer_help') => {
    try {
      const response = await api.post(`/v2/goals/${goal.id}/buddy/nudge`, { type });

      if (response.success) {
        toastRef.current.success(tRef.current('goals.toast.buddy_action_sent'));
      } else {
        toastRef.current.error(tRef.current('goals.toast.buddy_action_failed'));
      }
    } catch (err) {
      logError('Failed to send buddy action', err);
      toastRef.current.error(tRef.current('goals.toast.buddy_action_failed'));
    }
  };

  // ── Check-in (G3) ──
  const openCheckin = (goal: Goal) => {
    setCheckinGoal(goal);
    onCheckinOpen();
  };

  // ── Detail ──
  const openDetail = async (goal: Goal) => {
    setDetailGoal(goal);
    onDetailOpen();

    // Fetch fresh goal data for the detail modal
    try {
      const response = await api.get<Goal>(`/v2/goals/${goal.id}`);
      if (response.success && response.data && response.data.id) {
        setDetailGoal(response.data);
      }
    } catch (err) {
      logError('Failed to load goal details', err);
    }
  };

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_meta.goals.title')} noIndex />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <Target className="w-7 h-7 text-emerald-400" aria-hidden="true" />
            {t('goals.title')}
          </h1>
          <p className="text-theme-muted mt-1">{t('goals.subtitle')}</p>
        </div>
        {isAuthenticated && (
          <div className="flex gap-2">
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              startContent={<FileText className="w-4 h-4" aria-hidden="true" />}
              onPress={onTemplateOpen}
            >
              {t('goals.from_template')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={onOpen}
            >
              {t('goals.new_goal')}
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <ToggleButtonGroup
        aria-label={t('goals.title')}
        selectionMode="single"
        disallowEmptySelection
        isDetached
        selectedKeys={new Set([tab])}
        onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setTab(k as GoalTab); }}
        className="flex gap-2 flex-wrap"
      >
        <ToggleButton
          id="my"
          variant="ghost"
          className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-accent data-[selected=true]:to-accent-gradient-end data-[selected=true]:text-white"
        >
          <Target className="w-4 h-4" aria-hidden="true" />
          {t('goals.tab_my')}
        </ToggleButton>
        <ToggleButton
          id="buddying"
          variant="ghost"
          className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-accent data-[selected=true]:to-accent-gradient-end data-[selected=true]:text-white"
        >
          <Users className="w-4 h-4" aria-hidden="true" />
          {t('goals.tab_buddying')}
        </ToggleButton>
        <ToggleButton
          id="discover"
          variant="ghost"
          className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-accent data-[selected=true]:to-accent-gradient-end data-[selected=true]:text-white"
        >
          <Globe className="w-4 h-4" aria-hidden="true" />
          {t('goals.tab_discover')}
        </ToggleButton>
      </ToggleButtonGroup>

      <section className="rounded-lg border border-theme-default bg-theme-elevated/60 p-4 sm:p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-4 lg:items-center">
          <div className="flex gap-3">
            <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Users className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-theme-primary">{t('goals.buddy_explainer.title')}</h2>
              <p className="text-sm text-theme-muted mt-1">{t('goals.buddy_explainer.body')}</p>
              <p className="text-sm text-theme-muted mt-2">{t('goals.buddy_explainer.how')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase text-theme-subtle">{t('goals.guide.checkins_title')}</h3>
                <p className="text-sm text-theme-muted mt-1">{t('goals.guide.checkins_body')}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Target className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase text-theme-subtle">{t('goals.guide.progress_title')}</h3>
                <p className="text-sm text-theme-muted mt-1">{t('goals.guide.progress_body')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('goals.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadGoals()}
          >
            {t('goals.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Goals List */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className="space-y-4" aria-label={t('goals.loading')} aria-busy="true">
              {[1, 2, 3].map((i) => (
                <GlassCard key={i} className="p-5">
                  <div className="space-y-3">
                    <Skeleton className="h-5 rounded-lg w-1/3" />
                    <Skeleton className="h-3 rounded-lg w-full" />
                    <Skeleton className="h-2 rounded-lg w-full" />
                    <Skeleton className="h-3 rounded-lg w-1/4" />
                  </div>
                </GlassCard>
              ))}
            </div>
          ) : goals.length === 0 ? (
            <EmptyState
              icon={tab === 'buddying' ? <Users className="w-12 h-12" aria-hidden="true" /> : <Target className="w-12 h-12" aria-hidden="true" />}
              title={tab === 'my' ? t('goals.empty_my_title') : tab === 'buddying' ? t('goals.empty_buddying_title') : t('goals.empty_discover_title')}
              description={tab === 'my' ? t('goals.empty_my_description') : tab === 'buddying' ? t('goals.empty_buddying_description') : t('goals.empty_discover_description')}
              action={
                tab === 'my' && isAuthenticated ? (
                  <Button
                    className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                    onPress={onOpen}
                  >
                    {t('goals.create_goal')}
                  </Button>
                ) : tab === 'buddying' && isAuthenticated ? (
                  <Button
                    className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                    onPress={() => setTab('discover')}
                    startContent={<Globe className="w-4 h-4" aria-hidden="true" />}
                  >
                    {t('goals.tab_discover')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-4"
            >
              {goals.map((goal) => {
                const isOwner = goal.is_owner ?? goal.user_id === user?.id;
                return (
                  <motion.div key={goal.id} variants={itemVariants}>
                    <GoalCard
                      goal={goal}
                      isOwner={isOwner}
                      currentUserId={user?.id ?? null}
                      isCelebrating={celebratingId === goal.id}
                      onProgressUpdate={handleProgressUpdate}
                      onEdit={openEdit}
                      onDelete={openDelete}
                      onComplete={handleComplete}
                      onBecomeBuddy={handleBecomeBuddy}
                      onBuddyAction={handleBuddyAction}
                      onOpenDetail={openDetail}
                      onCheckin={openCheckin}
                      isDiscoverTab={tab === 'discover'}
                      isBuddyingTab={tab === 'buddying'}
                    />
                  </motion.div>
                );
              })}

              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="flat"
                    className="bg-theme-elevated text-theme-muted"
                    onPress={() => loadGoals(true)}
                    isLoading={isLoadingMore}
                    isDisabled={isLoadingMore}
                  >
                    {t('goals.load_more')}
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}

      {/* ─── Create Goal Modal ─── */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" classNames={modalClasses}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('goals.modal.create_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            <Input
              label={t('goals.modal.goal_title_label')}
              placeholder={t('goals.modal.goal_title_placeholder')}
              value={newGoal.title}
              onChange={(e) => setNewGoal((prev) => ({ ...prev, title: e.target.value }))}
              isRequired
              classNames={inputClasses}
            />
            <Textarea
              label={t('goals.modal.description_label')}
              placeholder={t('goals.modal.description_placeholder')}
              value={newGoal.description}
              onChange={(e) => setNewGoal((prev) => ({ ...prev, description: e.target.value }))}
              classNames={inputClasses}
            />
            <Input
              type="number"
              label={t('goals.modal.target_value_label')}
              placeholder={t('goals.modal.target_value_placeholder')}
              value={String(newGoal.target_value)}
              onChange={(e) => setNewGoal((prev) => ({ ...prev, target_value: parseInt(e.target.value) || 0 }))}
              classNames={inputClasses}
            />
            <p className="text-xs text-theme-muted -mt-2">{t('goals.modal.target_value_help')}</p>
            <Select
              label={t('goals.modal.checkin_frequency_label')}
              selectedKeys={[newGoal.checkin_frequency]}
              onChange={(e) => setNewGoal((prev) => ({ ...prev, checkin_frequency: (e.target.value || 'weekly') as typeof newGoal.checkin_frequency }))}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
            >
              {['none', 'daily', 'weekly', 'biweekly', 'monthly'].map((frequency) => (
                <SelectItem key={frequency} id={frequency}>{t(`frequency.${frequency}`)}</SelectItem>
              ))}
            </Select>
            <DatePicker
              label={t('goals.modal.deadline_label')}
              value={newGoal.deadline ? parseDate(newGoal.deadline) : null}
              onChange={(val) => setNewGoal((prev) => ({ ...prev, deadline: val ? val.toString() : '' }))}
              classNames={{ inputWrapper: inputClasses.inputWrapper, input: inputClasses.input }}
            />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-theme-primary">{t('goals.modal.make_public')}</p>
                <p className="text-xs text-theme-muted">{t('goals.modal.make_public_desc')}</p>
              </div>
              <Switch
                isSelected={newGoal.is_public}
                onValueChange={(val) => setNewGoal((prev) => ({ ...prev, is_public: val }))}
                aria-label={t('goals.modal.make_public')}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose} className="text-theme-muted">{t('goals.modal.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              onPress={handleCreate}
              isLoading={isCreating}
              isDisabled={!newGoal.title.trim()}
            >
              {t('goals.create_goal')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ─── Edit Goal Modal ─── */}
      <Modal isOpen={isEditOpen} onClose={onEditClose} size="lg" classNames={modalClasses}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('goals.modal.edit_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            <Input
              label={t('goals.modal.goal_title_label')}
              placeholder={t('goals.modal.goal_title_placeholder')}
              value={editForm.title}
              onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
              isRequired
              classNames={inputClasses}
            />
            <Textarea
              label={t('goals.modal.description_label')}
              placeholder={t('goals.modal.description_placeholder')}
              value={editForm.description}
              onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
              classNames={inputClasses}
            />
            <Input
              type="number"
              label={t('goals.modal.target_value_label')}
              placeholder={t('goals.modal.target_value_placeholder')}
              value={String(editForm.target_value)}
              onChange={(e) => setEditForm((prev) => ({ ...prev, target_value: parseInt(e.target.value) || 0 }))}
              classNames={inputClasses}
            />
            <p className="text-xs text-theme-muted -mt-2">{t('goals.modal.target_value_help')}</p>
            <Select
              label={t('goals.modal.checkin_frequency_label')}
              selectedKeys={[editForm.checkin_frequency]}
              onChange={(e) => setEditForm((prev) => ({ ...prev, checkin_frequency: (e.target.value || 'weekly') as typeof editForm.checkin_frequency }))}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
            >
              {['none', 'daily', 'weekly', 'biweekly', 'monthly'].map((frequency) => (
                <SelectItem key={frequency} id={frequency}>{t(`frequency.${frequency}`)}</SelectItem>
              ))}
            </Select>
            <DatePicker
              label={t('goals.modal.deadline_label')}
              value={editForm.deadline ? parseDate(editForm.deadline) : null}
              onChange={(val) => setEditForm((prev) => ({ ...prev, deadline: val ? val.toString() : '' }))}
              classNames={{ inputWrapper: inputClasses.inputWrapper, input: inputClasses.input }}
            />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-theme-primary">{t('goals.modal.make_public')}</p>
                <p className="text-xs text-theme-muted">{t('goals.modal.make_public_desc')}</p>
              </div>
              <Switch
                isSelected={editForm.is_public}
                onValueChange={(val) => setEditForm((prev) => ({ ...prev, is_public: val }))}
                aria-label={t('goals.modal.make_public')}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onEditClose} className="text-theme-muted">{t('goals.modal.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              onPress={handleSaveEdit}
              isLoading={isSavingEdit}
              isDisabled={!editForm.title.trim()}
            >
              {t('goals.modal.save_changes')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ─── Delete Confirmation Modal ─── */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} size="sm" classNames={modalClasses}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('goals.modal.delete_title')}</ModalHeader>
          <ModalBody>
            <div className="text-center py-2">
              <Trash2 className="w-12 h-12 text-red-400 mx-auto mb-3" aria-hidden="true" />
              <p className="text-theme-primary font-medium mb-1">
                {t('goals.modal.delete_confirm', { title: deleteGoal?.title })}
              </p>
              <p className="text-sm text-theme-muted">{t('goals.modal.delete_warning')}</p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteClose} className="text-theme-muted">{t('goals.modal.cancel')}</Button>
            <Button
              color="danger"
              onPress={handleDelete}
              isLoading={isDeleting}
            >
              {t('goals.modal.delete_goal')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ─── G1 - Template Picker Modal ─── */}
      <GoalTemplatePickerModal
        isOpen={isTemplateOpen}
        onClose={onTemplateClose}
        onTemplateSelected={() => {
          setCursor(undefined);
          loadGoals();
        }}
      />

      {/* ─── G3 - Check-in Modal ─── */}
      {checkinGoal && (
        <GoalCheckinModal
          isOpen={isCheckinOpen}
          onClose={() => {
            onCheckinClose();
            setCheckinGoal(null);
          }}
          goalId={checkinGoal.id}
          goalTitle={checkinGoal.title}
          currentProgress={Math.round(checkinGoal.progress_percentage)}
          onCheckinCreated={() => {
            setCursor(undefined);
            loadGoals();
          }}
        />
      )}

      {/* ─── Goal Detail Modal ─── */}
      <Modal isOpen={isDetailOpen} onClose={onDetailClose} size="2xl" scrollBehavior="inside" classNames={modalClasses}>
        <ModalContent>
          {detailGoal && (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <ModalHeading className="flex items-center gap-2 text-theme-primary">
                  <Target className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                  {detailGoal.title}
                </ModalHeading>
                <div className="flex items-center gap-2 flex-wrap">
                  {detailGoal.status === 'completed' ? (
                    <Chip size="sm" color="success" variant="flat" startContent={<CheckCircle className="w-3 h-3" aria-hidden="true" />}>
                      {t('goals.status.completed')}
                    </Chip>
                  ) : (
                    <Chip size="sm" color="primary" variant="flat">{t('goals.status.active')}</Chip>
                  )}
                  {detailGoal.is_public ? (
                    <Chip size="sm" variant="flat" className="text-theme-subtle" startContent={<Globe className="w-3 h-3" aria-hidden="true" />}>
                      {t('goals.visibility.public')}
                    </Chip>
                  ) : (
                    <Chip size="sm" variant="flat" className="text-theme-subtle" startContent={<Lock className="w-3 h-3" aria-hidden="true" />}>
                      {t('goals.visibility.private')}
                    </Chip>
                  )}
                </div>
              </ModalHeader>
              <ModalBody className="space-y-6">
                {/* Description */}
                {detailGoal.description && (
                  <div>
                    <h4 className="text-sm font-semibold text-theme-primary mb-1">{t('goals.detail.description')}</h4>
                    <p className="text-sm text-theme-muted whitespace-pre-wrap">{detailGoal.description}</p>
                  </div>
                )}

                {/* Progress Visualization */}
                <div>
                  <h4 className="text-sm font-semibold text-theme-primary mb-2">{t('goals.detail.progress')}</h4>
                  <p className="text-xs text-theme-muted mb-2">{t('goals.detail.progress_explainer')}</p>
                  <div className="flex justify-between text-xs text-theme-subtle mb-1">
                    <span>{detailGoal.current_value} / {detailGoal.target_value}</span>
                    <span>{Math.min(100, Math.round(detailGoal.progress_percentage))}%</span>
                  </div>
                  <Progress
                    value={Math.min(100, detailGoal.progress_percentage)}
                    classNames={{
                      indicator: detailGoal.status === 'completed'
                        ? 'bg-emerald-500'
                        : 'bg-gradient-to-r from-accent to-accent-gradient-end',
                      track: 'bg-theme-hover',
                    }}
                    size="lg"
                    aria-label={t('goals.detail.progress_aria', { percent: Math.round(detailGoal.progress_percentage) })}
                  />
                </div>

                {/* Meta Info Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {detailGoal.deadline && (
                    <div className="bg-theme-elevated rounded-xl p-3">
                      <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                        <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('goals.detail.deadline')}
                      </div>
                      <p className="text-sm text-theme-primary font-medium">
                        {new Date(detailGoal.deadline).toLocaleDateString(getFormattingLocale(), { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                  )}
                  <div className="bg-theme-elevated rounded-xl p-3">
                    <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('goals.detail.created')}
                    </div>
                    <p className="text-sm text-theme-primary font-medium">
                      {new Date(detailGoal.created_at).toLocaleDateString(getFormattingLocale(), { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                  </div>
                  {detailGoal.buddy_name && (
                    <div className="bg-theme-elevated rounded-xl p-3">
                      <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                        <Users className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('goals.detail.buddy')}
                      </div>
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={detailGoal.buddy_name}
                          src={resolveAvatarUrl(detailGoal.buddy_avatar)}
                          size="sm"
                          className="w-6 h-6"
                        />
                        <p className="text-sm text-theme-primary font-medium">{detailGoal.buddy_name}</p>
                      </div>
                    </div>
                  )}
                  {!detailGoal.buddy_name && detailGoal.is_public && (
                    <div className="bg-theme-elevated rounded-xl p-3">
                      <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                        <Users className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('goals.detail.buddy')}
                      </div>
                      <p className="text-sm text-theme-muted">{t('goals.detail.no_buddy')}</p>
                    </div>
                  )}
                  {(detailGoal.likes_count !== undefined || detailGoal.comments_count !== undefined) && (
                    <div className="bg-theme-elevated rounded-xl p-3">
                      <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('goals.detail.social')}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-theme-primary font-medium">
                        {detailGoal.likes_count !== undefined && (
                          <span className="flex items-center gap-1">
                            <Heart className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" /> {detailGoal.likes_count}
                          </span>
                        )}
                        {detailGoal.comments_count !== undefined && (
                          <span className="flex items-center gap-1">
                            <MessageCircle className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" /> {detailGoal.comments_count}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Owner info (if viewing someone else's goal) */}
                {detailGoal.user_name && (
                  <div className="flex items-center gap-3 bg-theme-elevated rounded-xl p-3">
                    <Avatar
                      name={detailGoal.user_name}
                      src={resolveAvatarUrl(detailGoal.user_avatar)}
                      size="sm"
                    />
                    <div>
                      <p className="text-sm font-medium text-theme-primary">{detailGoal.user_name}</p>
                      <p className="text-xs text-theme-subtle">{t('goals.detail.goal_owner')}</p>
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-semibold text-theme-primary mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" aria-hidden="true" />
                    {t('goals.detail.insights')}
                  </h4>
                  <GoalInsightsPanel goalId={detailGoal.id} canNudge={detailGoal.is_buddy} />
                </div>

                {/* G5 - Full Progress History Timeline */}
                <div>
                  <h4 className="text-sm font-semibold text-theme-primary mb-3 flex items-center gap-2">
                    <History className="w-4 h-4 text-accent" aria-hidden="true" />
                    {t('goals.detail.progress_timeline')}
                  </h4>
                  <GoalProgressHistory goalId={detailGoal.id} />
                </div>
              </ModalBody>
              <ModalFooter>
                {tab === 'discover' && detailGoal && !detailGoal.is_owner && detailGoal.is_public && !detailGoal.buddy_id && !detailGoal.is_buddy && user && (
                  <Button
                    className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                    startContent={<UserPlus className="w-4 h-4" aria-hidden="true" />}
                    onPress={() => {
                      handleBecomeBuddy(detailGoal);
                      onDetailClose();
                    }}
                  >
                    {t('goals.become_buddy')}
                  </Button>
                )}
                <Button variant="flat" onPress={onDetailClose} className="text-theme-muted">{t('goals.modal.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

/* ───────────────────────── Goal Card ───────────────────────── */

interface GoalCardProps {
  goal: Goal;
  isOwner: boolean;
  currentUserId: number | null;
  isCelebrating: boolean;
  isDiscoverTab: boolean;
  isBuddyingTab?: boolean;
  onProgressUpdate: (goalId: number, increment: number) => void;
  onEdit: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
  onComplete: (goal: Goal) => void;
  onBecomeBuddy: (goal: Goal) => void;
  onBuddyAction: (goal: Goal, type: 'nudge' | 'encouragement' | 'offer_help') => void;
  onOpenDetail: (goal: Goal) => void;
  onCheckin: (goal: Goal) => void;
}

function GoalCard({
  goal,
  isOwner,
  currentUserId,
  isCelebrating,
  isDiscoverTab,
  isBuddyingTab = false,
  onProgressUpdate,
  onEdit,
  onDelete,
  onComplete,
  onBecomeBuddy,
  onBuddyAction,
  onOpenDetail,
  onCheckin,
}: GoalCardProps) {
  const { t } = useTranslation(['gamification', 'goals']);
  const { tenantPath } = useTenant();
  const isCompleted = goal.status === 'completed' || goal.progress_percentage >= 100;
  const deadlineDate = goal.deadline ? new Date(goal.deadline) : null;
  const isOverdue = deadlineDate && deadlineDate < new Date() && !isCompleted;
  const canComplete = isOwner && !isCompleted && goal.progress_percentage >= 100;
  const isBuddy = goal.is_buddy || (goal.buddy_id != null && goal.buddy_id === currentUserId);
  const canBecomeBuddy = isDiscoverTab && !isOwner && goal.is_public && !goal.buddy_id && !isBuddy && currentUserId !== null;

  return (
    <GlassCard className={`p-5 relative overflow-hidden ${isCompleted ? 'border-l-4 border-emerald-500' : ''} ${isOverdue ? 'border-l-4 border-red-500' : ''}`}>
      {/* Confetti celebration overlay */}
      <ConfettiCelebration show={isCelebrating} />

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Button
              variant="ghost"
              className="min-h-[32px] justify-start px-0 py-0 text-left text-lg font-semibold text-theme-primary hover:text-accent"
              onPress={() => onOpenDetail(goal)}
            >
              {goal.title}
            </Button>
            {isCompleted && (
              <Chip size="sm" color="success" variant="soft" startContent={<CheckCircle className="w-3 h-3" aria-hidden="true" />}>
                {t('goals.status.completed')}
              </Chip>
            )}
            {goal.is_public ? (
              <Chip size="sm" variant="flat" className="text-theme-subtle" startContent={<Globe className="w-3 h-3" aria-hidden="true" />}>
                {t('goals.visibility.public')}
              </Chip>
            ) : (
              <Chip size="sm" variant="flat" className="text-theme-subtle" startContent={<Lock className="w-3 h-3" aria-hidden="true" />}>
                {t('goals.visibility.private')}
              </Chip>
            )}
            {isBuddy && !isBuddyingTab && (
              <Chip size="sm" color="secondary" variant="flat" startContent={<Users className="w-3 h-3" />}>
                {t('goals.youre_a_buddy')}
              </Chip>
            )}
          </div>

          {goal.description && (
            <p className="text-sm text-theme-muted mb-3 line-clamp-2">{goal.description}</p>
          )}

          {/* Progress Bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-theme-subtle mb-1">
              <span>{goal.current_value} / {goal.target_value}</span>
              <span>{Math.min(100, Math.round(goal.progress_percentage))}%</span>
            </div>
            <Progress
              value={Math.min(100, goal.progress_percentage)}
              classNames={{
                indicator: isCompleted
                  ? 'bg-emerald-500'
                  : 'bg-gradient-to-r from-accent to-accent-gradient-end',
                track: 'bg-theme-hover',
              }}
              size="md"
              aria-label={t('goals.detail.progress_aria', { percent: Math.round(goal.progress_percentage) })}
            />
          </div>

          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-theme-subtle">
            {(goal.streak_count ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-orange-700 dark:text-orange-400">
                <Sparkles className="w-3 h-3" aria-hidden="true" />
                {t('goals.streak_label', { count: goal.streak_count })}
              </span>
            )}
            {deadlineDate && (
              <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 dark:text-red-400' : ''}`}>
                <Calendar className="w-3 h-3" aria-hidden="true" />
                {isOverdue ? t('goals.overdue') : t('goals.due')}{deadlineDate.toLocaleDateString(getFormattingLocale())}
              </span>
            )}
            {goal.buddy_name && !isBuddyingTab && (
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" aria-hidden="true" />
                {t('goals.buddy_label')}: {goal.buddy_name}
              </span>
            )}
            {(!isOwner || isBuddyingTab) && goal.user_name && (
              <Link
                to={tenantPath(`/profile/${goal.user_id}`)}
                className="flex items-center gap-1.5 hover:text-theme-primary transition-colors"
              >
                <Avatar
                  name={goal.user_name}
                  src={resolveAvatarUrl(goal.user_avatar)}
                  size="sm"
                  className="w-4 h-4"
                />
                {goal.user_name}
              </Link>
            )}
          </div>
        </div>

        {/* Actions Column */}
        <div className="flex flex-col gap-2 flex-shrink-0 items-end">
          {/* Owner 3-dot menu */}
          {isOwner && (
            <Dropdown>
              <DropdownTrigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="text-theme-muted"
                  aria-label={t('goals.actions_aria')}
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label={t('goals.actions_aria')}
                onAction={(key) => {
                  if (key === 'edit') onEdit(goal);
                  if (key === 'delete') onDelete(goal);
                }}
              >
                <DropdownItem
                  key="edit" id="edit"
                  startContent={<Edit3 className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('goals.action_edit')}
                </DropdownItem>
                <DropdownItem
                  key="delete" id="delete"
                  className="text-danger"
                  color="danger"
                  startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('goals.action_delete')}
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          )}

          {/* G4 - Reminder Toggle */}
          {isOwner && !isCompleted && (
            <GoalReminderToggle goalId={goal.id} />
          )}

          {/* G3 - Check-in button */}
          {isOwner && !isCompleted && (
            <Button
              size="sm"
              variant="flat"
              className="bg-accent/10 text-accent dark:text-accent"
              startContent={<ClipboardCheck className="w-4 h-4" aria-hidden="true" />}
              onPress={() => onCheckin(goal)}
            >
              {t('goals:checkin.check_in_button')}
            </Button>
          )}

          {/* Quick +1 for owner */}
          {isOwner && !isCompleted && (
            <Button
              size="sm"
              variant="flat"
              className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              onPress={() => onProgressUpdate(goal.id, 1)}
            >
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
              +1
            </Button>
          )}

          {/* Mark Complete button when progress >= 100% */}
          {canComplete && (
            <Button
              size="sm"
              className="bg-gradient-to-r from-emerald-500 to-green-600 text-white"
              startContent={<Award className="w-4 h-4" aria-hidden="true" />}
              onPress={() => onComplete(goal)}
            >
              {t('goals.mark_complete')}
            </Button>
          )}

          {/* Become Buddy for discover tab */}
          {canBecomeBuddy && (
            <Button
              size="sm"
              variant="flat"
              className="bg-accent/10 text-accent dark:text-accent"
              startContent={<UserPlus className="w-4 h-4" aria-hidden="true" />}
              onPress={() => onBecomeBuddy(goal)}
            >
              {t('goals.become_buddy')}
            </Button>
          )}

          {isBuddyingTab && isBuddy && !isCompleted && (
            <Button
              size="sm"
              variant="flat"
              className="bg-accent/10 text-accent dark:text-accent"
              startContent={<MessageCircle className="w-4 h-4" aria-hidden="true" />}
              onPress={() => onBuddyAction(goal, 'nudge')}
            >
              {t('goals.action_nudge')}
            </Button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export default GoalsPage;
