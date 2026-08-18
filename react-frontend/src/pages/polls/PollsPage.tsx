// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { DatePicker } from '@/components/ui/DatePicker';
import type { DateInputValue } from '@/components/ui/DatePicker';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectItem } from '@/components/ui/Select';
import { Separator } from '@/components/ui/Separator';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Switch } from '@/components/ui/Switch';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useDisclosure } from '@/components/ui/useDisclosure';
/**
 * PollsPage — Standalone polls listing with inline voting, creation, and tabs.
 *
 * Features:
 * - Open / Closed / My Polls tabs
 * - Expandable create-poll section at top
 * - Inline voting with optimistic updates
 * - Results display with HeroUI Progress bars
 * - Cursor-based pagination ("Load More")
 * - Delete confirmation modal (owner / admin)
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';
import BarChart3 from 'lucide-react/icons/chart-column';
import Plus from 'lucide-react/icons/plus';
import Clock from 'lucide-react/icons/clock';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Users from 'lucide-react/icons/users';
import Trash2 from 'lucide-react/icons/trash-2';
import X from 'lucide-react/icons/x';
import ChevronUp from 'lucide-react/icons/chevron-up';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Check from 'lucide-react/icons/check';
import TrendingUp from 'lucide-react/icons/trending-up';
import GripVertical from 'lucide-react/icons/grip-vertical';
import EyeOff from 'lucide-react/icons/eye-off';
import Download from 'lucide-react/icons/download';
import Tag from 'lucide-react/icons/tag';
import ListOrdered from 'lucide-react/icons/list-ordered';
import Filter from 'lucide-react/icons/filter';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { api, API_BASE, tokenManager } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, formatNumber, formatRelativeTime } from '@/lib/helpers';

/* ───────────────────────── Types ───────────────────────── */

interface PollOption {
  id: number;
  label: string;
  /** null when results are hidden (open poll, non-creator ballot-integrity rule) */
  vote_count: number | null;
  percentage: number | null;
}

interface Poll {
  id: number;
  question: string;
  description: string | null;
  expires_at: string | null;
  created_at: string;
  total_votes: number;
  status: 'open' | 'closed';
  has_voted: boolean;
  voted_option_id: number | null;
  options: PollOption[];
  creator: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
  poll_type?: 'standard' | 'ranked';
  category?: string | null;
  is_anonymous?: boolean;
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
}

type PollTab = 'open' | 'closed' | 'mine';

const ITEMS_PER_PAGE = 20;

/* ───────────────────────── Time Remaining Helper ───────────────────────── */

function getTimeRemaining(expiresAt: string): string | null {
  const now = new Date();
  const end = new Date(expiresAt);
  const diffMs = end.getTime() - now.getTime();

  if (diffMs <= 0) return null;

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  return `${diffMinutes}m`;
}

/* ───────────────────────── Poll Card ───────────────────────── */

interface PollCardProps {
  poll: Poll;
  currentUserId?: number;
  onVote: (pollId: number, optionId: number) => void;
  onDelete: (poll: Poll) => void;
  onRankedVote: (poll: Poll) => void;
  onExport: (pollId: number) => void;
}

const PollCard = memo(function PollCard({ poll, currentUserId, onVote, onDelete, onRankedVote, onExport }: PollCardProps) {
  const { t } = useTranslation('polls');
  const { tenantPath } = useTenant();

  const isOwner = currentUserId === poll.creator.id;
  const isOpen = poll.status === 'open';
  const hasVoted = poll.has_voted;
  const resultsVisible = poll.options.some((o) => o.percentage !== null);
  const showResults = (hasVoted || !isOpen) && resultsVisible;

  const timeRemaining = poll.expires_at ? getTimeRemaining(poll.expires_at) : null;
  const isExpired = poll.expires_at ? new Date(poll.expires_at) <= new Date() : false;

  return (
    <GlassCard hoverable className="overflow-hidden">
      {/* Status accent bar */}
      <div className={`h-0.5 bg-gradient-to-r ${isOpen ? 'from-amber-500/30 to-orange-500/30' : 'from-gray-400/20 to-gray-500/20'}`} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={tenantPath(`/profile/${poll.creator.id}`)}>
              <Avatar
                name={poll.creator.name}
                src={resolveAvatarUrl(poll.creator.avatar_url)}
                size="sm"
                className="ring-2 ring-[var(--border-default)] flex-shrink-0"
                isBordered
              />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  to={tenantPath(`/profile/${poll.creator.id}`)}
                  className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--color-primary)] transition-colors truncate"
                >
                  {poll.creator.name}
                </Link>
                <Chip
                  size="sm"
                  variant="soft"
                  color={isOpen ? 'warning' : 'default'}
                  startContent={isOpen ? <BarChart3 className="w-3 h-3" aria-hidden="true" /> : <CheckCircle className="w-3 h-3" aria-hidden="true" />}
                  className="text-[10px] h-5"
                >
                  {isOpen ? t('status.open') : t('status.closed')}
                </Chip>
                {/* P1 - Ranked poll indicator */}
                {poll.poll_type === 'ranked' && (
                  <Chip
                    size="sm"
                    variant="soft"
                    color="default"
                    startContent={<ListOrdered className="w-3 h-3" aria-hidden="true" />}
                    className="text-[10px] h-5"
                  >
                    {t('badges.ranked')}
                  </Chip>
                )}
                {/* P3 - Anonymous badge */}
                {poll.is_anonymous && (
                  <Chip
                    size="sm"
                    variant="soft"
                    className="text-[10px] h-5 bg-gray-500/10 text-gray-600 dark:text-gray-400"
                    startContent={<EyeOff className="w-3 h-3" aria-hidden="true" />}
                  >
                    {t('badges.anonymous')}
                  </Chip>
                )}
                {/* P2 - Category badge */}
                {poll.category && (
                  <Chip
                    size="sm"
                    variant="soft"
                    className="text-[10px] h-5 bg-blue-500/10 text-blue-400"
                    startContent={<Tag className="w-3 h-3" aria-hidden="true" />}
                  >
                    {poll.category}
                  </Chip>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--text-subtle)]">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {formatRelativeTime(poll.created_at)}
                </span>
                {isOpen && timeRemaining && (
                  <span className="flex items-center gap-1 text-[var(--color-warning)]">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    {t('time_remaining', { time: timeRemaining })}
                  </span>
                )}
                {isOpen && isExpired && (
                  <span className="text-danger text-xs">{t('expired')}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* P4 - Export CSV (owner/admin only) */}
            {isOwner && (
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                className="text-[var(--text-subtle)] hover:text-[var(--color-primary)] min-w-0"
                onPress={() => onExport(poll.id)}
                aria-label={t('aria.export_csv')}
              >
                <Download className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
            {isOwner && (
              <Button
                isIconOnly
                size="sm"
                variant="danger-soft"
                className="text-[var(--text-subtle)] hover:text-danger min-w-0"
                onPress={() => onDelete(poll)}
                aria-label={t('delete_poll')}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>

        {/* Question */}
        <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">{poll.question}</h3>
        {poll.description && (
          <p className="text-sm text-[var(--text-secondary)] mb-3">{poll.description}</p>
        )}

        {/* Options */}
        <div className="space-y-2.5 mb-3">
          {poll.options.map((option) => {
            const isVotedOption = poll.voted_option_id === option.id;

            return (
              <div key={option.id}>
                {showResults ? (
                  /* Results view */
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm ${isVotedOption ? 'font-semibold text-[var(--color-primary)]' : 'text-[var(--text-primary)]'}`}>
                        {isVotedOption && <Check className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" aria-hidden="true" />}
                        {option.label}
                      </span>
                      <span className={`text-xs font-medium ml-2 ${isVotedOption ? 'text-[var(--color-primary)]' : 'text-[var(--text-muted)]'}`}>
                        {option.percentage !== null ? `${option.percentage}%` : '—'}
                      </span>
                    </div>
                    <Progress
                      value={option.percentage ?? 0}
                      size="sm"
                      color={isVotedOption ? 'primary' : 'default'}
                      classNames={{
                        track: 'bg-[var(--surface-hover)]',
                        indicator: isVotedOption ? 'bg-gradient-to-r from-accent to-accent-gradient-end' : '',
                      }}
                      aria-label={`${option.label}: ${option.percentage !== null ? `${option.percentage}%` : '—'}`}
                    />
                  </div>
                ) : poll.poll_type === 'ranked' ? (
                  /* P1 - Ranked poll: show label only (voting done in modal) */
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface-hover)]/50">
                    <GripVertical className="w-3.5 h-3.5 text-[var(--text-subtle)]" aria-hidden="true" />
                    <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
                  </div>
                ) : (
                  /* Standard vote button */
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start text-[var(--text-primary)] border-[var(--border-default)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-all"
                    onPress={() => onVote(poll.id, option.id)}
                    aria-label={t('vote_for_option', { option: option.label, question: poll.question })}
                  >
                    {option.label}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* P1 - Ranked poll vote button */}
        {poll.poll_type === 'ranked' && isOpen && !hasVoted && (
          <Button
            size="sm"
            className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white mb-3"
            startContent={<ListOrdered className="w-4 h-4" aria-hidden="true" />}
            onPress={() => onRankedVote(poll)}
          >
            {t('rank_preferences')}
          </Button>
        )}

        {/* Footer stats */}
        <div className="flex items-center gap-3 text-xs text-[var(--text-subtle)]">
          <span className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" aria-hidden="true" />
            {poll.total_votes} {poll.total_votes === 1 ? t('votes_one') : t('votes')}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="w-3 h-3" aria-hidden="true" />
            {poll.options.length} {t('options')}
          </span>
        </div>

        <SocialInteractionPanel
          targetType="poll"
          targetId={poll.id}
          initialLiked={poll.is_liked ?? false}
          initialLikesCount={poll.likes_count ?? 0}
          initialCommentsCount={poll.comments_count ?? 0}
          title={poll.question}
          description={poll.description}
          targetOwnerId={poll.creator.id}
          className="mt-3"
          compact
        />
      </div>
    </GlassCard>
  );
});

/* ───────────────────────── Animation variants ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/* ───────────────────────── Main Component ───────────────────────── */

export function PollsPage() {
  const { t } = useTranslation('polls');
  usePageTitle(t('page_title'));
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  /* ── State ── */
  const [polls, setPolls] = useState<Poll[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [tab, setTab] = useState<PollTab>('open');

  /* ── Create form ── */
  const [showCreate, setShowCreate] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newOptions, setNewOptions] = useState<string[]>(['', '']);
  const [newExpiresAt, setNewExpiresAt] = useState<DateInputValue | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newPollType, setNewPollType] = useState<'standard' | 'ranked'>('standard');
  const [newCategory, setNewCategory] = useState('');
  const [newIsAnonymous, setNewIsAnonymous] = useState(false);

  /* ── P2 Categories ── */
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  /* ── P1 Ranked-choice ── */
  const { isOpen: isRankedOpen, onOpen: onRankedOpen, onClose: onRankedClose } = useDisclosure();
  const [rankedPoll, setRankedPoll] = useState<Poll | null>(null);
  const [rankOrder, setRankOrder] = useState<number[]>([]);
  const [isSubmittingRank, setIsSubmittingRank] = useState(false);
  const [rankedResults, setRankedResults] = useState<Record<string, unknown> | null>(null);
  const [isLoadingRanked, setIsLoadingRanked] = useState(false);

  /* ── Delete modal ── */
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const [deletingPoll, setDeletingPoll] = useState<Poll | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  /* ── Load categories on mount (P2) ── */
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await api.get<string[]>('/v2/polls/categories');
        if (response.success && response.data) {
          setCategories(Array.isArray(response.data) ? response.data : []);
        }
      } catch (err) {
        logError('Failed to load poll categories', err);
      }
    };
    loadCategories();
  }, []);

  /* ── Data loading ── */
  const loadPolls = useCallback(async (append = false) => {
    if (!append) {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
    }
    const controller = abortRef.current!;

    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      params.set('per_page', String(ITEMS_PER_PAGE));
      if (append && cursor) params.set('cursor', cursor);

      if (tab === 'open') {
        params.set('status', 'open');
      } else if (tab === 'closed') {
        params.set('status', 'closed');
      } else if (tab === 'mine') {
        params.set('mine', '1');
      }

      // P2 - Category filter
      if (selectedCategory) {
        params.set('category', selectedCategory);
      }

      const response = await api.get<Poll[]>(`/v2/polls?${params}`);

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];
        if (append) {
          setPolls((prev) => [...prev, ...items]);
        } else {
          setPolls(items);
        }
        setHasMore(response.meta?.has_more ?? items.length >= ITEMS_PER_PAGE);
        setCursor(response.meta?.cursor ?? undefined);
      } else {
        if (!append) setError(tRef.current('errors.load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load polls', err);
      if (!append) {
        setError(tRef.current('errors.load_failed'));
      } else {
        toastRef.current.error(tRef.current('errors.load_more_failed'));
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [tab, cursor, selectedCategory]);

  // Reload when tab or category changes
  useEffect(() => {
    setCursor(undefined);
    loadPolls();
  }, [tab, selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on tab/category change; loadPolls excluded to avoid loop

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    loadPolls(true);
  }, [isLoadingMore, hasMore, loadPolls]);

  /* ── Create poll ── */
  const validOptions = newOptions.filter((o) => o.trim().length > 0);
  const canCreate = newQuestion.trim().length > 0 && validOptions.length >= 2;

  const addOption = () => {
    if (newOptions.length < 6) {
      setNewOptions((prev) => [...prev, '']);
    }
  };

  const updateOption = (index: number, value: string) => {
    setNewOptions((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const removeOption = (index: number) => {
    if (newOptions.length > 2) {
      setNewOptions((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const resetCreateForm = () => {
    setNewQuestion('');
    setNewDescription('');
    setNewOptions(['', '']);
    setNewExpiresAt(null);
    setNewPollType('standard');
    setNewCategory('');
    setNewIsAnonymous(false);
  };

  const handleCreate = async () => {
    if (!newQuestion.trim()) {
      toastRef.current.error(tRef.current('errors.question_required'));
      return;
    }
    if (validOptions.length < 2) {
      toastRef.current.error(tRef.current('errors.min_options'));
      return;
    }

    try {
      setIsCreating(true);
      const payload: Record<string, unknown> = {
        question: newQuestion.trim(),
        description: newDescription.trim() || undefined,
        options: validOptions.map((o) => o.trim()),
        poll_type: newPollType,
        is_anonymous: newIsAnonymous,
      };

      if (newCategory.trim()) {
        payload.category = newCategory.trim();
      }

      if (newExpiresAt) {
        payload.expires_at = newExpiresAt.toString();
      }

      const response = await api.post('/v2/polls', payload);

      if (response.success) {
        resetCreateForm();
        setShowCreate(false);
        toastRef.current.success(tRef.current('toast.created'));
        // If we're on the "open" or "mine" tab, reload to show the new poll
        if (tab === 'open' || tab === 'mine') {
          setCursor(undefined);
          loadPolls();
        } else {
          setTab('open');
        }
      } else {
        toastRef.current.error(tRef.current('toast.create_failed'));
      }
    } catch (err) {
      logError('Failed to create poll', err);
      toastRef.current.error(tRef.current('toast.create_failed'));
    } finally {
      setIsCreating(false);
    }
  };

  /* ── Vote ── */
  const handleVote = useCallback(async (pollId: number, optionId: number) => {
    // Optimistic update
    setPolls((prev) =>
      prev.map((poll) => {
        if (poll.id !== pollId) return poll;

        const wasVoted = poll.has_voted;
        const newTotal = poll.total_votes + (wasVoted ? 0 : 1);

        const updatedOptions = poll.options.map((opt) => {
          // vote_count can be null when results are hidden; skip optimistic
          // count math in that case (percentage will stay null until reload)
          if (opt.vote_count === null) return opt;
          let newCount = opt.vote_count;
          if (opt.id === poll.voted_option_id) newCount -= 1;
          if (opt.id === optionId) newCount += 1;
          newCount = Math.max(0, newCount);
          return {
            ...opt,
            vote_count: newCount,
            percentage: newTotal > 0 ? Math.round((newCount / newTotal) * 1000) / 10 : 0,
          };
        });

        return {
          ...poll,
          has_voted: true,
          voted_option_id: optionId,
          total_votes: newTotal,
          options: updatedOptions,
        };
      })
    );

    try {
      const response = await api.post(`/v2/polls/${pollId}/vote`, { option_id: optionId });
      if (response.success) {
        toastRef.current.success(tRef.current('toast.voted'));
      } else {
        // Revert on failure
        loadPolls();
        toastRef.current.error(tRef.current('toast.vote_failed'));
      }
    } catch (err) {
      logError('Failed to vote', err);
      loadPolls();
      toastRef.current.error(tRef.current('toast.vote_failed'));
    }
  }, [loadPolls]);

  /* ── Delete ── */
  const openDeleteModal = (poll: Poll) => {
    setDeletingPoll(poll);
    onDeleteOpen();
  };

  const handleDelete = async () => {
    if (!deletingPoll) return;

    try {
      setIsDeleting(true);
      const response = await api.delete(`/v2/polls/${deletingPoll.id}`);

      if (response.success) {
        onDeleteClose();
        setDeletingPoll(null);
        toastRef.current.success(tRef.current('toast.deleted'));
        // Remove from local state
        setPolls((prev) => prev.filter((p) => p.id !== deletingPoll.id));
      } else {
        toastRef.current.error(tRef.current('toast.delete_failed'));
      }
    } catch (err) {
      logError('Failed to delete poll', err);
      toastRef.current.error(tRef.current('toast.delete_failed'));
    } finally {
      setIsDeleting(false);
    }
  };

  /* ── P1: Ranked-choice voting ── */
  const openRankedVote = (poll: Poll) => {
    setRankedPoll(poll);
    setRankOrder(poll.options.map((o) => o.id));
    setRankedResults(null);
    onRankedOpen();
  };

  const loadRankedResults = async (pollId: number) => {
    try {
      setIsLoadingRanked(true);
      const response = await api.get<Record<string, unknown>>(`/v2/polls/${pollId}/ranked-results`);
      if (response.success && response.data) {
        setRankedResults(response.data);
      }
    } catch (err) {
      logError('Failed to load ranked results', err);
      toastRef.current.error(tRef.current('toast.vote_failed'));
    } finally {
      setIsLoadingRanked(false);
    }
  };

  const handleRankedSubmit = async () => {
    if (!rankedPoll) return;
    try {
      setIsSubmittingRank(true);
      const response = await api.post(`/v2/polls/${rankedPoll.id}/rank`, {
        rankings: rankOrder,
      });

      if (response.success) {
        toastRef.current.success(tRef.current('toast.voted'));
        onRankedClose();
        loadPolls();
      } else {
        toastRef.current.error(tRef.current('toast.vote_failed'));
      }
    } catch (err) {
      logError('Failed to submit ranked vote', err);
      toastRef.current.error(tRef.current('toast.vote_failed'));
    } finally {
      setIsSubmittingRank(false);
    }
  };

  const moveRankUp = (index: number) => {
    if (index === 0) return;
    setRankOrder((prev) => {
      const next = [...prev];
      const a = next[index - 1];
      const b = next[index];
      if (a !== undefined && b !== undefined) {
        next[index - 1] = b;
        next[index] = a;
      }
      return next;
    });
  };

  const moveRankDown = (index: number) => {
    setRankOrder((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      const a = next[index];
      const b = next[index + 1];
      if (a !== undefined && b !== undefined) {
        next[index] = b;
        next[index + 1] = a;
      }
      return next;
    });
  };

  /* ── P4: Export CSV ── */
  const handleExport = async (pollId: number) => {
    try {
      const token = tokenManager.getAccessToken();
      const tenantId = tokenManager.getTenantId();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (tenantId) headers['X-Tenant-ID'] = tenantId;

      const response = await fetch(`${API_BASE}/v2/polls/${pollId}/export`, {
        headers,
        credentials: 'include',
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `poll-${pollId}-results.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        toastRef.current.success(tRef.current('toast.csv_exported'));
      } else {
        toastRef.current.error(tRef.current('toast.export_failed'));
      }
    } catch (err) {
      logError('Failed to export poll', err);
      toastRef.current.error(tRef.current('toast.export_failed'));
    }
  };

  /* ── Tab change handler ── */
  const handleTabChange = (key: React.Key) => {
    setTab(key as PollTab);
  };

  /* ── Empty state description by tab ── */
  const getEmptyDescription = () => {
    switch (tab) {
      case 'closed':
        return t('empty.description_closed');
      case 'mine':
        return t('empty.description_mine');
      default:
        return t('empty.description');
    }
  };

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_meta.title')} noIndex />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <BarChart3 className="w-7 h-7 text-amber-400" aria-hidden="true" />
            {t('title')}
          </h1>
          <p className="text-theme-muted mt-1">{t('subtitle')}</p>
        </div>
        {isAuthenticated && (
          <Button
            className="bg-gradient-to-r from-amber-500 to-orange-600 text-white"
            startContent={showCreate ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
            onPress={() => setShowCreate(!showCreate)}
          >
            {showCreate ? t('collapse') : t('expand')}
          </Button>
        )}
      </div>

      {/* Create Poll Section */}
      <AnimatePresence>
        {showCreate && isAuthenticated && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <GlassCard className="p-5">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-amber-400" aria-hidden="true" />
                {t('create_poll')}
              </h2>

              <div className="space-y-4">
                {/* Question */}
                <Input
                  label={t('question')}
                  placeholder={t('question_placeholder')}
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  classNames={{
                    input: 'bg-transparent text-[var(--text-primary)]',
                    inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
                  }}
                />

                {/* Description */}
                <Textarea
                  label={t('description')}
                  placeholder={t('description_placeholder')}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  minRows={2}
                  maxRows={4}
                  classNames={{
                    input: 'bg-transparent text-[var(--text-primary)]',
                    inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
                  }}
                />

                {/* Options */}
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)] mb-2">{t('options')}</p>
                  <div className="space-y-2">
                    {newOptions.map((opt, index) => (
                      <div key={`option-${index}`} className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full border-2 border-[var(--border-default)] flex-shrink-0 flex items-center justify-center text-[10px] text-[var(--text-subtle)] font-medium">
                          {index + 1}
                        </div>
                        <Input
                          placeholder={t('option_placeholder', { number: index + 1 })}
                          value={opt}
                          onChange={(e) => updateOption(index, e.target.value)}
                          size="sm"
                          aria-label={t('option_placeholder', { number: index + 1 })}
                          classNames={{
                            input: 'bg-transparent text-[var(--text-primary)]',
                            inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
                          }}
                        />
                        {newOptions.length > 2 && (
                          <Button
                            isIconOnly
                            size="sm"
                            variant="tertiary"
                            className="text-[var(--text-muted)] min-w-8 w-8 h-8 hover:text-danger"
                            onPress={() => removeOption(index)}
                            aria-label={`${t('remove_option')} ${index + 1}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ))}

                    {newOptions.length < 6 && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="bg-[var(--surface-elevated)] text-[var(--color-primary)]"
                        startContent={<Plus className="w-3 h-3" aria-hidden="true" />}
                        onPress={addOption}
                      >
                        {t('add_option')}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Poll Type (P1) */}
                <Select
                  label={t('poll_type')}
                  selectedKeys={[newPollType]}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    if (val === 'standard' || val === 'ranked') {
                      setNewPollType(val);
                    }
                  }}
                  classNames={{
                    trigger: 'bg-[var(--surface-elevated)] border-[var(--border-default)]',
                    value: 'text-[var(--text-primary)]',
                  }}
                >
                  <SelectItem key="standard" id="standard">{t('poll_type_standard')}</SelectItem>
                  <SelectItem key="ranked" id="ranked">{t('poll_type_ranked')}</SelectItem>
                </Select>

                {/* Category (P2) */}
                <Input
                  label={t('category_label')}
                  placeholder={t('category_placeholder')}
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  classNames={{
                    input: 'bg-transparent text-[var(--text-primary)]',
                    inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
                  }}
                />

                {/* Anonymous (P3) */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{t('anonymous_voting')}</p>
                    <p className="text-xs text-[var(--text-muted)]">{t('anonymous_voting_desc')}</p>
                  </div>
                  <Switch
                    isSelected={newIsAnonymous}
                    onValueChange={setNewIsAnonymous}
                    aria-label={t('anonymous_voting')}
                  />
                </div>

                {/* Expiry date */}
                <DatePicker
                  label={t('expires_at')}
                  value={newExpiresAt}
                  onChange={setNewExpiresAt}
                  granularity="day"
                  classNames={{
                    inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
                  }}
                  description={t('no_deadline')}
                />

                <Separator />

                {/* Actions */}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="tertiary"
                    size="sm"
                    onPress={() => {
                      resetCreateForm();
                      setShowCreate(false);
                    }}
                    className="text-[var(--text-muted)]"
                  >
                    {t('confirm_delete.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/20"
                    onPress={handleCreate}
                    isLoading={isCreating}
                    isDisabled={!canCreate}
                  >
                    {t('submit')}
                  </Button>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <GlassCard className="p-2">
        <Tabs
          selectedKey={tab}
          onSelectionChange={handleTabChange}
          variant="secondary"
          aria-label={t('tabs.aria_label')}
          classNames={{
            tabList: 'gap-2',
            tab: 'px-4 py-2',
          }}
        >
          <Tab key="open" title={t('tabs.open')} />
          <Tab key="closed" title={t('tabs.closed')} />
          <Tab key="mine" title={t('tabs.mine')} />
        </Tabs>
      </GlassCard>

      {/* P2 - Category Filter */}
      {categories.length > 0 && (
        <ToggleButtonGroup
          aria-label={t('category_filter_label')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={new Set([selectedCategory ?? '__all__'])}
          onSelectionChange={(keys) => { const [k] = Array.from(keys); setSelectedCategory(!k || k === '__all__' ? null : String(k)); }}
          className="flex gap-2 flex-wrap"
        >
          <ToggleButton
            id="__all__"
            variant="ghost"
            className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-amber-500 data-[selected=true]:to-orange-600 data-[selected=true]:text-white"
          >
            <Filter className="w-3.5 h-3.5" aria-hidden="true" />
            {t('all_categories')}
          </ToggleButton>
          {categories.map((cat) => (
            <ToggleButton
              key={cat}
              id={cat}
              variant="ghost"
              className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-amber-500 data-[selected=true]:to-orange-600 data-[selected=true]:text-white"
            >
              {cat}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('errors.load_failed')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadPolls()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Polls List */}
      {!error && (
        <>
          {isLoading ? (
            /* Loading skeleton */
            <div className="space-y-4" role="status" aria-label={t('loading')} aria-busy="true">
              {[1, 2, 3].map((i) => (
                <CardRowsSkeleton key={i} />
              ))}
            </div>
          ) : polls.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="w-12 h-12" aria-hidden="true" />}
              title={t('empty.title')}
              description={getEmptyDescription()}
              action={
                isAuthenticated && tab !== 'closed' && (
                  <Button
                    className="bg-gradient-to-r from-amber-500 to-orange-600 text-white"
                    startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                    onPress={() => setShowCreate(true)}
                  >
                    {t('create_poll')}
                  </Button>
                )
              }
            />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-4"
            >
              {polls.map((poll) => (
                <motion.div key={poll.id} variants={itemVariants}>
                  <PollCard
                    poll={poll}
                    currentUserId={user?.id}
                    onVote={handleVote}
                    onDelete={openDeleteModal}
                    onRankedVote={openRankedVote}
                    onExport={handleExport}
                  />
                </motion.div>
              ))}

              {/* Load More */}
              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="secondary"
                    className="bg-theme-elevated text-theme-muted"
                    onPress={loadMore}
                    isLoading={isLoadingMore}
                  >
                    {t('load_more')}
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}

      {/* P1 - Ranked-Choice Voting Modal */}
      <Modal
        isOpen={isRankedOpen}
        onClose={onRankedClose}
        size="lg"
        classNames={{ base: 'bg-overlay border border-theme-default' }}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <ModalHeading className="flex items-center gap-2 text-[var(--text-primary)]">
              <ListOrdered className="w-5 h-5 text-accent" aria-hidden="true" />
              {t('rank_preferences')}
            </ModalHeading>
            {rankedPoll && (
              <p className="text-sm text-[var(--text-muted)] font-normal">{rankedPoll.question}</p>
            )}
          </ModalHeader>
          <ModalBody>
            {rankedPoll && (
              <div className="space-y-4">
                <p className="text-xs text-[var(--text-subtle)]">
                  {t('ranked_instructions')}
                </p>

                <div className="space-y-2">
                  {rankOrder.map((optionId, index) => {
                    const option = rankedPoll.options.find((o) => o.id === optionId);
                    if (!option) return null;
                    return (
                      <div
                        key={optionId}
                        className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border-default)]"
                      >
                        <div className="w-7 h-7 rounded-full bg-gradient-to-r from-accent to-accent-gradient-end flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {index + 1}
                        </div>
                        <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                          {option.label}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="tertiary"
                            className="text-[var(--text-subtle)] min-w-0 w-7 h-7"
                            onPress={() => moveRankUp(index)}
                            isDisabled={index === 0}
                            aria-label={t('aria.move_rank_up', { option: option.label })}
                          >
                            <ChevronUp className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="tertiary"
                            className="text-[var(--text-subtle)] min-w-0 w-7 h-7 rotate-180"
                            onPress={() => moveRankDown(index)}
                            isDisabled={index === rankOrder.length - 1}
                            aria-label={t('aria.move_rank_down', { option: option.label })}
                          >
                            <ChevronUp className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Show ranked results button for closed polls */}
                {rankedPoll.status === 'closed' && (
                  <div className="pt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-theme-elevated text-theme-primary"
                      onPress={() => loadRankedResults(rankedPoll.id)}
                      isLoading={isLoadingRanked}
                    >
                      {t('view_ranked_results')}
                    </Button>
                    {rankedResults && (
                      <div className="mt-3 p-3 rounded-xl bg-theme-elevated space-y-3">
                        <h4 className="text-sm font-semibold text-theme-primary">{t('ranked_results_title')}</h4>
                        {/* Winner */}
                        {rankedResults.winner ? (
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                            <TrendingUp className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                            <span className="text-sm font-medium text-theme-success">
                              {t('winner_label', { name: String(rankedResults.winner) })}
                            </span>
                          </div>
                        ) : null}
                        {/* Rounds */}
                        {Array.isArray(rankedResults.rounds) && (rankedResults.rounds as Array<Record<string, unknown>>).map((round, idx) => {
                          const votes = round.votes as Record<string, number> | undefined;
                          const eliminated = round.eliminated as string | undefined;
                          return (
                            <div key={idx} className="p-2 rounded-lg border border-[var(--border-default)]">
                              <p className="text-xs font-semibold text-theme-muted mb-1.5">{t('round_number', { number: idx + 1 })}</p>
                              {votes && Object.entries(votes)
                                .sort(([, a], [, b]) => b - a)
                                .map(([option, count]) => {
                                  const totalBallots = Number(rankedResults.total_ballots) || Object.values(votes).reduce((s, v) => s + v, 0);
                                  const pct = totalBallots > 0 ? Math.round((count / totalBallots) * 100) : 0;
                                  return (
                                    <div key={option} className="flex items-center gap-2 mb-1">
                                      <span className={`text-xs flex-1 truncate ${eliminated === option ? 'line-through text-theme-subtle' : 'text-theme-primary'}`}>
                                        {option}
                                      </span>
                                      <Progress
                                        aria-label={option}
                                        size="sm"
                                        value={pct}
                                        className="w-24"
                                        classNames={{ track: 'bg-[var(--surface-hover)]', indicator: 'bg-gradient-to-r from-accent to-accent-gradient-end' }}
                                      />
                                      <span className="text-xs text-theme-muted w-12 text-right">
                                        {count} ({formatNumber(pct / 100, { style: 'percent', maximumFractionDigits: 0 })})
                                      </span>
                                    </div>
                                  );
                                })}
                              {eliminated && (
                                <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">{t('eliminated_candidate', { name: eliminated })}</p>
                              )}
                            </div>
                          );
                        })}
                        {/* Total ballots */}
                        {rankedResults.total_ballots ? (
                          <p className="text-xs text-theme-subtle">{t('total_ballots', { count: Number(rankedResults.total_ballots) })}</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onRankedClose} className="text-[var(--text-muted)]">
              {t('confirm_delete.cancel')}
            </Button>
            {rankedPoll?.status === 'open' && (
              <Button
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                onPress={handleRankedSubmit}
                isLoading={isSubmittingRank}
              >
                {t('submit_rankings')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} size="sm">
        <ModalContent>
          <ModalHeader className="text-[var(--text-primary)]">
            {t('confirm_delete.title')}
          </ModalHeader>
          <ModalBody>
            <p className="text-[var(--text-secondary)]">
              {t('confirm_delete.message')}
            </p>
            {deletingPoll && (
              <p className="text-sm font-medium text-[var(--text-primary)] mt-2 italic">
                &ldquo;{deletingPoll.question}&rdquo;
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={onDeleteClose}
              className="text-[var(--text-muted)]"
            >
              {t('confirm_delete.cancel')}
            </Button>
            <Button
              variant="danger"
              onPress={handleDelete}
              isLoading={isDeleting}
            >
              {t('confirm_delete.confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default PollsPage;
