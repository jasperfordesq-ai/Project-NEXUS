// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, type Href } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  getEvents,
  type Event,
} from '@/lib/api/events';
import {
  acceptGroupAnswer,
  answerGroupQuestion,
  createGroupAnnouncement,
  createGroupDiscussion,
  createGroupQuestion,
  createGroupTask,
  createGroupWikiPage,
  deleteGroupFile,
  deleteGroupMedia,
  deleteGroupTask,
  deleteGroupAnnouncement,
  deleteGroupWikiPage,
  getGroup,
  getGroupAnalytics,
  getGroupAnalyticsComparative,
  getGroupAnalyticsRetention,
  getGroupAnnouncements,
  getGroupDiscussions,
  getGroupFiles,
  getGroupMembers,
  getGroupMedia,
  getGroupQuestion,
  getGroupQuestions,
  getGroupTasks,
  getGroupTaskStats,
  getGroupWikiPage,
  getGroupWikiPages,
  getGroupWikiRevisions,
  joinGroup,
  leaveGroup,
  updateGroupAnnouncement,
  updateGroupTask,
  updateGroupWikiPage,
  uploadGroupMedia,
  voteGroupQA,
  type GroupAnnouncement,
  type GroupAnalyticsComparative,
  type GroupAnalyticsDashboard,
  type GroupAnalyticsRetentionCohort,
  type GroupDetail,
  type GroupDiscussion,
  type GroupFileItem,
  type GroupFilesResponse,
  type GroupMemberListItem,
  type GroupMediaItem,
  type GroupMediaType,
  type GroupQuestion,
  type GroupQuestionDetail,
  type GroupQuestionsResponse,
  type GroupTask,
  type GroupTaskPriority,
  type GroupTaskStats,
  type GroupTaskStatus,
  type GroupWikiPage,
  type GroupWikiPageDetail,
  type GroupWikiRevision,
} from '@/lib/api/groups';
import {
  getGroupMarketplaceListings,
  getGroupMarketplaceStats,
  marketplaceHasMore,
  marketplaceNextCursor,
  saveMarketplaceListing,
  unsaveMarketplaceListing,
  type MarketplaceCategory,
  type MarketplaceListingItem,
} from '@/lib/api/marketplace';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { API_BASE_URL, API_V2 } from '@/lib/constants';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import Input from '@/components/ui/Input';
import TextArea from '@/components/ui/TextArea';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import MarketplaceListingCard from '@/components/marketplace/MarketplaceListingCard';
import { dateLocale } from '@/lib/utils/dateLocale';

const WEB_URL = 'https://app.project-nexus.ie';
const CARD_MIN_HEIGHT = 118;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type TabKey = 'overview' | 'discussion' | 'members' | 'events' | 'announcements' | 'files' | 'media' | 'qa' | 'wiki' | 'tasks' | 'analytics' | 'marketplace';
type ApiGroupDetail = GroupDetail & {
  viewer_membership?: { status?: string; role?: string; is_admin?: boolean } | null;
  avatar_url?: string | null;
  image_url?: string | null;
  type?: string | null;
  location?: string | null;
};

function isGroupMember(group: ApiGroupDetail) {
  return group.is_member === true || group.viewer_membership?.status === 'active';
}

function groupImage(group: ApiGroupDetail) {
  return resolveImageUrl(group.cover_image ?? group.image_url ?? group.avatar_url ?? null);
}

function stripHtml(value?: string | null) {
  return (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatDateParts(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: new Intl.DateTimeFormat(dateLocale(), { day: 'numeric' }).format(date),
    month: new Intl.DateTimeFormat(dateLocale(), { month: 'short' }).format(date),
  };
}

function formatFileSize(bytes?: number | null) {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / Math.pow(1024, index);
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatMetric(value?: number | null, options?: Intl.NumberFormatOptions) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat(dateLocale(), options).format(Number.isFinite(amount) ? amount : 0);
}

function StatusChip({ icon, label, color }: { icon: IoniconName; label: string; color: string }) {
  return (
    <Chip size="sm" variant="secondary" color="default">
      <Ionicons name={icon} size={12} color={color} />
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
        {title}
      </Text>
      {action}
    </View>
  );
}

function StatTile({
  label,
  value,
  tone,
  theme,
}: {
  label: string;
  value: string;
  tone: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 gap-1 rounded-panel-inner p-4">
      <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
        {label}
      </Text>
      <View className="flex-row items-end justify-between gap-2">
        <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={1}>
          {value}
        </Text>
        <View className="h-1.5 w-10 rounded-full" style={{ backgroundColor: tone }} />
      </View>
    </Surface>
  );
}

function EmptyCard({ icon, message }: { icon: IoniconName; message: string }) {
  const primary = usePrimaryColor();
  const theme = useTheme();
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="min-h-[118px] items-center justify-center gap-3 p-5">
        <View className="size-11 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
          <Ionicons name={icon} size={20} color={primary} />
        </View>
        <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
          {message}
        </Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function StateMessage({
  title,
  action,
  primary,
  onAction,
}: {
  title: string;
  action: string;
  primary: string;
  onAction?: () => void;
}) {
  const theme = useTheme();

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={action} fallbackHref="/(tabs)/groups" />
      <View className="flex-1 items-center justify-center px-6" style={{ flex: 1, backgroundColor: theme.bg }}>
        <Surface variant="secondary" className="items-center gap-4 rounded-panel p-8">
          <View className="size-12 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
            <Ionicons name="people-outline" size={24} color={primary} />
          </View>
          <Text className="text-center text-sm text-muted-foreground">{title}</Text>
          <HeroButton variant="secondary" onPress={onAction ?? (() => router.back())}>
            <HeroButton.Label>{action}</HeroButton.Label>
          </HeroButton>
        </Surface>
      </View>
    </SafeAreaView>
  );
}

export default function GroupDetailScreen() {
  return (
    <ModalErrorBoundary>
      <GroupDetailScreenInner />
    </ModalErrorBoundary>
  );
}

function GroupDetailScreenInner() {
  const { t } = useTranslation(['groups', 'common', 'marketplace']);
  const { user } = useAuth();
  const { hasFeature } = useTenant();
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const groupId = Number(id);
  const safeGroupId = Number.isFinite(groupId) && groupId > 0 ? groupId : 0;

  const { data, isLoading, error, refresh } = useApi(
    () => getGroup(safeGroupId),
    [safeGroupId],
    { enabled: safeGroupId > 0 },
  );

  const group = (data?.data ?? null) as ApiGroupDetail | null;
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showDiscussionComposer, setShowDiscussionComposer] = useState(false);
  const [discussionTitle, setDiscussionTitle] = useState('');
  const [discussionContent, setDiscussionContent] = useState('');
  const [creatingDiscussion, setCreatingDiscussion] = useState(false);
  const [showAnnouncementComposer, setShowAnnouncementComposer] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementContent, setAnnouncementContent] = useState('');
  const [announcementPinned, setAnnouncementPinned] = useState(false);
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false);
  const [updatingAnnouncementId, setUpdatingAnnouncementId] = useState<number | null>(null);
  const [showQuestionComposer, setShowQuestionComposer] = useState(false);
  const [questionTitle, setQuestionTitle] = useState('');
  const [questionBody, setQuestionBody] = useState('');
  const [creatingQuestion, setCreatingQuestion] = useState(false);

  useEffect(() => {
    if (group) {
      setIsMember(isGroupMember(group));
      setMemberCount(group.member_count ?? 0);
    }
  }, [group]);

  const currentIsMember = group ? (isMember ?? isGroupMember(group)) : false;
  const membersApi = useApi(() => getGroupMembers(safeGroupId), [safeGroupId, currentIsMember], {
    enabled: safeGroupId > 0 && currentIsMember,
  });
  const discussionsApi = useApi(() => getGroupDiscussions(safeGroupId), [safeGroupId, currentIsMember], {
    enabled: safeGroupId > 0 && currentIsMember,
  });
  const announcementsApi = useApi(() => getGroupAnnouncements(safeGroupId), [safeGroupId, currentIsMember], {
    enabled: safeGroupId > 0 && currentIsMember,
  });
  const filesApi = useApi<GroupFilesResponse>(() => getGroupFiles(safeGroupId), [safeGroupId, currentIsMember], {
    enabled: safeGroupId > 0 && currentIsMember,
  });
  const questionsApi = useApi<GroupQuestionsResponse>(() => getGroupQuestions(safeGroupId), [safeGroupId, currentIsMember], {
    enabled: safeGroupId > 0 && currentIsMember,
  });
  const eventsApi = useApi(() => getEvents('upcoming', null, 20, { groupId: safeGroupId }), [safeGroupId], {
    enabled: safeGroupId > 0,
  });

  const members = useMemo<GroupMemberListItem[]>(() => membersApi.data?.data ?? [], [membersApi.data]);
  const discussions = useMemo<GroupDiscussion[]>(() => discussionsApi.data?.data ?? [], [discussionsApi.data]);
  const announcements = useMemo<GroupAnnouncement[]>(() => announcementsApi.data?.data?.items ?? [], [announcementsApi.data]);
  const files = useMemo<GroupFileItem[]>(() => filesApi.data?.data.items ?? [], [filesApi.data]);
  const questions = useMemo<GroupQuestion[]>(() => questionsApi.data?.data.items ?? [], [questionsApi.data]);
  const events = useMemo<Event[]>(() => eventsApi.data?.data ?? [], [eventsApi.data]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refresh();
    membersApi.refresh();
    discussionsApi.refresh();
    announcementsApi.refresh();
    filesApi.refresh();
    questionsApi.refresh();
    eventsApi.refresh();
  }, [announcementsApi, discussionsApi, eventsApi, filesApi, membersApi, questionsApi, refresh]);

  useEffect(() => {
    if (!isLoading && !membersApi.isLoading && !discussionsApi.isLoading && !announcementsApi.isLoading && !filesApi.isLoading && !questionsApi.isLoading && !eventsApi.isLoading) {
      setRefreshing(false);
    }
  }, [announcementsApi.isLoading, discussionsApi.isLoading, eventsApi.isLoading, filesApi.isLoading, isLoading, membersApi.isLoading, questionsApi.isLoading]);

  async function handleShare() {
    if (!group) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `${group.name} - ${WEB_URL}/groups/${group.id}`,
      });
    } catch {
      // Native share can be cancelled; no user-facing error needed.
    }
  }

  if (!safeGroupId) {
    return <StateMessage title={t('detail.invalidId')} action={t('detail.goBack')} primary={primary} />;
  }

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref="/(tabs)/groups" />
        <View className="flex-1 items-center justify-center" style={{ flex: 1, backgroundColor: theme.bg }}>
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <StateMessage
        title={error}
        action={t('common:buttons.retry')}
        primary={primary}
        onAction={refresh}
      />
    );
  }

  if (!group) {
    return <StateMessage title={t('detail.notFound')} action={t('detail.goBack')} primary={primary} />;
  }

  const loadedGroup = group;
  const currentMemberCount = memberCount ?? loadedGroup.member_count ?? 0;
  const isUpdating = joining || leaving;
  const displayDescription = loadedGroup.long_description ?? loadedGroup.description;
  const image = groupImage(loadedGroup);
  const userCanSeeMemberContent = currentIsMember;
  const canManageGroup = loadedGroup.viewer_membership?.is_admin === true;

  function openEditGroup() {
    router.push({ pathname: '/(modals)/edit-group', params: { id: String(loadedGroup.id) } } as unknown as Href);
  }

  async function handleJoin() {
    const prevIsMember = isMember ?? isGroupMember(loadedGroup);
    const prevMemberCount = memberCount ?? loadedGroup.member_count ?? 0;
    setJoining(true);
    setIsMember(true);
    setMemberCount(prevMemberCount + 1);
    try {
      await joinGroup(loadedGroup.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refresh();
      membersApi.refresh();
      discussionsApi.refresh();
      announcementsApi.refresh();
      filesApi.refresh();
      questionsApi.refresh();
      eventsApi.refresh();
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setIsMember(prevIsMember);
      setMemberCount(prevMemberCount);
      showToast({ title: t('common:errors.alertTitle'), description: t('joinError'), variant: 'danger' });
    } finally {
      setJoining(false);
    }
  }

  function handleLeave() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    confirm({
      title: t('leaveConfirmTitle'),
      message: t('leaveConfirmMessage'),
      confirmLabel: t('leave'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        const prevIsMember = isMember ?? isGroupMember(loadedGroup);
        const prevMemberCount = memberCount ?? loadedGroup.member_count ?? 0;
        setLeaving(true);
        setIsMember(false);
        setMemberCount(Math.max(0, prevMemberCount - 1));
        try {
          await leaveGroup(loadedGroup.id);
          refresh();
        } catch {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setIsMember(prevIsMember);
          setMemberCount(prevMemberCount);
          showToast({ title: t('common:errors.alertTitle'), description: t('leaveError'), variant: 'danger' });
        } finally {
          setLeaving(false);
        }
      },
    });
  }

  async function handleCreateDiscussion() {
    const title = discussionTitle.trim();
    const content = discussionContent.trim();
    if (!title || !content) {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.discussionRequired'), variant: 'warning' });
      return;
    }

    setCreatingDiscussion(true);
    try {
      await createGroupDiscussion(loadedGroup.id, { title, content });
      setDiscussionTitle('');
      setDiscussionContent('');
      setShowDiscussionComposer(false);
      discussionsApi.refresh();
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.discussionCreateError'), variant: 'danger' });
    } finally {
      setCreatingDiscussion(false);
    }
  }

  async function handleCreateAnnouncement() {
    const title = announcementTitle.trim();
    const content = announcementContent.trim();
    if (!title || !content) {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.announcementRequired'), variant: 'warning' });
      return;
    }

    setCreatingAnnouncement(true);
    try {
      await createGroupAnnouncement(loadedGroup.id, {
        title,
        content,
        is_pinned: announcementPinned,
      });
      setAnnouncementTitle('');
      setAnnouncementContent('');
      setAnnouncementPinned(false);
      setShowAnnouncementComposer(false);
      announcementsApi.refresh();
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.announcementCreateError'), variant: 'danger' });
    } finally {
      setCreatingAnnouncement(false);
    }
  }

  async function handleToggleAnnouncementPin(announcement: GroupAnnouncement) {
    setUpdatingAnnouncementId(announcement.id);
    try {
      await updateGroupAnnouncement(loadedGroup.id, announcement.id, { is_pinned: !announcement.is_pinned });
      announcementsApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.announcementUpdateError'), variant: 'danger' });
    } finally {
      setUpdatingAnnouncementId(null);
    }
  }

  function handleDeleteAnnouncement(announcement: GroupAnnouncement) {
    confirm({
      title: t('detail.deleteAnnouncementTitle'),
      message: t('detail.deleteAnnouncementMessage'),
      confirmLabel: t('detail.deleteAnnouncement'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setUpdatingAnnouncementId(announcement.id);
        try {
          await deleteGroupAnnouncement(loadedGroup.id, announcement.id);
          announcementsApi.refresh();
          refresh();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('common:errors.alertTitle'), description: t('detail.announcementDeleteError'), variant: 'danger' });
        } finally {
          setUpdatingAnnouncementId(null);
        }
      },
    });
  }

  async function handleCreateQuestion() {
    const title = questionTitle.trim();
    const body = questionBody.trim();
    if (!title || !body) {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.qa.validation'), variant: 'warning' });
      return;
    }

    setCreatingQuestion(true);
    try {
      await createGroupQuestion(loadedGroup.id, { title, body });
      setQuestionTitle('');
      setQuestionBody('');
      setShowQuestionComposer(false);
      questionsApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.qa.createError'), variant: 'danger' });
    } finally {
      setCreatingQuestion(false);
    }
  }

  const tabs: { key: TabKey; label: string; icon: IoniconName }[] = [
    { key: 'overview', label: t('detail.tabs.overview'), icon: 'newspaper-outline' },
    { key: 'discussion', label: t('detail.tabs.discussion'), icon: 'chatbubble-ellipses-outline' },
    { key: 'members', label: t('detail.tabs.members'), icon: 'people-outline' },
    { key: 'events', label: t('detail.tabs.events'), icon: 'calendar-outline' },
    { key: 'announcements', label: t('detail.tabs.announcements'), icon: 'megaphone-outline' },
    { key: 'files', label: t('detail.tabs.files'), icon: 'folder-open-outline' },
    { key: 'media', label: t('detail.tabs.media'), icon: 'images-outline' },
    { key: 'qa', label: t('detail.tabs.qa'), icon: 'help-circle-outline' },
    { key: 'wiki', label: t('detail.tabs.wiki'), icon: 'book-outline' },
    { key: 'tasks', label: t('detail.tabs.tasks'), icon: 'checkbox-outline' },
  ];
  if (canManageGroup) {
    tabs.push({ key: 'analytics', label: t('detail.tabs.analytics'), icon: 'analytics-outline' });
  }
  if (hasFeature('marketplace')) {
    tabs.push({ key: 'marketplace', label: t('detail.tabs.marketplace'), icon: 'bag-handle-outline' });
  }

  return (
    <SafeAreaView testID="group-detail-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('detail.title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/groups"
        rightAction={{
          accessibilityLabel: t('share'),
          icon: 'share-outline',
          onPress: handleShare,
        }}
      />

      <ScrollView
        testID="group-detail-scroll"
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, gap: 16, paddingHorizontal: 16, paddingBottom: 40, backgroundColor: theme.bg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={primary}
            colors={[primary]}
          />
        }
      >
        <HeroCard className="overflow-hidden rounded-panel p-0">
          {image ? (
            <Image source={{ uri: image }} className="h-44 w-full bg-default-200" resizeMode="cover" />
          ) : (
            <View className="h-28 items-center justify-center" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="people-outline" size={42} color={primary} />
            </View>
          )}
          <HeroCard.Body className="gap-5 p-4">
            <View className="gap-3">
              <View className="flex-row items-start gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={2}>
                    {loadedGroup.name}
                  </Text>
                  {loadedGroup.location ? (
                    <View className="mt-2 flex-row items-center gap-1">
                      <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
                      <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                        {loadedGroup.location}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {loadedGroup.is_featured ? (
                  <Chip size="sm" variant="secondary" color="warning">
                    <Ionicons name="star-outline" size={12} color="#f59e0b" />
                    <Chip.Label>{t('featured')}</Chip.Label>
                  </Chip>
                ) : null}
              </View>

              <View className="flex-row flex-wrap gap-2">
                <StatusChip
                  icon={loadedGroup.visibility === 'private' ? 'lock-closed-outline' : 'globe-outline'}
                  label={loadedGroup.visibility === 'private' ? t('private') : t('public')}
                  color={theme.textMuted}
                />
                {currentIsMember ? (
                  <StatusChip icon="checkmark-circle-outline" label={t('joined')} color={theme.success} />
                ) : null}
              </View>
            </View>

            <View className="flex-row flex-wrap gap-3">
              <StatTile label={t('detail.stats.members')} value={String(currentMemberCount)} tone={primary} theme={theme} />
              <StatTile label={t('detail.stats.posts')} value={String(loadedGroup.posts_count ?? 0)} tone="#22c55e" theme={theme} />
            </View>

            <HeroButton
              variant={currentIsMember ? 'secondary' : 'primary'}
              onPress={currentIsMember ? () => void handleLeave() : () => void handleJoin()}
              isDisabled={isUpdating}
            >
              {isUpdating ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <Ionicons
                    name={currentIsMember ? 'exit-outline' : 'add-outline'}
                    size={18}
                    color={currentIsMember ? primary : '#fff'}
                  />
                  <HeroButton.Label>{currentIsMember ? t('leave') : t('join')}</HeroButton.Label>
                </>
              )}
            </HeroButton>

            {canManageGroup ? (
              <Surface variant="secondary" className="gap-3 rounded-panel-inner p-4">
                <SectionTitle title={t('detail.ownerTools')} />
                <HeroButton variant="secondary" onPress={openEditGroup}>
                  <Ionicons name="create-outline" size={18} color={primary} />
                  <HeroButton.Label>{t('detail.edit')}</HeroButton.Label>
                </HeroButton>
              </Surface>
            ) : null}
          </HeroCard.Body>
        </HeroCard>

        <Surface variant="secondary" className="rounded-panel p-1">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1">
            {tabs.map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <HeroButton
                  key={tab.key}
                  size="sm"
                  variant={selected ? 'primary' : 'ghost'}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveTab(tab.key);
                  }}
                  className="h-11 min-w-[120px] rounded-panel-inner"
                  style={{ backgroundColor: selected ? withAlpha(primary, 0.18) : 'transparent' }}
                >
                  <Ionicons name={tab.icon} size={16} color={selected ? primary : theme.textSecondary} />
                  <HeroButton.Label style={{ color: selected ? primary : theme.textSecondary }}>
                    {tab.label}
                  </HeroButton.Label>
                </HeroButton>
              );
            })}
          </ScrollView>
        </Surface>

        {activeTab === 'overview' ? (
          <View className="gap-4">
            {displayDescription ? (
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="gap-3 p-4">
                  <SectionTitle title={t('detail.about')} />
                  <Text className="text-sm leading-6" style={{ color: theme.text }}>
                    {stripHtml(displayDescription)}
                  </Text>
                </HeroCard.Body>
              </HeroCard>
            ) : (
              <EmptyCard icon="document-text-outline" message={t('detail.emptyAbout')} />
            )}

            {loadedGroup.tags && loadedGroup.tags.length > 0 ? (
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="gap-3 p-4">
                  <SectionTitle title={t('detail.tags')} />
                  <View className="flex-row flex-wrap gap-2">
                    {loadedGroup.tags.map((tag) => (
                      <Chip key={tag} size="sm" variant="secondary" color="default">
                        <Chip.Label>{tag}</Chip.Label>
                      </Chip>
                    ))}
                  </View>
                </HeroCard.Body>
              </HeroCard>
            ) : null}

            {loadedGroup.admin ? (
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="gap-3 p-4">
                  <SectionTitle title={t('detail.admin')} />
                  <View className="flex-row items-center gap-3">
                    <Avatar uri={loadedGroup.admin.avatar_url ?? undefined} name={loadedGroup.admin.name ?? '?'} size={42} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                        {loadedGroup.admin.name ?? t('common:unknown')}
                      </Text>
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>
                        {t('detail.groupAdmin')}
                      </Text>
                    </View>
                  </View>
                </HeroCard.Body>
              </HeroCard>
            ) : null}
          </View>
        ) : null}

        {activeTab === 'discussion' ? (
          <View className="gap-3">
            {!userCanSeeMemberContent ? (
              <EmptyCard icon="lock-closed-outline" message={t('detail.joinToDiscuss')} />
            ) : (
              <>
                <HeroCard className="rounded-panel p-0">
                  <HeroCard.Body className="gap-3 p-4">
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="min-w-0 flex-1">
                        <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                          {t('detail.startDiscussion')}
                        </Text>
                        <Text className="mt-1 text-xs" style={{ color: theme.textSecondary }} numberOfLines={2}>
                          {t('detail.startDiscussionHint')}
                        </Text>
                      </View>
                      <HeroButton
                        size="sm"
                        variant="primary"
                        onPress={() => setShowDiscussionComposer(true)}
                      >
                        <HeroButton.Label>{t('detail.newDiscussion')}</HeroButton.Label>
                      </HeroButton>
                    </View>
                  </HeroCard.Body>
                </HeroCard>

                {discussionsApi.isLoading ? (
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="min-h-[140px] items-center justify-center">
                  <Spinner size="md" />
                </HeroCard.Body>
              </HeroCard>
            ) : discussions.length === 0 ? (
              <EmptyCard icon="chatbubble-ellipses-outline" message={t('detail.emptyDiscussions')} />
            ) : (
              discussions.map((discussion) => (
                <HeroCard key={discussion.id} className="rounded-panel p-0">
                  <HeroCard.Body className="gap-3 p-4" style={{ minHeight: CARD_MIN_HEIGHT }}>
                    <View className="flex-row items-start justify-between gap-3">
                      <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                        {discussion.title}
                      </Text>
                      {discussion.is_pinned ? (
                        <Chip size="sm" variant="secondary" color="warning">
                          <Chip.Label>{t('detail.pinned')}</Chip.Label>
                        </Chip>
                      ) : null}
                    </View>
                    <View className="flex-row items-center gap-3">
                      <Avatar uri={discussion.author?.avatar_url ?? undefined} name={discussion.author?.name ?? '?'} size={32} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm font-medium" style={{ color: theme.text }} numberOfLines={1}>
                          {discussion.author?.name ?? t('common:unknown')}
                        </Text>
                        <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                          {[
                            t('detail.replies', { count: discussion.reply_count ?? 0 }),
                            formatDate(discussion.created_at),
                          ].filter(Boolean).join(' • ')}
                        </Text>
                      </View>
                    </View>
                  </HeroCard.Body>
                </HeroCard>
              ))
            )}
              </>
            )}
          </View>
        ) : null}

        {activeTab === 'members' ? (
          <View className="gap-3">
            {!userCanSeeMemberContent ? (
              <EmptyCard icon="lock-closed-outline" message={t('detail.joinToSeeMembers')} />
            ) : membersApi.isLoading ? (
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="min-h-[140px] items-center justify-center">
                  <Spinner size="md" />
                </HeroCard.Body>
              </HeroCard>
            ) : members.length === 0 ? (
              <EmptyCard icon="people-outline" message={t('detail.emptyMembers')} />
            ) : (
              members.map((member) => (
                <HeroCard key={member.id} className="rounded-panel p-0">
                  <HeroCard.Body className="flex-row items-center gap-3 p-4" style={{ minHeight: 86 }}>
                    <Avatar uri={member.avatar_url ?? undefined} name={member.name ?? '?'} size={44} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                        {member.name || t('common:unknown')}
                      </Text>
                      <Text className="mt-1 text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                        {[
                          t(`detail.roles.${member.role}`, { defaultValue: member.role }),
                          formatDate(member.joined_at),
                        ].filter(Boolean).join(' • ')}
                      </Text>
                    </View>
                  </HeroCard.Body>
                </HeroCard>
              ))
            )}
          </View>
        ) : null}

        {activeTab === 'events' ? (
          <GroupEventsPanel groupId={loadedGroup.id} events={events} isLoading={eventsApi.isLoading} canCreate={userCanSeeMemberContent} />
        ) : null}

        {activeTab === 'announcements' ? (
          <View className="gap-3">
            {!userCanSeeMemberContent ? (
              <EmptyCard icon="lock-closed-outline" message={t('detail.joinToSeeAnnouncements')} />
            ) : (
              <>
                {canManageGroup ? (
                  <HeroCard className="rounded-panel p-0">
                    <HeroCard.Body className="gap-3 p-4">
                      <View className="flex-row items-center justify-between gap-3">
                        <View className="min-w-0 flex-1">
                          <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                            {t('detail.newAnnouncement')}
                          </Text>
                          <Text className="mt-1 text-xs" style={{ color: theme.textSecondary }} numberOfLines={2}>
                            {t('detail.newAnnouncementHint')}
                          </Text>
                        </View>
                        <HeroButton
                          size="sm"
                          variant={showAnnouncementComposer ? 'secondary' : 'primary'}
                          onPress={() => setShowAnnouncementComposer((value) => !value)}
                        >
                          <HeroButton.Label>
                            {showAnnouncementComposer ? t('common:buttons.cancel') : t('detail.createAnnouncement')}
                          </HeroButton.Label>
                        </HeroButton>
                      </View>

                      {showAnnouncementComposer ? (
                        <View className="gap-3">
                          <Input
                            value={announcementTitle}
                            onChangeText={setAnnouncementTitle}
                            placeholder={t('detail.announcementTitlePlaceholder')}
                            placeholderTextColor={theme.textMuted}
                            className="text-base"
                            style={{ color: theme.text }}
                            accessibilityLabel={t('detail.announcementTitlePlaceholder')}
                          />
                          <Input
                            value={announcementContent}
                            onChangeText={setAnnouncementContent}
                            placeholder={t('detail.announcementContentPlaceholder')}
                            placeholderTextColor={theme.textMuted}
                            multiline
                            className="min-h-[104px] text-base"
                            style={{ color: theme.text, textAlignVertical: 'top' }}
                            accessibilityLabel={t('detail.announcementContentPlaceholder')}
                          />
                          <HeroButton
                            size="sm"
                            variant={announcementPinned ? 'primary' : 'secondary'}
                            onPress={() => setAnnouncementPinned((value) => !value)}
                          >
                            <Ionicons name="pin-outline" size={16} color={announcementPinned ? '#fff' : primary} />
                            <HeroButton.Label>{announcementPinned ? t('detail.pinned') : t('detail.pinAnnouncement')}</HeroButton.Label>
                          </HeroButton>
                          <HeroButton isDisabled={creatingAnnouncement} onPress={() => void handleCreateAnnouncement()}>
                            {creatingAnnouncement ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.publishAnnouncement')}</HeroButton.Label>}
                          </HeroButton>
                        </View>
                      ) : null}
                    </HeroCard.Body>
                  </HeroCard>
                ) : null}

                {announcementsApi.isLoading ? (
                  <HeroCard className="rounded-panel p-0">
                    <HeroCard.Body className="min-h-[140px] items-center justify-center">
                      <Spinner size="md" />
                    </HeroCard.Body>
                  </HeroCard>
                ) : announcements.length === 0 ? (
                  <EmptyCard icon="megaphone-outline" message={t('detail.emptyAnnouncements')} />
                ) : (
                  announcements.map((announcement) => (
                <HeroCard key={announcement.id} className="rounded-panel p-0">
                  <HeroCard.Body className="gap-3 p-4" style={{ minHeight: CARD_MIN_HEIGHT }}>
                    <View className="flex-row items-start justify-between gap-3">
                      <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                        {announcement.title}
                      </Text>
                      {announcement.is_pinned ? (
                        <Chip size="sm" variant="secondary" color="warning">
                          <Chip.Label>{t('detail.pinned')}</Chip.Label>
                        </Chip>
                      ) : null}
                    </View>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>
                      {stripHtml(announcement.content)}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                      {[announcement.author?.name, formatDate(announcement.created_at)].filter(Boolean).join(' • ')}
                    </Text>
                    {canManageGroup ? (
                      <View className="flex-row flex-wrap gap-2">
                        <HeroButton
                          size="sm"
                          variant="secondary"
                          isDisabled={updatingAnnouncementId === announcement.id}
                          onPress={() => void handleToggleAnnouncementPin(announcement)}
                        >
                          {updatingAnnouncementId === announcement.id ? <Spinner size="sm" /> : <Ionicons name="pin-outline" size={16} color={primary} />}
                          <HeroButton.Label>{announcement.is_pinned ? t('detail.unpinAnnouncement') : t('detail.pinAnnouncement')}</HeroButton.Label>
                        </HeroButton>
                        <HeroButton
                          size="sm"
                          variant="danger-soft"
                          isDisabled={updatingAnnouncementId === announcement.id}
                          onPress={() => handleDeleteAnnouncement(announcement)}
                        >
                          <Ionicons name="trash-outline" size={16} color={theme.error} />
                          <HeroButton.Label>{t('detail.deleteAnnouncement')}</HeroButton.Label>
                        </HeroButton>
                      </View>
                    ) : null}
                  </HeroCard.Body>
                </HeroCard>
                  ))
                )}
              </>
            )}
          </View>
        ) : null}

        {activeTab === 'files' ? (
          <GroupFilesPanel
            groupId={loadedGroup.id}
            files={files}
            isLoading={filesApi.isLoading}
            canView={userCanSeeMemberContent}
            canManage={canManageGroup}
            onRefresh={filesApi.refresh}
          />
        ) : null}

        {activeTab === 'media' ? (
          <GroupMediaPanel
            groupId={loadedGroup.id}
            canView={userCanSeeMemberContent}
            canManage={canManageGroup}
          />
        ) : null}

        {activeTab === 'qa' ? (
          <GroupQAPanel
            groupId={loadedGroup.id}
            questions={questions}
            isLoading={questionsApi.isLoading}
            canView={userCanSeeMemberContent}
            canManage={canManageGroup}
            currentUserId={user?.id ?? null}
            showComposer={showQuestionComposer}
            setShowComposer={setShowQuestionComposer}
            title={questionTitle}
            setTitle={setQuestionTitle}
            body={questionBody}
            setBody={setQuestionBody}
            creating={creatingQuestion}
            onCreate={() => void handleCreateQuestion()}
            onRefresh={questionsApi.refresh}
          />
        ) : null}

        {activeTab === 'wiki' ? (
          <GroupWikiPanel
            groupId={loadedGroup.id}
            canView={userCanSeeMemberContent}
            canEdit={userCanSeeMemberContent}
            canManage={canManageGroup}
          />
        ) : null}

        {activeTab === 'tasks' ? (
          <GroupTasksPanel
            groupId={loadedGroup.id}
            canView={userCanSeeMemberContent}
            canManage={canManageGroup}
            members={members}
          />
        ) : null}

        {activeTab === 'analytics' ? (
          <GroupAnalyticsPanel groupId={loadedGroup.id} canView={canManageGroup} />
        ) : null}

        {activeTab === 'marketplace' ? (
          <GroupMarketplacePanel groupId={loadedGroup.id} canView={userCanSeeMemberContent} />
        ) : null}
      </ScrollView>
      <BottomSheet
        visible={showDiscussionComposer}
        onClose={() => setShowDiscussionComposer(false)}
        snapPoints={['62%', '88%']}
        title={t('detail.startDiscussion')}
      >
        <View className="gap-4 py-2">
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('detail.startDiscussionHint')}
          </Text>
          <Input
            value={discussionTitle}
            onChangeText={setDiscussionTitle}
            placeholder={t('detail.discussionTitlePlaceholder')}
            placeholderTextColor={theme.textMuted}
            containerClassName="mb-0"
            className="text-base"
            style={{ color: theme.text }}
            accessibilityLabel={t('detail.discussionTitlePlaceholder')}
          />
          <TextArea
            value={discussionContent}
            onChangeText={setDiscussionContent}
            placeholder={t('detail.discussionContentPlaceholder')}
            placeholderTextColor={theme.textMuted}
            numberOfLines={6}
            containerClassName="mb-0"
            inputClassName="min-h-[140px] text-base"
            style={{ color: theme.text }}
            accessibilityLabel={t('detail.discussionContentPlaceholder')}
          />
          <View className="flex-row gap-3">
            <HeroButton
              className="flex-1"
              variant="secondary"
              isDisabled={creatingDiscussion}
              onPress={() => setShowDiscussionComposer(false)}
            >
              <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              className="flex-1"
              isDisabled={creatingDiscussion}
              onPress={() => void handleCreateDiscussion()}
            >
              {creatingDiscussion ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.publishDiscussion')}</HeroButton.Label>}
            </HeroButton>
          </View>
        </View>
      </BottomSheet>
      {confirmDialog}
    </SafeAreaView>
  );
}

function GroupEventsPanel({
  groupId,
  events,
  isLoading,
  canCreate,
}: {
  groupId: number;
  events: Event[];
  isLoading: boolean;
  canCreate: boolean;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();

  function openEvent(eventId: number) {
    router.push({ pathname: '/(modals)/event-detail', params: { id: String(eventId) } } as never);
  }

  function createGroupEvent() {
    router.push({ pathname: '/(modals)/new-event', params: { group_id: String(groupId) } } as never);
  }

  return (
    <View className="gap-3">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha('#f59e0b', 0.16) }}>
              <Ionicons name="calendar-outline" size={23} color="#f59e0b" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>
                {t('detail.eventsHeading')}
              </Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('detail.eventsSubtitle')}
              </Text>
            </View>
          </View>

          {canCreate ? (
            <HeroButton variant="secondary" onPress={createGroupEvent}>
              <Ionicons name="add-outline" size={16} color={primary} />
              <HeroButton.Label>{t('detail.createEvent')}</HeroButton.Label>
            </HeroButton>
          ) : null}
        </HeroCard.Body>
      </HeroCard>

      {isLoading ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="min-h-[140px] items-center justify-center">
            <Spinner size="md" />
          </HeroCard.Body>
        </HeroCard>
      ) : events.length === 0 ? (
        <EmptyCard icon="calendar-outline" message={t('detail.emptyEvents')} />
      ) : (
        events.map((event) => {
          const eventDate = formatDate(event.start_date) ?? t('detail.eventDateFallback');
          const eventDateParts = formatDateParts(event.start_date);
          const eventTime = formatTime(event.start_date);
          const eventLocation = event.is_online ? t('detail.eventOnline') : event.location;
          const attendeeCount = event.attendees_count ?? event.rsvp_counts?.going ?? 0;
          return (
            <HeroButton
              key={event.id}
              variant="ghost"
              feedbackVariant="scale"
              className="w-full p-0"
              accessibilityLabel={event.title}
              onPress={() => openEvent(event.id)}
            >
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="gap-3 p-4">
                  <View className="flex-row items-start gap-3">
                    <View
                      className="w-16 items-center rounded-3xl border px-2 py-3"
                      style={{ backgroundColor: withAlpha('#f59e0b', 0.1), borderColor: withAlpha('#f59e0b', 0.25) }}
                    >
                      <Text className="text-center text-[11px] font-semibold uppercase" style={{ color: '#f59e0b' }} numberOfLines={1}>
                        {eventDateParts?.month ?? eventDate}
                      </Text>
                      <Text className="text-center text-xl font-bold" style={{ color: theme.text }} numberOfLines={1}>
                        {eventDateParts?.day ?? '-'}
                      </Text>
                    </View>
                    <View className="min-w-0 flex-1 gap-2">
                      <View className="flex-row items-start justify-between gap-2">
                        <View className="min-w-0 flex-1">
                          <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                            {event.title}
                          </Text>
                          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                            {stripHtml(event.description)}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                      </View>

                      <View className="flex-row flex-wrap gap-2">
                        {eventTime ? <StatusChip icon="time-outline" label={eventTime} color="#f59e0b" /> : null}
                        {eventLocation ? <StatusChip icon={event.is_online ? 'videocam-outline' : 'location-outline'} label={eventLocation} color={primary} /> : null}
                        <StatusChip icon="people-outline" label={t('detail.eventAttending', { count: attendeeCount })} color={theme.textMuted} />
                      </View>
                    </View>
                  </View>
                </HeroCard.Body>
              </HeroCard>
            </HeroButton>
          );
        })
      )}
    </View>
  );
}

function GroupFilesPanel({
  groupId,
  files,
  isLoading,
  canView,
  canManage,
  onRefresh,
}: {
  groupId: number;
  files: GroupFileItem[];
  isLoading: boolean;
  canView: boolean;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function openDownload(fileId: number) {
    const url = `${API_BASE_URL}${API_V2}/groups/${groupId}/files/${fileId}/download`;
    void Linking.openURL(url);
  }

  function confirmDelete(file: GroupFileItem) {
    confirm({
      title: t('detail.files.deleteTitle'),
      message: t('detail.files.deleteMessage', { name: file.file_name }),
      confirmLabel: t('detail.files.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setDeletingId(file.id);
        try {
          await deleteGroupFile(groupId, file.id);
          onRefresh();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('common:errors.alertTitle'), description: t('detail.files.deleteError'), variant: 'danger' });
        } finally {
          setDeletingId(null);
        }
      },
    });
  }

  if (!canView) {
    return <EmptyCard icon="lock-closed-outline" message={t('detail.files.joinToView')} />;
  }

  return (
    <View className="gap-3">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="folder-open-outline" size={22} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>
                {t('detail.files.title')}
              </Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('detail.files.subtitle')}
              </Text>
            </View>
          </View>
        </HeroCard.Body>
      </HeroCard>

      {isLoading ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="min-h-[140px] items-center justify-center">
            <Spinner size="md" />
          </HeroCard.Body>
        </HeroCard>
      ) : files.length === 0 ? (
        <EmptyCard icon="folder-open-outline" message={t('detail.files.empty')} />
      ) : (
        files.map((file) => (
          <HeroCard key={file.id} className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-10 items-center justify-center rounded-panel-inner" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                  <Ionicons name="document-text-outline" size={19} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                    {file.file_name}
                  </Text>
                  {file.description ? (
                    <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={2}>
                      {file.description}
                    </Text>
                  ) : null}
                  <Text className="mt-1 text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                    {[formatFileSize(file.file_size), file.folder, file.uploader_name, formatDate(file.created_at)].filter(Boolean).join(' - ')}
                  </Text>
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <HeroButton
                  size="sm"
                  variant="secondary"
                  onPress={() => openDownload(file.id)}
                  accessibilityLabel={t('detail.files.downloadLabel', { name: file.file_name })}
                >
                  <Ionicons name="download-outline" size={16} color={primary} />
                  <HeroButton.Label>{t('detail.files.download')}</HeroButton.Label>
                </HeroButton>
                {canManage ? (
                  <HeroButton
                    size="sm"
                    variant="danger-soft"
                    isDisabled={deletingId === file.id}
                    onPress={() => confirmDelete(file)}
                    accessibilityLabel={t('detail.files.deleteLabel', { name: file.file_name })}
                  >
                    {deletingId === file.id ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.files.delete')}</HeroButton.Label>}
                  </HeroButton>
                ) : null}
              </View>
            </HeroCard.Body>
          </HeroCard>
        ))
      )}
      {confirmDialog}
    </View>
  );
}

function GroupMediaPanel({
  groupId,
  canView,
  canManage,
}: {
  groupId: number;
  canView: boolean;
  canManage: boolean;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [filter, setFilter] = useState<GroupMediaType | 'all'>('all');
  const [items, setItems] = useState<GroupMediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [uploadingMediaType, setUploadingMediaType] = useState<GroupMediaType | null>(null);

  const loadMedia = useCallback(async () => {
    if (!canView) return;
    setIsLoading(true);
    try {
      const response = await getGroupMedia(groupId, { type: filter });
      setItems(response.data.items ?? []);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.media.loadError'), variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, groupId, filter]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  function openMedia(item: GroupMediaItem) {
    const url = item.url ?? item.thumbnail_url;
    if (url) void Linking.openURL(resolveImageUrl(url) ?? url);
  }

  function confirmDelete(item: GroupMediaItem) {
    confirm({
      title: t('detail.media.deleteTitle'),
      message: t('detail.media.deleteMessage'),
      confirmLabel: t('detail.media.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setDeletingId(item.id);
        try {
          await deleteGroupMedia(groupId, item.id);
          await loadMedia();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('common:errors.alertTitle'), description: t('detail.media.deleteError'), variant: 'danger' });
        } finally {
          setDeletingId(null);
        }
      },
    });
  }

  async function pickMedia(type: GroupMediaType) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast({ title: t('detail.media.permissionTitle'), description: t('detail.media.permissionMessage'), variant: 'warning' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: type === 'video' ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.82,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    setUploadingMediaType(type);
    try {
      await uploadGroupMedia(groupId, {
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
      });
      await loadMedia();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.media.uploadError'), variant: 'danger' });
    } finally {
      setUploadingMediaType(null);
    }
  }

  if (!canView) {
    return <EmptyCard icon="lock-closed-outline" message={t('detail.media.joinToView')} />;
  }

  return (
    <View className="gap-3">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="images-outline" size={22} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>
                {t('detail.media.title')}
              </Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('detail.media.subtitle')}
              </Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {(['all', 'image', 'video'] as const).map((value) => (
              <HeroButton
                key={value}
                size="sm"
                variant={filter === value ? 'primary' : 'secondary'}
                onPress={() => setFilter(value)}
              >
                <HeroButton.Label>{t(`detail.media.filters.${value}`)}</HeroButton.Label>
              </HeroButton>
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            <HeroButton size="sm" variant="secondary" isDisabled={uploadingMediaType !== null} onPress={() => void pickMedia('image')}>
              {uploadingMediaType === 'image' ? <Spinner size="sm" /> : <Ionicons name="image-outline" size={16} color={primary} />}
              <HeroButton.Label>{t('detail.media.uploadPhoto')}</HeroButton.Label>
            </HeroButton>
            <HeroButton size="sm" variant="secondary" isDisabled={uploadingMediaType !== null} onPress={() => void pickMedia('video')}>
              {uploadingMediaType === 'video' ? <Spinner size="sm" /> : <Ionicons name="film-outline" size={16} color={primary} />}
              <HeroButton.Label>{t('detail.media.uploadVideo')}</HeroButton.Label>
            </HeroButton>
          </View>
        </HeroCard.Body>
      </HeroCard>

      {isLoading ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="min-h-[140px] items-center justify-center">
            <Spinner size="md" />
          </HeroCard.Body>
        </HeroCard>
      ) : items.length === 0 ? (
        <EmptyCard icon="images-outline" message={t('detail.media.empty')} />
      ) : (
        <View className="flex-row flex-wrap gap-3">
          {items.map((item) => {
            const sourceUrl = resolveImageUrl(item.thumbnail_url ?? item.url ?? null);
            return (
              <HeroCard key={item.id} className="w-[47%] rounded-panel p-0">
                <HeroCard.Body className="gap-2 p-3">
                  {item.type === 'image' && sourceUrl ? (
                    <Image source={{ uri: sourceUrl }} className="h-28 w-full rounded-panel-inner" resizeMode="cover" />
                  ) : (
                    <View className="h-28 w-full items-center justify-center rounded-panel-inner" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                      <Ionicons name={item.type === 'video' ? 'film-outline' : 'image-outline'} size={28} color={primary} />
                    </View>
                  )}
                  <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                    {item.caption || t(`detail.media.type.${item.type}`)}
                  </Text>
                  <Text className="text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                    {[item.uploader_name, formatDate(item.created_at)].filter(Boolean).join(' - ')}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <HeroButton size="sm" variant="secondary" onPress={() => openMedia(item)} accessibilityLabel={t('detail.media.openLabel')}>
                      <HeroButton.Label>{t('detail.media.open')}</HeroButton.Label>
                    </HeroButton>
                    {canManage ? (
                      <HeroButton size="sm" variant="danger-soft" isDisabled={deletingId === item.id} onPress={() => confirmDelete(item)}>
                        {deletingId === item.id ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.media.delete')}</HeroButton.Label>}
                      </HeroButton>
                    ) : null}
                  </View>
                </HeroCard.Body>
              </HeroCard>
            );
          })}
        </View>
      )}
      {confirmDialog}
    </View>
  );
}

function GroupQAPanel({
  groupId,
  questions,
  isLoading,
  canView,
  canManage,
  currentUserId,
  showComposer,
  setShowComposer,
  title,
  setTitle,
  body,
  setBody,
  creating,
  onCreate,
  onRefresh,
}: {
  groupId: number;
  questions: GroupQuestion[];
  isLoading: boolean;
  canView: boolean;
  canManage: boolean;
  currentUserId: number | null;
  showComposer: boolean;
  setShowComposer: React.Dispatch<React.SetStateAction<boolean>>;
  title: string;
  setTitle: (value: string) => void;
  body: string;
  setBody: (value: string) => void;
  creating: boolean;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<GroupQuestionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [answerBody, setAnswerBody] = useState('');
  const [answering, setAnswering] = useState(false);
  const [votingTarget, setVotingTarget] = useState<string | null>(null);
  const [acceptingAnswerId, setAcceptingAnswerId] = useState<number | null>(null);

  async function toggleQuestion(questionId: number) {
    if (expandedId === questionId) {
      setExpandedId(null);
      setDetail(null);
      setAnswerBody('');
      return;
    }

    setExpandedId(questionId);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const response = await getGroupQuestion(groupId, questionId);
      setDetail(response.data);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.qa.loadError'), variant: 'danger' });
      setExpandedId(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function submitAnswer() {
    const content = answerBody.trim();
    if (!expandedId || !content) {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.qa.answerValidation'), variant: 'warning' });
      return;
    }

    setAnswering(true);
    try {
      await answerGroupQuestion(groupId, expandedId, { body: content });
      setAnswerBody('');
      const response = await getGroupQuestion(groupId, expandedId);
      setDetail(response.data);
      onRefresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.qa.answerError'), variant: 'danger' });
    } finally {
      setAnswering(false);
    }
  }

  async function refreshExpandedQuestion() {
    if (!expandedId) return;
    const response = await getGroupQuestion(groupId, expandedId);
    setDetail(response.data);
  }

  async function voteTarget(type: 'question' | 'answer', targetId: number, vote: 'up' | 'down') {
    const targetKey = `${type}:${targetId}:${vote}`;
    setVotingTarget(targetKey);
    try {
      await voteGroupQA(groupId, { type, target_id: targetId, vote });
      onRefresh();
      if (expandedId) await refreshExpandedQuestion();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.qa.voteError'), variant: 'danger' });
    } finally {
      setVotingTarget(null);
    }
  }

  async function acceptAnswer(answerId: number) {
    setAcceptingAnswerId(answerId);
    try {
      await acceptGroupAnswer(groupId, answerId);
      onRefresh();
      await refreshExpandedQuestion();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.qa.acceptError'), variant: 'danger' });
    } finally {
      setAcceptingAnswerId(null);
    }
  }

  if (!canView) {
    return <EmptyCard icon="lock-closed-outline" message={t('detail.qa.joinToView')} />;
  }

  return (
    <View className="gap-3">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>
                {t('detail.qa.title')}
              </Text>
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('detail.qa.subtitle')}
              </Text>
            </View>
            <HeroButton size="sm" variant={showComposer ? 'secondary' : 'primary'} onPress={() => setShowComposer((value) => !value)}>
              <HeroButton.Label>{showComposer ? t('common:buttons.cancel') : t('detail.qa.ask')}</HeroButton.Label>
            </HeroButton>
          </View>

          {showComposer ? (
            <View className="gap-3">
              <Input
                value={title}
                onChangeText={setTitle}
                placeholder={t('detail.qa.titlePlaceholder')}
                placeholderTextColor={theme.textMuted}
                className="text-base"
                style={{ color: theme.text }}
                accessibilityLabel={t('detail.qa.titlePlaceholder')}
              />
              <Input
                value={body}
                onChangeText={setBody}
                placeholder={t('detail.qa.bodyPlaceholder')}
                placeholderTextColor={theme.textMuted}
                multiline
                className="min-h-[104px] text-base"
                style={{ color: theme.text, textAlignVertical: 'top' }}
                accessibilityLabel={t('detail.qa.bodyPlaceholder')}
              />
              <HeroButton isDisabled={creating} onPress={onCreate}>
                {creating ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.qa.publish')}</HeroButton.Label>}
              </HeroButton>
            </View>
          ) : null}
        </HeroCard.Body>
      </HeroCard>

      {isLoading ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="min-h-[140px] items-center justify-center">
            <Spinner size="md" />
          </HeroCard.Body>
        </HeroCard>
      ) : questions.length === 0 ? (
        <EmptyCard icon="help-circle-outline" message={t('detail.qa.empty')} />
      ) : (
        questions.map((question) => {
          const expanded = expandedId === question.id;
          const answers = expanded && detail?.id === question.id ? detail.answers : [];
          const questionAuthorId = detail?.id === question.id ? detail.author?.id : question.author?.id;
          const canAcceptAnswers = canManage || (currentUserId !== null && questionAuthorId === currentUserId);
          return (
            <HeroCard key={question.id} className="rounded-panel p-0">
              <HeroCard.Body className="gap-3 p-4">
                <HeroButton
                  variant="ghost"
                  feedbackVariant="scale"
                  className="w-full justify-start p-0"
                  onPress={() => void toggleQuestion(question.id)}
                  accessibilityLabel={question.title}
                >
                  <View className="w-full gap-2">
                    <View className="flex-row items-start justify-between gap-3">
                      <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                        {question.title}
                      </Text>
                      {question.has_accepted_answer ? (
                        <Chip size="sm" variant="secondary" color="success">
                          <Chip.Label>{t('detail.qa.answered')}</Chip.Label>
                        </Chip>
                      ) : null}
                    </View>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                      {stripHtml(question.body)}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                      {[
                        t('detail.qa.answers', { count: question.answer_count ?? 0 }),
                        t('detail.qa.votes', { count: question.vote_count ?? 0 }),
                        question.author?.name,
                        formatDate(question.created_at),
                      ].filter(Boolean).join(' - ')}
                    </Text>
                  </View>
                </HeroButton>

                <View className="flex-row flex-wrap gap-2">
                  <HeroButton
                    size="sm"
                    variant={question.user_vote === 1 ? 'primary' : 'secondary'}
                    isDisabled={votingTarget === `question:${question.id}:up`}
                    onPress={() => void voteTarget('question', question.id, 'up')}
                    accessibilityLabel={t('detail.qa.upvoteQuestion')}
                  >
                    {votingTarget === `question:${question.id}:up` ? <Spinner size="sm" /> : <Ionicons name="arrow-up-outline" size={15} color={question.user_vote === 1 ? '#fff' : primary} />}
                    <HeroButton.Label>{t('detail.qa.upvote')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton
                    size="sm"
                    variant={question.user_vote === -1 ? 'primary' : 'secondary'}
                    isDisabled={votingTarget === `question:${question.id}:down`}
                    onPress={() => void voteTarget('question', question.id, 'down')}
                    accessibilityLabel={t('detail.qa.downvoteQuestion')}
                  >
                    {votingTarget === `question:${question.id}:down` ? <Spinner size="sm" /> : <Ionicons name="arrow-down-outline" size={15} color={question.user_vote === -1 ? '#fff' : primary} />}
                    <HeroButton.Label>{t('detail.qa.downvote')}</HeroButton.Label>
                  </HeroButton>
                </View>

                {expanded ? (
                  <View className="gap-3 border-t pt-3" style={{ borderColor: theme.borderSubtle }}>
                    {loadingDetail ? (
                      <View className="items-center py-4">
                        <Spinner size="sm" />
                      </View>
                    ) : answers.length === 0 ? (
                      <Text className="text-sm" style={{ color: theme.textSecondary }}>
                        {t('detail.qa.noAnswers')}
                      </Text>
                    ) : (
                      answers.map((answer) => (
                        <Surface key={answer.id} variant="secondary" className="gap-2 rounded-panel-inner p-3">
                          <View className="flex-row items-start justify-between gap-2">
                            <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.text }}>
                              {stripHtml(answer.body)}
                            </Text>
                            {answer.is_accepted ? (
                              <Chip size="sm" variant="secondary" color="success">
                                <Chip.Label>{t('detail.qa.accepted')}</Chip.Label>
                              </Chip>
                            ) : null}
                          </View>
                          <Text className="text-xs" style={{ color: theme.textMuted }}>
                            {[answer.author?.name, formatDate(answer.created_at)].filter(Boolean).join(' - ')}
                          </Text>
                          <View className="flex-row flex-wrap gap-2">
                            <HeroButton
                              size="sm"
                              variant={answer.user_vote === 1 ? 'primary' : 'secondary'}
                              isDisabled={votingTarget === `answer:${answer.id}:up`}
                              onPress={() => void voteTarget('answer', answer.id, 'up')}
                              accessibilityLabel={t('detail.qa.upvoteAnswer')}
                            >
                              {votingTarget === `answer:${answer.id}:up` ? <Spinner size="sm" /> : <Ionicons name="arrow-up-outline" size={15} color={answer.user_vote === 1 ? '#fff' : primary} />}
                              <HeroButton.Label>{t('detail.qa.upvote')}</HeroButton.Label>
                            </HeroButton>
                            <HeroButton
                              size="sm"
                              variant={answer.user_vote === -1 ? 'primary' : 'secondary'}
                              isDisabled={votingTarget === `answer:${answer.id}:down`}
                              onPress={() => void voteTarget('answer', answer.id, 'down')}
                              accessibilityLabel={t('detail.qa.downvoteAnswer')}
                            >
                              {votingTarget === `answer:${answer.id}:down` ? <Spinner size="sm" /> : <Ionicons name="arrow-down-outline" size={15} color={answer.user_vote === -1 ? '#fff' : primary} />}
                              <HeroButton.Label>{t('detail.qa.downvote')}</HeroButton.Label>
                            </HeroButton>
                            {canAcceptAnswers && !answer.is_accepted ? (
                              <HeroButton
                                size="sm"
                                variant="secondary"
                                isDisabled={acceptingAnswerId === answer.id}
                                onPress={() => void acceptAnswer(answer.id)}
                              >
                                {acceptingAnswerId === answer.id ? <Spinner size="sm" /> : <Ionicons name="checkmark-circle-outline" size={15} color={primary} />}
                                <HeroButton.Label>{t('detail.qa.acceptAnswer')}</HeroButton.Label>
                              </HeroButton>
                            ) : null}
                          </View>
                        </Surface>
                      ))
                    )}
                    <Input
                      value={answerBody}
                      onChangeText={setAnswerBody}
                      placeholder={t('detail.qa.answerPlaceholder')}
                      placeholderTextColor={theme.textMuted}
                      multiline
                      className="min-h-[86px] text-base"
                      style={{ color: theme.text, textAlignVertical: 'top' }}
                      accessibilityLabel={t('detail.qa.answerPlaceholder')}
                    />
                    <HeroButton isDisabled={answering} onPress={() => void submitAnswer()}>
                      {answering ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.qa.postAnswer')}</HeroButton.Label>}
                    </HeroButton>
                  </View>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          );
        })
      )}
    </View>
  );
}

function GroupWikiPanel({
  groupId,
  canView,
  canEdit,
  canManage,
}: {
  groupId: number;
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [pages, setPages] = useState<GroupWikiPage[]>([]);
  const [selectedPage, setSelectedPage] = useState<GroupWikiPageDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [revisions, setRevisions] = useState<GroupWikiRevision[]>([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [deletingPage, setDeletingPage] = useState(false);

  async function loadPage(slug: string) {
    setPageLoading(true);
    setEditing(false);
    setShowRevisions(false);
    setRevisions([]);
    try {
      const response = await getGroupWikiPage(groupId, slug);
      setSelectedPage(response.data);
      setEditContent(response.data.content ?? '');
      setChangeSummary('');
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.wiki.pageLoadError'), variant: 'danger' });
    } finally {
      setPageLoading(false);
    }
  }

  async function loadPages(openFirst = false) {
    setIsLoading(true);
    try {
      const response = await getGroupWikiPages(groupId);
      const items = Array.isArray(response.data) ? response.data : [];
      setPages(items);
      if (openFirst && items.length > 0) {
        await loadPage(items[0].slug);
      } else if (selectedPage && !items.some((page) => page.id === selectedPage.id)) {
        setSelectedPage(null);
      }
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.wiki.loadError'), variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (canView) void loadPages(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, groupId]);

  async function createPage() {
    const title = newTitle.trim();
    const content = newContent.trim();
    if (!title || !content) {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.wiki.validation'), variant: 'warning' });
      return;
    }

    setCreating(true);
    try {
      const response = await createGroupWikiPage(groupId, { title, content });
      setNewTitle('');
      setNewContent('');
      setShowComposer(false);
      setSelectedPage(response.data);
      await loadPages(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.wiki.createError'), variant: 'danger' });
    } finally {
      setCreating(false);
    }
  }

  async function savePage() {
    if (!selectedPage || !editContent.trim()) {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.wiki.validation'), variant: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const response = await updateGroupWikiPage(groupId, selectedPage.id, {
        title: selectedPage.title,
        content: editContent.trim(),
        change_summary: changeSummary.trim() || undefined,
      });
      setSelectedPage(response.data);
      setEditing(false);
      setChangeSummary('');
      await loadPages(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.wiki.saveError'), variant: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  async function loadRevisions() {
    if (!selectedPage) return;
    setRevisionsLoading(true);
    try {
      const response = await getGroupWikiRevisions(groupId, selectedPage.id);
      setRevisions(response.data ?? []);
      setShowRevisions(true);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.wiki.revisionsError'), variant: 'danger' });
    } finally {
      setRevisionsLoading(false);
    }
  }

  function confirmDeletePage() {
    if (!selectedPage) return;
    confirm({
      title: t('detail.wiki.deleteTitle'),
      message: t('detail.wiki.deleteMessage', { title: selectedPage.title }),
      confirmLabel: t('detail.wiki.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        if (!selectedPage) return;
        setDeletingPage(true);
        try {
          await deleteGroupWikiPage(groupId, selectedPage.id);
          setSelectedPage(null);
          setRevisions([]);
          setShowRevisions(false);
          await loadPages(false);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('common:errors.alertTitle'), description: t('detail.wiki.deleteError'), variant: 'danger' });
        } finally {
          setDeletingPage(false);
        }
      },
    });
  }

  if (!canView) {
    return <EmptyCard icon="lock-closed-outline" message={t('detail.wiki.joinToView')} />;
  }

  return (
    <View className="gap-3">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>
                {t('detail.wiki.title')}
              </Text>
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('detail.wiki.subtitle')}
              </Text>
            </View>
            {canEdit ? (
              <HeroButton size="sm" variant={showComposer ? 'secondary' : 'primary'} onPress={() => setShowComposer((value) => !value)}>
                <HeroButton.Label>{showComposer ? t('common:buttons.cancel') : t('detail.wiki.newPage')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>

          {showComposer ? (
            <View className="gap-3">
              <Input
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder={t('detail.wiki.titlePlaceholder')}
                placeholderTextColor={theme.textMuted}
                className="text-base"
                style={{ color: theme.text }}
                accessibilityLabel={t('detail.wiki.titlePlaceholder')}
              />
              <Input
                value={newContent}
                onChangeText={setNewContent}
                placeholder={t('detail.wiki.contentPlaceholder')}
                placeholderTextColor={theme.textMuted}
                multiline
                className="min-h-[120px] text-base"
                style={{ color: theme.text, textAlignVertical: 'top' }}
                accessibilityLabel={t('detail.wiki.contentPlaceholder')}
              />
              <HeroButton isDisabled={creating} onPress={() => void createPage()}>
                {creating ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.wiki.create')}</HeroButton.Label>}
              </HeroButton>
            </View>
          ) : null}
        </HeroCard.Body>
      </HeroCard>

      {isLoading && pages.length === 0 ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="min-h-[140px] items-center justify-center">
            <Spinner size="md" />
          </HeroCard.Body>
        </HeroCard>
      ) : pages.length === 0 ? (
        <EmptyCard icon="book-outline" message={t('detail.wiki.empty')} />
      ) : (
        <View className="gap-2">
          {pages.map((page) => (
            <HeroButton
              key={page.id}
              variant={selectedPage?.id === page.id ? 'secondary' : 'ghost'}
              feedbackVariant="scale"
              className="w-full justify-start rounded-panel"
              onPress={() => void loadPage(page.slug)}
              accessibilityLabel={page.title}
            >
              <View className="w-full flex-row items-center gap-3">
                <Ionicons name="document-text-outline" size={18} color={theme.textSecondary} />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                    {page.title}
                  </Text>
                  <Text className="text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                    {[page.author?.name, formatDate(page.updated_at)].filter(Boolean).join(' - ')}
                  </Text>
                </View>
                {!page.is_published ? (
                  <Chip size="sm" variant="secondary" color="warning">
                    <Chip.Label>{t('detail.wiki.draft')}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
            </HeroButton>
          ))}
        </View>
      )}

      {pageLoading ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="items-center justify-center py-8">
            <Spinner size="sm" />
          </HeroCard.Body>
        </HeroCard>
      ) : selectedPage ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-semibold" style={{ color: theme.text }}>
                  {selectedPage.title}
                </Text>
                <Text className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                  {[selectedPage.author?.name, formatDate(selectedPage.updated_at)].filter(Boolean).join(' - ')}
                </Text>
              </View>
              {canEdit ? (
                <View className="flex-row flex-wrap gap-2">
                  <HeroButton size="sm" variant="secondary" onPress={() => setEditing((value) => !value)}>
                    <HeroButton.Label>{editing ? t('common:buttons.cancel') : t('detail.wiki.edit')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton size="sm" variant="secondary" isDisabled={revisionsLoading} onPress={() => void (showRevisions ? setShowRevisions(false) : loadRevisions())}>
                    {revisionsLoading ? <Spinner size="sm" /> : <Ionicons name="time-outline" size={15} color={theme.textSecondary} />}
                    <HeroButton.Label>{showRevisions ? t('detail.wiki.hideRevisions') : t('detail.wiki.revisions')}</HeroButton.Label>
                  </HeroButton>
                  {canManage ? (
                    <HeroButton size="sm" variant="danger-soft" isDisabled={deletingPage} onPress={confirmDeletePage}>
                      {deletingPage ? <Spinner size="sm" /> : <Ionicons name="trash-outline" size={15} color={theme.error} />}
                      <HeroButton.Label>{t('detail.wiki.delete')}</HeroButton.Label>
                    </HeroButton>
                  ) : null}
                </View>
              ) : null}
            </View>

            {editing ? (
              <View className="gap-3">
                <Input
                  value={editContent}
                  onChangeText={setEditContent}
                  placeholder={t('detail.wiki.contentPlaceholder')}
                  placeholderTextColor={theme.textMuted}
                  multiline
                  className="min-h-[160px] text-base"
                  style={{ color: theme.text, textAlignVertical: 'top' }}
                  accessibilityLabel={t('detail.wiki.editContentLabel')}
                />
                <Input
                  value={changeSummary}
                  onChangeText={setChangeSummary}
                  placeholder={t('detail.wiki.changeSummaryPlaceholder')}
                  placeholderTextColor={theme.textMuted}
                  className="text-base"
                  style={{ color: theme.text }}
                  accessibilityLabel={t('detail.wiki.changeSummaryPlaceholder')}
                />
                <HeroButton isDisabled={saving} onPress={() => void savePage()}>
                  {saving ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.wiki.save')}</HeroButton.Label>}
                </HeroButton>
              </View>
            ) : (
              <Text className="text-sm leading-6" style={{ color: theme.textSecondary }}>
                {stripHtml(selectedPage.content) || t('detail.wiki.emptyContent')}
              </Text>
            )}

            {showRevisions ? (
              <View className="gap-2 border-t pt-3" style={{ borderColor: theme.borderSubtle }}>
                <SectionTitle title={t('detail.wiki.revisions')} />
                {revisions.length === 0 ? (
                  <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.wiki.noRevisions')}</Text>
                ) : (
                  revisions.map((revision) => (
                    <Surface key={revision.id} variant="secondary" className="gap-2 rounded-panel-inner p-3">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                        {[revision.editor?.name, formatDate(revision.created_at)].filter(Boolean).join(' - ') || t('detail.wiki.revisionFallback')}
                      </Text>
                      {revision.change_summary ? (
                        <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={2}>
                          {revision.change_summary}
                        </Text>
                      ) : null}
                      <Text className="text-xs leading-5" style={{ color: theme.textMuted }} numberOfLines={3}>
                        {stripHtml(revision.content) || t('detail.wiki.emptyContent')}
                      </Text>
                    </Surface>
                  ))
                )}
              </View>
            ) : null}
          </HeroCard.Body>
        </HeroCard>
      ) : null}
      {confirmDialog}
    </View>
  );
}

function GroupTasksPanel({
  groupId,
  canView,
  canManage,
  members,
}: {
  groupId: number;
  canView: boolean;
  canManage: boolean;
  members: GroupMemberListItem[];
}) {
  const { t } = useTranslation(['groups', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [statusFilter, setStatusFilter] = useState<GroupTaskStatus | 'all'>('all');
  const [tasks, setTasks] = useState<GroupTask[]>([]);
  const [stats, setStats] = useState<GroupTaskStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<GroupTaskPriority>('medium');
  const [assignedTo, setAssignedTo] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);

  const loadTasks = useCallback(async () => {
    if (!canView) return;
    setIsLoading(true);
    try {
      const [taskResponse, statsResponse] = await Promise.all([
        getGroupTasks(groupId, { status: statusFilter }),
        getGroupTaskStats(groupId),
      ]);
      setTasks(taskResponse.data ?? []);
      setStats(statsResponse.data);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.tasks.loadError'), variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
  // Keep loading tied to data inputs. The i18n function can change identity during test/runtime renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, groupId, statusFilter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const cycleStatus = async (task: GroupTask) => {
    const nextStatus: GroupTaskStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo';
    setUpdatingTaskId(task.id);
    try {
      await updateGroupTask(task.id, { status: nextStatus });
      await loadTasks();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.tasks.updateError'), variant: 'danger' });
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const updateTaskFields = async (
    task: GroupTask,
    payload: Partial<Pick<GroupTask, 'assigned_to' | 'priority'>>,
  ) => {
    setUpdatingTaskId(task.id);
    try {
      await updateGroupTask(task.id, payload);
      await loadTasks();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.tasks.updateError'), variant: 'danger' });
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const createTask = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.tasks.validation'), variant: 'warning' });
      return;
    }

    setCreating(true);
    try {
      await createGroupTask(groupId, {
        title: cleanTitle,
        description: description.trim() || null,
        status: 'todo',
        priority,
        assigned_to: assignedTo,
        due_date: dueDate.trim() || null,
      });
      setTitle('');
      setDescription('');
      setPriority('medium');
      setAssignedTo(null);
      setDueDate('');
      setShowComposer(false);
      await loadTasks();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.tasks.createError'), variant: 'danger' });
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = (task: GroupTask) => {
    confirm({
      title: t('detail.tasks.deleteTitle'),
      message: t('detail.tasks.deleteMessage', { title: task.title }),
      confirmLabel: t('detail.tasks.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setUpdatingTaskId(task.id);
        try {
          await deleteGroupTask(task.id);
          await loadTasks();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('common:errors.alertTitle'), description: t('detail.tasks.deleteError'), variant: 'danger' });
        } finally {
          setUpdatingTaskId(null);
        }
      },
    });
  };

  if (!canView) {
    return <EmptyCard icon="lock-closed-outline" message={t('detail.tasks.joinToView')} />;
  }

  return (
    <View className="gap-3">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>
                {t('detail.tasks.title')}
              </Text>
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('detail.tasks.subtitle')}
              </Text>
            </View>
            <HeroButton size="sm" variant={showComposer ? 'secondary' : 'primary'} onPress={() => setShowComposer((value) => !value)}>
              <HeroButton.Label>{showComposer ? t('common:buttons.cancel') : t('detail.tasks.newTask')}</HeroButton.Label>
            </HeroButton>
          </View>

          {stats ? (
            <View className="flex-row flex-wrap gap-2">
              {(['total', 'todo', 'in_progress', 'done', 'overdue'] as const).map((key) => (
                <Chip key={key} size="sm" variant="secondary" color={key === 'overdue' && stats.overdue > 0 ? 'danger' : key === 'done' ? 'success' : 'default'}>
                  <Chip.Label>{t(`detail.tasks.stats.${key}`, { count: stats[key] })}</Chip.Label>
                </Chip>
              ))}
            </View>
          ) : null}

          <View className="flex-row flex-wrap gap-2">
            {(['all', 'todo', 'in_progress', 'done'] as const).map((status) => (
              <HeroButton
                key={status}
                size="sm"
                variant={statusFilter === status ? 'primary' : 'secondary'}
                onPress={() => setStatusFilter(status)}
              >
                <HeroButton.Label>{t(`detail.tasks.filters.${status}`)}</HeroButton.Label>
              </HeroButton>
            ))}
          </View>

          {showComposer ? (
            <View className="gap-3">
              <Input
                value={title}
                onChangeText={setTitle}
                placeholder={t('detail.tasks.titlePlaceholder')}
                placeholderTextColor={theme.textMuted}
                className="text-base"
                style={{ color: theme.text }}
                accessibilityLabel={t('detail.tasks.titlePlaceholder')}
              />
              <Input
                value={description}
                onChangeText={setDescription}
                placeholder={t('detail.tasks.descriptionPlaceholder')}
                placeholderTextColor={theme.textMuted}
                multiline
                className="min-h-[88px] text-base"
                style={{ color: theme.text, textAlignVertical: 'top' }}
                accessibilityLabel={t('detail.tasks.descriptionPlaceholder')}
              />
              <Input
                value={dueDate}
                onChangeText={setDueDate}
                placeholder={t('detail.tasks.dueDatePlaceholder')}
                placeholderTextColor={theme.textMuted}
                className="text-base"
                style={{ color: theme.text }}
                accessibilityLabel={t('detail.tasks.dueDatePlaceholder')}
              />
              <View className="gap-2">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>
                  {t('detail.tasks.priorityLabel')}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {(['low', 'medium', 'high', 'urgent'] as GroupTaskPriority[]).map((value) => (
                    <HeroButton key={value} size="sm" variant={priority === value ? 'primary' : 'secondary'} onPress={() => setPriority(value)}>
                      <HeroButton.Label>{t(`detail.tasks.priority.${value}`)}</HeroButton.Label>
                    </HeroButton>
                  ))}
                </View>
              </View>
              {members.length > 0 ? (
                <View className="gap-2">
                  <Text className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>
                    {t('detail.tasks.assigneeLabel')}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <HeroButton size="sm" variant={assignedTo === null ? 'primary' : 'secondary'} onPress={() => setAssignedTo(null)}>
                      <HeroButton.Label>{t('detail.tasks.unassigned')}</HeroButton.Label>
                    </HeroButton>
                    {members.slice(0, 8).map((member) => (
                      <HeroButton
                        key={member.id}
                        size="sm"
                        variant={assignedTo === member.id ? 'primary' : 'secondary'}
                        onPress={() => setAssignedTo(member.id)}
                      >
                        <HeroButton.Label>{member.name}</HeroButton.Label>
                      </HeroButton>
                    ))}
                  </View>
                </View>
              ) : null}
              <HeroButton isDisabled={creating} onPress={() => void createTask()}>
                {creating ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.tasks.create')}</HeroButton.Label>}
              </HeroButton>
            </View>
          ) : null}
        </HeroCard.Body>
      </HeroCard>

      {isLoading ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="min-h-[140px] items-center justify-center">
            <Spinner size="md" />
          </HeroCard.Body>
        </HeroCard>
      ) : tasks.length === 0 ? (
        <EmptyCard icon="checkbox-outline" message={t('detail.tasks.empty')} />
      ) : (
        tasks.map((task) => (
          <HeroCard key={task.id} className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <HeroButton
                  size="sm"
                  variant={task.status === 'done' ? 'primary' : 'secondary'}
                  isDisabled={updatingTaskId === task.id}
                  onPress={() => void cycleStatus(task)}
                  accessibilityLabel={t(`detail.tasks.status.${task.status}`)}
                >
                  {updatingTaskId === task.id ? <Spinner size="sm" /> : <Ionicons name={task.status === 'done' ? 'checkmark-outline' : task.status === 'in_progress' ? 'time-outline' : 'ellipse-outline'} size={16} color={theme.text} />}
                </HeroButton>
                <View className="min-w-0 flex-1 gap-2">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: task.status === 'done' ? theme.textMuted : theme.text }}>
                      {task.title}
                    </Text>
                    <Chip size="sm" variant="secondary" color={task.priority === 'urgent' ? 'danger' : task.priority === 'high' ? 'warning' : 'default'}>
                      <Chip.Label>{t(`detail.tasks.priority.${task.priority}`)}</Chip.Label>
                    </Chip>
                  </View>
                  {task.description ? (
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                      {task.description}
                    </Text>
                  ) : null}
                  <Text className="text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                    {[
                      t(`detail.tasks.status.${task.status}`),
                      task.assignee?.name,
                      task.due_date ? t('detail.tasks.dueDate', { date: formatDate(task.due_date) ?? task.due_date }) : null,
                    ].filter(Boolean).join(' - ')}
                  </Text>
                </View>
                {canManage ? (
                  <HeroButton size="sm" variant="danger-soft" isDisabled={updatingTaskId === task.id} onPress={() => confirmDelete(task)}>
                    <HeroButton.Label>{t('detail.tasks.delete')}</HeroButton.Label>
                  </HeroButton>
                ) : null}
              </View>
              {canManage ? (
                <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
                  <View className="gap-2">
                    <Text className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>
                      {t('detail.tasks.quickPriority')}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {(['low', 'medium', 'high', 'urgent'] as GroupTaskPriority[]).map((value) => (
                        <HeroButton
                          key={value}
                          size="sm"
                          variant={task.priority === value ? 'primary' : 'secondary'}
                          isDisabled={updatingTaskId === task.id}
                          onPress={() => void updateTaskFields(task, { priority: value })}
                        >
                          <HeroButton.Label>{t(`detail.tasks.priority.${value}`)}</HeroButton.Label>
                        </HeroButton>
                      ))}
                    </View>
                  </View>
                  {members.length > 0 ? (
                    <View className="gap-2">
                      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>
                        {t('detail.tasks.quickAssignee')}
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        <HeroButton
                          size="sm"
                          variant={task.assigned_to === null ? 'primary' : 'secondary'}
                          isDisabled={updatingTaskId === task.id}
                          onPress={() => void updateTaskFields(task, { assigned_to: null })}
                        >
                          <HeroButton.Label>{t('detail.tasks.unassigned')}</HeroButton.Label>
                        </HeroButton>
                        {members.slice(0, 8).map((member) => (
                          <HeroButton
                            key={member.id}
                            size="sm"
                            variant={task.assigned_to === member.id ? 'primary' : 'secondary'}
                            isDisabled={updatingTaskId === task.id}
                            onPress={() => void updateTaskFields(task, { assigned_to: member.id })}
                          >
                            <HeroButton.Label>{member.name}</HeroButton.Label>
                          </HeroButton>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </Surface>
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        ))
      )}
      {confirmDialog}
    </View>
  );
}

function GroupAnalyticsPanel({ groupId, canView }: { groupId: number; canView: boolean }) {
  const { t } = useTranslation(['groups', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [days, setDays] = useState(30);
  const [dashboard, setDashboard] = useState<GroupAnalyticsDashboard | null>(null);
  const [retention, setRetention] = useState<GroupAnalyticsRetentionCohort[]>([]);
  const [comparative, setComparative] = useState<GroupAnalyticsComparative | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    if (!canView) return;
    setIsLoading(true);
    try {
      const [response, retentionResponse, comparativeResponse] = await Promise.all([
        getGroupAnalytics(groupId, days),
        getGroupAnalyticsRetention(groupId, 6),
        getGroupAnalyticsComparative(groupId),
      ]);
      setDashboard(response.data);
      setRetention(retentionResponse.data);
      setComparative(comparativeResponse.data);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.analytics.loadError'), variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
    // Keep loading tied to data inputs. The i18n function can change identity during test/runtime renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, days, groupId]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  if (!canView) {
    return <EmptyCard icon="lock-closed-outline" message={t('detail.analytics.adminOnly')} />;
  }

  const overview = dashboard?.overview;
  const engagement = dashboard?.engagement.summary;
  const latestGrowth = dashboard?.member_growth.at(-1);
  const latestEngagement = dashboard?.engagement.timeline.at(-1);
  const activity = dashboard?.activity_breakdown;
  const latestRetention = retention.at(-1);

  return (
    <View className="gap-3">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="analytics-outline" size={23} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>
                {t('detail.analytics.title')}
              </Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('detail.analytics.subtitle')}
              </Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            {[7, 30, 90].map((value) => (
              <HeroButton key={value} size="sm" variant={days === value ? 'primary' : 'secondary'} onPress={() => setDays(value)}>
                <HeroButton.Label>{t(`detail.analytics.days.${value}`)}</HeroButton.Label>
              </HeroButton>
            ))}
          </View>
        </HeroCard.Body>
      </HeroCard>

      {isLoading ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="min-h-[140px] items-center justify-center">
            <Spinner size="md" />
          </HeroCard.Body>
        </HeroCard>
      ) : !dashboard ? (
        <EmptyCard icon="analytics-outline" message={t('detail.analytics.empty')} />
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3">
            <StatTile label={t('detail.analytics.metrics.members')} value={formatMetric(overview?.total_members)} tone={primary} theme={theme} />
            <StatTile label={t('detail.analytics.metrics.activeMembers')} value={formatMetric(engagement?.active_members)} tone={theme.success} theme={theme} />
            <StatTile
              label={t('detail.analytics.metrics.participation')}
              value={formatMetric((engagement?.participation_rate ?? 0) / 100, { style: 'percent', maximumFractionDigits: 0 })}
              tone="#f59e0b"
              theme={theme}
            />
            <StatTile label={t('detail.analytics.metrics.postsPerDay')} value={formatMetric(engagement?.avg_posts_per_day, { maximumFractionDigits: 1 })} tone="#0ea5e9" theme={theme} />
          </View>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <SectionTitle title={t('detail.analytics.activity')} />
              <View className="flex-row flex-wrap gap-2">
                {(['discussions', 'posts', 'events', 'files', 'member_joins'] as const).map((key) => (
                  <Chip key={key} size="sm" variant="secondary" color="default">
                    <Chip.Label>{t(`detail.analytics.breakdown.${key}`, { count: activity?.[key] ?? 0 })}</Chip.Label>
                  </Chip>
                ))}
              </View>
              <View className="gap-2">
                <Text className="text-sm" style={{ color: theme.textSecondary }}>
                  {t('detail.analytics.latestGrowth', {
                    count: latestGrowth?.new_members ?? 0,
                    total: latestGrowth?.total_members ?? overview?.total_members ?? 0,
                  })}
                </Text>
                <Text className="text-sm" style={{ color: theme.textSecondary }}>
                  {t('detail.analytics.latestEngagement', {
                    posts: latestEngagement?.posts ?? 0,
                    discussions: latestEngagement?.discussions ?? 0,
                    active: latestEngagement?.active_members ?? 0,
                  })}
                </Text>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <View className="flex-row flex-wrap gap-3">
            <StatTile
              label={t('detail.analytics.metrics.retention')}
              value={formatMetric((latestRetention?.retention_rate ?? 0) / 100, { style: 'percent', maximumFractionDigits: 0 })}
              tone="#14b8a6"
              theme={theme}
            />
            <StatTile
              label={t('detail.analytics.metrics.rank')}
              value={comparative ? t('detail.analytics.rankValue', { rank: comparative.rank, total: comparative.total_groups }) : '-'}
              tone="#a855f7"
              theme={theme}
            />
          </View>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <SectionTitle title={t('detail.analytics.retention')} />
              {retention.length === 0 ? (
                <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.analytics.noRetention')}</Text>
              ) : (
                retention.slice(-6).map((cohort) => (
                  <Surface key={cohort.month} variant="secondary" className="gap-2 rounded-panel-inner p-3">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }}>{cohort.month}</Text>
                      <Text className="text-sm font-semibold" style={{ color: primary }}>
                        {formatMetric((cohort.retention_rate ?? 0) / 100, { style: 'percent', maximumFractionDigits: 0 })}
                      </Text>
                    </View>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {t('detail.analytics.retentionDetail', { joined: cohort.joined, active: cohort.still_active })}
                    </Text>
                  </Surface>
                ))
              )}
            </HeroCard.Body>
          </HeroCard>

          {comparative ? (
            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-3 p-4">
                <SectionTitle title={t('detail.analytics.comparative')} />
                <View className="flex-row flex-wrap gap-2">
                  <Chip size="sm" variant="secondary" color="default">
                    <Chip.Label>{t('detail.analytics.comparison.members', { count: comparative.group_members })}</Chip.Label>
                  </Chip>
                  <Chip size="sm" variant="secondary" color="default">
                    <Chip.Label>{t('detail.analytics.comparison.average', { count: comparative.avg_members })}</Chip.Label>
                  </Chip>
                  <Chip size="sm" variant="secondary" color="default">
                    <Chip.Label>{t('detail.analytics.comparison.percentile', { count: comparative.percentile })}</Chip.Label>
                  </Chip>
                </View>
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <SectionTitle title={t('detail.analytics.contributors')} />
              {dashboard.top_contributors.length === 0 ? (
                <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.analytics.noContributors')}</Text>
              ) : (
                dashboard.top_contributors.slice(0, 5).map((contributor) => (
                  <View key={contributor.user_id} className="flex-row items-center gap-3">
                    <Avatar uri={contributor.avatar_url ?? undefined} name={contributor.name} size={38} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                        {contributor.name}
                      </Text>
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>
                        {t('detail.analytics.postCount', { count: contributor.post_count })}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <SectionTitle title={t('detail.analytics.content')} />
              {dashboard.content_performance.length === 0 ? (
                <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.analytics.noContent')}</Text>
              ) : (
                dashboard.content_performance.slice(0, 5).map((item) => (
                  <Surface key={item.id} variant="secondary" className="gap-2 rounded-panel-inner p-3">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                      {[
                        item.author_name,
                        formatDate(item.created_at),
                        t('detail.analytics.replies', { count: item.reply_count }),
                        t('detail.analytics.participants', { count: item.unique_participants }),
                      ].filter(Boolean).join(' - ')}
                    </Text>
                  </Surface>
                ))
              )}
            </HeroCard.Body>
          </HeroCard>
        </>
      )}
    </View>
  );
}

function GroupMarketplacePanel({ groupId, canView }: { groupId: number; canView: boolean }) {
  const { t } = useTranslation(['groups', 'marketplace', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [items, setItems] = useState<MarketplaceListingItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statsApi = useApi(() => getGroupMarketplaceStats(groupId), [groupId], { enabled: canView });
  const stats = statsApi.data?.data;

  const loadListings = useCallback(async (append = false, categoryId = selectedCategory) => {
    if (!canView) return;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);

    try {
      const response = await getGroupMarketplaceListings(groupId, {
        category_id: categoryId,
        cursor: append ? cursor : null,
        limit: 20,
        sort: 'newest',
      });
      setCursor(marketplaceNextCursor(response));
      setHasMore(marketplaceHasMore(response));
      setItems((current) => append ? [...current, ...response.data] : response.data);
    } catch (err) {
      if (!append) setError(err instanceof Error ? err.message : t('detail.marketplace.loadFailed'));
      else showToast({ title: t('common:errors.alertTitle'), description: t('detail.marketplace.loadMoreFailed'), variant: 'danger' });
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [canView, cursor, groupId, selectedCategory, showToast, t]);

  useEffect(() => {
    void loadListings(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, selectedCategory, canView]);

  function chooseCategory(category: MarketplaceCategory | null) {
    setCursor(null);
    setSelectedCategory(category?.id ?? null);
  }

  async function toggleSave(item: MarketplaceListingItem) {
    const nextSaved = !item.is_saved;
    setItems((current) => current.map((listing) => listing.id === item.id ? { ...listing, is_saved: nextSaved } : listing));
    try {
      if (nextSaved) await saveMarketplaceListing(item.id);
      else await unsaveMarketplaceListing(item.id);
    } catch {
      setItems((current) => current.map((listing) => listing.id === item.id ? item : listing));
      showToast({ title: t('common:errors.alertTitle'), description: t('marketplace:common.save_failed'), variant: 'danger' });
    }
  }

  if (!canView) {
    return <EmptyCard icon="lock-closed-outline" message={t('detail.marketplace.joinToView')} />;
  }

  return (
    <View className="gap-3">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="bag-handle-outline" size={23} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('detail.marketplace.title')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('detail.marketplace.subtitle')}</Text>
            </View>
          </View>

          {stats ? (
            <View className="flex-row flex-wrap gap-2">
              <StatusChip icon="cube-outline" label={t('detail.marketplace.active', { count: stats.active_listings ?? 0 })} color={primary} />
              <StatusChip icon="pricetag-outline" label={t('detail.marketplace.total', { count: stats.total_listed ?? 0 })} color={theme.success} />
              <StatusChip icon="people-outline" label={t('detail.marketplace.sellers', { count: stats.total_sellers ?? 0 })} color={theme.textMuted} />
            </View>
          ) : statsApi.isLoading ? <Spinner size="sm" /> : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            <HeroButton size="sm" variant={selectedCategory === null ? 'primary' : 'secondary'} onPress={() => chooseCategory(null)}>
              <HeroButton.Label>{t('marketplace:filters.allCategories')}</HeroButton.Label>
            </HeroButton>
            {(stats?.categories ?? []).map((category) => (
              <HeroButton key={category.id} size="sm" variant={selectedCategory === category.id ? 'primary' : 'secondary'} onPress={() => chooseCategory(category)}>
                <HeroButton.Label>{category.name}</HeroButton.Label>
              </HeroButton>
            ))}
          </ScrollView>

          <HeroButton variant="secondary" onPress={() => router.push({ pathname: '/(modals)/new-marketplace-listing', params: { group_id: String(groupId) } } as never)}>
            <Ionicons name="add-outline" size={16} color={primary} />
            <HeroButton.Label>{t('detail.marketplace.sellToGroup')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>

      {isLoading ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="min-h-[140px] items-center justify-center">
            <Spinner size="md" />
          </HeroCard.Body>
        </HeroCard>
      ) : items.length === 0 ? (
        <EmptyCard icon="bag-handle-outline" message={error ?? t('detail.marketplace.empty')} />
      ) : (
        <>
          {items.map((item) => (
            <MarketplaceListingCard
              key={item.id}
              item={item}
              onPress={() => router.push({ pathname: '/(modals)/marketplace-detail', params: { id: String(item.id) } } as never)}
              onSavePress={() => void toggleSave(item)}
            />
          ))}
          {hasMore ? (
            <HeroButton variant="secondary" isDisabled={isLoadingMore} onPress={() => void loadListings(true)}>
              {isLoadingMore ? <Spinner size="sm" /> : <HeroButton.Label>{t('marketplace:loadMore')}</HeroButton.Label>}
            </HeroButton>
          ) : null}
        </>
      )}
    </View>
  );
}
