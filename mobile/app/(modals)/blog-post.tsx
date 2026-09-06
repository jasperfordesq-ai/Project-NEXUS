// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import ErrorState from '@/components/ui/ErrorState';
import { buildWebUrl } from '@/lib/utils/webUrl';
import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { getBlogPost, type BlogPost } from '@/lib/api/blog';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import AppTopBar from '@/components/ui/AppTopBar';
import { Chip } from '@/components/ui/StatusChip';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';
import CommentSheet from '@/components/comments/CommentSheet';


function ActionPill({
  label,
  icon,
  onPress,
  primary,
  accessibilityLabel,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();

  return (
    <HeroButton
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
      size="sm"
      variant="secondary"
      style={{
        backgroundColor: withAlpha(primary, 0.12),
        borderWidth: 1,
        borderColor: withAlpha(primary, 0.22),
      }}
    >
      <Ionicons name={icon} size={16} color={primary} />
      <HeroButton.Label className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
    </HeroButton>
  );
}

export default function BlogPostScreen() {
  const { t } = useTranslation(['blog', 'home', 'exchanges', 'common']);
  const { id, openComments, commentId } = useLocalSearchParams<{ id: string; openComments?: string; commentId?: string }>();
  const primary = usePrimaryColor();
  const { tenant } = useTenant();
  const theme = useTheme();
  const slug = id?.trim() || '';
  const [commentsVisible, setCommentsVisible] = useState(openComments === '1');

  useEffect(() => {
    if (openComments === '1') setCommentsVisible(true);
  }, [openComments, slug]);

  const handleShare = useCallback(async (sharePost: { title: string; slug: string; excerpt: string | null }) => {
    const url = buildWebUrl(tenant?.slug, `/blog/${sharePost.slug}`);
    const message = sharePost.excerpt
      ? `${sharePost.title}\n\n${sharePost.excerpt}\n\n${url}`
      : `${sharePost.title}\n\n${url}`;
    await Share.share({ message, url });
  }, [tenant?.slug]);

  const { data, isLoading, error: postError, refresh } = useApi(
    () => getBlogPost(slug),
    [slug],
    { enabled: slug.length > 0 },
  );

  const post: BlogPost | null = data?.data ?? null;

  if (!slug) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref="/(modals)/blog" />
        <EmptyState
          icon="newspaper-outline"
          title={t('detail.invalidId')}
          subtitle={t('detail.invalidIdHint')}
          actionLabel={t('detail.backToBlog')}
          onAction={() => router.replace('/(modals)/blog')}
        />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref="/(modals)/blog" />
          <View className="flex-1 items-center justify-center" style={{ flex: 1 }}>
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  /*
    🔴 S5: a dropped connection or a 500 rendered the "not found" state, so a member on a
    bad signal was told the post no longer exists — with a button that navigates away from
    it (audit 2026-09-06).
  */
  if (!post && postError) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref="/(modals)/blog" />
        <ErrorState subtitle={postError} onRetry={refresh} isRetrying={isLoading} testID="blog-post-error" />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref="/(modals)/blog" />
        <EmptyState
          icon="newspaper-outline"
          title={t('detail.notFound')}
          subtitle={t('detail.notFoundHint')}
          actionLabel={t('detail.backToBlog')}
          onAction={() => router.replace('/(modals)/blog')}
        />
      </SafeAreaView>
    );
  }

  const publishedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString(dateLocale(), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar
          title={t('detail.title')}
          backLabel={t('common:back')}
          fallbackHref="/(modals)/blog"
          rightAction={{
            accessibilityLabel: t('detail.share'),
            icon: 'share-outline',
            onPress: () => handleShare(post),
          }}
        />
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />
          }
        >
          <HeroCard className="mb-4 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}>
            {post.featured_image ? (
              <Image
                source={{ uri: resolveImageUrl(post.featured_image) ?? post.featured_image }}
                className="h-[240px] w-full"
                resizeMode="cover"
                accessibilityLabel={post.title}
              />
            ) : (
              <View className="h-[150px] w-full items-center justify-center" style={{ backgroundColor: withAlpha(primary, 0.10) }}>
                <View className="size-16 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                  <Ionicons name="newspaper-outline" size={34} color={primary} />
                </View>
              </View>
            )}
            <HeroCard.Body className="gap-5 p-5">
              <View className="flex-row flex-wrap gap-2">
                {post.category ? (
                  <Chip size="sm" variant="secondary">
                    <Ionicons name="folder-open-outline" size={12} color={primary} />
                    <Chip.Label>{post.category.name}</Chip.Label>
                  </Chip>
                ) : null}
                {post.reading_time ? (
                  <Chip size="sm" variant="secondary">
                    <Ionicons name="time-outline" size={12} color={theme.textSecondary} />
                    <Chip.Label>{t('readingTime', { minutes: post.reading_time })}</Chip.Label>
                  </Chip>
                ) : null}
              </View>

              <Text className="text-3xl font-bold" style={{ color: theme.text }} numberOfLines={5}>
                {post.title}
              </Text>

              {post.excerpt ? (
                <Text className="text-base leading-6" style={{ color: theme.textSecondary }}>
                  {post.excerpt}
                </Text>
              ) : null}

              <Surface
                variant="secondary"
                className="gap-3 rounded-panel-inner p-3"
                style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
              >
                <View className="flex-row items-center gap-3">
                <Ionicons name="calendar-outline" size={20} color={theme.textSecondary} />
                <View className="min-w-0 flex-1">
                  {publishedDate ? (
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {t('publishedOn', { date: publishedDate })}
                    </Text>
                  ) : null}
                </View>
                </View>
                <View className="items-start">
                  <ActionPill
                    label={t('detail.share')}
                    icon="share-outline"
                    primary={primary}
                    accessibilityLabel={t('detail.share')}
                    onPress={() => void handleShare(post)}
                  />
                  <ActionPill
                    label={t('home:comment')}
                    icon="chatbubble-outline"
                    primary={primary}
                    onPress={() => setCommentsVisible(true)}
                  />
                </View>
              </Surface>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.1) }}>
            <HeroCard.Body className="gap-4 p-5">
              <SectionTitle icon="document-text-outline" label={t('detail.article')} primary={primary} theme={theme} />
              {post.content ? (
                <Text className="text-base leading-7" style={{ color: theme.text }}>
                  {stripHtml(post.content)}
                </Text>
              ) : post.excerpt ? (
                <>
                  <Text className="text-base leading-7" style={{ color: theme.text }}>
                    {post.excerpt}
                  </Text>
                  <Surface
                    variant="secondary"
                    className="flex-row items-center gap-2 rounded-panel-inner p-3"
                    style={{ borderWidth: 1, borderColor: withAlpha(theme.info ?? primary, 0.16) }}
                  >
                    <Ionicons name="information-circle-outline" size={16} color={theme.info ?? primary} />
                    <Text className="min-w-0 flex-1 text-xs font-medium" style={{ color: theme.info ?? primary }}>
                      {t('detail.readFull')}
                    </Text>
                  </Surface>
                </>
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        </ScrollView>
        <CommentSheet
          visible={commentsVisible}
          targetType="blog"
          targetId={post.id}
          focusCommentId={commentId && /^\d+$/.test(commentId) ? Number(commentId) : null}
          strings={{
            title: t('home:comment'),
            placeholder: t('exchanges:detail.commentPlaceholder'),
            empty: t('exchanges:detail.noComments'),
            loadFailed: t('exchanges:detail.commentsFailed'),
            submitFailed: t('exchanges:detail.commentFailed'),
            actionFailedTitle: t('exchanges:detail.actionFailedTitle'),
            reactionFailed: t('exchanges:detail.likeFailed'),
            send: t('common:buttons.send'),
            authorFallback: t('common:labels.member'),
            reply: t('exchanges:detail.commentReply'),
            replyingTo: t('exchanges:detail.commentReplyingTo'),
            edit: t('common:buttons.edit'),
            editing: t('exchanges:detail.commentEditing'),
            delete: t('common:buttons.delete'),
            deleteConfirmTitle: t('exchanges:detail.commentDeleteTitle'),
            deleteConfirmMessage: t('exchanges:detail.commentDeleteMessage'),
            edited: t('exchanges:detail.commentEdited'),
            cancel: t('common:buttons.cancel'),
            like: t('exchanges:detail.commentLike'),
            editFailed: t('exchanges:detail.commentEditFailed'),
            deleteFailed: t('exchanges:detail.commentDeleteFailed'),
          }}
          onClose={() => setCommentsVisible(false)}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function SectionTitle({
  icon,
  label,
  primary,
  theme,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
        <Ionicons name={icon} size={16} color={primary} />
      </View>
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
