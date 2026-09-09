// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One group discussion, opened for reading and replying.
 *
 * 🔴 Why this screen exists. Until now the Discussion tab of a group listed titles and
 * reply counts and stopped there: the cards were not pressable, `lib/api/groups.ts` had no
 * function for either of the two endpoints that serve a thread, and no screen consumed
 * them. A member could START a discussion and then never read a single answer to it —
 * including their own. The strings for this screen (`detail.discussionReplies.*`) were
 * already translated into all seven languages, which suggests the screen was planned and
 * then lost. Found by the 2026-09-07 audit; the endpoints are `routes/api.php:663-666`.
 *
 * Paging note: the API walks BACKWARDS from the newest reply, so a further page holds
 * OLDER replies. They are prepended, and the control says "Show earlier replies" rather
 * than the usual "Load more".
 */

import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusalStatus } from '@/lib/api/refusal';
import {
  getGroupDiscussionThread,
  postGroupDiscussionMessage,
  type GroupDiscussionMessage,
} from '@/lib/api/groups';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';
import { toPlainText } from '@/lib/utils/plainText';
import { withRouteGate } from '@/components/withRouteGate';

/** Replies are stored as sanitised HTML by the web composer — never render it raw. */
function formatWhen(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(dateLocale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The frame every state of this screen shares.
 *
 * 🔴 Declared at module scope on purpose. Defined inside the screen it would be a NEW
 * component type on every render, so React would unmount and remount the whole subtree —
 * and the reply box would lose focus after each character typed.
 */
function DiscussionShell({
  title,
  backLabel,
  backHref,
  background,
  children,
}: {
  title: string;
  backLabel: string;
  backHref: Href;
  background: string;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['top']}>
      <AppTopBar title={title} backLabel={backLabel} fallbackHref={backHref} />
      {children}
    </SafeAreaView>
  );
}

function GroupDiscussionScreen() {
  return (
    <ModalErrorBoundary>
      <GroupDiscussionScreenInner />
    </ModalErrorBoundary>
  );
}

function GroupDiscussionScreenInner() {
  const { t } = useTranslation(['groups', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();

  const { id, discussionId } = useLocalSearchParams<{ id: string; discussionId: string }>();
  const groupId = Number(id);
  const threadId = Number(discussionId);
  const safeGroupId = Number.isFinite(groupId) && groupId > 0 ? groupId : 0;
  const safeThreadId = Number.isFinite(threadId) && threadId > 0 ? threadId : 0;
  const isValidId = safeGroupId > 0 && safeThreadId > 0;

  const { data, isLoading, error, errorStatus, refresh } = useApi(
    () => getGroupDiscussionThread(safeGroupId, safeThreadId),
    [safeGroupId, safeThreadId],
    { enabled: isValidId },
  );

  /** Replies fetched by "show earlier", oldest-first, sitting before the first page. */
  const [earlier, setEarlier] = useState<GroupDiscussionMessage[]>([]);
  /** Replies this member posted in this sitting, sitting after the first page. */
  const [posted, setPosted] = useState<GroupDiscussionMessage[]>([]);
  /** `undefined` until "show earlier" has been used at least once. */
  const [pagedCursor, setPagedCursor] = useState<string | null | undefined>(undefined);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const discussion = data?.data?.discussion ?? null;
  const firstPage = useMemo(() => data?.data?.messages ?? [], [data]);
  const messages = useMemo(
    () => [...earlier, ...firstPage, ...posted],
    [earlier, firstPage, posted],
  );

  const baseCursor = data?.meta?.has_more ? (data.meta.cursor ?? null) : null;
  const nextCursor = pagedCursor === undefined ? baseCursor : pagedCursor;

  const handleRefresh = useCallback(() => {
    setEarlier([]);
    setPosted([]);
    setPagedCursor(undefined);
    refresh();
  }, [refresh]);

  async function handleShowEarlier() {
    if (loadingEarlier || !nextCursor) return;
    setLoadingEarlier(true);
    try {
      const page = await getGroupDiscussionThread(safeGroupId, safeThreadId, nextCursor);
      setEarlier((prev) => [...page.data.messages, ...prev]);
      setPagedCursor(page.meta.has_more ? (page.meta.cursor ?? null) : null);
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: describeApiError(err, t('detail.discussionReplies.loadError')),
        variant: 'danger',
      });
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function handleSend() {
    if (sending) return;
    const content = draft.trim();
    if (!content) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: t('detail.discussionReplies.validation'),
        variant: 'warning',
      });
      return;
    }
    setSending(true);
    try {
      const created = await postGroupDiscussionMessage(safeGroupId, safeThreadId, { content });
      setPosted((prev) => [...prev, created.data]);
      setDraft('');
    } catch (err) {
      // The server's own reason has to reach the member here: a closed discussion (409),
      // a membership that ended (403) and a deleted thread (404) all need different
      // actions from them, and a fixed sentence would hide which happened.
      showToast({
        title: t('common:errors.alertTitle'),
        description: describeApiError(err, t('detail.discussionReplies.postError')),
        variant: 'danger',
      });
    } finally {
      setSending(false);
    }
  }

  // The top bar stays generic and the opening post carries the real title. A discussion
  // title is a whole sentence — in the bar it would be truncated to a few words, and
  // repeating it directly above the card that already shows it in full reads as a bug.
  const title = t('detail.discussionReplies.title');
  const backHref = (safeGroupId > 0
    ? `/(modals)/group-detail?id=${safeGroupId}&tab=discussion`
    : '/(modals)/groups') as Href;

  const shellProps = {
    title,
    backLabel: t('common:buttons.back'),
    backHref,
    background: theme.bg,
  };

  if (!isValidId) {
    return (
      <DiscussionShell {...shellProps}>
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title={t('detail.discussionReplies.unavailable')}
          actionLabel={t('detail.goBack')}
          onAction={() => router.back()}
          testID="group-discussion-invalid"
        />
      </DiscussionShell>
    );
  }

  // A refusal is not a failure. Retry can never turn a 403 or a 404 into a thread, so
  // these two say what happened and offer the way back instead (audit 2026-09-07).
  // One list of refusal statuses for the whole app — see lib/api/refusal.ts.
  if (error && !discussion && isRefusalStatus(errorStatus)) {
    return (
      <DiscussionShell {...shellProps}>
        <EmptyState
          icon={errorStatus === 403 ? 'lock-closed-outline' : 'chatbubble-ellipses-outline'}
          title={
            errorStatus === 403
              ? t('detail.discussionReplies.noAccess')
              : t('detail.discussionReplies.unavailable')
          }
          subtitle={error}
          actionLabel={t('detail.goBack')}
          onAction={() => router.back()}
          testID={errorStatus === 403 ? 'group-discussion-forbidden' : 'group-discussion-missing'}
        />
      </DiscussionShell>
    );
  }

  if (error && !discussion) {
    return (
      <DiscussionShell {...shellProps}>
        <ErrorState
          title={t('detail.discussionReplies.loadError')}
          subtitle={error}
          onRetry={handleRefresh}
          isRetrying={isLoading}
          testID="group-discussion-error"
        />
      </DiscussionShell>
    );
  }

  return (
    <DiscussionShell {...shellProps}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={handleRefresh}
              tintColor={primary}
              colors={[primary]}
            />
          }
        >
          {isLoading && !discussion ? (
            <View className="min-h-[160px] items-center justify-center">
              <Spinner size="md" />
            </View>
          ) : null}

          {discussion ? (
            <HeroCard className="rounded-panel p-0" testID="group-discussion-opening-post">
              <HeroCard.Body className="gap-3 p-4">
                <View className="flex-row items-start justify-between gap-3">
                  <Text
                    className="min-w-0 flex-1 text-lg font-semibold"
                    style={{ color: theme.text }}
                  >
                    {discussion.title}
                  </Text>
                  {discussion.is_pinned ? (
                    <Chip size="sm" variant="secondary" color="warning">
                      <Chip.Label>{t('detail.pinned')}</Chip.Label>
                    </Chip>
                  ) : null}
                </View>
                <View className="flex-row items-center gap-3">
                  <Avatar
                    uri={discussion.author?.avatar_url ?? undefined}
                    name={discussion.author?.name ?? '?'}
                    size={32}
                  />
                  <View className="min-w-0 flex-1">
                    <Text
                      className="text-sm font-medium"
                      style={{ color: theme.text }}
                      numberOfLines={1}
                    >
                      {discussion.author?.name ?? t('common:unknown')}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {formatWhen(discussion.created_at)}
                    </Text>
                  </View>
                </View>
                {toPlainText(discussion.content) ? (
                  <Text className="text-sm leading-5" style={{ color: theme.text }}>
                    {toPlainText(discussion.content)}
                  </Text>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          {nextCursor ? (
            <HeroButton
              variant="tertiary"
              isDisabled={loadingEarlier}
              onPress={handleShowEarlier}
              testID="group-discussion-show-earlier"
            >
              <HeroButton.Label>
                {loadingEarlier
                  ? t('common:loading')
                  : t('detail.discussionReplies.showEarlier')}
              </HeroButton.Label>
            </HeroButton>
          ) : null}

          {discussion && messages.length === 0 ? (
            <EmptyState
              icon="chatbubble-outline"
              title={t('detail.discussionReplies.empty')}
              testID="group-discussion-empty"
            />
          ) : null}

          {messages.map((message) => (
            <HeroCard key={message.id} className="rounded-panel p-0">
              <HeroCard.Body className="gap-2 p-4">
                <View className="flex-row items-center gap-3">
                  <Avatar
                    uri={message.author?.avatar_url ?? undefined}
                    name={message.author?.name ?? '?'}
                    size={28}
                  />
                  <View className="min-w-0 flex-1">
                    <Text
                      className="text-sm font-medium"
                      style={{ color: theme.text }}
                      numberOfLines={1}
                    >
                      {message.author?.name ?? t('common:unknown')}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {formatWhen(message.created_at)}
                    </Text>
                  </View>
                </View>
                <Text className="text-sm leading-5" style={{ color: theme.text }}>
                  {toPlainText(message.content)}
                </Text>
              </HeroCard.Body>
            </HeroCard>
          ))}
        </ScrollView>

        <View
          className="gap-2 border-t px-4 pb-4 pt-3"
          style={{ borderTopColor: theme.borderSubtle, backgroundColor: theme.bg }}
        >
          <TextArea
            value={draft}
            onChangeText={setDraft}
            placeholder={t('detail.discussionReplies.placeholder')}
            numberOfLines={3}
            editable={!sending}
            containerClassName="mb-0"
            testID="group-discussion-reply-input"
          />
          <HeroButton
            isDisabled={sending || draft.trim().length === 0}
            onPress={handleSend}
            testID="group-discussion-reply-send"
          >
            <HeroButton.Label>
              {sending ? t('detail.discussionReplies.posting') : t('detail.discussionReplies.post')}
            </HeroButton.Label>
          </HeroButton>
        </View>
      </KeyboardAvoidingView>
    </DiscussionShell>
  );
}

export default withRouteGate(GroupDiscussionScreen, 'group-discussion');
