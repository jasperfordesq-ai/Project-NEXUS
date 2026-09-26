// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import TextArea from '@/components/ui/TextArea';
import NativePressable from '@/components/ui/NativePressable';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Ionicons } from '@/components/ui/Icon';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  cancelGroupChallenge,
  createGroupChallenge,
  getGroupChallenges,
  type GroupChallenge,
  type GroupChallengeMetric,
  type GroupChallengeReward,
} from '@/lib/api/groups';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  completeGroupContentCreationOperation,
  discardGroupContentCreationOperation,
  loadGroupContentCreationOperation,
  reserveGroupContentCreationOperation,
  type GroupContentCreationOperation,
} from '@/lib/groupContentCreationOperation';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';
import { withAlpha } from '@/lib/utils/color';

const METRICS: GroupChallengeMetric[] = ['posts', 'discussions', 'members', 'files'];
const REWARDS: GroupChallengeReward[] = [0, 25, 50, 100];
type PendingChallenge = GroupContentCreationOperation<'challenge'>;

function isChallenge(value: unknown, groupId: number): value is GroupChallenge {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<GroupChallenge>;
  return Number.isSafeInteger(item.id) && Number(item.id) > 0
    && item.group_id === groupId
    && typeof item.title === 'string' && item.title.trim().length > 0
    && typeof item.description === 'string'
    && METRICS.includes(item.metric as GroupChallengeMetric)
    && Number.isSafeInteger(item.target_value) && Number(item.target_value) > 0
    && Number.isFinite(item.current_value) && Number(item.current_value) >= 0 && Number(item.current_value) <= Number(item.target_value)
    && REWARDS.includes(item.reward_xp as GroupChallengeReward)
    && ['active', 'completed', 'expired', 'cancelled'].includes(String(item.status))
    && Number.isFinite(item.progress_percentage) && Number(item.progress_percentage) >= 0 && Number(item.progress_percentage) <= 100
    && typeof item.ends_at === 'string' && Number.isFinite(Date.parse(item.ends_at));
}

export default function GroupChallengesPanel({
  groupId, canManage, canView, refreshToken,
}: { groupId: number; canManage: boolean; canView: boolean; refreshToken: number }) {
  const { t } = useTranslation(['groups', 'common']);
  const tRef = useRef(t); tRef.current = t;
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const [items, setItems] = useState<GroupChallenge[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [metric, setMetric] = useState<GroupChallengeMetric>('posts');
  const [target, setTarget] = useState('');
  const [reward, setReward] = useState<GroupChallengeReward>(0);
  const [endsAt, setEndsAt] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingChallenge | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    const version = ++requestVersion.current;
    setLoading(true); setLoadError(null);
    try {
      const response = await getGroupChallenges(groupId);
      if (!mounted.current || version !== requestVersion.current) return;
      if (!Array.isArray(response.data) || !response.data.every(item => isChallenge(item, groupId))) {
        throw new Error('Invalid challenge response');
      }
      setItems(response.data);
    } catch (error) {
      if (mounted.current && version === requestVersion.current) {
        setLoadError(describeApiError(error, tRef.current('detail.challenges.loadError')));
      }
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, [canView, groupId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (refreshToken > 0) void load(); }, [load, refreshToken]);
  useEffect(() => {
    let active = true;
    void loadGroupContentCreationOperation(groupId, 'challenge').then(operation => {
      if (!active || !operation) return;
      setPending(operation);
      setTitle(operation.payload.title);
      setDescription(operation.payload.description);
      setMetric(operation.payload.metric);
      setTarget(String(operation.payload.targetValue));
      setReward(operation.payload.rewardXp);
      setEndsAt(new Date(operation.payload.endsAt));
      setShowCreate(true);
    }).catch(() => { if (active) setRecoveryError(tRef.current('detail.challenges.recoveryError')); });
    return () => { active = false; };
  }, [groupId]);

  const active = useMemo(() => items.filter(item => item.status === 'active'), [items]);
  const history = useMemo(() => items.filter(item => item.status !== 'active'), [items]);
  const formatDate = (value: string | Date) => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(dateLocale(), { dateStyle: 'medium' }) : t('detail.challenges.unknownDate');
  };

  const resetForm = () => {
    setTitle(''); setDescription(''); setMetric('posts'); setTarget(''); setReward(0);
    setEndsAt(null); setPickerOpen(false); setValidationError(null); setPending(null); setRecoveryError(null);
  };

  const submit = async () => {
    const numericTarget = Number(target);
    const titleLength = title.trim().length;
    const descriptionLength = description.trim().length;
    if (titleLength < 3 || titleLength > 120
      || (descriptionLength > 0 && (descriptionLength < 10 || descriptionLength > 2000))
      || !Number.isSafeInteger(numericTarget) || numericTarget < 1 || numericTarget > 1_000_000
      || !endsAt || endsAt.getTime() <= Date.now()) {
      setValidationError(t('detail.challenges.validationError'));
      return;
    }
    setValidationError(null); setCreating(true);
    try {
      const operation = await reserveGroupContentCreationOperation(groupId, 'challenge', {
        title, description, metric, targetValue: numericTarget, rewardXp: reward, endsAt: endsAt.toISOString(),
      });
      if (mounted.current) setPending(operation);
      await createGroupChallenge(groupId, {
        title: operation.payload.title,
        description: operation.payload.description,
        metric: operation.payload.metric,
        target_value: operation.payload.targetValue,
        reward_xp: operation.payload.rewardXp,
        ends_at: operation.payload.endsAt,
      }, operation.key);
      await completeGroupContentCreationOperation(operation);
      if (!mounted.current) return;
      resetForm(); setShowCreate(false);
      showToast({ title: t('detail.challenges.created'), variant: 'success' });
      await load();
    } catch (error) {
      if (mounted.current) showToast({ title: t('detail.challenges.createError'), description: describeApiError(error, t('detail.challenges.retryHint')), variant: 'danger' });
    } finally {
      if (mounted.current) setCreating(false);
    }
  };

  const discard = async () => {
    if (!pending) return;
    try {
      await discardGroupContentCreationOperation(pending);
      if (mounted.current) resetForm();
    } catch {
      if (mounted.current) setRecoveryError(t('detail.challenges.recoveryError'));
    }
  };

  const cancel = (challenge: GroupChallenge) => confirm({
    title: t('detail.challenges.cancelTitle'),
    message: t('detail.challenges.cancelMessage', { title: challenge.title }),
    confirmLabel: t('detail.challenges.cancelAction'), cancelLabel: t('common:buttons.cancel'), variant: 'danger',
    onConfirm: async () => {
      setCancellingId(challenge.id);
      try {
        await cancelGroupChallenge(groupId, challenge.id);
        showToast({ title: t('detail.challenges.cancelled'), variant: 'success' });
      } catch (error) {
        showToast({ title: t('detail.challenges.cancelError'), description: describeApiError(error, t('detail.challenges.cancelError')), variant: 'danger' });
      } finally {
        if (mounted.current) { setCancellingId(null); await load(); }
      }
    },
  });

  if (!canView) return <EmptyState icon="lock-closed-outline" title={t('detail.challenges.joinTitle')} subtitle={t('detail.challenges.joinSubtitle')} />;
  if (loading && items.length === 0) return <HeroCard className="rounded-panel p-0"><HeroCard.Body className="min-h-[180px] items-center justify-center"><Spinner size="md" /></HeroCard.Body></HeroCard>;
  if (loadError && items.length === 0) return <ErrorState subtitle={loadError} onRetry={load} isRetrying={loading} />;

  const renderChallenge = (challenge: GroupChallenge) => {
    const percent = Math.max(0, Math.min(100, Number(challenge.progress_percentage) || 0));
    return <Surface key={challenge.id} variant="secondary" className="gap-3 rounded-panel-inner p-4" testID={`group-challenge-${challenge.id}`}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text accessibilityRole="header" className="text-base font-semibold" style={{ color: theme.text }}>{challenge.title}</Text>
          {challenge.description ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{challenge.description}</Text> : null}
        </View>
        <View className="rounded-full px-2 py-1" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
          <Text className="text-xs font-semibold" style={{ color: primary }}>{t(`detail.challenges.status.${challenge.status}`)}</Text>
        </View>
      </View>
      <Text className="text-sm" style={{ color: theme.text }}>{t('detail.challenges.progress', { current: challenge.current_value, target: challenge.target_value, metric: t(`detail.challenges.metric.${challenge.metric}`) })}</Text>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }} className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: withAlpha(primary, 0.16) }}>
        <View className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: primary }} />
      </View>
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('detail.challenges.ends', { date: formatDate(challenge.ends_at) })}</Text>
        <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('detail.challenges.reward', { xp: challenge.reward_xp })}</Text>
      </View>
      {canManage && challenge.status === 'active' ? <HeroButton size="sm" variant="ghost" isDisabled={cancellingId !== null} onPress={() => cancel(challenge)}>
        <Ionicons name="close-circle-outline" size={16} color={theme.error} /><HeroButton.Label style={{ color: theme.error }}>{t('detail.challenges.cancelAction')}</HeroButton.Label>
      </HeroButton> : null}
    </Surface>;
  };

  return <View className="gap-4" testID="group-challenges-panel">
    <HeroCard className="rounded-panel p-0"><HeroCard.Body className="gap-4 p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1"><Text accessibilityRole="header" className="text-lg font-semibold" style={{ color: theme.text }}>{t('detail.challenges.title')}</Text><Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.challenges.subtitle')}</Text></View>
        {canManage ? <HeroButton size="sm" variant="secondary" onPress={() => setShowCreate(value => !value)}><HeroButton.Label>{showCreate ? t('common:buttons.cancel') : t('detail.challenges.create')}</HeroButton.Label></HeroButton> : null}
      </View>
      {showCreate ? <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
        <Input label={t('detail.challenges.titleLabel')} value={title} maxLength={120} editable={!creating} onChangeText={setTitle} />
        <TextArea label={t('detail.challenges.descriptionLabel')} value={description} maxLength={2000} editable={!creating} onChangeText={setDescription} />
        <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('detail.challenges.metricLabel')}</Text>
        <View className="gap-2">{METRICS.map(value => <NativePressable key={value} accessibilityRole="radio" accessibilityState={{ checked: metric === value, disabled: creating }} disabled={creating} onPress={() => setMetric(value)}><View className="rounded-xl border border-border p-3"><Text style={{ color: theme.text }}>{metric === value ? '◉ ' : '○ '}{t(`detail.challenges.metric.${value}`)}</Text></View></NativePressable>)}</View>
        <Input label={t('detail.challenges.targetLabel')} value={target} keyboardType="number-pad" editable={!creating} onChangeText={setTarget} />
        <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('detail.challenges.rewardLabel')}</Text>
        <View className="flex-row flex-wrap gap-2">{REWARDS.map(value => <NativePressable key={value} accessibilityRole="radio" accessibilityState={{ checked: reward === value, disabled: creating }} disabled={creating} onPress={() => setReward(value)}><View className="rounded-xl border border-border px-4 py-3"><Text style={{ color: theme.text }}>{reward === value ? '◉ ' : '○ '}{t('detail.challenges.reward', { xp: value })}</Text></View></NativePressable>)}</View>
        <HeroButton variant="secondary" isDisabled={creating} onPress={() => setPickerOpen(true)}><HeroButton.Label>{endsAt ? t('detail.challenges.ends', { date: formatDate(endsAt) }) : t('detail.challenges.endDateLabel')}</HeroButton.Label></HeroButton>
        {pickerOpen ? <><DateTimePicker value={endsAt ?? new Date(Date.now() + 86400000)} mode="date" minimumDate={new Date(Date.now() + 86400000)} onChange={(event, value) => { if (Platform.OS !== 'ios') setPickerOpen(false); if (event.type === 'set' && value) setEndsAt(value); }} />{Platform.OS === 'ios' ? <HeroButton variant="ghost" onPress={() => { if (!endsAt) setEndsAt(new Date(Date.now() + 86400000)); setPickerOpen(false); }}><HeroButton.Label>{t('common:buttons.done')}</HeroButton.Label></HeroButton> : null}</> : null}
        {validationError ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{validationError}</Text> : null}
        {(pending || recoveryError) ? <Surface variant="secondary" className="gap-2 rounded-panel-inner p-3" testID="group-challenge-recovery"><Text className="font-semibold" style={{ color: theme.text }}>{t('detail.challenges.recoveryTitle')}</Text><Text style={{ color: theme.textSecondary }}>{recoveryError ?? t('detail.challenges.recoveryNotice')}</Text>{pending ? <HeroButton variant="ghost" onPress={() => void discard()}><HeroButton.Label>{t('detail.challenges.discard')}</HeroButton.Label></HeroButton> : null}</Surface> : null}
        <HeroButton testID="group-challenge-create" isDisabled={creating || Boolean(recoveryError)} onPress={() => void submit()}>{creating ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.challenges.create')}</HeroButton.Label>}</HeroButton>
      </Surface> : null}
      {loadError ? <ErrorState subtitle={loadError} onRetry={load} isRetrying={loading} /> : null}
      {items.length === 0 ? <EmptyState icon="trophy-outline" title={t('detail.challenges.emptyTitle')} subtitle={canManage ? t('detail.challenges.emptyManager') : t('detail.challenges.emptyMember')} /> : null}
      {active.map(renderChallenge)}
      {history.length > 0 ? <><HeroButton variant="ghost" onPress={() => setShowHistory(value => !value)}><HeroButton.Label>{showHistory ? t('detail.challenges.hideHistory') : t('detail.challenges.showHistory', { count: history.length })}</HeroButton.Label></HeroButton>{showHistory ? history.map(renderChallenge) : null}</> : null}
    </HeroCard.Body></HeroCard>
    {confirmDialog}
  </View>;
}
