// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
/**
 * Group Discussion Tab
 * Thread-based discussions with expand/collapse and inline replies.
 */

import { Fragment, useCallback, useState } from 'react';
import { motion, AnimatePresence } from '@/lib/motion';

import MessageSquare from 'lucide-react/icons/message-square';
import Lock from 'lucide-react/icons/lock';
import Plus from 'lucide-react/icons/plus';
import Send from 'lucide-react/icons/send';
import Clock from 'lucide-react/icons/clock';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronUp from 'lucide-react/icons/chevron-up';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { htmlToPlainText } from '@/lib/sanitize';
import { EmptyState } from '@/components/feedback';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts';
import { resolveAvatarUrl, formatRelativeTime } from '@/lib/helpers';

/**
 * Discussion text with the shared Translate button (AWID feedback, 30 Oct 2026:
 * group discussions could not be translated). The stored text is rich text; it
 * is translated as words, and the translation is shown as plain text until
 * "Show original" brings the formatting back.
 */
function TranslatableDiscussionText({ contentType, contentId, content, className, as }: {
  contentType: string;
  contentId: number;
  content: string;
  className: string;
  as?: 'div';
}) {
  const [translated, setTranslated] = useState<string | null>(null);
  const onTextChange = useCallback((text: string, isTranslated: boolean) => {
    setTranslated(isTranslated ? text : null);
  }, []);

  return (
    <>
      {translated !== null
        ? <div className={className}>{translated}</div>
        : <SafeHtml content={content} className={className} as={as} />}
      <TranslateButton
        contentType={contentType}
        contentId={contentId}
        sourceText={htmlToPlainText(content)}
        sourceLocale={null}
        onTextChange={onTextChange}
        className="mt-1"
      />
    </>
  );
}

export interface Discussion {
  id: number;
  title: string;
  content?: string;
  author: {
    id: number;
    name: string;
    avatar_url?: string | null;
  };
  reply_count: number;
  comments_count?: number;
  likes_count?: number;
  is_liked?: boolean;
  is_pinned?: boolean;
  last_reply_at?: string | null;
  created_at: string;
}

export interface DiscussionMessage {
  id: number;
  content: string;
  author: {
    id: number;
    name: string;
    avatar_url?: string | null;
  };
  is_own?: boolean;
  created_at: string;
}

export interface DiscussionDetail extends Discussion {
  messages: DiscussionMessage[];
  messagesNextCursor?: string;
  messagesHasMore: boolean;
}

interface GroupDiscussionTabProps {
  isMember: boolean;
  isJoining: boolean;
  discussions: Discussion[];
  discussionsLoading: boolean;
  discussionsHasMore: boolean;
  expandedDiscussionId: number | null;
  expandedDiscussion: DiscussionDetail | null;
  expandedLoading: boolean;
  loadingEarlierReplies: boolean;
  replyContent: string;
  sendingReply: boolean;
  onJoinLeave: () => void;
  onShowNewDiscussion: () => void;
  onExpandDiscussion: (id: number) => void;
  onLoadMoreDiscussions: () => void;
  onLoadEarlierReplies: () => void;
  onReplyContentChange: (value: string) => void;
  onSendReply: () => void;
}

export function GroupDiscussionTab({
  isMember,
  isJoining,
  discussions,
  discussionsLoading,
  discussionsHasMore,
  expandedDiscussionId,
  expandedDiscussion,
  expandedLoading,
  loadingEarlierReplies,
  replyContent,
  sendingReply,
  onJoinLeave,
  onShowNewDiscussion,
  onExpandDiscussion,
  onLoadMoreDiscussions,
  onLoadEarlierReplies,
  onReplyContentChange,
  onSendReply,
}: GroupDiscussionTabProps) {
  const { t } = useTranslation('groups');
  const { isAuthenticated } = useAuth();

  if (!isMember) {
    return (
      <GlassCard className="p-6 sm:p-8">
        <EmptyState
          icon={<Lock className="w-12 h-12" aria-hidden="true" />}
          title={t('detail.join_to_discuss_title')}
          description={t('detail.join_to_discuss_desc')}
          action={
            isAuthenticated && (
              <Button
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                onPress={onJoinLeave}
                isLoading={isJoining}
              >
                {t('detail.join_group')}
              </Button>
            )
          }
        />
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4 sm:p-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-theme-primary">{t('detail.discussions_heading')}</h2>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white sm:w-auto"
            size="sm"
            startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            onPress={onShowNewDiscussion}
          >
            {t('detail.new_discussion')}
          </Button>
        </div>

        {/* Discussions List */}
        {discussionsLoading && discussions.length === 0 ? (
          <div className="flex justify-center py-8" role="status" aria-busy="true" aria-label={t('detail.loading')}>
            <Spinner size="lg" />
          </div>
        ) : discussions.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="w-12 h-12" aria-hidden="true" />}
            title={t('detail.no_discussions_title')}
            description={t('detail.no_discussions_desc')}
            action={
              <Button
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                onPress={onShowNewDiscussion}
                startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              >
                {t('detail.start_discussion')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {discussions.map((discussion) => (
              <Fragment key={discussion.id}>
                <motion.div
                  layout
                  className="cursor-pointer overflow-hidden rounded-lg bg-theme-elevated transition-colors hover:bg-theme-hover"
                  onClick={() => onExpandDiscussion(discussion.id)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedDiscussionId === discussion.id}
                  aria-label={discussion.title}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpandDiscussion(discussion.id); } }}
                >
                  <div className="p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <Avatar
                        src={resolveAvatarUrl(discussion.author.avatar_url)}
                        name={discussion.author.name}
                        size="sm"
                        className="flex-shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="truncate font-medium text-theme-primary">{discussion.title}</h3>
                          {expandedDiscussionId === discussion.id ? (
                            <ChevronUp className="w-4 h-4 text-theme-subtle flex-shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-theme-subtle flex-shrink-0" aria-hidden="true" />
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-theme-subtle">
                          <span className="max-w-40 truncate">{discussion.author.name}</span>
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <MessageSquare className="w-3 h-3" aria-hidden="true" />
                            {t('detail.reply_count', { count: discussion.reply_count })}
                          </span>
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {formatRelativeTime(discussion.last_reply_at || discussion.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* Expanded Discussion */}
                <AnimatePresence>
                  {expandedDiscussionId === discussion.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="ms-3 space-y-4 border-s-2 border-theme-default pb-2 ps-3 sm:ms-6 sm:ps-6">
                        {expandedLoading ? (
                          <div className="flex justify-center py-4" role="status" aria-busy="true" aria-label={t('detail.loading_replies')}>
                            <Spinner size="sm" />
                          </div>
                        ) : expandedDiscussion ? (
                          <>
                            {/* Original discussion content */}
                            <div className="p-3 rounded-lg bg-theme-elevated/50">
                              <TranslatableDiscussionText
                                contentType="group_discussion"
                                contentId={discussion.id}
                                content={expandedDiscussion.content ?? ''}
                                className="text-sm text-theme-muted whitespace-pre-wrap"
                                as="div"
                              />
                            </div>

                            <SocialInteractionPanel
                              targetType="discussion"
                              targetId={discussion.id}
                              initialLiked={discussion.is_liked ?? false}
                              initialLikesCount={discussion.likes_count ?? 0}
                              initialCommentsCount={discussion.comments_count ?? 0}
                              title={discussion.title}
                              description={expandedDiscussion.content}
                              targetOwnerId={discussion.author.id}
                              allowComments={false}
                              compact
                            />

                            {expandedDiscussion.messagesHasMore && (
                              <div className="text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  isLoading={loadingEarlierReplies}
                                  onPress={onLoadEarlierReplies}
                                >
                                  {t('detail.load_earlier_replies')}
                                </Button>
                              </div>
                            )}

                            {/* Messages */}
                            {expandedDiscussion.messages && expandedDiscussion.messages.length > 0 && (
                              <div className="space-y-3">
                                {expandedDiscussion.messages.map((msg) => (
                                  <div key={msg.id} className="flex gap-3 p-3 rounded-lg bg-theme-elevated/30">
                                    <Avatar
                                      src={resolveAvatarUrl(msg.author.avatar_url)}
                                      name={msg.author.name}
                                      size="sm"
                                      className="flex-shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="max-w-40 truncate text-sm font-medium text-theme-primary">{msg.author.name}</span>
                                        <time className="text-xs text-theme-subtle" dateTime={msg.created_at}>
                                          {formatRelativeTime(msg.created_at)}
                                        </time>
                                      </div>
                                      <TranslatableDiscussionText
                                        contentType="group_discussion_reply"
                                        contentId={msg.id}
                                        content={msg.content}
                                        className="text-sm text-theme-muted mt-1 whitespace-pre-wrap prose prose-sm max-w-none dark:prose-invert"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Reply Form */}
                            <div className="flex flex-col sm:flex-row gap-2 items-end">
                              <Textarea
                                placeholder={t('detail.reply_placeholder')}
                                aria-label={t('detail.reply_aria')}
                                value={replyContent}
                                onChange={(e) => onReplyContentChange(e.target.value)}
                                minRows={1}
                                maxRows={4}
                                classNames={{
                                  input: 'bg-transparent text-theme-primary',
                                  inputWrapper: 'bg-theme-elevated border-theme-default',
                                }}
                              />
                              <Button
                                isIconOnly
                                className="min-h-11 min-w-11 flex-shrink-0 bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                                aria-label={t('detail.send_reply_aria')}
                                isLoading={sendingReply}
                                isDisabled={!replyContent.trim()}
                                onPress={onSendReply}
                              >
                                <Send className="w-4 h-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Fragment>
            ))}

            {/* Load More Discussions */}
            {discussionsHasMore && (
              <div className="pt-2 text-center">
                <Button
                  variant="flat"
                  size="sm"
                  className="bg-theme-elevated text-theme-muted"
                  isLoading={discussionsLoading}
                  onPress={onLoadMoreDiscussions}
                >
                  {t('detail.load_more_discussions')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
