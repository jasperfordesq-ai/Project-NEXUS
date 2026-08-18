// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectItem } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
/**
 * Achievements Page - Badge showcase, challenges, collections, XP shop, daily rewards
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from '@/lib/motion';

import Trophy from 'lucide-react/icons/trophy';
import Medal from 'lucide-react/icons/medal';
import Star from 'lucide-react/icons/star';
import Sparkles from 'lucide-react/icons/sparkles';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Lock from 'lucide-react/icons/lock';
import Filter from 'lucide-react/icons/filter';
import Target from 'lucide-react/icons/target';
import Clock from 'lucide-react/icons/clock';
import Gift from 'lucide-react/icons/gift';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Crown from 'lucide-react/icons/crown';
import Gem from 'lucide-react/icons/gem';
import Layers from 'lucide-react/icons/layers';
import Zap from 'lucide-react/icons/zap';
import Package from 'lucide-react/icons/package';
import Route from 'lucide-react/icons/route';
import Calendar from 'lucide-react/icons/calendar';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useToast } from '@/contexts/ToastContext';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GamificationProfile {
  user: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
  xp: number;
  level: number;
  level_progress: {
    current_xp: number;
    xp_for_current_level: number;
    xp_for_next_level: number;
    progress_percentage: number;
  };
  badges_count: number;
  showcased_badges: BadgeEntry[];
  is_own_profile: boolean;
}

interface BadgeEntry {
  badge_key: string;
  name: string;
  description: string;
  icon: string;
  type: string;
  created_at: string;
  is_showcased: boolean;
  earned?: boolean;
  earned_at?: string | null;
}

interface Challenge {
  id: number;
  title: string;
  description: string;
  reward_xp: number;
  user_progress: number;
  target_count: number;
  end_date: string | null;
  is_completed: boolean;
  reward_claimed: boolean;
  progress_percent: number;
  challenge_type: string;
}

interface BadgeCollection {
  id: number;
  name: string;
  description: string;
  badges: {
    badge_key: string;
    name: string;
    icon: string;
    earned: boolean;
  }[];
  earned_count: number;
  total_count: number;
  reward_xp: number;
  completed: boolean;
}

interface ShopItem {
  id: number;
  name: string;
  description: string;
  cost_xp: number;
  xp_cost: number;
  item_type: string;
  icon: string | null;
  can_purchase: boolean;
  user_purchases: number;
  stock_limit: number | null;
  is_active: boolean;
}

interface DailyRewardStatus {
  claimed_today: boolean;
  current_streak: number;
  reward_xp: number;
  next_reward_xp: number;
  next_claim_at: string | null;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Daily Reward Widget
// ─────────────────────────────────────────────────────────────────────────────

function DailyRewardWidget() {
  const { t } = useTranslation('gamification');
  const toast = useToast();
  const [status, setStatus] = useState<DailyRewardStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClaiming, setIsClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadStatus = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      const res = await api.get<DailyRewardStatus>('/v2/gamification/daily-reward');
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        setStatus(res.data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load daily reward status', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const claimReward = async () => {
    try {
      setIsClaiming(true);
      const res = await api.post<{ claimed: boolean; reward: { xp_earned: number; streak_day: number } }>('/v2/gamification/daily-reward');
      if (res.success) {
        setJustClaimed(true);
        const reward = res.data?.reward;
        toastRef.current.success(tRef.current('achievements.daily_reward.claimed_title'), tRef.current('achievements.daily_reward.claimed_message', { xp: reward?.xp_earned ?? status?.reward_xp ?? 0 }));
        // Update status
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                claimed_today: true,
                current_streak: reward?.streak_day ?? prev.current_streak + 1,
              }
            : prev
        );
        // Reset animation after 2s
        setTimeout(() => setJustClaimed(false), 2000);
      } else {
        toastRef.current.error(tRef.current('achievements.daily_reward.claim_failed'), res.error ?? tRef.current('achievements.daily_reward.claim_failed_desc'));
      }
    } catch (err) {
      logError('Failed to claim daily reward', err);
      toastRef.current.error(tRef.current('achievements.daily_reward.claim_failed'), tRef.current('achievements.daily_reward.claim_error'));
    } finally {
      setIsClaiming(false);
    }
  };

  if (isLoading) {
    return (
      <GlassCard role="status" className="p-4" aria-label={t('achievements.daily_reward.loading')} aria-busy="true">
        <div className="flex items-center gap-4">
          <Skeleton className="rounded-full flex-shrink-0"><div className="w-12 h-12 rounded-full bg-surface-tertiary" /></Skeleton>
          <div className="flex-1 space-y-2">
            <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-1/3" /></Skeleton>
            <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-1/2" /></Skeleton>
          </div>
          <Skeleton className="rounded-lg"><div className="h-10 w-28 rounded-lg bg-surface-tertiary" /></Skeleton>
        </div>
      </GlassCard>
    );
  }

  if (!status) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <GlassCard className="p-4 border-l-4 border-amber-400 overflow-hidden relative">
          {/* Sparkle background effect when claiming */}
          {justClaimed && (
            <motion.div
              className="absolute inset-0 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5 }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-yellow-400/20 to-amber-500/10" />
              {[...Array(6)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-2 h-2 bg-amber-400 rounded-full"
                  initial={{
                    x: '50%',
                    y: '50%',
                    scale: 0,
                    opacity: 1,
                  }}
                  animate={{
                    x: `${20 + Math.random() * 60}%`,
                    y: `${10 + Math.random() * 80}%`,
                    scale: [0, 1.5, 0],
                    opacity: [1, 1, 0],
                  }}
                  transition={{
                    duration: 1,
                    delay: i * 0.1,
                    ease: 'easeOut',
                  }}
                />
              ))}
            </motion.div>
          )}

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 relative z-10">
            <motion.div
              className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0"
              animate={
                justClaimed
                  ? { scale: [1, 1.3, 1], rotate: [0, 10, -10, 0] }
                  : {}
              }
              transition={{ duration: 0.6 }}
            >
              <Gift className="w-6 h-6 text-white" aria-hidden="true" />
            </motion.div>

            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-theme-primary">{t('achievements.daily_reward.title')}</h3>
              {status.claimed_today ? (
                <p className="text-sm text-theme-muted">
                  {t('achievements.daily_reward.come_back_tomorrow', { xp: status.next_reward_xp })}
                  {status.current_streak > 1 && (
                    <span className="ml-2">
                      <Zap className="w-3 h-3 inline text-amber-400" aria-hidden="true" /> {t('achievements.daily_reward.day_streak', { count: status.current_streak })}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-theme-muted">
                  {t('achievements.daily_reward.claim_today', { xp: status.reward_xp })}
                  {status.current_streak > 0 && (
                    <span className="ml-2">
                      <Zap className="w-3 h-3 inline text-amber-400" aria-hidden="true" /> {t('achievements.daily_reward.day_streak', { count: status.current_streak })}
                    </span>
                  )}
                </p>
              )}
            </div>

            {!status.claimed_today ? (
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button
                  className="bg-gradient-to-r from-amber-400 to-orange-500 text-white font-semibold shadow-lg"
                  startContent={
                    isClaiming ? (
                      <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center py-4"><Spinner size="sm" color="white" /></div>
                    ) : (
                      <Sparkles className="w-4 h-4" aria-hidden="true" />
                    )
                  }
                  onPress={claimReward}
                  isDisabled={isClaiming}
                >
                  {isClaiming ? t('achievements.daily_reward.claiming') : t('achievements.daily_reward.claim_reward')}
                </Button>
              </motion.div>
            ) : (
              <Chip
                color="success"
                variant="flat"
                startContent={<CheckCircle className="w-3 h-3" aria-hidden="true" />}
              >
                {t('achievements.daily_reward.claimed')}
              </Chip>
            )}
          </div>
        </GlassCard>
      </motion.div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Challenges Tab Content
// ─────────────────────────────────────────────────────────────────────────────

function ChallengesTab() {
  const { t } = useTranslation('gamification');
  const toast = useToast();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<number | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadChallenges = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      const res = await api.get<Challenge[]>('/v2/gamification/challenges');
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        setChallenges(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load challenges', err);
      toastRef.current.error(tRef.current('achievements.challenges.load_failed'), tRef.current('achievements.challenges.load_failed_desc'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChallenges();
  }, [loadChallenges]);

  const claimReward = async (challengeId: number) => {
    try {
      setClaimingId(challengeId);
      const res = await api.post('/v2/gamification/challenges/' + challengeId + '/claim');
      if (res.success) {
        toastRef.current.success(tRef.current('achievements.challenges.reward_claimed'), tRef.current('achievements.challenges.reward_claimed_desc'));
        setChallenges((prev) =>
          prev.map((c) => (c.id === challengeId ? { ...c, reward_claimed: true } : c))
        );
      } else {
        toastRef.current.error(tRef.current('achievements.challenges.claim_failed'), res.error ?? tRef.current('achievements.challenges.claim_failed_desc'));
      }
    } catch (err) {
      logError('Failed to claim challenge reward', err);
      toastRef.current.error(tRef.current('achievements.challenges.claim_failed'), tRef.current('achievements.challenges.claim_error'));
    } finally {
      setClaimingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <GlassCard key={i} className="p-5">
            <div className="flex items-start gap-4">
              <Skeleton className="rounded-lg flex-shrink-0"><div className="w-10 h-10 rounded-lg bg-surface-tertiary" /></Skeleton>
              <div className="flex-1 space-y-2">
                <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-1/3" /></Skeleton>
                <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-2/3" /></Skeleton>
                <Skeleton className="rounded-lg"><div className="h-2 rounded-lg bg-surface-secondary w-full" /></Skeleton>
                <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-1/4" /></Skeleton>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    );
  }

  if (challenges.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          icon={<Target className="w-12 h-12" aria-hidden="true" />}
          title={t('achievements.challenges.empty_title')}
          description={t('achievements.challenges.empty_description')}
        />
      </div>
    );
  }

  const activeChallenges = challenges.filter((c) => !c.is_completed && !c.reward_claimed);
  const completedChallenges = challenges.filter((c) => c.is_completed || c.reward_claimed);

  return (
    <div className="space-y-6 mt-4">
      {/* Active Challenges */}
      {activeChallenges.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-theme-primary mb-3 flex items-center gap-2">
            <Target className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('achievements.challenges.active_challenges')}
          </h3>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {activeChallenges.map((challenge) => {
              const progressPct = challenge.target_count > 0
                ? Math.min(100, Math.round((challenge.user_progress / challenge.target_count) * 100))
                : 0;

              return (
                <motion.div key={challenge.id} variants={itemVariants}>
                  <GlassCard className="p-5" hoverable>
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 flex items-center justify-center flex-shrink-0">
                        <Target className="w-5 h-5 text-accent" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="font-semibold text-theme-primary">{challenge.title}</h4>
                          <Chip size="sm" color="warning" variant="flat">
                            <Gem className="w-3 h-3" aria-hidden="true" />
                            {t('achievements.xp_value', { xp: challenge.reward_xp })}
                          </Chip>
                        </div>
                        <p className="text-sm text-theme-muted mb-3">{challenge.description}</p>
                        <Progress
                          value={progressPct}
                          className="mb-2"
                          classNames={{
                            indicator: 'bg-gradient-to-r from-accent to-accent-gradient-end',
                            track: 'bg-theme-hover',
                          }}
                          size="sm"
                          aria-label={t('achievements.challenges.progress_aria', { percent: progressPct })}
                        />
                        <div className="flex items-center justify-between text-xs text-theme-subtle">
                          <span>{challenge.user_progress} / {challenge.target_count}</span>
                          {challenge.end_date && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              {new Date(challenge.end_date).toLocaleDateString(getFormattingLocale())}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      )}

      {/* Completed Challenges */}
      {completedChallenges.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-theme-primary mb-3 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            {t('achievements.challenges.completed')}
          </h3>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {completedChallenges.map((challenge) => (
              <motion.div key={challenge.id} variants={itemVariants}>
                <GlassCard className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-green-500/20 flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="font-semibold text-theme-primary">{challenge.title}</h4>
                        {challenge.is_completed && !challenge.reward_claimed ? (
                          <Button
                            size="sm"
                            className="bg-gradient-to-r from-emerald-500 to-green-600 text-white"
                            startContent={
                              claimingId === challenge.id ? (
                                <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center py-4"><Spinner size="sm" color="white" /></div>
                              ) : (
                                <Gift className="w-3 h-3" aria-hidden="true" />
                              )
                            }
                            onPress={() => claimReward(challenge.id)}
                            isDisabled={claimingId === challenge.id}
                          >
                            {t('achievements.challenges.claim_xp', { xp: challenge.reward_xp })}
                          </Button>
                        ) : (
                          <Chip size="sm" color="success" variant="flat">
                            <CheckCircle className="w-3 h-3" aria-hidden="true" />
                            {t('achievements.challenges.claimed')}
                          </Chip>
                        )}
                      </div>
                      <p className="text-sm text-theme-muted">{challenge.description}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Journeys Tab Content (formerly Collections)
// ─────────────────────────────────────────────────────────────────────────────

function JourneysTab() {
  const { t } = useTranslation('gamification');
  const toast = useToast();
  const [collections, setCollections] = useState<BadgeCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadCollections = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      const res = await api.get<BadgeCollection[]>('/v2/gamification/collections');
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        setCollections(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load collections', err);
      toastRef.current.error(tRef.current('achievements.collections.load_failed'), tRef.current('achievements.collections.load_failed_desc'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0 },
  };

  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <GlassCard key={i} className="p-5">
            <div className="space-y-2 mb-3">
              <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-1/3" /></Skeleton>
              <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-2/3" /></Skeleton>
              <Skeleton className="rounded-lg"><div className="h-2 rounded-lg bg-surface-secondary w-full" /></Skeleton>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="rounded-full"><div className="w-8 h-8 rounded-full bg-surface-tertiary" /></Skeleton>
              ))}
            </div>
          </GlassCard>
        ))}
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          icon={<Layers className="w-12 h-12" aria-hidden="true" />}
          title={t('achievements.collections.empty_title')}
          description={t('achievements.collections.empty_description')}
        />
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-4 mt-4"
    >
      {collections.map((collection) => {
        const progressPct = collection.total_count > 0
          ? Math.round((collection.earned_count / collection.total_count) * 100)
          : 0;

        return (
          <motion.div key={collection.id} variants={itemVariants}>
            <GlassCard className={`p-5 ${collection.completed ? 'border-l-4 border-emerald-400' : ''}`} hoverable>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h4 className="font-semibold text-theme-primary flex items-center gap-2">
                    <Layers className="w-4 h-4 text-accent" aria-hidden="true" />
                    {collection.name}
                    {collection.completed && (
                      <Chip size="sm" color="success" variant="flat">{t('achievements.collections.complete')}</Chip>
                    )}
                  </h4>
                  <p className="text-sm text-theme-muted mt-1">{collection.description}</p>
                </div>
                {collection.reward_xp > 0 && (
                  <Chip size="sm" color="warning" variant="flat" className="flex-shrink-0">
                    <Gem className="w-3 h-3" aria-hidden="true" />
                    {t('achievements.xp_value', { xp: collection.reward_xp })}
                  </Chip>
                )}
              </div>

              <Progress
                value={progressPct}
                className="mb-2"
                classNames={{
                  indicator: collection.completed
                    ? 'bg-gradient-to-r from-emerald-500 to-green-500'
                    : 'bg-gradient-to-r from-accent to-accent-gradient-end',
                  track: 'bg-theme-hover',
                }}
                size="sm"
                aria-label={t('achievements.collections.progress_aria', { percent: progressPct })}
              />
              <p className="text-xs text-theme-subtle mb-3">
                {t('achievements.collections.badges_collected', { earned: collection.earned_count, total: collection.total_count })}
              </p>

              {/* Badge thumbnails */}
              <div className="flex flex-wrap gap-2">
                {collection.badges.map((badge) => (
                  <div
                    key={badge.badge_key}
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm ${
                      badge.earned
                        ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20'
                        : 'bg-theme-hover opacity-40'
                    }`}
                    title={badge.name}
                  >
                    {badge.icon || (
                      badge.earned
                        ? <Medal className="w-4 h-4 text-amber-400" aria-hidden="true" />
                        : <Lock className="w-3 h-3 text-theme-subtle" aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Engagement Tab Content
// ─────────────────────────────────────────────────────────────────────────────

interface EngagementMonth {
  year_month: string;
  was_active: boolean;
  activity_count: number;
}

export function EngagementTab() {
  const { t } = useTranslation('gamification');
  const [history, setHistory] = useState<EngagementMonth[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);

    try {
      const res = await api.get<EngagementMonth[]>('/v2/gamification/engagement-history');
      if (requestId !== requestIdRef.current) return;

      if (res.success && Array.isArray(res.data)) {
        setHistory(res.data);
        setLoadFailed(false);
      } else {
        // A resolved failure envelope is still a failure. Keep previously
        // confirmed history visible instead of replacing it with fabricated zeroes.
        setLoadFailed(true);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logError('Failed to load engagement history', err);
      setLoadFailed(true);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  if (isLoading && history === null) {
    return (
      <div className="mt-4 space-y-4">
        <GlassCard className="p-5">
          <Skeleton className="rounded-lg"><div className="h-4 w-48 bg-surface-tertiary" /></Skeleton>
          <div className="grid grid-cols-6 gap-2 mt-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="rounded-lg"><div className="h-10 bg-surface-secondary" /></Skeleton>
            ))}
          </div>
        </GlassCard>
      </div>
    );
  }

  if (history === null) {
    return (
      <div className="mt-4" role="alert">
        <EmptyState
          icon={<AlertTriangle className="h-10 w-10 text-danger" aria-hidden="true" />}
          title={t('achievements.load_error')}
          action={{ label: t('achievements.try_again'), onClick: load }}
        />
      </div>
    );
  }

  const staleDataWarning = loadFailed ? (
    <div
      className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-danger sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm">{t('achievements.load_error')}</p>
      </div>
      <Button
        variant="outline"
        onPress={load}
        isLoading={isLoading}
        startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      >
        {t('achievements.try_again')}
      </Button>
    </div>
  ) : null;

  if (history.length === 0) {
    return (
      <div className="mt-4 space-y-4">
        {staleDataWarning}
        <GlassCard className="p-5">
          <EmptyState
            icon={<Calendar className="h-10 w-10 text-accent" aria-hidden="true" />}
            title={t('achievements.engagement.title')}
            description={t('achievements.engagement.description')}
            action={(
              <Button
                variant="secondary"
                onPress={load}
                isLoading={isLoading}
                startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              >
                {t('common.refresh')}
              </Button>
            )}
          />
        </GlassCard>
      </div>
    );
  }

  // Generate last 12 months for the grid
  const months: Array<{ label: string; ym: string; active: boolean; count: number }> = [];
  const historyMap = new Map(history.map((h) => [h.year_month, h]));

  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString(getFormattingLocale(), { month: 'short', year: '2-digit' });
    const entry = historyMap.get(ym);
    months.push({
      label,
      ym,
      active: entry?.was_active ?? false,
      count: entry?.activity_count ?? 0,
    });
  }

  const activeCount = months.filter((m) => m.active).length;

  return (
    <div className="mt-4 space-y-4">
      {staleDataWarning}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold text-theme-primary flex items-center gap-2">
            <Calendar className="w-4 h-4 text-accent" aria-hidden="true" />
            {t('achievements.engagement.title')}
          </h4>
          <div className="flex items-center gap-2">
            <Chip size="sm" color={activeCount >= 6 ? 'success' : 'default'} variant="flat">
              {t('achievements.engagement.months_active', { count: activeCount })}
            </Chip>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={load}
              isLoading={isLoading}
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
          {months.map((month) => (
            <div
              key={month.ym}
              className={`flex flex-col items-center p-2 rounded-lg transition-colors ${
                month.active
                  ? 'bg-emerald-500/20 border border-emerald-500/30'
                  : 'bg-surface-secondary/50 border border-transparent'
              }`}
              title={
                month.active
                  ? t('achievements.engagement.month_active_tooltip', { count: month.count })
                  : t('achievements.engagement.month_inactive_tooltip')
              }
            >
              <span className="text-[10px] text-muted">{month.label}</span>
              {month.active ? (
                <CheckCircle className="w-5 h-5 text-emerald-500 mt-1" aria-hidden="true" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-surface-secondary mt-1" />
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-theme-muted mt-3">
          {t('achievements.engagement.description')}
        </p>
      </GlassCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// XP Shop Tab Content
// ─────────────────────────────────────────────────────────────────────────────

function XpShopTab({ userXp }: { userXp: number }) {
  const { t } = useTranslation('gamification');
  const toast = useToast();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState<number | null>(null);
  const [currentXp, setCurrentXp] = useState(userXp);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    setCurrentXp(userXp);
  }, [userXp]);

  const loadShop = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      const res = await api.get<ShopItem[]>('/v2/gamification/shop');
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        setItems(Array.isArray(res.data) ? res.data : []);
        // Update XP from shop meta if available (more current than profile)
        const metaXp = (res.meta as { user_xp?: number } | undefined)?.user_xp;
        if (metaXp !== undefined && metaXp !== null) {
          setCurrentXp(metaXp);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load shop', err);
      toastRef.current.error(tRef.current('achievements.shop.load_failed'), tRef.current('achievements.shop.load_failed_desc'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShop();
  }, [loadShop]);

  const purchaseItem = async (item: ShopItem) => {
    const cost = item.cost_xp ?? item.xp_cost ?? 0;
    if (currentXp < cost) {
      toastRef.current.warning(tRef.current('achievements.shop.not_enough_xp'), tRef.current('achievements.shop.not_enough_xp_desc', { xp: cost - currentXp }));
      return;
    }

    try {
      setPurchasingId(item.id);
      const res = await api.post('/v2/gamification/shop/purchase', { item_id: item.id });
      if (res.success) {
        toastRef.current.success(tRef.current('achievements.shop.purchase_complete'), tRef.current('achievements.shop.purchase_complete_desc', { name: item.name }));
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, user_purchases: (i.user_purchases ?? 0) + 1, can_purchase: false } : i))
        );
        setCurrentXp((prev) => prev - cost);
      } else {
        toastRef.current.error(tRef.current('achievements.shop.purchase_failed'), res.error ?? tRef.current('achievements.shop.purchase_failed_desc'));
      }
    } catch (err) {
      logError('Failed to purchase shop item', err);
      toastRef.current.error(tRef.current('achievements.shop.purchase_failed'), tRef.current('achievements.shop.purchase_error'));
    } finally {
      setPurchasingId(null);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: { opacity: 1, scale: 1 },
  };

  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        <GlassCard className="p-4">
          <Skeleton className="rounded-lg"><div className="h-6 rounded-lg bg-surface-tertiary w-1/4" /></Skeleton>
        </GlassCard>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <GlassCard key={i} className="p-5 text-center">
              <Skeleton className="rounded-lg mx-auto mb-3"><div className="w-12 h-12 rounded-lg bg-surface-tertiary mx-auto" /></Skeleton>
              <div className="space-y-2">
              <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-2/3 mx-auto" /></Skeleton>
              <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-full" /></Skeleton>
              <Skeleton className="rounded-lg"><div className="h-8 rounded-lg bg-surface-tertiary w-1/2 mx-auto" /></Skeleton>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {/* XP Balance */}
      <GlassCard className="p-4 border-l-4 border-accent">
        <div className="flex items-center gap-3">
          <Gem className="w-5 h-5 text-accent" aria-hidden="true" />
          <span className="text-theme-primary font-medium">
            {t('achievements.shop.your_balance')}:{' '}
            <strong className="text-accent dark:text-accent">
              {t('achievements.xp_value', { xp: currentXp.toLocaleString(getFormattingLocale()) })}
            </strong>
          </span>
        </div>
      </GlassCard>

      {items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="w-12 h-12" aria-hidden="true" />}
          title={t('achievements.shop.empty_title')}
          description={t('achievements.shop.empty_description')}
        />
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {items.map((item) => {
            const cost = item.cost_xp ?? item.xp_cost ?? 0;
            const canAfford = currentXp >= cost;
            const isOwned = (item.user_purchases ?? 0) > 0;
            const isAvailable = item.can_purchase && !isOwned;

            return (
              <motion.div key={item.id} variants={itemVariants}>
                <GlassCard
                  className={`p-5 text-center ${isOwned ? 'opacity-70' : ''}`}
                  hoverable={!isOwned}
                >
                  {/* Item icon */}
                  <div className="w-14 h-14 mx-auto mb-3 rounded-lg bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 flex items-center justify-center">
                    {item.icon ? (
                      <span className="text-2xl">{item.icon}</span>
                    ) : item.item_type === 'badge' ? (
                      <Medal className="w-7 h-7 text-amber-400" aria-hidden="true" />
                    ) : item.item_type === 'title' ? (
                      <Crown className="w-7 h-7 text-accent" aria-hidden="true" />
                    ) : item.item_type === 'theme' ? (
                      <Sparkles className="w-7 h-7 text-accent" aria-hidden="true" />
                    ) : (
                      <Package className="w-7 h-7 text-accent" aria-hidden="true" />
                    )}
                  </div>

                  <h4 className="font-semibold text-theme-primary text-sm mb-1">{item.name}</h4>
                  <p className="text-xs text-theme-muted mb-3 line-clamp-2">{item.description}</p>

                  {/* Price & stock */}
                  <div className="mb-3">
                    <Chip
                      size="sm"
                      color={canAfford ? 'primary' : 'danger'}
                      variant="flat"
                    >
                      <Gem className="w-3 h-3" aria-hidden="true" />
                      {t('achievements.xp_value', { xp: cost.toLocaleString(getFormattingLocale()) })}
                    </Chip>
                    {item.stock_limit !== null && item.stock_limit !== undefined && !isOwned && (
                      <p className="text-xs text-theme-subtle mt-1">{t('achievements.shop.stock_left', { count: item.stock_limit })}</p>
                    )}
                  </div>

                  {/* Action */}
                  {isOwned ? (
                    <Chip color="success" variant="flat">
                      <CheckCircle className="w-3 h-3" aria-hidden="true" />
                      {t('achievements.shop.owned')}
                    </Chip>
                  ) : !isAvailable ? (
                    <Chip color="default" variant="flat">{t('achievements.shop.unavailable')}</Chip>
                  ) : (
                    <Button
                      size="sm"
                      className={
                        canAfford
                          ? 'bg-gradient-to-r from-accent to-accent-gradient-end text-white'
                          : 'bg-theme-hover text-theme-subtle'
                      }
                      startContent={
                        purchasingId === item.id ? (
                          <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center py-4"><Spinner size="sm" color="white" /></div>
                        ) : (
                          <ShoppingBag className="w-3 h-3" aria-hidden="true" />
                        )
                      }
                      onPress={() => purchaseItem(item)}
                      isDisabled={!canAfford || purchasingId === item.id}
                    >
                      {purchasingId === item.id ? t('achievements.shop.buying') : t('achievements.shop.purchase')}
                    </Button>
                  )}
                </GlassCard>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge Showcase Modal
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Badge Detail Modal
// ─────────────────────────────────────────────────────────────────────────────

interface BadgeDetail {
  key: string;
  name: string;
  description: string;
  icon: string;
  type: string;
  threshold: number;
  badge_tier?: string;
  badge_class?: string;
  rarity?: string;
  xp_value?: number;
  earned: boolean;
  earned_at: string | null;
  is_showcased: boolean;
}

interface BadgeDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  badgeKey: string | null;
}

function BadgeDetailModal({ isOpen, onClose, badgeKey }: BadgeDetailModalProps) {
  const { t } = useTranslation('gamification');
  const [badge, setBadge] = useState<BadgeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  // Clear the badge/error when the modal closes or has no key. Done during
  // render with a prev-prop comparison (not useEffect) so a stale badge from a
  // previous open is never shown for a frame.
  const [prevBadgeKey, setPrevBadgeKey] = useState<{ isOpen: boolean; badgeKey: string | null }>({ isOpen, badgeKey });
  if (prevBadgeKey.isOpen !== isOpen || prevBadgeKey.badgeKey !== badgeKey) {
    setPrevBadgeKey({ isOpen, badgeKey });
    if (!isOpen || !badgeKey) {
      setBadge(null);
      setError(false);
    }
  }

  useEffect(() => {
    if (!isOpen || !badgeKey) {
      return;
    }

    let cancelled = false;
    const loadBadge = async () => {
      setIsLoading(true);
      setError(false);
      try {
        const res = await api.get<BadgeDetail>(`/v2/gamification/badges/${badgeKey}`);
        if (cancelled) return;
        if (res.success && res.data) {
          setBadge(res.data as BadgeDetail);
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    loadBadge();
    return () => { cancelled = true; };
  }, [isOpen, badgeKey]);

  const typeLabel = badge ? t(`achievements.badge_type.${badge.type}`) : '';
  const rarityKey = badge?.rarity ? `achievements.badge_detail.rarity_${badge.rarity}` : '';
  const tierKey = badge?.badge_tier ? `achievements.badge_detail.tier_${badge.badge_tier}` : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      classNames={{
        base: 'bg-overlay border border-white/10',
        header: 'border-b border-white/10',
        body: 'py-6',
        footer: 'border-t border-white/10',
      }}
    >
      <ModalContent>
        {isLoading ? (
          <ModalBody>
            <div className="flex flex-col items-center gap-4 py-8">
              <Skeleton className="rounded-full"><div className="w-20 h-20 rounded-full bg-surface-tertiary" /></Skeleton>
              <Skeleton className="rounded-lg"><div className="h-6 w-48 rounded-lg bg-surface-tertiary" /></Skeleton>
              <Skeleton className="rounded-lg"><div className="h-4 w-64 rounded-lg bg-surface-secondary" /></Skeleton>
            </div>
          </ModalBody>
        ) : error || !badge ? (
          <ModalBody>
            <div className="text-center py-8">
              <AlertTriangle className="w-10 h-10 text-warning mx-auto mb-2" aria-hidden="true" />
              <p className="text-theme-muted">{t('achievements.badge_detail.load_failed')}</p>
            </div>
          </ModalBody>
        ) : (
          <>
            <ModalHeader className="flex items-center gap-3">
              <Medal className="w-5 h-5 text-amber-400" aria-hidden="true" />
              {t('achievements.badge_detail.title')}
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col items-center text-center">
                {/* Badge Icon */}
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl mb-4 ${
                    badge.earned
                      ? 'bg-gradient-to-br from-amber-500/30 to-orange-500/30 shadow-lg shadow-amber-500/10'
                      : 'bg-gradient-to-br from-gray-500/20 to-gray-600/20 grayscale'
                  }`}
                >
                  {badge.icon || <Medal className="w-12 h-12 text-amber-400" aria-hidden="true" />}
                </motion.div>

                {/* Badge Name */}
                <h2 className="text-xl font-bold text-theme-primary mb-2">{badge.name}</h2>

                {/* Description */}
                <p className="text-theme-muted text-sm max-w-md mb-5 leading-relaxed">
                  {badge.description}
                </p>

                {/* Earned Status */}
                {badge.earned && badge.earned_at ? (
                  <div className="flex items-center gap-2 mb-5 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <CheckCircle className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                    <span className="text-sm text-theme-success font-medium">
                      {t('achievements.badge_detail.earned_on', { date: new Date(badge.earned_at).toLocaleDateString(getFormattingLocale()) })}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-5 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                    <Lock className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
                    <span className="text-sm text-theme-subtle">{t('achievements.badge_detail.not_earned')}</span>
                  </div>
                )}

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                  {/* Category */}
                  <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-xs text-theme-subtle mb-1">{t('achievements.badge_detail.type')}</p>
                    <p className="text-sm font-medium text-theme-primary">{typeLabel}</p>
                  </div>

                  {/* Rarity */}
                  {badge.rarity && (
                    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                      <p className="text-xs text-theme-subtle mb-1">{t('achievements.badge_detail.rarity')}</p>
                      <p className="text-sm font-medium text-theme-primary">{t(rarityKey)}</p>
                    </div>
                  )}

                  {/* XP Reward */}
                  {badge.xp_value != null && badge.xp_value > 0 && (
                    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                      <p className="text-xs text-theme-subtle mb-1">{t('achievements.badge_detail.xp_reward')}</p>
                      <div className="flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                        <p className="text-sm font-medium text-theme-warning">
                          {t('achievements.badge_detail.xp_value', { xp: badge.xp_value })}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Tier */}
                  {badge.badge_tier && (
                    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                      <p className="text-xs text-theme-subtle mb-1">{t('achievements.badge_detail.tier')}</p>
                      <p className="text-sm font-medium text-theme-primary">{t(tierKey)}</p>
                    </div>
                  )}
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose} className="text-theme-muted">
                {t('achievements.badge_detail.close')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Showcase Modal
// ─────────────────────────────────────────────────────────────────────────────

interface ShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  badges: BadgeEntry[];
  onSave: (keys: string[]) => void;
  isSaving: boolean;
}

function ShowcaseModal({ isOpen, onClose, badges, onSave, isSaving }: ShowcaseModalProps) {
  const { t } = useTranslation('gamification');
  const earnedBadges = badges.filter((b) => b.earned_at || b.earned !== false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set(badges.filter((b) => b.is_showcased).map((b) => b.badge_key))
  );

  // Sync when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedKeys(new Set(badges.filter((b) => b.is_showcased).map((b) => b.badge_key)));
    }
  }, [isOpen, badges]);

  const toggleBadge = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < 5) {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      classNames={{
        base: 'bg-overlay border border-white/10',
        header: 'border-b border-white/10',
        body: 'py-4',
        footer: 'border-t border-white/10',
      }}
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Star className="w-5 h-5 text-amber-400" aria-hidden="true" />
          {t('achievements.showcase.manage_title')}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-theme-muted mb-4">
            {t('achievements.showcase.select_badges', { count: selectedKeys.size })}
          </p>
          {earnedBadges.length === 0 ? (
            <div className="text-center py-8">
              <Medal className="w-10 h-10 text-theme-subtle mx-auto mb-2" aria-hidden="true" />
              <p className="text-theme-muted">{t('achievements.showcase.no_badges_earned')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
              {earnedBadges.map((badge) => {
                const isSelected = selectedKeys.has(badge.badge_key);
                const isDisabled = !isSelected && selectedKeys.size >= 5;

                return (
                  <Checkbox
                    key={badge.badge_key}
                    isSelected={isSelected}
                    isDisabled={isDisabled}
                    onValueChange={() => toggleBadge(badge.badge_key)}
                    aria-label={t('achievements.showcase.showcase_badge', { name: badge.name })}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-amber-400/50 bg-amber-500/10'
                        : isDisabled
                          ? 'border-white/5 bg-theme-hover opacity-50 cursor-not-allowed'
                          : 'border-white/10 bg-theme-elevated hover:bg-theme-hover'
                    }`}
                    classNames={{
                      wrapper: 'flex-shrink-0',
                      label: 'flex min-w-0 flex-1 items-center gap-3',
                    }}
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center text-sm flex-shrink-0">
                      {badge.icon || <Medal className="w-4 h-4 text-amber-400" aria-hidden="true" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-theme-primary truncate">
                        {badge.name}
                        {isSelected && (
                          <Star className="w-3 h-3 inline ml-1 text-amber-400" aria-hidden="true" />
                        )}
                      </p>
                      <p className="text-xs text-theme-subtle truncate">{badge.description}</p>
                    </div>
                  </Checkbox>
                );
              })}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} className="text-theme-muted">
            {t('achievements.showcase.cancel')}
          </Button>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={
              isSaving ? (
                <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center py-4"><Spinner size="sm" color="white" /></div>
              ) : (
                <Star className="w-4 h-4" aria-hidden="true" />
              )
            }
            onPress={() => onSave(Array.from(selectedKeys))}
            isDisabled={isSaving}
          >
            {isSaving ? t('achievements.showcase.saving') : t('achievements.showcase.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Achievements Page
// ─────────────────────────────────────────────────────────────────────────────

export function AchievementsPage() {
  const { t } = useTranslation('gamification');
  usePageTitle(t('achievements.page_title'));
  const toast = useToast();
  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [badges, setBadges] = useState<BadgeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('badges');
  const [isShowcaseOpen, setIsShowcaseOpen] = useState(false);
  const [isSavingShowcase, setIsSavingShowcase] = useState(false);
  const [selectedBadgeKey, setSelectedBadgeKey] = useState<string | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      // Load profile and badges in parallel
      const [profileRes, badgesRes] = await Promise.all([
        api.get<GamificationProfile>('/v2/gamification/profile'),
        api.get<BadgeEntry[]>('/v2/gamification/badges'),
      ]);

      if (controller.signal.aborted) return;

      if (profileRes.success && profileRes.data) {
        const profileData = profileRes.data as unknown as GamificationProfile;
        setProfile(profileData);
      }

      if (badgesRes.success && badgesRes.data) {
        setBadges(Array.isArray(badgesRes.data) ? badgesRes.data : []);
        setAvailableTypes((badgesRes.meta?.available_types as string[]) ?? []);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load achievements', err);
      setError(tRef.current('achievements.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveShowcase = async (badgeKeys: string[]) => {
    try {
      setIsSavingShowcase(true);
      const res = await api.put('/v2/gamification/showcase', { badge_keys: badgeKeys });
      if (res.success) {
        toastRef.current.success(tRef.current('achievements.showcase.updated'), tRef.current('achievements.showcase.updated_desc'));
        // Update badge showcase state
        setBadges((prev) =>
          prev.map((b) => ({
            ...b,
            is_showcased: badgeKeys.includes(b.badge_key),
          }))
        );
        setIsShowcaseOpen(false);
      } else {
        toastRef.current.error(tRef.current('achievements.showcase.save_failed'), res.error ?? tRef.current('achievements.showcase.save_failed_desc'));
      }
    } catch (err) {
      logError('Failed to save showcase', err);
      toastRef.current.error(tRef.current('achievements.showcase.save_failed'), tRef.current('achievements.showcase.save_error'));
    } finally {
      setIsSavingShowcase(false);
    }
  };

  const filteredBadges = filterType === 'all'
    ? badges
    : badges.filter((b) => b.type === filterType);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: { opacity: 1, scale: 1 },
  };

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_meta.achievements.title')} noIndex />
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
          <Trophy className="w-7 h-7 text-amber-400" aria-hidden="true" />
          {t('achievements.title')}
        </h1>
        <p className="text-theme-muted mt-1">{t('achievements.subtitle')}</p>
      </div>

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('achievements.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadData}
          >
            {t('achievements.try_again')}
          </Button>
        </GlassCard>
      )}

      {!error && (
        <>
          {isLoading ? (
            <div role="status" aria-label={t('achievements.loading')} aria-busy="true" className="space-y-6">
              {/* Daily reward skeleton */}
              <GlassCard className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="rounded-full flex-shrink-0"><div className="w-12 h-12 rounded-full bg-surface-tertiary" /></Skeleton>
                  <div className="flex-1 space-y-2">
                    <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-1/3" /></Skeleton>
                    <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-1/2" /></Skeleton>
                  </div>
                </div>
              </GlassCard>
              {/* Profile skeleton */}
              <GlassCard className="p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="rounded-full flex-shrink-0"><div className="w-16 h-16 rounded-full bg-surface-tertiary" /></Skeleton>
                  <div className="flex-1 space-y-2">
                    <Skeleton className="rounded-lg"><div className="h-5 rounded-lg bg-surface-tertiary w-1/3" /></Skeleton>
                    <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-secondary w-full" /></Skeleton>
                    <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-1/4" /></Skeleton>
                  </div>
                </div>
              </GlassCard>
              {/* Badge grid skeleton */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <GlassCard key={i} className="p-4 text-center">
                    <Skeleton className="rounded-full mx-auto mb-3"><div className="w-12 h-12 rounded-full bg-surface-tertiary mx-auto" /></Skeleton>
                    <div className="space-y-2">
                    <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-2/3 mx-auto" /></Skeleton>
                    <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-full" /></Skeleton>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Daily Reward Widget */}
              <DailyRewardWidget />

              {/* XP Profile Card */}
              {profile && (
                <GlassCard className="p-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="relative">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-accent-gradient-end flex items-center justify-center">
                          <span className="text-white text-xl font-bold">{profile.level}</span>
                        </div>
                        <Sparkles className="w-5 h-5 text-amber-400 absolute -top-1 -right-1" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-theme-primary">{t('achievements.level', { level: profile.level })}</h2>
                        <p className="text-sm text-theme-muted">
                          {/* Coerce defensively: a degraded profile (backend catch-fallback
                              missing xp / level_progress) used to crash this card and blank
                              the whole Achievements page via the error boundary. */}
                          {t('achievements.xp_total', { xp: (profile.xp ?? 0).toLocaleString(getFormattingLocale()) })}
                        </p>
                        <div className="mt-2">
                          <Progress
                            value={profile.level_progress?.progress_percentage ?? 0}
                            className="max-w-md"
                            classNames={{
                              indicator: 'bg-gradient-to-r from-accent to-accent-gradient-end',
                              track: 'bg-theme-hover',
                            }}
                            size="sm"
                            aria-label={t('achievements.level_progress_aria')}
                          />
                          <p className="text-xs text-theme-subtle mt-1">
                            {t('achievements.xp_to_next_level', { current: profile.level_progress?.current_xp ?? 0, next: profile.level_progress?.xp_for_next_level ?? 0 })}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-theme-warning">{profile.badges_count}</p>
                        <p className="text-xs text-theme-subtle">{t('achievements.badges_label')}</p>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              )}

              {/* Tabs */}
              <Tabs
                selectedKey={activeTab}
                onSelectionChange={(key) => setActiveTab(key as string)}
                aria-label={t('achievements.sections_aria')}
                classNames={{
                  tabList: 'bg-theme-elevated border border-white/10 rounded-lg p-1',
                  cursor: 'bg-gradient-to-r from-accent to-accent-gradient-end',
                  tab: 'text-theme-muted data-[selected=true]:text-white',
                  tabContent: 'group-data-[selected=true]:text-white',
                }}
                fullWidth
              >
                <Tab
                  key="badges"
                  title={
                    <div className="flex items-center gap-2">
                      <Medal className="w-4 h-4" aria-hidden="true" />
                      <span>{t('achievements.tab_badges')}</span>
                    </div>
                  }
                />
                <Tab
                  key="challenges"
                  title={
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4" aria-hidden="true" />
                      <span>{t('achievements.tab_challenges')}</span>
                    </div>
                  }
                />
                <Tab
                  key="journeys"
                  title={
                    <div className="flex items-center gap-2">
                      <Route className="w-4 h-4" aria-hidden="true" />
                      <span>{t('achievements.tab_journeys')}</span>
                    </div>
                  }
                />
                <Tab
                  key="engagement"
                  title={
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" aria-hidden="true" />
                      <span>{t('achievements.tab_engagement')}</span>
                    </div>
                  }
                />
                <Tab
                  key="shop"
                  title={
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                      <span>{t('achievements.tab_shop')}</span>
                    </div>
                  }
                />
              </Tabs>

              {/* Tab Content */}
              {activeTab === 'badges' && (
                <>
                  {/* Manage Showcase + Filter row */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {availableTypes.length > 0 && (
                        <>
                          <Filter className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
                          <Select
                            placeholder={t('achievements.filter_by_type')}
                            aria-label={t('achievements.filter_badges_aria')}
                            selectedKeys={[filterType]}
                            onChange={(e) => setFilterType(e.target.value || 'all')}
                            className="w-48"
                            classNames={{
                              trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                              value: 'text-theme-primary',
                            }}
                            items={[
                              { key: 'all', label: t('achievements.all_types') },
                              ...availableTypes.map((badgeType) => ({
                                key: badgeType,
                                label: t(`achievements.badge_type.${badgeType}`),
                              })),
                            ]}
                          >
                            {(item) => <SelectItem key={item.key} id={item.key}>{item.label}</SelectItem>}
                          </Select>
                        </>
                      )}
                    </div>

                    <Button
                      variant="flat"
                      className="text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                      startContent={<Star className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => setIsShowcaseOpen(true)}
                    >
                      {t('achievements.manage_showcase')}
                    </Button>
                  </div>

                  {/* Badges Grid */}
                  {filteredBadges.length === 0 ? (
                    <EmptyState
                      icon={<Medal className="w-12 h-12" aria-hidden="true" />}
                      title={t('achievements.empty_title')}
                      description={t('achievements.empty_description')}
                    />
                  ) : (
                    <motion.div
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                    >
                      {filteredBadges.map((badge) => (
                        <motion.div key={badge.badge_key} variants={itemVariants}>
                          <GlassCard
                            className={`flex h-full min-h-[180px] flex-col p-4 text-center transition-transform motion-safe:hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer ${
                              !badge.earned_at && badge.earned === false ? 'opacity-40' : ''
                            }`}
                            onClick={() => setSelectedBadgeKey(badge.badge_key)}
                            aria-label={badge.name}
                          >
                            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center text-2xl">
                              {badge.icon || <Medal className="w-7 h-7 text-amber-400" aria-hidden="true" />}
                            </div>
                            <h3 className="font-semibold text-theme-primary text-sm mb-1 line-clamp-2">{badge.name}</h3>
                            <p className="text-xs text-theme-muted line-clamp-2">{badge.description}</p>
                            {!!badge.is_showcased && (
                              <Chip size="sm" color="warning" variant="flat" className="mt-2">
                                <Star className="w-3 h-3" aria-hidden="true" />
                                {t('achievements.showcased')}
                              </Chip>
                            )}
                            {badge.earned_at ? (
                              <p className="text-xs text-theme-subtle mt-2">
                                {t('achievements.earned_date', { date: new Date(badge.earned_at).toLocaleDateString(getFormattingLocale()) })}
                              </p>
                            ) : badge.earned === false ? (
                              <div className="flex items-center justify-center gap-1 mt-2 text-xs text-theme-subtle">
                                <Lock className="w-3 h-3" aria-hidden="true" />
                                {t('achievements.locked')}
                              </div>
                            ) : null}
                          </GlassCard>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}

                  {/* Badge Detail Modal */}
                  <BadgeDetailModal
                    isOpen={selectedBadgeKey !== null}
                    onClose={() => setSelectedBadgeKey(null)}
                    badgeKey={selectedBadgeKey}
                  />

                  {/* Showcase Modal */}
                  <ShowcaseModal
                    isOpen={isShowcaseOpen}
                    onClose={() => setIsShowcaseOpen(false)}
                    badges={badges}
                    onSave={handleSaveShowcase}
                    isSaving={isSavingShowcase}
                  />
                </>
              )}

              {activeTab === 'challenges' && <ChallengesTab />}
              {activeTab === 'journeys' && <JourneysTab />}
              {activeTab === 'engagement' && <EngagementTab />}
              {activeTab === 'shop' && <XpShopTab userXp={profile?.xp ?? 0} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default AchievementsPage;
