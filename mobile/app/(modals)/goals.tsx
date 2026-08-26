// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  createGoal,
  createGoalFromTemplate,
  getGoalTemplateCategories,
  getGoalTemplates,
  getGoals,
  updateGoalStatus,
  type Goal,
  type GoalTemplate,
} from '@/lib/api/goals';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha , contrastText } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import EmptyState from '@/components/ui/EmptyState';
import BottomSheet from '@/components/ui/BottomSheet';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type ApiGoal = Goal & {
  target_value?: number | string | null;
  current_value?: number | string | null;
  deadline?: string | null;
  progress_percentage?: number | string | null;
  is_public?: boolean;
  is_owner?: boolean;
  buddy_name?: string | null;
  streak_count?: number | null;
};

function numberOrFallback(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getGoalTarget(goal: ApiGoal) {
  return numberOrFallback(goal.target_hours, numberOrFallback(goal.target_value));
}

function getGoalProgress(goal: ApiGoal) {
  return numberOrFallback(goal.progress_hours, numberOrFallback(goal.current_value));
}

function getGoalProgressPercent(goal: ApiGoal) {
  const explicit = numberOrFallback(goal.progress_percentage, NaN);
  if (Number.isFinite(explicit)) {
    return Math.max(0, Math.min(100, Math.round(explicit)));
  }
  const target = getGoalTarget(goal);
  return target > 0 ? Math.max(0, Math.min(100, Math.round((getGoalProgress(goal) / target) * 100))) : 0;
}

function getGoalDueDate(goal: ApiGoal) {
  return goal.due_date ?? goal.deadline ?? null;
}

function getTemplateTarget(template: GoalTemplate) {
  return numberOrFallback(template.target_value, numberOrFallback(template.default_target_value, 0));
}

function statusTone(goal: ApiGoal, primary: string, theme: ReturnType<typeof useTheme>) {
  if (goal.status === 'completed') return theme.success;
  if (goal.status === 'abandoned') return theme.textMuted;
  return primary;
}

function StatusChip({
  goal,
  primary,
  theme,
  t,
}: {
  goal: ApiGoal;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string) => string;
}) {
  const tone = statusTone(goal, primary, theme);
  const icon: IoniconName =
    goal.status === 'completed' ? 'checkmark-circle-outline' :
    goal.status === 'abandoned' ? 'close-circle-outline' :
    'flag-outline';

  return (
    <Chip size="sm" variant="secondary" color={goal.status === 'completed' ? 'success' : 'default'}>
      <Ionicons name={icon} size={12} color={tone} />
      <Chip.Label>{t(`status.${goal.status}`)}</Chip.Label>
    </Chip>
  );
}

function ProgressBar({
  percent,
  color,
}: {
  percent: number;
  color: string;
}) {
  return (
    <View className="h-2.5 overflow-hidden rounded-full bg-default-200">
      <View className="h-2.5 rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
  theme,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  tone: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 gap-2 rounded-panel-inner p-3">
      <View className="flex-row items-center gap-2">
        <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
          <Ionicons name={icon} size={16} color={tone} />
        </View>
        <Text className="flex-1 text-[11px] font-semibold uppercase text-muted-foreground" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>
        {value}
      </Text>
    </Surface>
  );
}

function GoalsHero({
  goals,
  primary,
  theme,
  t,
}: {
  goals: ApiGoal[];
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const activeGoals = goals.filter((goal) => goal.status === 'active').length;
  const completedGoals = goals.filter((goal) => goal.status === 'completed').length;
  const totalProgress = goals.length > 0
    ? Math.round(goals.reduce((sum, goal) => sum + getGoalProgressPercent(goal), 0) / goals.length)
    : 0;

  return (
    <HeroCard className="gap-5 overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-5 p-4 pt-0">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="flag-outline" size={24} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-semibold uppercase text-muted-foreground">
              {t('heroEyebrow')}
            </Text>
            <Text className="text-2xl font-bold text-foreground" numberOfLines={1}>
              {t('title')}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t('subtitle')}
            </Text>
          </View>
        </View>

        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase text-muted-foreground">
              {t('stats.averageProgress')}
            </Text>
            <Text className="text-sm font-bold" style={{ color: primary }}>
              {t('percent', { percent: totalProgress })}
            </Text>
          </View>
          <ProgressBar percent={totalProgress} color={primary} />
        </View>

        <View className="flex-row flex-wrap gap-3">
          <StatTile icon="flag-outline" label={t('stats.active')} value={String(activeGoals)} tone={primary} theme={theme} />
          <StatTile icon="checkmark-circle-outline" label={t('stats.completed')} value={String(completedGoals)} tone={theme.success} theme={theme} />
          <StatTile icon="layers-outline" label={t('stats.total')} value={String(goals.length)} tone="#f59e0b" theme={theme} />
          <StatTile icon="sparkles-outline" label={t('stats.momentum')} value={goals.length > 0 ? t('momentumOn') : t('momentumEmpty')} tone="#8b5cf6" theme={theme} />
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function GoalCard({
  goal,
  primary,
  theme,
  t,
  onComplete,
  onAbandon,
}: {
  goal: ApiGoal;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onComplete: (id: number) => void;
  onAbandon: (id: number) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const target = getGoalTarget(goal);
  const current = getGoalProgress(goal);
  const percent = getGoalProgressPercent(goal);
  const tone = statusTone(goal, primary, theme);
  const dueDate = getGoalDueDate(goal);
  const dueDateStr = dueDate
    ? new Date(dueDate).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  const openDetail = () => {
    router.push({ pathname: '/(modals)/goal-detail', params: { id: String(goal.id) } } as unknown as Href);
  };

  function handleAbandon() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    confirm({
      title: t('abandonTitle'),
      message: t('abandonMessage'),
      confirmLabel: t('abandon'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => onAbandon(goal.id),
    });
  }

  return (
    <>
    <HeroCard className="rounded-panel p-0" accessible accessibilityLabel={goal.title}>
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
            <Ionicons name={goal.status === 'completed' ? 'checkmark-outline' : 'flag-outline'} size={22} color={tone} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-start justify-between gap-2">
              <Text className="min-w-0 flex-1 text-base font-semibold text-foreground" numberOfLines={2}>
                {goal.title}
              </Text>
              <StatusChip goal={goal} primary={primary} theme={theme} t={t} />
            </View>
            {goal.description ? (
              <Text className="text-sm text-muted-foreground" numberOfLines={3}>
                {goal.description}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase text-muted-foreground">
              {target > 0 ? t('progress', { current, target }) : t('noTarget', { current })}
            </Text>
            <Text className="text-xs font-bold" style={{ color: tone }}>
              {t('percent', { percent })}
            </Text>
          </View>
          <ProgressBar percent={percent} color={tone} />
        </View>

        <View className="flex-row flex-wrap gap-2">
          {dueDateStr ? (
            <Chip size="sm" variant="secondary" color="default">
              <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
              <Chip.Label>{t('due', { date: dueDateStr })}</Chip.Label>
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

        {goal.status === 'active' ? (
          <HeroCard.Footer className="gap-2 p-0 pt-1">
            <HeroButton
              className="flex-1"
              size="sm"
              variant="secondary"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onComplete(goal.id);
              }}
            >
              <Ionicons name="checkmark-outline" size={15} color={theme.success} />
              <HeroButton.Label>{t('complete')}</HeroButton.Label>
            </HeroButton>
            <HeroButton className="flex-1" size="sm" variant="secondary" onPress={openDetail}>
              <Ionicons name="open-outline" size={15} color={primary} />
              <HeroButton.Label>{t('details')}</HeroButton.Label>
            </HeroButton>
            <HeroButton className="flex-1" size="sm" variant="tertiary" onPress={handleAbandon}>
              <Ionicons name="close-outline" size={15} color={theme.textMuted} />
              <HeroButton.Label>{t('abandon')}</HeroButton.Label>
            </HeroButton>
          </HeroCard.Footer>
        ) : (
          <HeroCard.Footer className="p-0 pt-1">
            <HeroButton className="flex-1" size="sm" variant="secondary" onPress={openDetail}>
              <Ionicons name="open-outline" size={15} color={primary} />
              <HeroButton.Label>{t('details')}</HeroButton.Label>
            </HeroButton>
          </HeroCard.Footer>
        )}
      </HeroCard.Body>
    </HeroCard>
    {confirmDialog}
    </>
  );
}

function CreateGoalForm({
  theme,
  t,
  onCreated,
  onCancel,
}: {
  theme: ReturnType<typeof useTheme>;
  t: (key: string) => string;
  onCreated: (goal: Goal) => void;
  onCancel: () => void;
}) {
  const { show: showToast } = useAppToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSubmitting(true);
    try {
      const parsed = targetValue.trim() !== '' ? Number(targetValue) : undefined;
      const result = await createGoal({
        title: trimmedTitle,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(parsed !== undefined && Number.isFinite(parsed) ? { target_value: parsed } : {}),
      });
      onCreated(result.data);
      setTitle('');
      setDescription('');
      setTargetValue('');
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('create.error')), variant: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-center gap-3">
          <View className="size-10 items-center justify-center rounded-2xl bg-default-200">
            <Ionicons name="add-outline" size={22} color={theme.text} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-bold text-foreground">{t('create.title')}</Text>
            <Text className="text-xs text-muted-foreground">{t('create.subtitle')}</Text>
          </View>
        </View>

        <View>
          <Input
            label={t('create.titleLabel')}
            style={{ color: theme.text }}
            placeholder={t('create.titlePlaceholder')}
            placeholderTextColor={theme.textMuted}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
            autoFocus
          />
        </View>

        <View>
          <Input
            label={t('create.descriptionLabel')}
            style={{ color: theme.text, minHeight: 82, textAlignVertical: 'top' }}
            placeholder={t('create.descriptionPlaceholder')}
            placeholderTextColor={theme.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </View>

        <View>
          <Input
            label={t('create.targetHoursLabel')}
            style={{ color: theme.text }}
            placeholder={t('create.targetPlaceholder')}
            placeholderTextColor={theme.textMuted}
            value={targetValue}
            onChangeText={setTargetValue}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
        </View>

        <HeroCard.Footer className="gap-2 p-0">
          <HeroButton className="flex-1" variant="tertiary" onPress={onCancel}>
            <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
          </HeroButton>
          <HeroButton
            className="flex-[2]"
            variant="primary"
            onPress={() => void handleSubmit()}
            isDisabled={submitting || !title.trim()}
          >
            {submitting ? <Spinner size="sm" /> : <HeroButton.Label>{t('create.submit')}</HeroButton.Label>}
          </HeroButton>
        </HeroCard.Footer>
      </HeroCard.Body>
    </HeroCard>
  );
}

function GoalTemplatesPanel({
  primary,
  theme,
  t,
  onCreated,
}: {
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onCreated: (goal: Goal) => void;
}) {
  const { show: showToast } = useAppToast();
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingFromId, setCreatingFromId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadTemplates() {
      setIsLoading(true);
      setError(null);
      try {
        const [templatesResponse, categoriesResponse] = await Promise.all([
          getGoalTemplates(),
          getGoalTemplateCategories(),
        ]);
        if (!mounted) return;
        setTemplates(templatesResponse.data ?? []);
        setCategories(categoriesResponse.data ?? []);
      } catch {
        if (mounted) setError(t('templates.loadError'));
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadTemplates();
    return () => {
      mounted = false;
    };
    // Keep the template load tied to panel mount. Test/runtime i18n functions can change identity between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleTemplates = selectedCategory
    ? templates.filter((template) => template.category === selectedCategory)
    : templates;

  async function applyTemplate(template: GoalTemplate) {
    setCreatingFromId(template.id);
    try {
      const result = await createGoalFromTemplate(template.id);
      onCreated(result.data);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('templates.createError')), variant: 'danger' });
    } finally {
      setCreatingFromId(null);
    }
  }

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="sparkles-outline" size={20} color={primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-bold text-foreground">{t('templates.title')}</Text>
            <Text className="text-xs text-muted-foreground">{t('templates.subtitle')}</Text>
          </View>
        </View>

        {isLoading ? (
          <View className="min-h-[120px] items-center justify-center">
            <Spinner size="md" />
          </View>
        ) : error ? (
          <Surface variant="secondary" className="items-center gap-3 rounded-panel-inner p-4">
            <Ionicons name="alert-circle-outline" size={24} color={theme.error} />
            <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>{error}</Text>
          </Surface>
        ) : templates.length === 0 ? (
          <Surface variant="secondary" className="items-center gap-3 rounded-panel-inner p-4">
            <Ionicons name="layers-outline" size={24} color={theme.textMuted} />
            <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>{t('templates.empty')}</Text>
          </Surface>
        ) : (
          <>
            <View className="flex-row flex-wrap gap-2">
              <HeroButton
                size="sm"
                variant={selectedCategory === null ? 'primary' : 'secondary'}
                onPress={() => setSelectedCategory(null)}
              >
                <HeroButton.Label>{t('templates.allCategories')}</HeroButton.Label>
              </HeroButton>
              {categories.map((category) => (
                <HeroButton
                  key={category}
                  size="sm"
                  variant={selectedCategory === category ? 'primary' : 'secondary'}
                  onPress={() => setSelectedCategory(category)}
                >
                  <HeroButton.Label>{category}</HeroButton.Label>
                </HeroButton>
              ))}
            </View>

            {visibleTemplates.length === 0 ? (
              <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>
                {t('templates.emptyCategory')}
              </Text>
            ) : (
              <View className="gap-3">
                {visibleTemplates.map((template) => {
                  const target = getTemplateTarget(template);
                  const duration = numberOrFallback(template.duration_days, 0);
                  return (
                    <Surface key={template.id} variant="secondary" className="gap-3 rounded-panel-inner p-3">
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="min-w-0 flex-1 gap-1">
                          <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                            {template.title}
                          </Text>
                          {template.description ? (
                            <Text className="text-xs leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                              {template.description}
                            </Text>
                          ) : null}
                        </View>
                        <HeroButton
                          size="sm"
                          variant="primary"
                          isDisabled={creatingFromId !== null}
                          onPress={() => void applyTemplate(template)}
                          accessibilityLabel={t('templates.useLabel', { title: template.title })}
                        >
                          {creatingFromId === template.id ? <Spinner size="sm" /> : <HeroButton.Label>{t('templates.use')}</HeroButton.Label>}
                        </HeroButton>
                      </View>

                      <View className="flex-row flex-wrap gap-2">
                        {target > 0 ? (
                          <Chip size="sm" variant="secondary" color="default">
                            <Ionicons name="flag-outline" size={12} color={theme.textMuted} />
                            <Chip.Label>{t('templates.target', { value: target })}</Chip.Label>
                          </Chip>
                        ) : null}
                        {template.category ? (
                          <Chip size="sm" variant="secondary" color="default">
                            <Chip.Label>{template.category}</Chip.Label>
                          </Chip>
                        ) : null}
                        {duration > 0 ? (
                          <Chip size="sm" variant="secondary" color="default">
                            <Chip.Label>{t('templates.duration', { days: duration })}</Chip.Label>
                          </Chip>
                        ) : null}
                      </View>
                    </Surface>
                  );
                })}
              </View>
            )}
          </>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

export default function GoalsScreen() {
  const { t } = useTranslation(['goals', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();

  const [showForm, setShowForm] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [goals, setGoals] = useState<ApiGoal[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refresh } = useApi(() => getGoals(null), []);

  useEffect(() => {
    if (data) {
      setGoals((data.data ?? []) as ApiGoal[]);
      setInitialized(true);
      setRefreshing(false);
    }
  }, [data]);

  const sortedGoals = useMemo(() => {
    const rank = { active: 0, completed: 1, abandoned: 2 };
    return [...goals].sort((a, b) => rank[a.status] - rank[b.status]);
  }, [goals]);

  function handleRefresh() {
    setRefreshing(true);
    refresh();
  }

  async function handleUpdateStatus(id: number, status: 'completed' | 'abandoned') {
    try {
      const result = await updateGoalStatus(id, status);
      setGoals((prev) => prev.map((goal) => (goal.id === id ? result.data as ApiGoal : goal)));
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('goals:updateError')), variant: 'danger' });
    }
  }

  function handleGoalCreated(goal: Goal) {
    setGoals((prev) => [goal as ApiGoal, ...prev]);
    setShowForm(false);
    setShowTemplates(false);
  }

  const topAction = {
    accessibilityLabel: showForm ? t('goals:create.close') : t('goals:addGoal'),
    icon: (showForm ? 'close-outline' : 'add-outline') as IoniconName,
    onPress: () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setShowForm((visible) => !visible);
    },
  };

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('goals:title')} backLabel={t('common:back')} fallbackHref="/(tabs)/home" rightAction={topAction} />

        {isLoading && !initialized ? (
          <View className="flex-1 items-center justify-center">
            <LoadingSpinner />
          </View>
        ) : (
          <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <FlatList<ApiGoal>
              data={sortedGoals}
              keyExtractor={(item) => String(item.id)}
              contentContainerClassName="gap-4 px-4 pb-10"
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void handleRefresh()}
                  tintColor={primary}
                  colors={[primary]}
                />
              }
              ListHeaderComponent={
                <View className="gap-4">
                  <GoalsHero goals={goals} primary={primary} theme={theme} t={t} />
                  <HeroCard className="rounded-panel p-0">
                    <HeroCard.Body className="gap-3 p-4">
                      <View className="flex-row flex-wrap gap-2">
                        <HeroButton
                          className="flex-1"
                          variant={showForm ? 'primary' : 'secondary'}
                          onPress={() => {
                            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setShowTemplates(false);
                            setShowForm((visible) => !visible);
                          }}
                        >
                          <Ionicons name="add-outline" size={16} color={showForm ? contrastText(primary) : primary} />
                          <HeroButton.Label>{t('addGoal')}</HeroButton.Label>
                        </HeroButton>
                        <HeroButton
                          className="flex-1"
                          variant={showTemplates ? 'primary' : 'secondary'}
                          onPress={() => {
                            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setShowForm(false);
                            setShowTemplates((visible) => !visible);
                          }}
                        >
                          <Ionicons name="sparkles-outline" size={16} color={showTemplates ? contrastText(primary) : primary} />
                          <HeroButton.Label>{t('templates.open')}</HeroButton.Label>
                        </HeroButton>
                      </View>
                    </HeroCard.Body>
                  </HeroCard>
                  {showTemplates ? (
                    <GoalTemplatesPanel
                      primary={primary}
                      theme={theme}
                      t={t}
                      onCreated={handleGoalCreated}
                    />
                  ) : null}
                </View>
              }
              ListEmptyComponent={
                !isLoading && !showForm ? (
                  <View className="pt-4">
                    {error ? (
                      <Surface variant="secondary" className="items-center gap-3 rounded-panel p-6">
                        <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
                        <Text className="text-center text-sm text-danger">{error}</Text>
                      </Surface>
                    ) : (
                      <EmptyState
                        icon="flag-outline"
                        title={t('goals:noGoals')}
                        subtitle={t('goals:noGoalsHint')}
                        actionLabel={t('goals:addGoal')}
                        onAction={() => setShowForm(true)}
                      />
                    )}
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <GoalCard
                  goal={item}
                  primary={primary}
                  theme={theme}
                  t={t}
                  onComplete={(id) => void handleUpdateStatus(id, 'completed')}
                  onAbandon={(id) => void handleUpdateStatus(id, 'abandoned')}
                />
              )}
            />
          </KeyboardAvoidingView>
        )}

        {/* Goal composer — bottom sheet so the keyboard never buries the form
            (was rendered inline inside the list header). */}
        <BottomSheet visible={showForm} onClose={() => setShowForm(false)} snapPoints={['75%', '92%']}>
          <CreateGoalForm
            theme={theme}
            t={t}
            onCreated={handleGoalCreated}
            onCancel={() => setShowForm(false)}
          />
        </BottomSheet>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
