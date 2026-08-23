// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { BottomSheetFlatList, BottomSheetFooter, type BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { Ionicons } from '@/components/ui/Icon';
import { BottomSheet as HeroBottomSheet, Button as HeroButton, Spinner, Surface, useBottomSheetAwareHandlers } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRootBottomInset } from '@/lib/ui/rootInsets';
import * as Haptics from '@/lib/haptics';

import Avatar from '@/components/ui/Avatar';
import TextArea from '@/components/ui/TextArea';
import ActionSheet from '@/components/ui/ActionSheet';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useDeferredBottomSheetState } from '@/components/ui/useDeferredBottomSheetState';
import {
  deleteComment,
  editComment,
  getComments,
  normalizeCommentReactions,
  submitComment,
  toggleCommentReaction,
  type CommentItem,
  type CommentTargetType,
} from '@/lib/api/comments';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { formatRelativeTime } from '@/lib/utils/formatRelativeTime';
import AccentIcon from '@/components/ui/AccentIcon';

const MAX_COMMENT_LENGTH = 10000;
const COUNTER_VISIBLE_FROM = 9000;
/** Replies are allowed on depth 0 and 1 only (matches web CommentsSection). */
const MAX_REPLY_DEPTH = 2;

interface CommentSheetStrings {
  title: string;
  placeholder: string;
  empty: string;
  loadFailed: string;
  submitFailed: string;
  actionFailedTitle: string;
  send: string;
  authorFallback: string;
  reply: string;
  /** Template containing a literal `{name}` token, e.g. "Replying to {name}". */
  replyingTo: string;
  edit: string;
  editing: string;
  delete: string;
  deleteConfirmTitle: string;
  deleteConfirmMessage: string;
  edited: string;
  cancel: string;
  like: string;
  editFailed: string;
  deleteFailed: string;
}

interface CommentSheetProps {
  visible: boolean;
  targetType: CommentTargetType;
  targetId: number;
  initialCount?: number;
  strings: CommentSheetStrings;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}

interface FlatComment extends CommentItem {
  depth: number;
}

export default function CommentSheet({
  visible,
  targetType,
  targetId,
  initialCount = 0,
  strings,
  onClose,
  onCountChange,
}: CommentSheetProps) {
  const primary = usePrimaryColor();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedTargetKey, setLoadedTargetKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{ id: number; name: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: number } | null>(null);
  const [actionComment, setActionComment] = useState<FlatComment | null>(null);
  const { mounted: sheetMounted, open: sheetOpen, shouldHonorClose } = useDeferredBottomSheetState(visible);
  const targetKey = `${targetType}-${targetId}`;
  // Android modal screens report bottom inset 0 — floor with the root inset
  // so the composer footer clears the system navigation bar.
  const footerBottomInset = Math.max(0, insets.bottom, getRootBottomInset());
  const composerBottomPadding = 12;
  const listBottomPadding = 112 + footerBottomInset;

  const flattenedComments = useMemo(() => flattenComments(comments), [comments]);

  const loadSheetComments = useCallback(async (force = false) => {
    if (!visible || isLoading || (!force && loadedTargetKey === targetKey)) return;
    setIsLoading(true);
    try {
      const response = await getComments(targetType, targetId);
      const payload = ('data' in response && response.data ? response.data : response) as { comments?: CommentItem[]; count?: number };
      const nextComments = payload.comments ?? [];
      const nextCount = payload.count ?? countComments(nextComments);
      setComments(nextComments);
      setLoadedTargetKey(targetKey);
      onCountChange?.(nextCount);
    } catch {
      showToast({
        title: strings.actionFailedTitle,
        description: strings.loadFailed,
        variant: 'danger',
      });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, loadedTargetKey, onCountChange, showToast, strings.actionFailedTitle, strings.loadFailed, targetId, targetKey, targetType, visible]);

  useEffect(() => {
    if (visible) {
      void loadSheetComments();
    }
  }, [loadSheetComments, visible]);

  useEffect(() => {
    if (!visible) return;
    setDraft('');
    setReplyTarget(null);
    setEditTarget(null);
    setActionComment(null);
  }, [targetKey, visible]);

  async function handleSubmit() {
    const content = draft.trim();
    if (!content || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (editTarget) {
        await editComment(editTarget.id, content);
        setDraft('');
        setEditTarget(null);
      } else {
        await submitComment(targetType, targetId, content, replyTarget?.id);
        setDraft('');
        setReplyTarget(null);
        const optimisticCount = Math.max(initialCount, countComments(comments)) + 1;
        onCountChange?.(optimisticCount);
      }
      await loadSheetComments(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        title: strings.actionFailedTitle,
        description: editTarget ? strings.editFailed : strings.submitFailed,
        variant: 'danger',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function startReply(comment: FlatComment) {
    setEditTarget(null);
    setReplyTarget({ id: comment.id, name: comment.author?.name || strings.authorFallback });
  }

  function startEdit(comment: FlatComment) {
    setReplyTarget(null);
    setEditTarget({ id: comment.id });
    setDraft(stripHtml(comment.content));
  }

  function cancelComposerContext() {
    if (editTarget) setDraft('');
    setReplyTarget(null);
    setEditTarget(null);
  }

  function requestDelete(comment: FlatComment) {
    confirm({
      title: strings.deleteConfirmTitle,
      message: strings.deleteConfirmMessage,
      confirmLabel: strings.delete,
      cancelLabel: strings.cancel,
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteComment(comment.id);
          if (editTarget?.id === comment.id) cancelComposerContext();
          if (replyTarget?.id === comment.id) setReplyTarget(null);
          await loadSheetComments(true);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({
            title: strings.actionFailedTitle,
            description: strings.deleteFailed,
            variant: 'danger',
          });
        }
      },
    });
  }

  function handleToggleLike(comment: FlatComment) {
    const wasLiked = (comment.user_reactions ?? []).includes('like');
    // Optimistic toggle — apply locally first, refetch authoritative state on failure.
    setComments((prev) => updateCommentTree(prev, comment.id, (c) => {
      const reactions = normalizeCommentReactions(c.reactions);
      const userReactions = (c.user_reactions ?? []).filter((type) => type !== 'like');
      if (wasLiked) {
        const next = (reactions.like ?? 0) - 1;
        if (next > 0) reactions.like = next;
        else delete reactions.like;
      } else {
        reactions.like = (reactions.like ?? 0) + 1;
        userReactions.push('like');
      }
      return { ...c, reactions, user_reactions: userReactions };
    }));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleCommentReaction(comment.id, 'like').catch(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      void loadSheetComments(true);
    });
  }

  const composerContextLabel = editTarget
    ? strings.editing
    : replyTarget
      ? strings.replyingTo.replace('{name}', replyTarget.name)
      : null;

  if (!sheetMounted) return null;

  return (
    <>
      <HeroBottomSheet
        isOpen={sheetOpen}
        onOpenChange={(open) => {
          // shouldHonorClose() filters the library's spurious mount-time close
          // event (see useDeferredBottomSheetState) that made the comment sheet
          // need multiple taps to open.
          if (!open && shouldHonorClose()) onClose();
        }}
      >
        <HeroBottomSheet.Portal unstable_accessibilityContainerViewIsModal>
          <HeroBottomSheet.Overlay isCloseOnPress className="bg-black/55" />
          <HeroBottomSheet.Content
            snapPoints={['62%', '90%']}
            enableDynamicSizing={false}
            enableOverDrag={false}
            keyboardBehavior="extend"
            keyboardBlurBehavior="restore"
            contentContainerClassName="h-full bg-background"
            backgroundClassName="rounded-t-[30px] bg-background"
            handleClassName="rounded-t-[30px] bg-background"
            handleIndicatorClassName="bg-muted-foreground/50"
            footerComponent={(footerProps: BottomSheetFooterProps) => (
              <BottomSheetFooter {...footerProps} bottomInset={footerBottomInset} style={{ backgroundColor: theme.bg }}>
                <CommentComposer
                  draft={draft}
                  placeholder={strings.placeholder}
                  primary={primary}
                  sendLabel={strings.send}
                  contextLabel={composerContextLabel}
                  cancelLabel={strings.cancel}
                  isSubmitting={isSubmitting}
                  bottomPadding={composerBottomPadding}
                  onChangeDraft={setDraft}
                  onCancelContext={cancelComposerContext}
                  onSubmit={() => void handleSubmit()}
                />
              </BottomSheetFooter>
            )}
          >
            <View className="flex-1 bg-background" style={{ flex: 1, height: '100%' }}>
              <View className="flex-row items-center justify-between gap-3 border-b border-border px-5 pb-4 pt-2">
                <View className="min-w-0 flex-1">
                  <HeroBottomSheet.Title className="text-xl font-bold text-foreground">
                    {strings.title}
                  </HeroBottomSheet.Title>
                </View>
                <HeroBottomSheet.Close iconProps={{ size: 20 }} />
              </View>

              <BottomSheetFlatList
                data={flattenedComments}
                keyExtractor={(item) => `${item.id}-${item.depth}`}
                keyboardShouldPersistTaps="handled"
                style={{ flex: 1, backgroundColor: theme.bg }}
                contentContainerStyle={{
                  flexGrow: 1,
                  gap: 10,
                  paddingHorizontal: 16,
                  paddingTop: 14,
                  paddingBottom: listBottomPadding,
                }}
                ListEmptyComponent={
                  isLoading ? (
                    <View className="flex-1 items-center justify-center py-12">
                      <Spinner size="sm" />
                    </View>
                  ) : (
                    <Surface variant="secondary" className="items-center gap-3 rounded-panel p-6">
                      <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                        <Ionicons name="chatbubble-ellipses-outline" size={22} color={primary} />
                      </View>
                      <Text className="text-center text-sm text-muted-foreground">{strings.empty}</Text>
                    </Surface>
                  )
                }
                renderItem={({ item }) => (
                  <CommentRow
                    comment={item}
                    authorFallback={strings.authorFallback}
                    editedLabel={strings.edited}
                    replyLabel={strings.reply}
                    likeLabel={strings.like}
                    primary={primary}
                    onReply={startReply}
                    onToggleLike={handleToggleLike}
                    onOpenActions={setActionComment}
                  />
                )}
              />
            </View>
          </HeroBottomSheet.Content>
        </HeroBottomSheet.Portal>
      </HeroBottomSheet>

      <ActionSheet
        visible={actionComment !== null}
        onClose={() => setActionComment(null)}
        actions={
          actionComment
            ? [
                ...(actionComment.depth < MAX_REPLY_DEPTH
                  ? [{ label: strings.reply, icon: 'arrow-undo-outline', onPress: () => startReply(actionComment) }]
                  : []),
                ...(actionComment.is_own
                  ? [
                      { label: strings.edit, icon: 'pencil-outline', onPress: () => startEdit(actionComment) },
                      { label: strings.delete, icon: 'trash-outline', destructive: true, onPress: () => requestDelete(actionComment) },
                    ]
                  : []),
              ]
            : []
        }
      />
      {confirmDialog}
    </>
  );
}

function CommentComposer({
  draft,
  placeholder,
  primary,
  sendLabel,
  contextLabel,
  cancelLabel,
  isSubmitting,
  bottomPadding,
  onChangeDraft,
  onCancelContext,
  onSubmit,
}: {
  draft: string;
  placeholder: string;
  primary: string;
  sendLabel: string;
  contextLabel: string | null;
  cancelLabel: string;
  isSubmitting: boolean;
  bottomPadding: number;
  onChangeDraft: (value: string) => void;
  onCancelContext: () => void;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  const awareHandlers = useBottomSheetAwareHandlers();
  const { onFocus, onBlur } = Platform.OS === 'web'
    ? { onBlur: undefined, onFocus: undefined }
    : awareHandlers;
  const showCounter = draft.length > COUNTER_VISIBLE_FROM;

  return (
    <View className="border-t border-border bg-background" style={{ paddingBottom: bottomPadding }}>
      {contextLabel ? (
        <View className="flex-row items-center gap-2 px-4 pt-2" testID="comment-composer-context">
          <View
            className="flex-row items-center gap-1.5 rounded-full px-3 py-1"
            style={{ backgroundColor: withAlpha(primary, 0.12) }}
          >
            <Text className="max-w-56 text-xs font-medium" style={{ color: primary }} numberOfLines={1}>
              {contextLabel}
            </Text>
            <Pressable
              onPress={onCancelContext}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              testID="comment-composer-context-cancel"
            >
              <Ionicons name="close-circle" size={16} color={primary} />
            </Pressable>
          </View>
        </View>
      ) : null}
      {showCounter ? (
        <View className="flex-row justify-end px-4 pt-1">
          <Text className="text-[11px] text-muted-foreground" testID="comment-composer-counter">
            {`${draft.length.toLocaleString()} / ${MAX_COMMENT_LENGTH.toLocaleString()}`}
          </Text>
        </View>
      ) : null}
      <View className="flex-row items-end gap-2 px-4 pt-3">
        <TextArea
          value={draft}
          onChangeText={onChangeDraft}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          multiline
          maxLength={MAX_COMMENT_LENGTH}
          className="min-h-12 text-sm"
          containerClassName="mb-0 min-w-0 flex-1"
          inputClassName="max-h-28 min-h-12 flex-1 rounded-3xl px-4 py-3"
          style={{ color: theme.text, textAlignVertical: 'top' }}
          accessibilityLabel={placeholder}
        />
        <HeroButton
          isIconOnly
          variant="primary"
          isDisabled={isSubmitting || !draft.trim()}
          accessibilityLabel={sendLabel}
          onPress={onSubmit}
          className="h-12 w-12 rounded-full"
        >
          {isSubmitting ? <Spinner size="sm" /> : <AccentIcon name="send" size={18} />}
        </HeroButton>
      </View>
    </View>
  );
}

function CommentRow({
  comment,
  authorFallback,
  editedLabel,
  replyLabel,
  likeLabel,
  primary,
  onReply,
  onToggleLike,
  onOpenActions,
}: {
  comment: FlatComment;
  authorFallback: string;
  editedLabel: string;
  replyLabel: string;
  likeLabel: string;
  primary: string;
  onReply: (comment: FlatComment) => void;
  onToggleLike: (comment: FlatComment) => void;
  onOpenActions: (comment: FlatComment) => void;
}) {
  const theme = useTheme();
  const author = comment.author ?? { id: 0, name: authorFallback, avatar_url: null };
  const marginLeft = Math.min(comment.depth, 2) * 20;
  const reactions = normalizeCommentReactions(comment.reactions);
  const reactionTotal = Object.values(reactions).reduce((sum, count) => sum + count, 0);
  const liked = (comment.user_reactions ?? []).includes('like');

  // Hold-to-act detection. We deliberately do NOT pass onLongPress — with
  // reanimated-wrapped pressables, supplying onLongPress broke quick-tap
  // classification (see FeedItem handleLikePressIn/Out for the verified
  // pattern). We time the press ourselves from onPressIn/onPressOut and open
  // the action sheet mid-hold; onPress is skipped when the hold already fired.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFiredRef = useRef(false);

  function handleRowPressIn() {
    holdFiredRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      holdFiredRef.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onOpenActions(comment);
    }, 450);
  }

  function handleRowPressOut() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function handleRowPress() {
    if (holdFiredRef.current) {
      // The hold already opened the action sheet — releasing the finger must
      // not ALSO count as a tap.
      holdFiredRef.current = false;
    }
  }

  return (
    <View style={{ marginLeft }}>
      <Pressable
        onPress={handleRowPress}
        onPressIn={handleRowPressIn}
        onPressOut={handleRowPressOut}
        testID={`comment-row-${comment.id}`}
      >
        <Surface variant="secondary" className="rounded-panel p-3.5">
          <View className="flex-row items-start gap-3">
            <Avatar uri={author.avatar_url ?? author.avatar ?? null} name={author.name || authorFallback} size={34} />
            <View className="min-w-0 flex-1 gap-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                  {author.name || authorFallback}
                </Text>
                {comment.created_at ? (
                  <Text className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(comment.created_at, true)}
                  </Text>
                ) : null}
                {comment.edited ? (
                  <Text className="text-[11px] italic text-muted-foreground" testID={`comment-edited-${comment.id}`}>
                    {editedLabel}
                  </Text>
                ) : null}
              </View>
              <Text className="text-sm leading-5 text-muted-foreground">
                {stripHtml(comment.content)}
              </Text>
              <View className="mt-1 flex-row items-center gap-4">
                <Pressable
                  onPress={() => onToggleLike(comment)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={likeLabel}
                  accessibilityState={{ selected: liked }}
                  testID={`comment-like-${comment.id}`}
                  className="flex-row items-center gap-1"
                >
                  <Ionicons
                    name={liked ? 'heart' : 'heart-outline'}
                    size={15}
                    color={liked ? primary : theme.textMuted}
                  />
                  {reactionTotal > 0 ? (
                    <Text className="text-xs font-medium" style={{ color: liked ? primary : theme.textMuted }}>
                      {reactionTotal}
                    </Text>
                  ) : null}
                </Pressable>
                {comment.depth < MAX_REPLY_DEPTH ? (
                  <Pressable
                    onPress={() => onReply(comment)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={replyLabel}
                    testID={`comment-reply-${comment.id}`}
                  >
                    <Text className="text-xs font-semibold text-muted-foreground">{replyLabel}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        </Surface>
      </Pressable>
    </View>
  );
}

function flattenComments(comments: CommentItem[], depth = 0): FlatComment[] {
  return comments.flatMap((comment) => [
    { ...comment, depth },
    ...flattenComments(comment.replies ?? [], depth + 1),
  ]);
}

function countComments(comments: CommentItem[]): number {
  return comments.reduce((count, comment) => count + 1 + countComments(comment.replies ?? []), 0);
}

function updateCommentTree(
  comments: CommentItem[],
  commentId: number,
  updater: (comment: CommentItem) => CommentItem,
): CommentItem[] {
  return comments.map((comment) => {
    if (comment.id === commentId) return updater(comment);
    if (comment.replies?.length) {
      return { ...comment, replies: updateCommentTree(comment.replies, commentId, updater) };
    }
    return comment;
  });
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
