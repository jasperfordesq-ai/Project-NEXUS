// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WellbeingTab - Volunteer burnout/wellbeing dashboard (V10)
 *
 * Shows wellbeing score, hours stats, streak, burnout warnings,
 * suggested rest days, and a mood check-in form.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from '@/lib/motion';

import Heart from 'lucide-react/icons/heart';
import Activity from 'lucide-react/icons/activity';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Smile from 'lucide-react/icons/smile';
import Flame from 'lucide-react/icons/flame';
import CalendarCheck from 'lucide-react/icons/calendar-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TrendingDown from 'lucide-react/icons/trending-down';
import Coffee from 'lucide-react/icons/coffee';
import Sun from 'lucide-react/icons/sun';
import MessageSquare from 'lucide-react/icons/message-square';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

/* ───────────────────────── Types ───────────────────────── */

interface WellbeingData {
  score: number;
  hours_this_week: number;
  hours_this_month: number;
  streak_days: number;
  burnout_risk: 'low' | 'moderate' | 'high';
  warnings: string[];
  suggested_rest_days: string[];
  recent_checkins: MoodCheckin[];
}

interface MoodCheckin {
  id: number;
  mood: number;
  note: string | null;
  created_at: string;
  /** True when the volunteer let their community's team get in touch about this check-in. */
  shared?: boolean;
}

/** POST /v2/volunteering/wellbeing/checkin response. */
interface WellbeingCheckinResult {
  id: number;
  mood: number;
  note: string | null;
  shared: boolean;
  /** True when the community's team (and organisations) were told about this check-in. */
  team_notified: boolean;
}

/** Moods at or below this level offer to let someone get in touch. */
const LOW_MOOD_MAX = 2;

/* ───────────────────────── Mood Helpers ───────────────────────── */

type TranslateFn = (key: string) => string;

const getMoodOptions = (t: TranslateFn) => [
  { value: 1, label: t('wellbeing.mood_struggling'), emoji: '😞' },
  { value: 2, label: t('wellbeing.mood_low'), emoji: '😔' },
  { value: 3, label: t('wellbeing.mood_okay'), emoji: '😐' },
  { value: 4, label: t('wellbeing.mood_good'), emoji: '😊' },
  { value: 5, label: t('wellbeing.mood_great'), emoji: '😄' },
];

function getMoodEmoji(value: number, t: TranslateFn): string {
  return getMoodOptions(t).find((m) => m.value === value)?.emoji ?? '😐';
}

function getMoodLabel(value: number, t: TranslateFn): string {
  return getMoodOptions(t).find((m) => m.value === value)?.label ?? t('wellbeing.mood_unknown');
}

/* ───────────────────────── Score Color ───────────────────────── */

function getScoreColor(score: number): { text: string; bg: string; indicator: string } {
  if (score >= 70) return { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10', indicator: 'bg-gradient-to-r from-emerald-500 to-green-400' };
  if (score >= 40) return { text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10', indicator: 'bg-gradient-to-r from-amber-500 to-yellow-400' };
  return { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', indicator: 'bg-gradient-to-r from-rose-500 to-red-400' };
}

function getScoreLabel(score: number, t: TranslateFn): string {
  if (score >= 80) return t('wellbeing.score_excellent');
  if (score >= 70) return t('wellbeing.score_good');
  if (score >= 50) return t('wellbeing.score_fair');
  if (score >= 30) return t('wellbeing.score_needs_attention');
  return t('wellbeing.score_critical');
}

function getRiskColor(risk: string): 'success' | 'warning' | 'danger' {
  switch (risk) {
    case 'low': return 'success';
    case 'moderate': return 'warning';
    case 'high': return 'danger';
    default: return 'warning';
  }
}

/* ───────────────────────── Animation variants ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/* ───────────────────────── Main Component ───────────────────────── */

export function WellbeingTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const { tenantPath } = useTenant();
  const moodOptions = getMoodOptions((key) => t(key));
  const [data, setData] = useState<WellbeingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTips, setShowTips] = useState(false);

  // Check-in modal state
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedMood, setSelectedMood] = useState<number>(3);
  const [checkinNote, setCheckinNote] = useState('');
  // For a Low or Struggling check-in, the volunteer can let their community's
  // team get in touch. Ticked by default; they can untick it to keep it private.
  const [shareWithTeam, setShareWithTeam] = useState(true);
  const isLowMood = selectedMood <= LOW_MOOD_MAX;
  const [isSubmitting, setIsSubmitting] = useState(false);

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

      const response = await api.get<WellbeingData>('/v2/volunteering/wellbeing');

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        setData(response.data as WellbeingData);
      } else {
        setError(tRef.current('wellbeing.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load wellbeing data', err);
      setError(tRef.current('wellbeing.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCheckin = async () => {
    try {
      setIsSubmitting(true);

      // share_with_team is always sent explicitly: the server treats a missing
      // value as "do not share", and only ever shares a Low or Struggling check-in.
      const response = await api.post<WellbeingCheckinResult>('/v2/volunteering/wellbeing/checkin', {
        mood: selectedMood,
        note: checkinNote.trim() || undefined,
        share_with_team: isLowMood ? shareWithTeam : false,
      });

      if (response.success) {
        const teamNotified = response.data?.team_notified === true;
        toastRef.current.success(
          tRef.current(teamNotified ? 'wellbeing.checkin_success_team_notified' : 'wellbeing.checkin_success'),
        );
        onClose();
        setSelectedMood(3);
        setCheckinNote('');
        setShareWithTeam(true);
        load();
      } else {
        toastRef.current.error(tRef.current('wellbeing.checkin_failed'));
      }
    } catch (err) {
      logError('Failed to submit wellbeing check-in', err);
      toastRef.current.error(tRef.current('wellbeing.checkin_failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-rose-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('wellbeing.heading')}</h2>
        </div>
        <Button
          size="sm"
          startContent={<Smile className="w-4 h-4" aria-hidden="true" />}
          onPress={onOpen}
          className="bg-gradient-to-r from-rose-500 to-pink-600 text-white sm:shrink-0"
        >
          {t('wellbeing.log_feeling')}
        </Button>
      </div>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={load}
          >
            {t('wellbeing.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <CardRowsSkeleton key={i} />
            ))}
          </div>
          <CardRowsSkeleton />
        </div>
      )}

      {/* Empty State */}
      {!error && !isLoading && !data && (
        <EmptyState
          icon={<Heart className="w-12 h-12" aria-hidden="true" />}
          title={t('wellbeing.no_data_title')}
          description={t('wellbeing.no_data_desc')}
          action={
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              onPress={onOpen}
            >
              {t('wellbeing.log_mood')}
            </Button>
          }
        />
      )}

      {/* Dashboard Content */}
      {!error && !isLoading && data && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* Stat Cards Row */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Wellbeing Score */}
            <GlassCard className="p-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${getScoreColor(data.score).bg} flex items-center justify-center`}>
                  <Activity className={`w-5 h-5 ${getScoreColor(data.score).text}`} aria-hidden="true" />
                </div>
                <div>
                  <p className={`text-2xl font-bold ${getScoreColor(data.score).text}`}>{data.score}</p>
                  <p className="text-xs text-theme-muted">{t('wellbeing.score_label')}</p>
                </div>
              </div>
            </GlassCard>

            {/* Hours This Week */}
            <GlassCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-accent" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-theme-primary">{t('hours_abbrev', { hours: data.hours_this_week })}</p>
                  <p className="text-xs text-theme-muted">{t('wellbeing.this_week')}</p>
                </div>
              </div>
            </GlassCard>

            {/* Hours This Month */}
            <GlassCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
                  <CalendarCheck className="w-5 h-5 text-violet-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-theme-primary">{t('hours_abbrev', { hours: data.hours_this_month })}</p>
                  <p className="text-xs text-theme-muted">{t('wellbeing.this_month')}</p>
                </div>
              </div>
            </GlassCard>

            {/* Streak */}
            <GlassCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                  <Flame className="w-5 h-5 text-orange-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-theme-primary">{data.streak_days}</p>
                  <p className="text-xs text-theme-muted">{t('wellbeing.day_streak')}</p>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Wellbeing Score Bar */}
          <motion.div variants={itemVariants}>
            <GlassCard className="p-5">
              <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Heart className="w-4 h-4 text-rose-400" aria-hidden="true" />
                  <span className="text-sm font-medium text-theme-primary">{t('wellbeing.score_label')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Chip size="sm" color={getRiskColor(data.burnout_risk)} variant="soft">
                    {data.burnout_risk === 'low' ? t('wellbeing.risk_low') : data.burnout_risk === 'moderate' ? t('wellbeing.risk_moderate') : t('wellbeing.risk_high')}
                  </Chip>
                  <span className={`text-sm font-semibold ${getScoreColor(data.score).text}`}>
                    {t('wellbeing.score_out_of_100', {
                      score: data.score,
                      label: getScoreLabel(data.score, (key) => t(key)),
                    })}
                  </span>
                </div>
              </div>
              <Progress
                value={data.score}
                maxValue={100}
                classNames={{
                  indicator: getScoreColor(data.score).indicator,
                  track: 'bg-theme-hover',
                }}
                size="lg"
                aria-label={t('wellbeing.score_aria', { score: data.score })}
              />
            </GlassCard>
          </motion.div>

          {/* Warning Cards */}
          {data.warnings.length > 0 && (
            <motion.div variants={itemVariants} className="space-y-3">
              {data.warnings.map((warning, i) => (
                <GlassCard key={i} className="p-4 border-l-4 border-amber-500">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium text-theme-primary">{t('wellbeing.burnout_warning')}</p>
                      <p className="text-sm text-theme-muted">{warning}</p>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </motion.div>
          )}

          {/* Suggested Rest Days */}
          {data.suggested_rest_days.length > 0 && (
            <motion.div variants={itemVariants}>
              <GlassCard className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Coffee className="w-4 h-4 text-teal-400" aria-hidden="true" />
                  <h3 className="font-semibold text-theme-primary">{t('wellbeing.suggested_rest_days')}</h3>
                </div>
                <p className="text-sm text-theme-muted mb-3">
                  {t('wellbeing.rest_days_desc')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.suggested_rest_days
                    .map((day) => ({ day, parsed: new Date(day) }))
                    .filter(({ parsed }) => !Number.isNaN(parsed.getTime()))
                    .map(({ day, parsed }) => (
                    <Chip
                      key={day}
                      size="sm"
                      variant="soft"
                      color="accent"
                      startContent={<Sun className="w-3 h-3" />}
                    >
                      {parsed.toLocaleDateString(getFormattingLocale(), { weekday: 'short', month: 'short', day: 'numeric' })}
                    </Chip>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Recent Check-ins */}
          {data.recent_checkins.length > 0 && (
            <motion.div variants={itemVariants}>
              <GlassCard className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Smile className="w-4 h-4 text-rose-400" aria-hidden="true" />
                  <h3 className="font-semibold text-theme-primary">{t('wellbeing.recent_checkins')}</h3>
                </div>
                <div className="space-y-3">
                  {data.recent_checkins.map((checkin) => (
                    <div key={checkin.id} className="flex items-center gap-3 p-3 rounded-xl bg-theme-elevated">
                      <span className="text-2xl" role="img" aria-label={getMoodLabel(checkin.mood, (key) => t(key))}>
                        {getMoodEmoji(checkin.mood, (key) => t(key))}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-theme-primary">{getMoodLabel(checkin.mood, (key) => t(key))}</span>
                          <span className="text-xs text-theme-subtle">
                            {new Date(checkin.created_at).toLocaleDateString(getFormattingLocale(), {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {checkin.note && (
                          <p className="text-xs text-theme-muted truncate">{checkin.note}</p>
                        )}
                        {checkin.shared === true && (
                          <p className="text-xs text-theme-subtle mt-0.5">{t('wellbeing.checkin_shared_label')}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Low Score Call-to-Action */}
          {data.score < 40 && (
            <motion.div variants={itemVariants}>
              <GlassCard className="p-5 border border-rose-500/30">
                <div className="flex items-start gap-3">
                  <TrendingDown className="w-6 h-6 text-rose-400 flex-shrink-0" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold text-theme-primary mb-1">{t('wellbeing.needs_attention_title')}</h3>
                    <p className="text-sm text-theme-muted mb-3">
                      {t('wellbeing.needs_attention_desc')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="bg-theme-elevated text-theme-muted"
                        startContent={<Coffee className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => setShowTips(!showTips)}
                      >
                        {showTips ? t('wellbeing.hide_tips') : t('wellbeing.view_tips')}
                      </Button>
                      {/* The text above suggests reaching out to the community; this is
                          the way to do it (gap C5). The contact form goes to the
                          community's own team. */}
                      <Button
                        as={Link}
                        to={tenantPath('/contact')}
                        size="sm"
                        variant="secondary"
                        startContent={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('common:footer.contact_us')}
                      </Button>
                    </div>
                    {showTips && (
                      <div className="mt-4 space-y-2">
                        <p className="text-sm text-muted">&#8226; {t('wellbeing.tip_breaks')}</p>
                        <p className="text-sm text-muted">&#8226; {t('wellbeing.tip_boundaries')}</p>
                        <p className="text-sm text-muted">&#8226; {t('wellbeing.tip_connect')}</p>
                        <p className="text-sm text-muted">&#8226; {t('wellbeing.tip_celebrate')}</p>
                        <p className="text-sm text-muted">&#8226; {t('wellbeing.tip_reduce')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Mood Check-in Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            <ModalHeading className="flex items-center gap-2">
              <Smile className="w-5 h-5 text-rose-400" aria-hidden="true" />
              {t('wellbeing.how_feeling')}
            </ModalHeading>
          </ModalHeader>
          <ModalBody className="space-y-6">
            <p className="text-sm text-theme-muted">
              {t('wellbeing.checkin_desc')}
            </p>

            {/* Mood Selector */}
            <div>
              <p className="text-sm font-medium text-theme-primary mb-3">{t('wellbeing.select_mood')}</p>
              <ToggleButtonGroup
                aria-label={t('wellbeing.select_mood')}
                selectionMode="single"
                disallowEmptySelection
                isDetached
                selectedKeys={new Set([String(selectedMood)])}
                onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setSelectedMood(Number(k)); }}
                className="flex justify-center gap-3"
              >
                {moodOptions.map((mood) => (
                  <ToggleButton
                    key={mood.value}
                    id={String(mood.value)}
                    variant="ghost"
                    aria-label={t('wellbeing.mood_aria', { mood: mood.label })}
                    className="flex min-h-20 min-w-0 flex-col items-center gap-1 rounded-xl p-3 transition-all bg-theme-elevated hover:bg-theme-hover data-[selected=true]:bg-rose-500/20 data-[selected=true]:ring-2 data-[selected=true]:ring-rose-500 data-[selected=true]:scale-110"
                  >
                    <span className="text-3xl" role="img" aria-hidden="true">{mood.emoji}</span>
                    <span className="text-xs text-theme-muted">{mood.label}</span>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </div>

            {/* Optional Note */}
            <Textarea
              label={t('wellbeing.note_label')}
              placeholder={t('wellbeing.note_placeholder')}
              value={checkinNote}
              onChange={(e) => setCheckinNote(e.target.value)}
              maxLength={500}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />

            {/* Low or Struggling: offer to let someone get in touch. */}
            {isLowMood && (
              <Checkbox
                isSelected={shareWithTeam}
                onChange={setShareWithTeam}
                description={
                  shareWithTeam
                    ? t('wellbeing.share_with_team_desc')
                    : t('wellbeing.share_with_team_private')
                }
              >
                {t('wellbeing.share_with_team_label')}
              </Checkbox>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose} className="text-theme-muted">{t('wellbeing.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              onPress={handleCheckin}
              isLoading={isSubmitting}
              startContent={!isSubmitting ? <Heart className="w-4 h-4" aria-hidden="true" /> : undefined}
            >
              {t('wellbeing.submit_checkin')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default WellbeingTab;
