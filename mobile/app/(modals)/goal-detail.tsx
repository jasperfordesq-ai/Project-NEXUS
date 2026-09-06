// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import ErrorState from '@/components/ui/ErrorState';
import { parseDecimalInput } from '@/lib/utils/decimal';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Surface, Text } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import SourceRepositoryLink from '@/components/SourceRepositoryLink';
import {
  deleteGoalReminder,
  getGoal,
  getGoalHistory,
  getGoalInsights,
  getGoalReminder,
  setGoalReminder,
  updateGoalProgress,
  type Goal,
  type GoalHistoryEntry,
  type GoalInsights,
  type GoalReminder,
  type GoalReminderFrequency,
} from '@/lib/api/goals';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const REMINDER_FREQUENCIES: GoalReminderFrequency[] = ['daily', 'weekly', 'biweekly', 'monthly'];

function numberOrFallback(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function goalTarget(goal: Goal) {
  return numberOrFallback(goal.target_hours, numberOrFallback(goal.target_value));
}

function goalProgress(goal: Goal) {
  return numberOrFallback(goal.progress_hours, numberOrFallback(goal.current_value));
}

function goalPercent(goal: Goal) {
  const explicit = numberOrFallback(goal.progress_percentage, NaN);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));
  const target = goalTarget(goal);
  return target > 0 ? Math.max(0, Math.min(100, Math.round((goalProgress(goal) / target) * 100))) : 0;
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <View className="h-2.5 overflow-hidden rounded-full bg-default-200">
      <View className="h-2.5 rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
    </View>
  );
}

function InsightTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 rounded-panel-inner p-3">
      <View className="flex-row items-center gap-2">
        <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
          <Ionicons name={icon} size={16} color={tone} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[11px] font-bold uppercase text-muted-foreground" numberOfLines={1}>{label}</Text>
          <Text className="text-base font-bold text-foreground" numberOfLines={1}>{value}</Text>
        </View>
      </View>
    </Surface>
  );
}

export default function GoalDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const goalId = Number(Array.isArray(params.id) ? params.id[0] : params.id);
  const { t } = useTranslation(['goals', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [history, setHistory] = useState<GoalHistoryEntry[]>([]);
  const [insights, setInsights] = useState<GoalInsights | null>(null);
  const [reminder, setReminder] = useState<GoalReminder | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<GoalReminderFrequency>('weekly');
  const [progressIncrement, setProgressIncrement] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!Number.isFinite(goalId) || goalId <= 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [goalResult, historyResult, insightsResult, reminderResult] = await Promise.allSettled([
        getGoal(goalId),
        getGoalHistory(goalId),
        getGoalInsights(goalId),
        getGoalReminder(goalId),
      ]);

      if (goalResult.status === 'fulfilled') {
        setGoal(goalResult.value.data);
        setLoadError(null);
      } else {
        // allSettled never throws, so the catch below never ran and a timeout read as
        // "Goal not found" with no retry (audit 2026-09-05, S2-07).
        setLoadError(describeApiError(goalResult.reason, t('detail.loadError')));
      }
      if (historyResult.status === 'fulfilled') setHistory(historyResult.value.data ?? []);
      if (insightsResult.status === 'fulfilled') setInsights(insightsResult.value.data);
      if (reminderResult.status === 'fulfilled') {
        const nextReminder = reminderResult.value.data;
        setReminder(nextReminder);
        if (nextReminder?.frequency) setSelectedFrequency(nextReminder.frequency);
      }
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('detail.loadError')), variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
  }, [goalId, t, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const percent = goal ? goalPercent(goal) : 0;
  const target = goal ? goalTarget(goal) : 0;
  const current = goal ? goalProgress(goal) : 0;
  const dueDate = goal ? formatDate(goal.due_date ?? goal.deadline) : null;
  const reminderEnabled = Boolean(reminder && reminder.enabled !== false && reminder.enabled !== 0);
  const milestones = insights?.milestones ?? [];
  const completedMilestones = milestones.filter((milestone) => milestone.completed_at).length;

  const summaryTiles = useMemo(() => {
    if (!goal) return [];
    return [
      { icon: 'analytics-outline' as const, label: t('detail.summary.progress'), value: t('percent', { percent }), tone: primary },
      { icon: 'checkmark-done-outline' as const, label: t('detail.summary.checkins'), value: String(insights?.checkin_count ?? 0), tone: theme.success },
      { icon: 'flame-outline' as const, label: t('detail.summary.streak'), value: String(insights?.streak_count ?? goal.streak_count ?? 0), tone: '#f59e0b' },
      { icon: 'flag-outline' as const, label: t('detail.summary.milestones'), value: `${completedMilestones}/${milestones.length || insights?.milestone_count || 0}`, tone: '#8b5cf6' },
    ];
  }, [completedMilestones, goal, insights, milestones.length, percent, primary, t, theme.success]);

  async function handleProgressSave() {
    const increment = parseDecimalInput(progressIncrement) ?? Number.NaN;
    if (!goal || !Number.isFinite(increment) || increment <= 0) return;
    setIsSaving(true);
    try {
      const result = await updateGoalProgress(goal.id, increment);
      setGoal(result.data);
      setProgressIncrement('');
      await load();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('detail.progressError')), variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReminderSave(enabled: boolean) {
    if (!goal) return;
    setIsSaving(true);
    try {
      if (!enabled) {
        await deleteGoalReminder(goal.id);
        setReminder(null);
      } else {
        const result = await setGoalReminder(goal.id, { frequency: selectedFrequency, enabled: true });
        setReminder(result.data);
      }
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('detail.reminderError')), variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <ModalErrorBoundary>
        <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
          <AppTopBar title={t('detail.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/goals" />
          <LoadingSpinner />
        </SafeAreaView>
      </ModalErrorBoundary>
    );
  }

  if (!goal) {
    return (
      <ModalErrorBoundary>
        <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
          <AppTopBar title={t('detail.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/goals" />
          {loadError ? (
            <ErrorState subtitle={loadError} onRetry={() => void load()} isRetrying={isLoading} />
          ) : (
            <EmptyState icon="flag-outline" title={t('detail.notFound')} subtitle={t('detail.notFoundHint')} />
          )}
        </SafeAreaView>
      </ModalErrorBoundary>
    );
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/goals" />
        <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 40, gap: 12 }}>
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name={goal.status === 'completed' ? 'checkmark-circle-outline' : 'flag-outline'} size={24} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Chip size="sm" variant="soft" color={goal.status === 'completed' ? 'success' : 'accent'}>
                    <Chip.Label>{t(`status.${goal.status}`)}</Chip.Label>
                  </Chip>
                  <Text className="mt-2 text-2xl font-bold text-foreground">{goal.title}</Text>
                  {goal.description ? <Text className="text-sm leading-5 text-muted-foreground">{goal.description}</Text> : null}
                </View>
              </View>

              <View className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs font-bold uppercase text-muted-foreground">
                    {target > 0 ? t('progress', { current, target }) : t('noTarget', { current })}
                  </Text>
                  <Text className="text-sm font-bold" style={{ color: primary }}>{t('percent', { percent })}</Text>
                </View>
                <ProgressBar percent={percent} color={primary} />
              </View>

              <View className="flex-row flex-wrap gap-2">
                {dueDate ? (
                  <Chip size="sm" variant="secondary" color="default">
                    <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
                    <Chip.Label>{t('due', { date: dueDate })}</Chip.Label>
                  </Chip>
                ) : null}
                {goal.buddy_name ? (
                  <Chip size="sm" variant="secondary" color="default">
                    <Ionicons name="people-outline" size={12} color={theme.textMuted} />
                    <Chip.Label>{t('buddy', { name: goal.buddy_name })}</Chip.Label>
                  </Chip>
                ) : null}
                {goal.is_public ? (
                  <Chip size="sm" variant="secondary" color="default">
                    <Ionicons name="globe-outline" size={12} color={theme.textMuted} />
                    <Chip.Label>{t('visibility.public')}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-base font-bold text-foreground">{t('detail.insights')}</Text>
              <View className="flex-row flex-wrap gap-3">
                {summaryTiles.map((tile) => <InsightTile key={tile.label} {...tile} />)}
              </View>
            </HeroCard.Body>
          </HeroCard>

          {goal.is_owner ? (
            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-3 p-4">
                <Text className="text-base font-bold text-foreground">{t('detail.progressUpdate')}</Text>
                <Input
                  label={t('detail.progressIncrement')}
                  value={progressIncrement}
                  onChangeText={setProgressIncrement}
                  keyboardType="decimal-pad"
                  placeholder={t('detail.progressPlaceholder')}
                />
                <HeroButton
                  variant="primary"
                  onPress={handleProgressSave}
                  isDisabled={isSaving || !((parseDecimalInput(progressIncrement) ?? Number.NaN) > 0)}
                >
                  <HeroButton.Label>{isSaving ? t('detail.saving') : t('detail.saveProgress')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-bold text-foreground">{t('detail.reminder')}</Text>
                  <Text className="text-xs text-muted-foreground">{reminderEnabled ? t('detail.reminderOn') : t('detail.reminderOff')}</Text>
                </View>
                <HeroButton size="sm" variant={reminderEnabled ? 'tertiary' : 'primary'} onPress={() => void handleReminderSave(!reminderEnabled)} isDisabled={isSaving}>
                  <HeroButton.Label>{reminderEnabled ? t('detail.disableReminder') : t('detail.enableReminder')}</HeroButton.Label>
                </HeroButton>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {REMINDER_FREQUENCIES.map((frequency) => (
                  <HeroButton
                    key={frequency}
                    size="sm"
                    variant={selectedFrequency === frequency ? 'primary' : 'secondary'}
                    onPress={() => setSelectedFrequency(frequency)}
                    isDisabled={isSaving}
                  >
                    <HeroButton.Label>{t(`detail.frequency.${frequency}`)}</HeroButton.Label>
                  </HeroButton>
                ))}
              </View>
              {reminder?.next_reminder_at ? (
                <Text className="text-xs text-muted-foreground">{t('detail.nextReminder', { date: formatDate(reminder.next_reminder_at) ?? '' })}</Text>
              ) : null}
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-base font-bold text-foreground">{t('detail.milestones')}</Text>
              {milestones.length === 0 ? (
                <Text className="text-sm text-muted-foreground">{t('detail.noMilestones')}</Text>
              ) : milestones.map((milestone) => (
                <Surface key={milestone.id} variant="secondary" className="rounded-panel-inner px-3 py-3">
                  <View className="flex-row items-center gap-3">
                    <Ionicons name={milestone.completed_at ? 'checkmark-circle-outline' : 'ellipse-outline'} size={20} color={milestone.completed_at ? theme.success : theme.textMuted} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold text-foreground">{milestone.title}</Text>
                      <Text className="text-xs text-muted-foreground">
                        {milestone.completed_at
                          ? t('detail.completedOn', { date: formatDate(milestone.completed_at) ?? '' })
                          : t('detail.pendingMilestone')}
                      </Text>
                    </View>
                  </View>
                </Surface>
              ))}
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-base font-bold text-foreground">{t('detail.history')}</Text>
              {history.length === 0 ? (
                <Text className="text-sm text-muted-foreground">{t('detail.noHistory')}</Text>
              ) : history.slice(0, 8).map((entry) => (
                <Surface key={entry.id} variant="secondary" className="rounded-panel-inner px-3 py-3">
                  <View className="flex-row items-start gap-3">
                    <View className="mt-0.5 size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                      <Ionicons name="time-outline" size={16} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold text-foreground">{entry.description}</Text>
                      <Text className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</Text>
                    </View>
                  </View>
                </Surface>
              ))}
            </HeroCard.Body>
          </HeroCard>

          <SourceRepositoryLink />
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
