// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Separator } from '@/components/ui/Separator';
import { Slider } from '@/components/ui/Slider';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
/**
 * G3 - Goal Check-in Modal
 *
 * Allows users to log periodic check-ins on their goals with:
 * - Progress slider (percentage range)
 * - Text note
 * - Mood selector (emoji picker)
 *
 * API: GET /api/v2/goals/{id}/checkins
 *      POST /api/v2/goals/{id}/checkins
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from '@/lib/motion';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import Smile from 'lucide-react/icons/smile';
import Frown from 'lucide-react/icons/frown';
import Meh from 'lucide-react/icons/meh';
import Heart from 'lucide-react/icons/heart';
import Zap from 'lucide-react/icons/zap';
import Star from 'lucide-react/icons/star';
import Clock from 'lucide-react/icons/clock';
import TrendingUp from 'lucide-react/icons/trending-up';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import MessageSquare from 'lucide-react/icons/message-square';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';

import { useTranslation } from 'react-i18next';
/* ───────────────────────── Types ───────────────────────── */

interface CheckIn {
  id: number;
  goal_id: number;
  progress_value?: number | null;
  progress_percent?: number | null;
  note: string | null;
  mood: string | null;
  created_at: string;
}

interface GoalCheckinModalProps {
  isOpen: boolean;
  onClose: () => void;
  goalId: number;
  goalTitle: string;
  currentProgress: number;
  onCheckinCreated: () => void;
}

/* ───────────────────────── Mood Options ───────────────────────── */

const MOODS = [
  { value: 'great', labelKey: 'mood.great', icon: Star, color: 'text-amber-400' },
  { value: 'good', labelKey: 'mood.good', icon: Smile, color: 'text-emerald-400' },
  { value: 'okay', labelKey: 'mood.okay', icon: Meh, color: 'text-blue-400' },
  { value: 'struggling', labelKey: 'mood.struggling', icon: Frown, color: 'text-orange-400' },
  { value: 'motivated', labelKey: 'mood.motivated', icon: Zap, color: 'text-accent' },
  { value: 'grateful', labelKey: 'mood.grateful', icon: Heart, color: 'text-rose-400' },
] as const;

function getMoodIcon(mood: string) {
  const found = MOODS.find((m) => m.value === mood);
  if (!found) return null;
  const Icon = found.icon;
  return <Icon className={`w-4 h-4 ${found.color}`} aria-hidden="true" />;
}

function getMoodLabel(mood: string): string {
  return MOODS.find((m) => m.value === mood)?.labelKey || mood;
}

function getCheckinProgress(checkin: CheckIn): number | null {
  const value = checkin.progress_value ?? checkin.progress_percent;
  return value == null ? null : Number(value);
}

/* ───────────────────────── Component ───────────────────────── */

export function GoalCheckinModal({
  isOpen,
  onClose,
  goalId,
  goalTitle,
  currentProgress,
  onCheckinCreated,
}: GoalCheckinModalProps) {
  const toast = useToast();
  const { t } = useTranslation('goals');

  // Form state
  const [progressValue, setProgressValue] = useState(currentProgress);
  const [note, setNote] = useState('');
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // History state
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Reset form when opening. Done during render with a prev-prop comparison
  // (not useEffect) so users never see a stale frame. Mirrors the original
  // effect deps [isOpen, currentProgress]: re-applies when either changes while
  // the modal is open.
  const [prevTrigger, setPrevTrigger] = useState({ isOpen, currentProgress });
  if (isOpen !== prevTrigger.isOpen || currentProgress !== prevTrigger.currentProgress) {
    setPrevTrigger({ isOpen, currentProgress });
    if (isOpen) {
      setProgressValue(currentProgress);
      setNote('');
      setSelectedMood(null);
      setShowHistory(false);
    }
  }

  // Load check-in history
  const loadCheckins = useCallback(async () => {
    try {
      setIsLoadingHistory(true);
      setHistoryError(null);
      const response = await api.get<CheckIn[]>(`/v2/goals/${goalId}/checkins`);
      if (response.success && response.data) {
        setCheckins(Array.isArray(response.data) ? response.data : []);
      } else {
        // api.get resolves { success:false } on a 4xx/5xx WITHOUT throwing, so the
        // catch never fired — without this branch a failed history load fell through
        // to the "no check-ins yet" empty state, making a load failure look like a
        // goal that simply has no check-ins.
        setHistoryError(t('history.load_failed'));
      }
    } catch (err) {
      logError('Failed to load check-ins', err);
      setHistoryError(t('history.load_failed'));
    } finally {
      setIsLoadingHistory(false);
    }
  }, [goalId, t]);

  useEffect(() => {
    if (isOpen && showHistory) {
      loadCheckins();
    }
  }, [isOpen, showHistory, loadCheckins]);

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      const response = await api.post(`/v2/goals/${goalId}/checkins`, {
        progress_percent: progressValue,
        progress_value: progressValue,
        note: note.trim() || undefined,
        mood: selectedMood || undefined,
      });

      if (response.success) {
        toast.success(t('checkin_recorded'));
        onCheckinCreated();
        onClose();
      } else {
        toast.error(t('checkin_failed'));
      }
    } catch (err) {
      logError('Failed to create check-in', err);
      toast.error(t('checkin_failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      placement="top-center"
      scrollBehavior="inside"
      classNames={{
        backdrop: 'z-[9998]',
        wrapper: 'z-[9999] items-start px-3 py-4 pt-[calc(env(safe-area-inset-top)_+_7rem)] sm:px-4 sm:pt-[calc(env(safe-area-inset-top)_+_8rem)]',
        base: 'z-[10000] bg-overlay border border-theme-default my-0 max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_8rem)] sm:max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_9rem)]',
        body: 'overflow-y-auto',
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <ModalHeading className="flex items-center gap-2 text-theme-primary">
            <ClipboardCheck className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            {t('checkin.title')}
          </ModalHeading>
          <p className="text-sm text-theme-muted font-normal">{goalTitle}</p>
        </ModalHeader>
        <ModalBody className="space-y-5">
          {/* Tab toggle: New Check-in vs History */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={!showHistory ? 'solid' : 'flat'}
              className={!showHistory
                ? 'bg-gradient-to-r from-accent-strong to-accent-strong-end text-white'
                : 'bg-theme-elevated text-theme-muted'}
              onPress={() => setShowHistory(false)}
              startContent={<ClipboardCheck className="w-4 h-4" aria-hidden="true" />}
            >
              {t('checkin.new_checkin')}
            </Button>
            <Button
              size="sm"
              variant={showHistory ? 'solid' : 'flat'}
              className={showHistory
                ? 'bg-gradient-to-r from-accent-strong to-accent-strong-end text-white'
                : 'bg-theme-elevated text-theme-muted'}
              onPress={() => setShowHistory(true)}
              startContent={<Clock className="w-4 h-4" aria-hidden="true" />}
            >
              {t('checkin.history')}
            </Button>
          </div>

          {showHistory ? (
            /* Check-in History */
            <div>
              {isLoadingHistory ? (
                <div role="status" aria-busy="true" aria-label={t('insights.loading')} className="flex items-center justify-center py-8">
                  <Spinner size="md" color="primary" />
                </div>
              ) : historyError ? (
                <div role="alert" className="text-center py-8">
                  <p className="text-sm text-theme-muted mb-2">{historyError}</p>
                  <Button
                    size="sm"
                    variant="flat"
                    className="bg-theme-elevated text-theme-primary"
                    startContent={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
                    onPress={loadCheckins}
                  >
                    {t('history.retry')}
                  </Button>
                </div>
              ) : checkins.length === 0 ? (
                <div className="text-center py-8">
                  <ClipboardCheck className="w-10 h-10 text-theme-subtle mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm text-theme-muted">{t('checkin.no_checkins')}</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {checkins.map((checkin, index) => {
                    const progress = getCheckinProgress(checkin);
                    return (
                      <motion.div
                        key={checkin.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <GlassCard className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                                <span className="text-sm font-semibold text-theme-primary">
                                  {progress == null ? t('checkin.progress_unknown') : t('checkin.progress_value', { percent: progress })}
                                </span>
                                {checkin.mood && (
                                  <Chip
                                    size="sm"
                                    variant="flat"
                                    className="text-[10px] bg-theme-elevated"
                                    startContent={getMoodIcon(checkin.mood)}
                                  >
                                    {t(getMoodLabel(checkin.mood))}
                                  </Chip>
                                )}
                              </div>
                              {checkin.note && (
                                <p className="text-xs text-theme-muted line-clamp-2 mb-1">
                                  {checkin.note}
                                </p>
                              )}
                              <span className="text-xs text-theme-subtle">
                                {formatRelativeTime(checkin.created_at)}
                              </span>
                            </div>
                          </div>
                        </GlassCard>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* New Check-in Form */
            <>
              {/* Progress Slider */}
              <div>
                <label className="text-sm font-medium text-theme-primary mb-2 block">
                  {t('checkin.progress_label')}
                </label>
                <p className="text-xs text-theme-muted mb-3">
                  {t('checkin.progress_help')}
                </p>
                <Slider
                  step={5}
                  minValue={0}
                  maxValue={100}
                  value={progressValue}
                  onChange={(val) => setProgressValue(val as number)}
                  className="max-w-full"
                  classNames={{
                    track: 'bg-theme-hover',
                    filler: 'bg-gradient-to-r from-accent to-accent-gradient-end',
                    thumb: 'bg-white shadow-md border-2 border-accent',
                  }}
                  aria-label={t('checkin.aria_progress_percentage')}
                />
                <div className="flex justify-between text-xs text-theme-subtle mt-1">
                  <span>{t('checkin.progress_value', { percent: 0 })}</span>
                  <span className="font-semibold text-theme-primary">
                    {t('checkin.progress_value', { percent: progressValue })}
                  </span>
                  <span>{t('checkin.progress_value', { percent: 100 })}</span>
                </div>
              </div>

              <Separator />

              {/* Mood Selector */}
              <div>
                <label className="text-sm font-medium text-theme-primary mb-2 block">
                  {t('checkin.mood_label')}
                </label>
                <div className="flex gap-2 flex-wrap">
                  {MOODS.map((mood) => {
                    const Icon = mood.icon;
                    const isSelected = selectedMood === mood.value;
                    return (
                      <Button
                        key={mood.value}
                        size="sm"
                        variant={isSelected ? 'solid' : 'flat'}
                        className={isSelected
                          ? 'bg-gradient-to-r from-accent-strong to-accent-strong-end text-white'
                          : 'bg-theme-elevated text-theme-muted'}
                        startContent={<Icon className={`w-4 h-4 ${isSelected ? 'text-white' : mood.color}`} aria-hidden="true" />}
                        onPress={() => setSelectedMood(isSelected ? null : mood.value)}
                      >
                        {t(mood.labelKey)}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <Separator />

              {/* Note */}
              <div>
                <Textarea
                  label={t('checkin.note_label')}
                  placeholder={t('checkin.note_placeholder')}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  minRows={2}
                  maxRows={4}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                  }}
                  startContent={<MessageSquare className="w-4 h-4 text-theme-subtle mt-1" aria-hidden="true" />}
                />
              </div>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} className="text-theme-muted">
            {t('checkin.cancel')}
          </Button>
          {!showHistory && (
            <Button
              className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
              onPress={handleSubmit}
              isLoading={isSubmitting}
            >
              {t('checkin.submit')}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default GoalCheckinModal;
