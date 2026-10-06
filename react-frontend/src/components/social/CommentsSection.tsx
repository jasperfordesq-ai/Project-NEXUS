// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CommentsSection — Reusable threaded comments with reactions, replies, edit, delete.
 * Drop this into any content page (listings, events, blog posts, etc.).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Send from 'lucide-react/icons/send';
import MessageCircle from 'lucide-react/icons/message-circle';
import Clock from 'lucide-react/icons/clock';
import CornerDownRight from 'lucide-react/icons/corner-down-right';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { useTenant, useToast } from '@/contexts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { resolveAvatarUrl, formatRelativeTime } from '@/lib/helpers';
import { BottomSheet } from '@/components/ui/BottomSheet';
import type { FeedComment } from '@/components/feed/types';
import { AVAILABLE_REACTIONS, COMMENT_REACTION_EMOJI_MAP } from '@/hooks/useSocialInteractions';
import type { MentionUser } from '@/hooks/useSocialInteractions';
import { MentionRenderer } from './MentionRenderer';
import { UserHoverCard } from './UserHoverCard';
import { memberPlainText } from '@/components/ui/MemberPlainText';
import { Button, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Tooltip, Skeleton } from '@/components/ui';

/* ─── Props ─────────────────────────────────────────────────── */

export interface CommentsSectionProps {
  comments: FeedComment[];
  commentsCount: number;
  commentsLoading: boolean;
  commentsLoaded: boolean;
  loadComments: () => Promise<void>;
  submitComment: (content: string, parentId?: number) => Promise<boolean>;
  editComment: (commentId: number, content: string) => Promise<boolean>;
  deleteComment: (commentId: number) => Promise<boolean>;
  toggleReaction: (commentId: number, emoji: string) => Promise<void>;
  isAuthenticated: boolean;
  currentUserId?: number;
  currentUserAvatar?: string;
  currentUserName?: string;
  searchMentions?: (query: string) => Promise<MentionUser[]>;
  /**
   * 'sheet' renders for a mobile BottomSheet: no internal header (the sheet
   * header names the dialog), the comment list first, and the composer pinned
   * to the bottom of the sheet — matching native social apps.
   */
  variant?: 'inline' | 'sheet';
  /** Focus the composer on mount (used by the phone composer sheet so the
      keyboard opens with it). */
  autoFocusComposer?: boolean;
}

/* ─── Single Comment ────────────────────────────────────────── */

interface CommentItemProps {
  comment: FeedComment;
  depth: number;
  onReply: (parentId: number) => void;
  onEdit: (commentId: number, content: string) => Promise<boolean>;
  onDelete: (commentId: number) => Promise<boolean>;
  onToggleReaction: (commentId: number, emoji: string) => Promise<void>;
  replyingTo: number | null;
  replyContent: string;
  isSubmittingReply: boolean;
  highlightedCommentId: number | null;
  onReplyContentChange: (value: string) => void;
  onSubmitReply: () => void;
  onCancelReply: () => void;
  isAuthenticated: boolean;
  currentUserId?: number;
  searchMentions?: (query: string) => Promise<MentionUser[]>;
}

function CommentItemInner({
  comment,
  depth,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  replyingTo,
  replyContent,
  isSubmittingReply,
  highlightedCommentId,
  onReplyContentChange,
  onSubmitReply,
  onCancelReply,
  isAuthenticated,
  currentUserId,
  searchMentions,
}: CommentItemProps) {
  const { t } = useTranslation('social');
  const { tenantPath } = useTenant();
  const toast = useToast();
  const tr = useCallback((key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  }, [t]);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const isOwn = currentUserId === comment.author.id || comment.is_own;

  const handleSaveEdit = async () => {
    if (!editContent.trim()) return;
    setIsSubmittingEdit(true);
    const ok = await onEdit(comment.id, editContent.trim());
    // onEdit resolves false on a failed request (api.* returns { success:false }
    // WITHOUT throwing on a 4xx, which gets no global toast) — keep the editor
    // open and surface the failure instead of silently doing nothing.
    if (ok) {
      setIsEditing(false);
    } else {
      toast.error(tr('comment_edit_failed', 'Couldn’t save your changes. Please try again.'));
    }
    setIsSubmittingEdit(false);
  };

  const handleDeleteConfirm = async () => {
    const ok = await onDelete(comment.id);
    // Only close the confirmation on a real success — a failed delete (e.g. 403/404,
    // which resolves { success:false } without throwing and shows no global toast)
    // used to close the dialog as if it worked while the comment stayed in the list.
    if (ok) {
      setShowDeleteModal(false);
    } else {
      toast.error(tr('comment_delete_failed', 'Couldn’t delete the comment. Please try again.'));
    }
  };

  const reactions = comment.reactions ?? {};
  const userReactions = comment.user_reactions ?? [];
  const hasReactions = Object.keys(reactions).length > 0;

  const isReplyingHere = replyingTo === comment.id;
  const isHighlighted = highlightedCommentId === comment.id;

  return (
    <div
      id={`comment-${comment.id}`}
      className={`scroll-mt-24 flex items-start gap-2.5 rounded-2xl transition-[background-color,box-shadow] duration-500 ${
        depth > 0 ? 'ms-6 sm:ms-8 ps-3 border-s-2 border-[var(--color-primary)]/20' : ''
      } ${isHighlighted ? 'bg-[var(--color-primary)]/10 ring-2 ring-[var(--color-primary)]/30' : ''}`}
    >
      <UserHoverCard userId={comment.author.id}>
        <Link to={tenantPath(`/profile/${comment.author.id}`)}>
          <Avatar
            name={comment.author.name}
            src={resolveAvatarUrl(comment.author.avatar)}
            size="sm"
            className="w-7 h-7 flex-shrink-0 ring-2 ring-white/10"
          />
        </Link>
      </UserHoverCard>
      <div className="flex-1 min-w-0">
        <div className="bg-[var(--surface-elevated)] rounded-2xl px-3.5 py-2.5 border border-[var(--border-default)]">
          <div className="flex items-center gap-2">
            <UserHoverCard userId={comment.author.id}>
              <Link
                to={tenantPath(`/profile/${comment.author.id}`)}
                className="text-xs font-semibold text-[var(--text-primary)] hover:text-[var(--color-primary)] transition-colors"
              >
                {comment.author.name}
              </Link>
            </UserHoverCard>
            {comment.edited && (
              <span className="text-[10px] text-[var(--text-subtle)] italic">
                ({tr('edited', 'edited')})
              </span>
            )}
          </div>

          {isEditing ? (
            <div className="mt-1.5 space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                aria-label={tr('comments.edit_label', 'Edit comment')}
                minRows={1}
                maxRows={4}
                size="sm"
                classNames={{
                  input: 'bg-transparent text-[var(--text-primary)] text-xs',
                  inputWrapper: 'bg-[var(--surface-hover)] border-[var(--border-default)] min-h-[32px]',
                }}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  isIconOnly
                  variant="secondary"
                  className="w-6 h-6 min-w-0 bg-emerald-500/20 text-emerald-500"
                  onPress={handleSaveEdit}
                  isLoading={isSubmittingEdit}
                  aria-label={tr('save', 'Save')}
                >
                  <Check className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  isIconOnly
                  variant="flat"
                  className="w-6 h-6 min-w-0 bg-red-500/10 text-[var(--color-error)]"
                  onPress={() => { setIsEditing(false); setEditContent(memberPlainText(comment.content)); }}
                  aria-label={tr('cancel', 'Cancel')}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 whitespace-pre-wrap leading-relaxed">
              {/* F-568 (E-093): the comment box is a plain text box — what was typed is shown as words, never as markup. */}
              <MentionRenderer text={memberPlainText(comment.content)} showUserCard={false} />
            </p>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center gap-3 mt-1 px-1 flex-wrap">
          <span className="text-[10px] text-[var(--text-subtle)]">
            <Clock className="w-2.5 h-2.5 inline me-0.5 -mt-px" aria-hidden="true" />
            {formatRelativeTime(comment.created_at)}
          </span>

          {isAuthenticated && !isEditing && (
            <>
              {depth < 2 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => onReply(comment.id)}
                  className="flex min-h-[24px] items-center gap-0.5 px-0 py-0 text-[10px] text-[var(--color-primary)] hover:underline"
                  startContent={<CornerDownRight className="w-2.5 h-2.5" aria-hidden="true" />}
                >
                  {tr('reply', 'Reply')}
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onPress={() => setShowReactions(!showReactions)}
                className="min-h-[24px] px-0 py-0 text-[10px] text-[var(--text-subtle)] hover:text-[var(--text-primary)]"
              >
                {tr('react', 'React')}
              </Button>

              {isOwn && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => { setIsEditing(true); setEditContent(memberPlainText(comment.content)); }}
                    className="flex min-h-[24px] items-center gap-0.5 px-0 py-0 text-[10px] text-[var(--text-subtle)] hover:text-[var(--text-primary)]"
                    startContent={<Pencil className="w-2.5 h-2.5" aria-hidden="true" />}
                  >
                    {tr('edit', 'Edit')}
                  </Button>
                  <Button
                    variant="danger-soft"
                    size="sm"
                    onPress={() => setShowDeleteModal(true)}
                    className="flex min-h-[24px] items-center gap-0.5 px-0 py-0 text-[10px] text-red-600 dark:text-red-400 hover:text-[var(--color-error)]"
                    startContent={<Trash2 className="w-2.5 h-2.5" aria-hidden="true" />}
                  >
                    {tr('delete', 'Delete')}
                  </Button>
                </>
              )}
            </>
          )}
        </div>

        {/* Emoji reactions display */}
        {hasReactions && (
          <div className="flex flex-wrap gap-1 mt-1 px-1">
            {Object.entries(reactions).map(([reactionType, count]) => {
              const reactionEmoji = COMMENT_REACTION_EMOJI_MAP[reactionType as keyof typeof COMMENT_REACTION_EMOJI_MAP] ?? reactionType;
              return (
              <Tooltip key={reactionType} content={`${reactionEmoji} (${count})`} size="sm" delay={300} closeDelay={0}>
                <Button
                  variant="flat"
                  size="sm"
                  onPress={() => isAuthenticated && onToggleReaction(comment.id, reactionType)}
                  className={`inline-flex min-h-[24px] items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${
                    userReactions.includes(reactionType)
                      ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-subtle)]'
                  }`}
                >
                  <span>{reactionEmoji}</span>
                  <span>{count as number}</span>
                </Button>
              </Tooltip>
              );
            })}
          </div>
        )}

        {/* Reaction picker */}
        <AnimatePresence>
          {showReactions && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex gap-1 mt-1 px-1"
            >
              {AVAILABLE_REACTIONS.map((reactionType) => (
                <Button
                  key={reactionType}
                  isIconOnly
                  size="sm"
                  variant="flat"
                  onPress={() => { onToggleReaction(comment.id, reactionType); setShowReactions(false); }}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-sm hover:scale-125 transition-transform min-w-0 ${
                    userReactions.includes(reactionType) ? 'bg-[var(--color-primary)]/20 ring-1 ring-[var(--color-primary)]' : 'hover:bg-[var(--surface-hover)]'
                  }`}
                  aria-label={t(`reaction.${reactionType}`)}
                >
                  {COMMENT_REACTION_EMOJI_MAP[reactionType]}
                </Button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isReplyingHere && isAuthenticated && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -4 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -4 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="mt-2"
            >
              <div className="flex gap-2 items-end">
                <MentionInput
                  placeholder={t('write_reply_to', { name: comment.author.name })}
                  value={replyContent}
                  onChange={onReplyContentChange}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmitReply(); } }}
                  size="sm"
                  radius="full"
                  classNames={{
                    input: 'bg-transparent text-[var(--text-primary)] text-xs',
                    inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] h-8',
                  }}
                  autoFocus
                  searchMentions={searchMentions}
                  endContent={
                    <div className="flex gap-1">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        className="min-h-[28px] w-auto px-0 py-0 text-[var(--color-primary)] disabled:opacity-30"
                        onPress={onSubmitReply}
                        isDisabled={!replyContent.trim() || isSubmittingReply}
                        aria-label={tr('send_reply', 'Send reply')}
                      >
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        className="min-h-[28px] w-auto px-0 py-0 text-[var(--text-subtle)]"
                        onPress={onCancelReply}
                        aria-label={tr('cancel', 'Cancel')}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  }
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Nested replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-2 space-y-2">
            {comment.replies.map((reply) => (
              <CommentItemInner
                key={reply.id}
                comment={reply}
                depth={depth + 1}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleReaction={onToggleReaction}
                replyingTo={replyingTo}
                replyContent={replyContent}
                isSubmittingReply={isSubmittingReply}
                highlightedCommentId={highlightedCommentId}
                onReplyContentChange={onReplyContentChange}
                onSubmitReply={onSubmitReply}
                onCancelReply={onCancelReply}
                isAuthenticated={isAuthenticated}
                currentUserId={currentUserId}
                searchMentions={searchMentions}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        size="sm"
        classNames={{
          base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)]',
          backdrop: 'bg-black/60 backdrop-blur-sm',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-[var(--text-primary)]">
            {tr('delete_comment_title', 'Delete comment')}
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-[var(--text-secondary)]">
              {tr('delete_comment_body', 'Are you sure you want to delete this comment? This cannot be undone.')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              size="sm"
              onPress={() => setShowDeleteModal(false)}
            >
              {tr('cancel', 'Cancel')}
            </Button>
            <Button
              color="danger"
              size="sm"
              onPress={() => { void handleDeleteConfirm(); }}
            >
              {tr('delete', 'Delete')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/* ─── Mention Input ─────────────────────────────────────────── */

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  classNames?: Record<string, string>;
  endContent?: React.ReactNode;
  autoFocus?: boolean;
  searchMentions?: (query: string) => Promise<MentionUser[]>;
  /** Where the mention suggestions open. 'above' for composers pinned to a sheet bottom. */
  menuPlacement?: 'below' | 'above';
}

function MentionInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  size = 'sm',
  radius = 'full',
  classNames: inputClassNames,
  endContent,
  autoFocus,
  searchMentions,
  menuPlacement = 'below',
}: MentionInputProps) {
  const { t } = useTranslation('social');
  const tr = useCallback((key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  }, [t]);
  const [mentionResults, setMentionResults] = useState<MentionUser[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (newValue: string) => {
    onChange(newValue);

    if (!searchMentions) return;

    // Detect @mention pattern: @ followed by 2+ word characters at end of input or before space
    const match = newValue.match(/@(\w{2,})$/);
    if (match) {
      const query = match[1] ?? '';
      setMentionQuery(query);
      setSelectedIndex(0);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        const results = await searchMentions(query);
        setMentionResults(results.slice(0, 5));
        setShowMentions(results.length > 0);
      }, 300);
    } else {
      setShowMentions(false);
      setMentionResults([]);
    }
  };

  const selectMention = (user: MentionUser) => {
    // Replace @query with @Username — escape regex metacharacters in the query
    const escaped = mentionQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionHandle = user.username || user.name.replace(/\s+/g, '');
    const newValue = value.replace(new RegExp(`@${escaped}$`), `@${mentionHandle} `);
    onChange(newValue);
    setShowMentions(false);
    setMentionResults([]);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showMentions && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % mentionResults.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + mentionResults.length) % mentionResults.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const selected = mentionResults[selectedIndex];
        if (selected) selectMention(selected);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  return (
    <div className="relative flex-1">
      <Input
        ref={inputRef}
        placeholder={placeholder}
        aria-label={placeholder || tr('write_comment', 'Write a comment...')}
        value={value}
        enterKeyHint="send"
        autoCapitalize="sentences"
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
          blurTimeoutRef.current = setTimeout(() => setShowMentions(false), 200);
        }}
        size={size}
        radius={radius}
        classNames={inputClassNames}
        endContent={endContent}
        autoFocus={autoFocus}
      />

      {/* Mention dropdown */}
      {showMentions && mentionResults.length > 0 && (
        <div className={`absolute left-0 right-0 z-50 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-lg shadow-lg overflow-hidden ${
          menuPlacement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
        }`}>
          {mentionResults.map((user, idx) => (
            <Button
              key={user.id}
              variant="ghost"
              onPress={() => selectMention(user)}
              onMouseDown={(e) => { e.preventDefault(); }}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 text-start transition-colors justify-start rounded-none ${
                idx === selectedIndex
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <Avatar
                name={user.name}
                src={resolveAvatarUrl(user.avatar_url)}
                size="sm"
                className="w-6 h-6 flex-shrink-0"
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{user.name}</span>
                {user.username && (
                  <span className="block truncate text-[10px] text-[var(--text-subtle)]">@{user.username}</span>
                )}
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main Component ────────────────────────────────────────── */

export function CommentsSection({
  comments,
  commentsCount,
  commentsLoading,
  commentsLoaded,
  loadComments,
  submitComment,
  editComment,
  deleteComment,
  toggleReaction,
  isAuthenticated,
  currentUserId,
  currentUserAvatar,
  currentUserName,
  searchMentions,
  variant = 'inline',
  autoFocusComposer = false,
}: CommentsSectionProps) {
  const { t } = useTranslation('social');
  const toast = useToast();
  const tr = useCallback((key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  }, [t]);

  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Native-app composer: on phones the inline variant shows a pill that opens
  // the full sheet variant (composer pinned to the sheet bottom, keyboard up)
  // instead of typing into a cramped inline field. Desktop keeps the inline
  // composer, and the comment list itself stays visible in place either way.
  const isPhone = useMediaQuery('(max-width: 639px)');
  const [isComposerSheetOpen, setIsComposerSheetOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load comments on mount if not already loaded
  useEffect(() => {
    if (!commentsLoaded && !commentsLoading) {
      void loadComments();
    }
  }, [commentsLoaded, commentsLoading, loadComments]);

  const handleSubmit = async () => {
    if (!newComment.trim() || isSubmitting) return;
    setIsSubmitting(true);
    const ok = await submitComment(newComment.trim());
    // A rejected comment (api.* returns { success:false } without throwing, and a
    // 4xx gets no global toast) used to clear nothing and give zero feedback — keep
    // the user's text and tell them it failed so they can retry.
    if (ok) {
      setNewComment('');
    } else {
      toast.error(tr('comment_post_failed', 'Couldn’t post your comment. Please try again.'));
    }
    setIsSubmitting(false);
  };

  const handleReply = useCallback((parentId: number) => {
    setReplyingTo(parentId);
    setReplyContent('');
  }, []);

  const handleSubmitReply = useCallback(async () => {
    if (!replyContent.trim() || isSubmittingReply || !replyingTo) return;
    setIsSubmittingReply(true);
    const ok = await submitComment(replyContent.trim(), replyingTo);
    if (ok) {
      setReplyingTo(null);
      setReplyContent('');
    } else {
      // Same failed-request class as handleSubmit — keep the reply text + surface it.
      toast.error(tr('comment_post_failed', 'Couldn’t post your comment. Please try again.'));
    }
    setIsSubmittingReply(false);
  }, [isSubmittingReply, replyContent, replyingTo, submitComment, toast, tr]);

  const handleCancelReply = useCallback(() => {
    setReplyingTo(null);
    setReplyContent('');
  }, []);

  useEffect(() => {
    if (!commentsLoaded || commentsLoading || typeof window === 'undefined') {
      return undefined;
    }

    const hash = window.location.hash.replace(/^#/, '');
    const match = /^comment-(\d+)$/.exec(hash);
    if (!match) {
      return undefined;
    }

    const commentId = Number(match[1]);
    if (!Number.isFinite(commentId)) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`comment-${commentId}`);
      if (!target) return;

      setHighlightedCommentId(commentId);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });

      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedCommentId(null);
        highlightTimeoutRef.current = null;
      }, 2400);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [comments, commentsLoaded, commentsLoading]);

  useEffect(() => () => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
  }, []);

  const isSheet = variant === 'sheet';

  const composer = isAuthenticated ? (
    <div className="flex items-start gap-2.5">
      <Avatar
        name={currentUserName || tr('you', 'You')}
        src={resolveAvatarUrl(currentUserAvatar)}
        size="sm"
        className="w-7 h-7 flex-shrink-0 ring-2 ring-white/10"
      />
      <MentionInput
        placeholder={tr('write_comment', 'Write a comment...')}
        value={newComment}
        onChange={setNewComment}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit(); } }}
        autoFocus={autoFocusComposer}
        size="sm"
        radius="full"
        classNames={{
          input: 'bg-transparent text-[var(--text-primary)] text-sm',
          inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40 h-9',
        }}
        searchMentions={searchMentions}
        menuPlacement={isSheet ? 'above' : 'below'}
        endContent={
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            className="min-h-[28px] w-auto px-0 py-0 text-[var(--color-primary)] disabled:opacity-30"
            onPress={handleSubmit}
            isDisabled={!newComment.trim() || isSubmitting}
            aria-label={tr('send_comment', 'Send comment')}
          >
            <Send className="w-4 h-4" />
          </Button>
        }
      />
    </div>
  ) : null;

  return (
    <div className={isSheet ? 'flex min-h-full flex-col gap-4' : 'space-y-4'}>
      {/* Header — omitted in sheet mode where the sheet chrome names the dialog */}
      {!isSheet && (
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-[var(--color-primary)]" aria-hidden="true" />
          {tr('comments_title', 'Comments')} {commentsCount > 0 && `(${commentsCount})`}
        </h3>
      )}

      {/* New comment input — inline mode keeps it above the list. Phones show
          a pill that opens the composer sheet instead of a cramped inline field. */}
      {!isSheet && (isPhone && isAuthenticated ? (
        <div className="flex items-center gap-2.5">
          <Avatar
            name={currentUserName || tr('you', 'You')}
            src={resolveAvatarUrl(currentUserAvatar)}
            size="sm"
            className="w-7 h-7 flex-shrink-0 ring-2 ring-white/10"
          />
          <Button
            variant="flat"
            onPress={() => setIsComposerSheetOpen(true)}
            aria-label={tr('write_comment', 'Write a comment...')}
            className="min-h-11 flex-1 justify-start rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-2 text-left text-sm font-normal text-[var(--text-subtle)]"
          >
            <span className="line-clamp-1">{tr('write_comment', 'Write a comment...')}</span>
          </Button>
        </div>
      ) : composer)}

      {/* Comments list */}
      {commentsLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-start gap-2.5">
              <Skeleton className="w-7 h-7 rounded-full flex-shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-3 w-20 rounded mb-1.5" />
                <Skeleton className="h-3 w-3/4 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className={`text-xs text-[var(--text-subtle)] text-center py-3 italic ${isSheet ? 'flex flex-1 items-center justify-center' : ''}`}>
          {tr('no_comments', 'No comments yet. Be the first to comment!')}
        </p>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div key={comment.id}>
              <CommentItemInner
                comment={comment}
                depth={0}
                onReply={handleReply}
                onEdit={editComment}
                onDelete={deleteComment}
                onToggleReaction={toggleReaction}
                replyingTo={replyingTo}
                replyContent={replyContent}
                isSubmittingReply={isSubmittingReply}
                highlightedCommentId={highlightedCommentId}
                onReplyContentChange={setReplyContent}
                onSubmitReply={() => { void handleSubmitReply(); }}
                onCancelReply={handleCancelReply}
                isAuthenticated={isAuthenticated}
                currentUserId={currentUserId}
                searchMentions={searchMentions}
              />
            </div>
          ))}
        </div>
      )}

      {/*
        Sheet mode pins the composer to the bottom like native social apps.
        sticky keeps it visible while the list scrolls behind it; mt-auto
        anchors it to the sheet bottom when the list is short. The negative
        margins span the BottomSheet body's px-5 padding edge-to-edge.
      */}
      {isSheet && composer && (
        <div className="sticky bottom-0 z-10 mt-auto -mx-5 border-t border-[var(--border-default)] bg-[var(--surface-dropdown)] px-5 py-3">
          {composer}
        </div>
      )}

      {/* Phone composer sheet — the full sheet-variant thread with the
          composer pinned to the bottom and focused, like native social apps.
          The inline list above stays in place; both render from the same
          props so state is shared. */}
      {!isSheet && isPhone && isAuthenticated && (
        <BottomSheet
          isOpen={isComposerSheetOpen}
          onClose={() => setIsComposerSheetOpen(false)}
          title={commentsCount > 0
            ? `${tr('comments_title', 'Comments')} (${commentsCount})`
            : tr('comments_title', 'Comments')}
          snapPoints={['full']}
        >
          <CommentsSection
            variant="sheet"
            autoFocusComposer
            comments={comments}
            commentsCount={commentsCount}
            commentsLoading={commentsLoading}
            commentsLoaded={commentsLoaded}
            loadComments={loadComments}
            submitComment={submitComment}
            editComment={editComment}
            deleteComment={deleteComment}
            toggleReaction={toggleReaction}
            searchMentions={searchMentions}
            isAuthenticated={isAuthenticated}
            currentUserId={currentUserId}
            currentUserAvatar={currentUserAvatar}
            currentUserName={currentUserName}
          />
        </BottomSheet>
      )}
    </div>
  );
}

export default CommentsSection;
