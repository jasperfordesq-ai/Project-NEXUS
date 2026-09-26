// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  cancelGroupScheduledPost,
  createGroupScheduledPost,
  getGroupScheduledPosts,
  getGroupWelcomeConfig,
  updateGroupWelcomeConfig,
  type GroupScheduledPost,
  type GroupScheduledPostRecurrence,
  type GroupScheduledPostType,
} from '@/lib/api/groups';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  completeGroupContentCreationOperation,
  discardGroupContentCreationOperation,
  loadGroupContentCreationOperation,
  reserveGroupContentCreationOperation,
  type GroupContentCreationOperation,
} from '@/lib/groupContentCreationOperation';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';

const RECURRENCES: GroupScheduledPostRecurrence[] = ['daily', 'weekly', 'monthly'];
type PendingScheduledPost = GroupContentCreationOperation<'scheduled-post'>;

function validPost(value: unknown, groupId: number): value is GroupScheduledPost {
  if (!value || typeof value !== 'object') return false;
  const post = value as Partial<GroupScheduledPost>;
  return Number.isSafeInteger(post.id) && Number(post.id) > 0
    && post.group_id === groupId
    && (post.post_type === 'discussion' || post.post_type === 'announcement')
    && typeof post.title === 'string' && post.title.trim().length > 0
    && typeof post.content === 'string'
    && typeof post.scheduled_at === 'string' && Number.isFinite(Date.parse(post.scheduled_at))
    && (typeof post.is_recurring === 'boolean' || post.is_recurring === 0 || post.is_recurring === 1)
    && (post.status === 'scheduled' || post.status === 'processing')
    && typeof post.author_name === 'string'
    && (post.recurrence_pattern === null
      || (typeof post.recurrence_pattern === 'string' && RECURRENCES.includes(post.recurrence_pattern)));
}

export default function GroupAutomationPanel({
  groupId,
  discussionEnabled,
  announcementsEnabled,
}: {
  groupId: number;
  discussionEnabled: boolean;
  announcementsEnabled: boolean;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const tRef = useRef(t); tRef.current = t;
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const allowedTypes: GroupScheduledPostType[] = [
    ...(discussionEnabled ? ['discussion' as const] : []),
    ...(announcementsEnabled ? ['announcement' as const] : []),
  ];
  const [posts, setPosts] = useState<GroupScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [postType, setPostType] = useState<GroupScheduledPostType>(allowedTypes[0] ?? 'discussion');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<GroupScheduledPostRecurrence>('weekly');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingScheduledPost | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [welcomeLoading, setWelcomeLoading] = useState(true);
  const [welcomeSaving, setWelcomeSaving] = useState(false);

  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (!allowedTypes.includes(postType) && allowedTypes[0]) setPostType(allowedTypes[0]);
  }, [announcementsEnabled, discussionEnabled, postType]);

  const loadPosts = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setLoadError(null);
    try {
      const response = await getGroupScheduledPosts(groupId);
      if (!mounted.current || version !== requestVersion.current) return null;
      if (!Array.isArray(response.data) || !response.data.every(item => validPost(item, groupId))) {
        throw new Error('Invalid scheduled post response');
      }
      setPosts(response.data);
      return response.data;
    } catch (error) {
      if (mounted.current && version === requestVersion.current) {
        setLoadError(describeApiError(error, tRef.current('detail.automation.loadError')));
      }
      return null;
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, [groupId]);

  const loadWelcome = useCallback(async () => {
    setWelcomeLoading(true);
    try {
      const response = await getGroupWelcomeConfig(groupId);
      if (typeof response.data?.enabled !== 'boolean' || typeof response.data?.message !== 'string') {
        throw new Error('Invalid welcome response');
      }
      if (mounted.current) {
        setWelcomeEnabled(response.data.enabled);
        setWelcomeMessage(response.data.message);
      }
      return response.data;
    } catch (error) {
      if (mounted.current) showToast({ title: tRef.current('detail.automation.welcomeLoadError'), description: describeApiError(error, tRef.current('detail.automation.welcomeLoadError')), variant: 'danger' });
      return null;
    } finally {
      if (mounted.current) setWelcomeLoading(false);
    }
  }, [groupId, showToast]);

  useEffect(() => { void loadPosts(); void loadWelcome(); }, [loadPosts, loadWelcome]);
  useEffect(() => {
    let active = true;
    void loadGroupContentCreationOperation(groupId, 'scheduled-post').then(operation => {
      if (!active || !operation) return;
      setPending(operation); setPostType(operation.payload.postType); setTitle(operation.payload.title);
      setContent(operation.payload.content); setScheduledAt(new Date(operation.payload.scheduledAt));
      setRecurring(operation.payload.isRecurring);
      setRecurrence(operation.payload.recurrencePattern ?? 'weekly'); setShowCreate(true);
    }).catch(() => { if (active) setRecoveryError(tRef.current('detail.automation.recoveryError')); });
    return () => { active = false; };
  }, [groupId]);

  const resetForm = () => {
    setPostType(allowedTypes[0] ?? 'discussion'); setTitle(''); setContent(''); setScheduledAt(null);
    setPicker(null); setRecurring(false); setRecurrence('weekly'); setValidationError(null);
    setPending(null); setRecoveryError(null);
  };

  const submit = async () => {
    if (!allowedTypes.includes(postType) || title.trim().length < 1 || title.trim().length > 255
      || content.trim().length < 1 || content.length > 60000
      || !scheduledAt || scheduledAt.getTime() <= Date.now()) {
      setValidationError(t('detail.automation.validationError'));
      return;
    }
    setValidationError(null); setCreating(true);
    try {
      const operation = await reserveGroupContentCreationOperation(groupId, 'scheduled-post', {
        postType, title, content, scheduledAt: scheduledAt.toISOString(), isRecurring: recurring,
        recurrencePattern: recurring ? recurrence : null,
      });
      if (mounted.current) setPending(operation);
      await createGroupScheduledPost(groupId, {
        post_type: operation.payload.postType,
        title: operation.payload.title,
        content: operation.payload.content,
        scheduled_at: operation.payload.scheduledAt,
        is_recurring: operation.payload.isRecurring,
        recurrence_pattern: operation.payload.recurrencePattern,
      }, operation.key);
      await completeGroupContentCreationOperation(operation);
      if (!mounted.current) return;
      resetForm(); setShowCreate(false);
      showToast({ title: t('detail.automation.created'), variant: 'success' });
      await loadPosts();
    } catch (error) {
      if (mounted.current) showToast({ title: t('detail.automation.createError'), description: describeApiError(error, t('detail.automation.retryHint')), variant: 'danger' });
    } finally {
      if (mounted.current) setCreating(false);
    }
  };

  const discard = async () => {
    if (!pending) return;
    try { await discardGroupContentCreationOperation(pending); if (mounted.current) resetForm(); }
    catch { if (mounted.current) setRecoveryError(t('detail.automation.recoveryError')); }
  };

  const cancel = (post: GroupScheduledPost) => confirm({
    title: t('detail.automation.cancelTitle'),
    message: t('detail.automation.cancelMessage', { title: post.title }),
    confirmLabel: t('detail.automation.cancelAction'), cancelLabel: t('common:buttons.cancel'), variant: 'danger',
    onConfirm: async () => {
      setCancellingId(post.id);
      let success = false;
      try { await cancelGroupScheduledPost(groupId, post.id); success = true; }
      catch {
        const latest = await loadPosts();
        success = latest !== null && !latest.some(item => item.id === post.id);
      }
      if (mounted.current) {
        showToast({ title: success ? t('detail.automation.cancelled') : t('detail.automation.cancelError'), variant: success ? 'success' : 'danger' });
        setCancellingId(null);
        await loadPosts();
      }
    },
  });

  const saveWelcome = async () => {
    const intended = { enabled: welcomeEnabled, message: welcomeMessage };
    setWelcomeSaving(true);
    let saved = false;
    try {
      const response = await updateGroupWelcomeConfig(groupId, intended);
      saved = response.data.enabled === intended.enabled && response.data.message === intended.message;
    } catch {
      const readback = await loadWelcome();
      saved = readback?.enabled === intended.enabled && readback.message === intended.message;
    }
    if (mounted.current) {
      showToast({ title: saved ? t('detail.automation.welcomeSaved') : t('detail.automation.welcomeSaveError'), variant: saved ? 'success' : 'danger' });
      setWelcomeSaving(false);
    }
  };

  const formatDateTime = (value: string | Date) => {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return <View className="gap-4" testID="group-automation-panel">
    <HeroCard className="rounded-panel p-0"><HeroCard.Body className="gap-4 p-4">
      <View className="flex-row items-center justify-between gap-3"><View className="min-w-0 flex-1"><Text accessibilityRole="header" className="text-lg font-semibold" style={{ color: theme.text }}>{t('detail.automation.title')}</Text><Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.automation.subtitle')}</Text></View>{allowedTypes.length > 0 ? <HeroButton size="sm" variant="secondary" onPress={() => setShowCreate(value => !value)}><HeroButton.Label>{showCreate ? t('common:buttons.cancel') : t('detail.automation.create')}</HeroButton.Label></HeroButton> : null}</View>
      {allowedTypes.length === 0 ? <EmptyState icon="calendar-outline" title={t('detail.automation.noTypesTitle')} subtitle={t('detail.automation.noTypesSubtitle')} /> : null}
      {showCreate && allowedTypes.length > 0 ? <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
        <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('detail.automation.typeLabel')}</Text>
        {allowedTypes.map(value => <NativePressable key={value} accessibilityRole="radio" accessibilityState={{ checked: postType === value, disabled: creating }} disabled={creating} onPress={() => setPostType(value)}><View className="rounded-xl border border-border p-3"><Text style={{ color: theme.text }}>{postType === value ? '◉ ' : '○ '}{t(`detail.automation.type.${value}`)}</Text></View></NativePressable>)}
        <Input label={t('detail.automation.titleLabel')} value={title} maxLength={255} editable={!creating} onChangeText={setTitle} />
        <TextArea label={t('detail.automation.contentLabel')} value={content} maxLength={60000} editable={!creating} onChangeText={setContent} />
        <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('detail.automation.timezone', { timezone })}</Text>
        <View className="flex-row gap-2"><HeroButton className="flex-1" variant="secondary" onPress={() => setPicker('date')}><HeroButton.Label>{scheduledAt ? formatDateTime(scheduledAt) : t('detail.automation.dateAction')}</HeroButton.Label></HeroButton><HeroButton variant="secondary" onPress={() => setPicker('time')}><HeroButton.Label>{t('detail.automation.timeAction')}</HeroButton.Label></HeroButton></View>
        {picker ? <><DateTimePicker value={scheduledAt ?? new Date(Date.now() + 3600000)} mode={picker} minimumDate={picker === 'date' ? new Date() : undefined} onChange={(event, value) => { if (Platform.OS !== 'ios') setPicker(null); if (event.type === 'set' && value) setScheduledAt(value); }} />{Platform.OS === 'ios' ? <HeroButton variant="ghost" onPress={() => setPicker(null)}><HeroButton.Label>{t('common:buttons.done')}</HeroButton.Label></HeroButton> : null}</> : null}
        <NativePressable accessibilityRole="checkbox" accessibilityState={{ checked: recurring, disabled: creating }} disabled={creating} onPress={() => setRecurring(value => !value)}><View className="rounded-xl border border-border p-3"><Text style={{ color: theme.text }}>{recurring ? '☑ ' : '☐ '}{t('detail.automation.recurring')}</Text></View></NativePressable>
        {recurring ? <View className="gap-2">{RECURRENCES.map(value => <NativePressable key={value} accessibilityRole="radio" accessibilityState={{ checked: recurrence === value, disabled: creating }} disabled={creating} onPress={() => setRecurrence(value)}><View className="rounded-xl border border-border p-3"><Text style={{ color: theme.text }}>{recurrence === value ? '◉ ' : '○ '}{t(`detail.automation.recurrence.${value}`)}</Text></View></NativePressable>)}</View> : null}
        {validationError ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{validationError}</Text> : null}
        {(pending || recoveryError) ? <Surface variant="secondary" className="gap-2 rounded-panel-inner p-3" testID="group-automation-recovery"><Text className="font-semibold" style={{ color: theme.text }}>{t('detail.automation.recoveryTitle')}</Text><Text style={{ color: theme.textSecondary }}>{recoveryError ?? t('detail.automation.recoveryNotice')}</Text>{pending ? <HeroButton variant="ghost" onPress={() => void discard()}><HeroButton.Label>{t('detail.automation.discard')}</HeroButton.Label></HeroButton> : null}</Surface> : null}
        <HeroButton testID="group-automation-create" isDisabled={creating || Boolean(recoveryError)} onPress={() => void submit()}>{creating ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.automation.create')}</HeroButton.Label>}</HeroButton>
      </Surface> : null}
      {loading && posts.length === 0 ? <View className="min-h-[120px] items-center justify-center"><Spinner size="md" /></View> : null}
      {loadError ? <ErrorState subtitle={loadError} onRetry={loadPosts} isRetrying={loading} /> : null}
      {!loading && !loadError && posts.length === 0 ? <EmptyState icon="calendar-outline" title={t('detail.automation.emptyTitle')} subtitle={t('detail.automation.emptySubtitle')} /> : null}
      {posts.map(post => <Surface key={post.id} variant="secondary" className="gap-2 rounded-panel-inner p-4" testID={`group-scheduled-post-${post.id}`}><Text className="font-semibold" style={{ color: theme.text }}>{post.title}</Text><Text className="text-sm" style={{ color: theme.textSecondary }}>{t(`detail.automation.type.${post.post_type}`)} · {formatDateTime(post.scheduled_at)}</Text>{post.is_recurring && post.recurrence_pattern ? <Text className="text-xs" style={{ color: theme.textSecondary }}>{t(`detail.automation.recurrence.${post.recurrence_pattern}`)}</Text> : null}<HeroButton size="sm" variant="ghost" isDisabled={cancellingId !== null} onPress={() => cancel(post)}><HeroButton.Label style={{ color: theme.error }}>{t('detail.automation.cancelAction')}</HeroButton.Label></HeroButton></Surface>)}
    </HeroCard.Body></HeroCard>
    <HeroCard className="rounded-panel p-0"><HeroCard.Body className="gap-4 p-4"><Text accessibilityRole="header" className="text-lg font-semibold" style={{ color: theme.text }}>{t('detail.automation.welcomeTitle')}</Text>{welcomeLoading ? <Spinner size="md" /> : <><NativePressable accessibilityRole="switch" accessibilityState={{ checked: welcomeEnabled, disabled: welcomeSaving }} disabled={welcomeSaving} onPress={() => setWelcomeEnabled(value => !value)}><View className="rounded-xl border border-border p-3"><Text style={{ color: theme.text }}>{welcomeEnabled ? '☑ ' : '☐ '}{t('detail.automation.welcomeEnabled')}</Text></View></NativePressable><TextArea label={t('detail.automation.welcomeMessageLabel')} value={welcomeMessage} editable={!welcomeSaving && welcomeEnabled} onChangeText={setWelcomeMessage} /><Text className="text-xs" style={{ color: theme.textSecondary }}>{t('detail.automation.welcomeHint')}</Text><HeroButton testID="group-welcome-save" isDisabled={welcomeSaving} onPress={() => void saveWelcome()}>{welcomeSaving ? <Spinner size="sm" /> : <HeroButton.Label>{t('common:buttons.save')}</HeroButton.Label>}</HeroButton></>}</HeroCard.Body></HeroCard>
    {confirmDialog}
  </View>;
}
