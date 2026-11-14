// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SocialInteractionPanel — shared reactions, share, and comments.
 *
 * This is the canonical React surface for polymorphic social targets
 * (post/listing/event/goal/poll/review/volunteer/challenge/resource/job/blog/discussion).
 *
 * Reactions here are the SAME reactions the item's feed card shows: the panel
 * loads them itself from the one reactions store (useEntityReactions) and uses
 * the feed's own picker and "who reacted" list. It used to keep a separate
 * heart "like" in a different table, fed by `initialLiked` / `initialLikesCount`
 * props that most pages could never fill in, so a like disappeared on reload
 * and never matched the feed.
 */

import { useCallback, useEffect, useState } from 'react';import { AnimatePresence, motion } from '@/lib/motion';
import MessageCircle from 'lucide-react/icons/message-circle';
import { useTranslation } from 'react-i18next';
import { useAuth, useToast } from '@/contexts';
import { useEntityReactions } from '@/hooks/useEntityReactions';
import { useSocialInteractions } from '@/hooks/useSocialInteractions';
import { cn, resolveUserDisplayName } from '@/lib/helpers';
import { CommentsSection } from './CommentsSection';
import { ReactionPicker, type ReactionType } from './ReactionPicker';
import { ReactionSummary } from './ReactionSummary';
import { ShareButton } from './ShareButton';
import { Button } from '@/components/ui/Button';

export interface SocialInteractionPanelProps {
  targetType: string;
  targetId: number;
  /**
   * @deprecated Ignored. The panel loads reaction state itself, so it is right
   * whether or not the page's own endpoint sends like fields.
   */
  initialLiked?: boolean;
  /**
   * Only used for a visitor who is not signed in, who may not ask the
   * members-only reactions store: the bare count to show them. A signed-in
   * member always gets the loaded reactions instead.
   */
  initialLikesCount?: number;
  initialCommentsCount?: number;
  title?: string;
  description?: string | null;
  showShare?: boolean;
  allowComments?: boolean;
  targetOwnerId?: number | string | null;
  defaultShowComments?: boolean;
  className?: string;
  commentsClassName?: string;
  compact?: boolean;
}

const SHAREABLE_TARGET_TYPES = new Set([
  'post',
  'listing',
  'event',
  'poll',
  'job',
  'blog',
  'discussion',
  'goal',
  'challenge',
  'volunteer',
]);

function idsMatch(left: number | string | null | undefined, right: number | string | null | undefined): boolean {
  return left != null && right != null && String(left) === String(right);
}

function hasCommentHash() {
  return typeof window !== 'undefined' && /^#comment-\d+$/.test(window.location.hash);
}

function getUserName(user: ReturnType<typeof useAuth>['user'], fallback: string): string {
  if (!user) return fallback;
  return resolveUserDisplayName(user) || fallback;
}

export function SocialInteractionPanel({
  targetType,
  targetId,
  initialLikesCount = 0,
  initialCommentsCount = 0,
  title,
  description,
  showShare = true,
  allowComments = true,
  targetOwnerId,
  defaultShowComments = false,
  className,
  commentsClassName,
  compact = false,
}: SocialInteractionPanelProps) {
  const { t } = useTranslation('social');
  const { t: tFeed } = useTranslation('feed');
  const { user, isAuthenticated } = useAuth();
  const toast = useToast();
  const [showComments, setShowComments] = useState(
    allowComments && (defaultShowComments || hasCommentHash()),
  );

  const social = useSocialInteractions({
    targetType,
    targetId,
    enabled: isAuthenticated,
    initialCommentsCount,
  });
  const { commentsLoaded, commentsLoading, loadComments } = social;

  const { reactions, react, isReacting, failed: reactionFailed } = useEntityReactions({
    targetType,
    targetId,
    viewerId: user?.id ?? null,
    enabled: isAuthenticated,
    visitorTotal: initialLikesCount,
  });

  useEffect(() => {
    if (reactionFailed) {
      toast.error(tFeed('toast.like_failed'));
    }
    // Fires once per failure; `toast` and `tFeed` are stable enough not to matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionFailed]);

  useEffect(() => {
    setShowComments(allowComments && (defaultShowComments || hasCommentHash()));
  }, [targetType, targetId, defaultShowComments, allowComments]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleHashChange = () => {
      if (allowComments && hasCommentHash()) {
        setShowComments(true);
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [targetType, targetId, allowComments]);

  useEffect(() => {
    if (allowComments && isAuthenticated && showComments && !commentsLoaded && !commentsLoading) {
      void loadComments();
    }
  }, [allowComments, isAuthenticated, showComments, commentsLoaded, commentsLoading, loadComments]);

  const toggleComments = useCallback(() => {
    if (!allowComments || !isAuthenticated) return;
    setShowComments((current) => !current);
  }, [allowComments, isAuthenticated]);

  const currentUserName = getUserName(user, t('you'));
  const currentUserAvatar = user?.avatar_url ?? user?.avatar ?? undefined;
  const canShareToFeed = targetOwnerId == null || !idsMatch(user?.id, targetOwnerId);

  return (
    <div className={cn('space-y-3', className)}>
      {(reactions.total > 0 || (allowComments && social.commentsCount > 0)) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-theme-subtle">
          <div>
            {/* Who reacted opens for signed-in members only; a visitor sees
                the count and no names. */}
            <ReactionSummary
              counts={reactions.counts}
              total={reactions.total}
              topReactors={isAuthenticated ? reactions.top_reactors : []}
              entityType={targetType}
              entityId={targetId}
              isInteractive={isAuthenticated}
            />
          </div>

          {allowComments && social.commentsCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[28px] px-0 py-0 text-xs text-theme-subtle hover:text-theme-primary"
              isDisabled={!isAuthenticated}
              onPress={() => {
                if (isAuthenticated) setShowComments(true);
              }}
              aria-expanded={isAuthenticated && showComments}
            >
              {t('comments_count', { count: social.commentsCount })}
            </Button>
          )}
        </div>
      )}

      <div
        className={cn(
          'flex flex-wrap items-center gap-2 border-y border-theme-default py-2',
          compact && 'gap-1 py-1.5',
        )}
      >
        <ReactionPicker
          userReaction={(reactions.user_reaction as ReactionType | null) ?? null}
          onReact={(type) => {
            void react(type);
          }}
          isAuthenticated={isAuthenticated}
          isDisabled={isReacting}
          size={compact ? 'sm' : 'md'}
          className="flex flex-1 min-w-[7rem]"
          buttonClassName="flex-1"
        />

        {allowComments && (
          <Button
            variant="light"
            size={compact ? 'sm' : 'md'}
            className={cn(
              'flex-1 min-w-[7rem] text-theme-muted hover:bg-accent/10 hover:text-accent-soft-foreground',
              showComments && 'bg-accent/10 text-accent-soft-foreground',
            )}
            startContent={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
            aria-expanded={isAuthenticated && showComments}
            aria-label={isAuthenticated && showComments ? t('close_comments') : t('open_comments')}
            isDisabled={!isAuthenticated}
            onPress={toggleComments}
          >
            {t('comment_action')}
          </Button>
        )}

        {showShare && SHAREABLE_TARGET_TYPES.has(targetType) && (
          <ShareButton
            shareToFeed={social.shareToFeed}
            title={title}
            description={description ?? undefined}
            isAuthenticated={isAuthenticated}
            canShareToFeed={canShareToFeed}
            shareToFeedDisabledReason={t('cannot_share_own_content')}
            className={cn('flex-1 min-w-[7rem]', compact && 'h-8 text-sm')}
          />
        )}
      </div>

      <AnimatePresence initial={false}>
        {allowComments && isAuthenticated && showComments && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className={cn('overflow-hidden', commentsClassName)}
          >
            <CommentsSection
              comments={social.comments}
              commentsCount={social.commentsCount}
              commentsLoading={social.commentsLoading}
              commentsLoaded={social.commentsLoaded}
              loadComments={social.loadComments}
              submitComment={social.submitComment}
              editComment={social.editComment}
              deleteComment={social.deleteComment}
              toggleReaction={social.toggleReaction}
              searchMentions={social.searchMentions}
              isAuthenticated={isAuthenticated}
              currentUserId={user?.id}
              currentUserAvatar={currentUserAvatar}
              currentUserName={currentUserName}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default SocialInteractionPanel;
