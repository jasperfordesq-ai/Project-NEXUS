// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Progress } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Skeleton';
/**
 * GoalDetailPage — single-goal view at /goals/:id.
 *
 * Used for deep-links from feed cards (ShareButton, FeedCard chip,
 * "View detail" CTA). Shows the same content the in-page detail
 * modal renders on /goals, but as a standalone route.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Target from 'lucide-react/icons/target';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Globe from 'lucide-react/icons/globe';
import Lock from 'lucide-react/icons/lock';
import History from 'lucide-react/icons/history';
import Sparkles from 'lucide-react/icons/sparkles';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { GoalProgressHistory } from './components/GoalProgressHistory';
import { GoalInsightsPanel } from './components/GoalInsightsPanel';
import { GoalBuddyRequests } from './components/GoalBuddyRequests';

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
  user_name: string;
  user_avatar: string | null;
  progress_percentage: number;
  is_owner?: boolean;
  buddy_id?: number | null;
  buddy_name?: string | null;
  buddy_avatar?: string | null;
  is_buddy?: boolean;
  buddy_request_pending?: boolean;
  pending_buddy_requests_count?: number;
  likes_count?: number;
  comments_count?: number;
  is_liked?: boolean;
  checkin_frequency?: string | null;
}

export function GoalDetailPage() {
  const { t } = useTranslation('gamification');
  const { t: tGoals } = useTranslation('goals');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { tenantPath } = useTenant();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  usePageTitle(goal?.title ?? t('goals.page_title'));

  const reqIdRef = useRef(0);
  const loadGoal = useCallback(async () => {
    if (!id) return;
    const reqId = ++reqIdRef.current;
    try {
      setIsLoading(true);
      setError(null);
      setForbidden(false);
      setNotFound(false);

      const response = await api.get<Goal>(`/v2/goals/${id}`);
      if (reqId !== reqIdRef.current) return; // a newer load started — drop this stale response

      if (response.success && response.data && response.data.id) {
        setGoal(response.data);
      } else {
        const code = response.code;
        if (code === 'RESOURCE_NOT_FOUND') {
          setNotFound(true);
        } else if (code === 'RESOURCE_FORBIDDEN') {
          setForbidden(true);
        } else {
          setError(t('goals.load_error'));
        }
      }
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      logError('Failed to load goal detail', err);
      setError(t('goals.load_error'));
    } finally {
      if (reqId === reqIdRef.current) setIsLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadGoal();
  }, [loadGoal]);

  const backButton = (
    <Button
      variant="flat"
      className="bg-theme-elevated text-theme-primary"
      startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
      onPress={() => navigate(tenantPath('/goals'))}
    >
      {tGoals('detail.back_to_goals')}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageMeta title={t('page_meta.goals.title')} noIndex />
        {backButton}
        <div role="status" aria-label={t('goals.loading')} aria-busy="true">
          <GlassCard className="p-6 space-y-4">
            <Skeleton className="h-7 rounded-lg w-1/2" />
            <Skeleton className="h-3 rounded-lg w-full" />
            <Skeleton className="h-2 rounded-lg w-full" />
            <Skeleton className="h-3 rounded-lg w-1/3" />
          </GlassCard>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <PageMeta title={t('page_meta.goals.title')} noIndex />
        {backButton}
        <EmptyState
          icon={<Target className="w-12 h-12" aria-hidden="true" />}
          title={tGoals('detail.not_found_title')}
          description={tGoals('detail.not_found_description')}
        />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="space-y-6">
        <PageMeta title={t('page_meta.goals.title')} noIndex />
        {backButton}
        <EmptyState
          icon={<Lock className="w-12 h-12" aria-hidden="true" />}
          title={tGoals('detail.private_title')}
          description={tGoals('detail.private_description')}
        />
      </div>
    );
  }

  if (error || !goal) {
    return (
      <div className="space-y-6">
        <PageMeta title={t('page_meta.goals.title')} noIndex />
        {backButton}
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('goals.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error ?? t('goals.load_error')}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            onPress={loadGoal}
          >
            {t('goals.try_again')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  const isOwner = goal.is_owner ?? goal.user_id === user?.id;
  const showPrivateFields = isOwner;
  const isCompleted = goal.status === 'completed' || goal.progress_percentage >= 100;
  const deadlineDate = goal.deadline ? new Date(goal.deadline) : null;
  const isOverdue = deadlineDate && deadlineDate < new Date() && !isCompleted;
  const normalizedDescription = goal.description?.replace(/\s+/g, ' ').trim();
  const metaDescription = normalizedDescription || tGoals('detail.meta_description', {
    title: goal.title,
    owner: goal.user_name,
    progress: Math.round(goal.progress_percentage),
  });

  return (
    <div className="space-y-6">
      <PageMeta
        title={goal.title}
        description={metaDescription.slice(0, 160)}
        type="article"
        noIndex={!goal.is_public}
        publishedTime={goal.created_at}
        modifiedTime={goal.updated_at}
      />

      {backButton}

      <GlassCard className={`p-5 sm:p-6 space-y-6 ${isCompleted ? 'border-l-4 border-emerald-500' : ''} ${isOverdue ? 'border-l-4 border-red-500' : ''}`}>
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-theme-primary flex items-start gap-3">
            <Target className="w-7 h-7 text-emerald-400 flex-shrink-0 mt-1" aria-hidden="true" />
            <span className="break-words">{goal.title}</span>
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {isCompleted ? (
              <Chip size="sm" color="success" variant="flat" startContent={<CheckCircle className="w-3 h-3" aria-hidden="true" />}>
                {t('goals.status.completed')}
              </Chip>
            ) : (
              <Chip size="sm" color="primary" variant="flat">{t('goals.status.active')}</Chip>
            )}
            {goal.is_public ? (
              <Chip size="sm" variant="flat" className="text-theme-subtle" startContent={<Globe className="w-3 h-3" aria-hidden="true" />}>
                {t('goals.visibility.public')}
              </Chip>
            ) : (
              showPrivateFields && (
                <Chip size="sm" variant="flat" className="text-theme-subtle" startContent={<Lock className="w-3 h-3" aria-hidden="true" />}>
                  {t('goals.visibility.private')}
                </Chip>
              )
            )}
            {isOverdue && (
              <Chip size="sm" color="danger" variant="flat">
                {tGoals('detail.overdue_chip')}
              </Chip>
            )}
          </div>
        </div>

        {/* Description */}
        {goal.description && (
          <div>
            <h2 className="text-sm font-semibold text-theme-primary mb-1">{t('goals.detail.description')}</h2>
            <p className="text-sm text-theme-muted whitespace-pre-wrap">{goal.description}</p>
          </div>
        )}

        {/* Progress */}
        <div>
          <h2 className="text-sm font-semibold text-theme-primary mb-2">{t('goals.detail.progress')}</h2>
          <p className="text-xs text-theme-muted mb-2">{t('goals.detail.progress_explainer')}</p>
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
            size="lg"
            aria-label={t('goals.detail.progress_aria', { percent: Math.round(goal.progress_percentage) })}
          />
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {deadlineDate && (
            <div className="bg-theme-elevated rounded-xl p-3">
              <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                {t('goals.detail.deadline')}
              </div>
              <p className={`text-sm font-medium ${isOverdue ? 'text-red-600 dark:text-red-400' : 'text-theme-primary'}`}>
                {deadlineDate.toLocaleDateString(getFormattingLocale(), { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          )}
          <div className="bg-theme-elevated rounded-xl p-3">
            <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {t('goals.detail.created')}
            </div>
            <p className="text-sm text-theme-primary font-medium">
              {new Date(goal.created_at).toLocaleDateString(getFormattingLocale(), { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          {showPrivateFields && goal.checkin_frequency && (
            <div className="bg-theme-elevated rounded-xl p-3">
              <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                {tGoals('detail.checkin_frequency')}
              </div>
              <p className="text-sm text-theme-primary font-medium capitalize">{goal.checkin_frequency}</p>
            </div>
          )}
          {goal.buddy_name && (
            <div className="bg-theme-elevated rounded-xl p-3">
              <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
                {t('goals.detail.buddy')}
              </div>
              <Link
                to={goal.buddy_id ? tenantPath(`/profile/${goal.buddy_id}`) : '#'}
                className="flex items-center gap-2 hover:text-theme-primary transition-colors"
              >
                <Avatar
                  name={goal.buddy_name}
                  src={resolveAvatarUrl(goal.buddy_avatar)}
                  size="sm"
                  className="w-6 h-6"
                />
                <p className="text-sm text-theme-primary font-medium">{goal.buddy_name}</p>
              </Link>
            </div>
          )}
          {!goal.buddy_name && goal.is_public && (
            <div className="bg-theme-elevated rounded-xl p-3">
              <div className="flex items-center gap-2 text-xs text-theme-subtle mb-1">
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
                {t('goals.detail.buddy')}
              </div>
              <p className="text-sm text-theme-muted">{t('goals.detail.no_buddy_consent')}</p>
            </div>
          )}
        </div>

        {/* F-004: pending buddy offers — only the owner sees and decides them */}
        {isOwner && !goal.buddy_id && (goal.pending_buddy_requests_count ?? 0) > 0 && (
          <GoalBuddyRequests
            goalId={goal.id}
            onAccepted={(accepted) => setGoal((prev) => (prev ? { ...prev, ...accepted } : prev))}
          />
        )}

        {/* Owner info */}
        {goal.user_name && (
          <Link
            to={tenantPath(`/profile/${goal.user_id}`)}
            className="flex items-center gap-3 bg-theme-elevated rounded-xl p-3 hover:bg-theme-hover transition-colors"
          >
            <Avatar
              name={goal.user_name}
              src={resolveAvatarUrl(goal.user_avatar)}
              size="sm"
            />
            <div>
              <p className="text-sm font-medium text-theme-primary">{goal.user_name}</p>
              <p className="text-xs text-theme-subtle">{t('goals.detail.goal_owner')}</p>
            </div>
          </Link>
        )}

        <div>
          <h2 className="text-sm font-semibold text-theme-primary mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" aria-hidden="true" />
            {t('goals.detail.insights')}
          </h2>
          <GoalInsightsPanel goalId={goal.id} canNudge={goal.is_buddy} />
        </div>

        {/* Progress history (only for owner / public goals — endpoint is open but UI hides it for stranger-private) */}
        <SocialInteractionPanel
          targetType="goal"
          targetId={goal.id}
          initialLiked={goal.is_liked ?? false}
          initialLikesCount={goal.likes_count ?? 0}
          initialCommentsCount={goal.comments_count ?? 0}
          title={goal.title}
          description={goal.description}
          targetOwnerId={goal.user_id}
        />

        {(showPrivateFields || goal.is_public) && (
          <div>
            <h2 className="text-sm font-semibold text-theme-primary mb-3 flex items-center gap-2">
              <History className="w-4 h-4 text-accent" aria-hidden="true" />
              {t('goals.detail.progress_timeline')}
            </h2>
            <GoalProgressHistory goalId={goal.id} />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap pt-2">
          {isAuthenticated && (
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              as={Link}
              to={tenantPath('/goals')}
            >
              {tGoals('detail.view_all_goals')}
            </Button>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

export default GoalDetailPage;
