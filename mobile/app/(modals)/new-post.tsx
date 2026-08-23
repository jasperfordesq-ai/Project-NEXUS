// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Write a post to the community feed.
 *
 * 🔴 Journey 2.9 was BROKEN because no capability existed at all: the server has had
 * `POST /v2/feed/posts` throughout and the website has a composer, but this app had no
 * `createPost`, no composer screen and no way in. A member could read every post their
 * community wrote and never answer one.
 *
 * Deliberately narrower than the website's composer, and matching it where it counts:
 *   - No visibility picker. The website's post tab sends no visibility either, so both
 *     clients post to the community and neither invents a control the other lacks.
 *   - No image or poll. Those are separate server paths (multipart upload, poll create)
 *     and each deserves its own walk rather than being bolted on untested.
 *   - The length limit is the server's `FeedService::MAX_POST_LENGTH`, so submit is
 *     refused here rather than losing the member's words to a 422.
 *
 * A published post appears immediately, EXCEPT when the server's spam check flags it —
 * then it goes to moderation. That is why the success toast says the post was created
 * and does not promise the member their community can already see it.
 */

import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { Ionicons } from '@/components/ui/Icon';
import { useAppToast } from '@/components/ui/AppToast';
import FormActionFooter from '@/components/ui/FormActionFooter';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import TextArea from '@/components/ui/TextArea';
import { createPost, MAX_POST_LENGTH } from '@/lib/api/feed';
import { markFeedStale } from '@/lib/feedRefreshSignal';
import * as Haptics from '@/lib/haptics';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';
import { withAlpha } from '@/lib/utils/color';

/** The counter is noise until a post is genuinely long, so it appears near the limit. */
const COUNTER_VISIBLE_FROM = Math.floor(MAX_POST_LENGTH * 0.9);

export default function NewPostRoute() {
  return (
    <ModalErrorBoundary>
      <NewPostScreen />
    </ModalErrorBoundary>
  );
}

function NewPostScreen() {
  const { t } = useTranslation(['home', 'common']);
  const { hasModule } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmed = content.trim();
  const isTooLong = content.length > MAX_POST_LENGTH;
  const counter = useMemo(() => {
    const format = new Intl.NumberFormat(dateLocale());
    return `${format.format(content.length)} / ${format.format(MAX_POST_LENGTH)}`;
  }, [content.length]);

  // A community can switch its feed off. The entry points are hidden then, but a deep
  // link still lands here, and a post written into a feed nobody can open is worse than
  // being told plainly that there is nothing to post to.
  const feedEnabled = hasModule('feed');

  async function submit() {
    if (!trimmed) {
      showToast({ title: t('home:newPost.empty'), variant: 'warning' });
      return;
    }
    if (isTooLong) return;

    setIsSubmitting(true);
    let destination: Parameters<typeof router.push>[0] | null = null;
    try {
      const created = await createPost({ content: trimmed });
      const id = created?.data?.id;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The feed reader is holding a list that no longer has everything in it.
      markFeedStale();
      showToast({ title: t('home:newPost.created'), variant: 'success' });
      destination = id
        ? { pathname: '/(modals)/feed-item-detail', params: { id: String(id), type: 'post' } }
        : ('/(tabs)/home' as Href);
    } catch (error) {
      showToast({
        title: t('home:newPost.failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'danger',
      });
    } finally {
      setIsSubmitting(false);
    }

    if (destination) {
      setTimeout(() => {
        if (typeof router.replace === 'function') router.replace(destination);
        else router.push(destination);
      }, 0);
    }
  }

  return (
    <SafeAreaView
      testID="new-post-screen"
      className="flex-1 bg-background"
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <AppTopBar
        title={t('home:newPost.title')}
        backLabel={t('common:buttons.back')}
        fallbackHref={'/(tabs)/home' as Href}
      />
      {!feedEnabled ? (
        <View className="flex-1 px-4 py-8" style={{ flex: 1 }}>
          <EmptyState
            icon="create-outline"
            title={t('common:errors.notFound')}
            subtitle={t('home:feed.emptySubtitle')}
          />
        </View>
      ) : (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          testID="new-post-scroll"
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, gap: 14, padding: 16, paddingBottom: 140, backgroundColor: theme.bg }}
          keyboardShouldPersistTaps="handled"
        >
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View
                  className="size-12 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: withAlpha(primary, 0.14) }}
                >
                  <Ionicons name="create-outline" size={24} color={primary} />
                </View>
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-xs font-semibold uppercase text-muted-foreground">
                    {t('home:feed.title')}
                  </Text>
                  <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                    {t('home:composer.title')}
                  </Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard variant="secondary" className="rounded-panel p-0">
            <HeroCard.Body className="gap-2 p-4">
              <TextArea
                testID="new-post-content"
                value={content}
                onChangeText={setContent}
                placeholder={t('home:newPost.placeholder')}
                accessibilityLabel={t('home:newPost.placeholder')}
                numberOfLines={8}
                style={{ minHeight: 180 }}
                containerClassName="mb-0"
                autoFocus
              />
              {content.length >= COUNTER_VISIBLE_FROM ? (
                <Text
                  testID="new-post-counter"
                  className="text-right text-xs font-semibold"
                  style={{ color: isTooLong ? theme.error : theme.textSecondary }}
                >
                  {counter}
                </Text>
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        </ScrollView>
        <FormActionFooter
          title={t('home:newPost.title')}
          subtitle={t('home:composer.title')}
          submitLabel={t('home:newPost.submit')}
          secondaryLabel={t('common:buttons.cancel')}
          icon="send-outline"
          primary={primary}
          isSubmitting={isSubmitting}
          /*
            Only the over-length case is refused at the button, because the red counter
            directly above it says why. An empty post keeps the button live and answers
            with a toast — the same convention as the other create screens, and it tells
            the member something rather than presenting an inert control.
          */
          isDisabled={isTooLong}
          onSubmit={() => void submit()}
          onSecondary={() => router.back()}
        />
      </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
