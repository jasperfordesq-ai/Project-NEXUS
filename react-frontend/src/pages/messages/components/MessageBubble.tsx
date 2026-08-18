// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useState, useEffect, useRef, useCallback, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLongPress } from '@react-aria/interactions';
import { motion } from '@/lib/motion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useToast } from '@/contexts';

import SmilePlus from 'lucide-react/icons/smile-plus';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Copy from 'lucide-react/icons/copy';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Check from 'lucide-react/icons/check';
import CheckCheck from 'lucide-react/icons/check-check';
import FileText from 'lucide-react/icons/file-text';
import { useAuthenticatedMedia } from '@/hooks/useAuthenticatedMedia';
import Languages from 'lucide-react/icons/languages';
import { formatNumber, resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { api } from '@/lib/api';
import { useTenant } from '@/contexts/TenantContext';
import type { Message } from '@/types/api';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import { MessageLinkPreview } from './MessageLinkPreview';

// Available reaction emojis
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function normalizeReactionEntries(rawReactions: unknown): Array<[string, number]> {
  let candidate = rawReactions;

  // Older API responses exposed the MariaDB JSON column as a string. Parse it
  // defensively so a staggered deployment cannot turn character offsets into
  // reaction buttons, while still excluding the private legacy `_users` map.
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return [];
    }
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return [];
  }

  return Object.entries(candidate).flatMap(([emoji, count]) => {
    if (!REACTION_EMOJIS.includes(emoji)
      || typeof count !== 'number'
      || !Number.isFinite(count)
      || count <= 0) {
      return [];
    }

    return [[emoji, Math.trunc(count)] as [string, number]];
  });
}

// Human-readable language names for translate button labels
const LANG_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', ga: 'Irish', nl: 'Dutch',
  pl: 'Polish', ja: 'Japanese', ar: 'Arabic',
};

interface OtherUser {
  id: number;
  name: string;
  avatar_url?: string | null;
  avatar?: string | null;
}

export interface MessageBubbleProps {
  id?: string;
  message: Message;
  isOwn: boolean;
  showAvatar: boolean;
  otherUser: OtherUser;
  onReact?: (messageId: number, emoji: string) => void;
  isHighlighted?: boolean;
  highlightQuery?: string;
  onEdit?: (message: Message) => void;
  onDelete?: (messageId: number) => void;
  isEditing?: boolean;
  editingText?: string;
  onEditingTextChange?: (text: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  /** Pre-translated text supplied by auto-translate (from ConversationPage) */
  autoTranslatedText?: string | null;
}

export const MessageBubble = memo(function MessageBubble({
  id,
  message,
  isOwn,
  showAvatar,
  otherUser,
  onReact,
  isHighlighted,
  highlightQuery,
  onEdit,
  onDelete,
  isEditing,
  editingText,
  onEditingTextChange,
  onSaveEdit,
  onCancelEdit,
  autoTranslatedText,
}: MessageBubbleProps) {
  const { t, i18n } = useTranslation('messages');
  const { hasFeature } = useTenant();
  const { showToast } = useToast();
  const translationEnabled = hasFeature('message_translation');
  // Phones get one unified bottom action sheet (long-press or the ⋮ button)
  // instead of the desktop hover buttons + floating pickers.
  const isMobileSheet = useMediaQuery('(max-width: 639px)');
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const translationCacheRef = useRef<Map<string, string>>(new Map());
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);

  // When auto-translate provides a translation from the parent, populate internal state
  useEffect(() => {
    if (autoTranslatedText) {
      setTranslatedText(autoTranslatedText);
      setShowOriginal(false);
    }
  }, [autoTranslatedText]);
  const isVoiceMessage = message.is_voice || message.audio_url;
  const isDeleted = message.is_deleted;
  const canUseActions = !isEditing && !isDeleted;

  // Long-press opens the mobile action sheet (native messaging pattern).
  const { longPressProps } = useLongPress({
    isDisabled: !isMobileSheet || !canUseActions,
    accessibilityDescription: t('aria_message_options'),
    onLongPress: () => setShowActionSheet(true),
  });

  // Close popups when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (showReactionPicker && reactionPickerRef.current && !reactionPickerRef.current.contains(event.target as Node)) {
        setShowReactionPicker(false);
      }
      if (showMessageMenu && messageMenuRef.current && !messageMenuRef.current.contains(event.target as Node)) {
        setShowMessageMenu(false);
      }
    }

    if (showReactionPicker || showMessageMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showReactionPicker, showMessageMenu]);

  const reactionEntries = normalizeReactionEntries(message.reactions);
  const hasReactions = reactionEntries.length > 0;

  // Translation: determine if content is translatable and if already in user's language
  const messageText = message.body || message.content || '';
  const hasTranslatableContent = !!(message.transcript || messageText);
  const userLangBase = (i18n.language || 'en').split('-')[0] ?? 'en';
  const userLangName = LANG_NAMES[userLangBase] ?? userLangBase;
  // For voice messages, we know the source language — skip translate if it matches user's UI language
  const isAlreadyInUserLanguage = isVoiceMessage && message.transcript_language === userLangBase;

  const handleTranslate = useCallback(async () => {
    if (isTranslating || !hasTranslatableContent) return;

    // If already translated, toggle between translated and original
    if (translatedText) {
      setShowOriginal(prev => !prev);
      return;
    }

    // Check cache first (avoids redundant API calls)
    const cacheKey = `${message.id}:${userLangBase}`;
    const cached = translationCacheRef.current.get(cacheKey);
    if (cached) {
      setTranslatedText(cached);
      setShowOriginal(false);
      return;
    }

    setIsTranslating(true);
    setTranslationError(null);
    try {
      const response = await api.post<{ translated_text: string }>(`/v2/messages/${message.id}/translate`, {
        target_language: userLangBase,
      });
      const translated = response.data?.translated_text ?? '';
      translationCacheRef.current.set(cacheKey, translated);
      setTranslatedText(translated);
      setShowOriginal(false);
    } catch {
      setTranslationError(t('translate.translation_failed'));
    } finally {
      setIsTranslating(false);
    }
  }, [isTranslating, hasTranslatableContent, translatedText, message.id, userLangBase, t]);

  // Highlight search terms in message body
  function highlightText(text: string): ReactNode {
    if (!highlightQuery || !text) return text;
    const parts = text.split(new RegExp(`(${highlightQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === highlightQuery.toLowerCase() ? (
        <mark key={i} className="bg-yellow-400/40 text-theme-primary rounded px-0.5">{part}</mark>
      ) : part
    );
  }

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`flex min-w-0 gap-2 sm:gap-3 ${isOwn ? 'flex-row-reverse' : ''} group transition-all duration-300 ${isHighlighted ? 'ring-2 ring-yellow-400/30 rounded-lg' : ''}`}
    >
      {showAvatar && !isOwn ? (
        <Avatar
          src={resolveAvatarUrl(otherUser.avatar_url || otherUser.avatar)}
          name={otherUser.name}
          size="sm"
          className="flex-shrink-0"
        />
      ) : (
        <div className="w-8 flex-shrink-0" />
      )}

      <div className={`min-w-0 max-w-[85%] sm:max-w-[70%] ${isOwn ? 'text-right' : ''} relative`}>
        <div
          {...(isMobileSheet && canUseActions ? longPressProps : {})}
          className={`
            inline-block max-w-full break-words px-3 py-2 sm:px-4 rounded-2xl relative [overflow-wrap:anywhere]
            ${isMobileSheet && canUseActions ? 'select-none [-webkit-touch-callout:none]' : ''}
            ${isOwn
              ? 'bg-gradient-to-r from-accent to-accent-gradient-end text-white rounded-br-md'
              : 'bg-theme-elevated text-theme-primary rounded-bl-md'
            }
          `}
        >
          {isEditing ? (
            /* Editing mode */
            <div className="min-w-0 sm:min-w-[200px]">
              <Input
                value={editingText}
                onChange={(e) => onEditingTextChange?.(e.target.value)}
                aria-label={t('aria_edit_message')}
                classNames={{
                  input: 'bg-transparent text-inherit placeholder:text-inherit/40',
                  inputWrapper: 'bg-black/10 dark:bg-white/10 border-black/20 dark:border-white/20',
                }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSaveEdit?.();
                  } else if (e.key === 'Escape') {
                    onCancelEdit?.();
                  }
                }}
              />
              <div className="flex gap-2 mt-2 justify-end">
                <Button size="sm" variant="secondary" className="min-h-11 bg-black/10 dark:bg-white/10 text-inherit/70" onPress={onCancelEdit}>
                  {t('cancel')}
                </Button>
                <Button size="sm" className="min-h-11 bg-black/20 dark:bg-white/20 text-inherit" onPress={onSaveEdit}>
                  {t('save')}
                </Button>
              </div>
            </div>
          ) : isDeleted ? (
            /* Deleted message */
            <p className="text-sm opacity-40 italic">{t('message_deleted_placeholder')}</p>
          ) : isVoiceMessage ? (
            <div>
              <VoiceMessagePlayer
                audioUrl={message.audio_url}
                transcript={message.transcript}
                transcriptLanguage={message.transcript_language}
              />
              {/* Translate button for voice messages with transcripts */}
              {translationEnabled && message.transcript && !isAlreadyInUserLanguage && (
                <div className="mt-1">
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="tertiary"
                      className={`min-h-11 px-2 text-xs gap-1 ${isOwn ? 'text-white/60 hover:text-white/100' : 'opacity-60 hover:opacity-100'} ${isTranslating ? 'animate-pulse' : ''}`}
                      onPress={handleTranslate}
                      isDisabled={isTranslating}
                      startContent={<Languages className="w-3 h-3" aria-hidden="true" />}
                      aria-label={translatedText ? t('translate.view_original') : `${t('translate.translate_to')} ${userLangName}`}
                    >
                      {isTranslating
                        ? t('translate.translating')
                        : translatedText
                          ? (showOriginal ? t('translate.show_translation') : t('translate.view_original'))
                          : `${t('translate.translate_to')} ${userLangName}`
                      }
                    </Button>
                    {translatedText && !showOriginal && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isOwn ? 'bg-white/15 text-white/60' : 'bg-theme-muted/10 text-theme-muted'}`}>
                        {t('translate.translated_label')}
                      </span>
                    )}
                  </div>
                  {translatedText && !showOriginal && (
                    <p className="text-xs opacity-70 mt-1 whitespace-pre-wrap leading-relaxed italic break-words [overflow-wrap:anywhere]">
                      {translatedText}
                    </p>
                  )}
                  {translationError && !translatedText && (
                    <p className="text-xs text-red-700 dark:text-red-400 mt-1">{translationError}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {(message.body || message.content) && (
                <>
                  {/* Show translated text or original */}
                  {translatedText && !showOriginal ? (
                    <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{translatedText}</p>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{highlightText(message.body || message.content || '')}</p>
                  )}
                </>
              )}
              {/* Edited indicator */}
              {message.is_edited && (
                <span className="text-[10px] opacity-40 ml-1">{t('message_edited_indicator')}</span>
              )}
              {/* Translate button for text messages */}
              {translationEnabled && !isDeleted && (message.body || message.content) && (
                <div className="mt-1 flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="tertiary"
                    className={`min-h-11 px-2 text-xs gap-1 ${isOwn ? 'text-white/60 hover:text-white/100' : 'opacity-60 hover:opacity-100'} ${isTranslating ? 'animate-pulse' : ''}`}
                    onPress={handleTranslate}
                    isDisabled={isTranslating}
                    startContent={<Languages className="w-3 h-3" aria-hidden="true" />}
                    aria-label={translatedText ? t('translate.view_original') : `${t('translate.translate_to')} ${userLangName}`}
                  >
                    {isTranslating
                      ? t('translate.translating')
                      : translatedText
                        ? (showOriginal ? t('translate.show_translation') : t('translate.view_original'))
                        : `${t('translate.translate_to')} ${userLangName}`
                    }
                  </Button>
                  {translatedText && !showOriginal && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isOwn ? 'bg-white/15 text-white/60' : 'bg-theme-muted/10 text-theme-muted'}`}>
                      {t('translate.translated_label')}
                    </span>
                  )}
                  {translationError && !translatedText && (
                    <span className="text-xs text-red-700 dark:text-red-400">{translationError}</span>
                  )}
                </div>
              )}
              {/* Attachments */}
              {message.attachments && message.attachments.length > 0 && (
                <div className={`flex flex-wrap gap-2 ${message.body ? 'mt-2' : ''}`}>
                  {message.attachments.map((attachment) => (
                    <ProtectedAttachment key={attachment.id} attachment={attachment} />
                  ))}
                </div>
              )}
              {/* Link preview for URLs in message */}
              <MessageLinkPreview text={message.body || message.content || ''} />
            </>
          )}

          {/* Mobile: one compact button opens the unified action sheet
              (long-press on the bubble does the same). */}
          {canUseActions && isMobileSheet && (
            <div className={`absolute -bottom-2 ${isOwn ? '-left-12' : '-right-12'} flex`}>
              <Button
                isIconOnly
                variant="tertiary"
                className="size-11 min-h-11 min-w-11 p-0 bg-theme-elevated rounded-full border border-theme-default"
                onPress={() => setShowActionSheet(true)}
                aria-label={t('aria_message_options')}
              >
                <MoreVertical className="size-4 text-theme-muted" aria-hidden="true" />
              </Button>
            </div>
          )}

          {/* Desktop: action buttons shown on hover (only when not editing) */}
          {canUseActions && !isMobileSheet && (
            <div className={`absolute -bottom-2 ${isOwn ? '-left-24' : '-right-24'} flex gap-1 opacity-100 pointer-coarse:opacity-100 any-pointer-coarse:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 transition-opacity`}>
              {/* Reaction button */}
              <Button
                isIconOnly
                variant="tertiary"
                className="size-11 min-h-11 min-w-11 p-0 bg-theme-elevated rounded-full border border-theme-default focus-visible:opacity-100"
                onPress={() => setShowReactionPicker(!showReactionPicker)}
                aria-label={t('aria_add_reaction')}
              >
                <SmilePlus className="size-4 text-theme-muted" aria-hidden="true" />
              </Button>

              {/* Edit/Delete button — shown for all messages (receiver can delete for themselves or everyone) */}
              {!isVoiceMessage && (
                <Button
                  isIconOnly
                  variant="tertiary"
                  className="size-11 min-h-11 min-w-11 p-0 bg-theme-elevated rounded-full border border-theme-default focus-visible:opacity-100"
                  onPress={() => setShowMessageMenu(!showMessageMenu)}
                  aria-label={t('aria_message_options')}
                >
                  <MoreVertical className="size-4 text-theme-muted" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}

          {/* Reaction picker */}
          {showReactionPicker && (
            <div
              ref={reactionPickerRef}
              className={`
                absolute ${isOwn ? 'left-0' : 'right-0'} -top-10 max-w-[calc(100dvw-2rem)] overflow-x-auto
                flex gap-1 p-1.5 bg-theme-card rounded-full border border-theme-default
                shadow-lg z-10
              `}
              role="menu"
              aria-label={t('aria_add_reaction')}
            >
              {REACTION_EMOJIS.map((emoji) => (
                <Button
                  key={emoji}
                  isIconOnly
                  variant="tertiary"
                  className="size-11 min-h-11 min-w-11 p-0 rounded-full"
                  onPress={() => {
                    onReact?.(message.id, emoji);
                    setShowReactionPicker(false);
                  }}
                  aria-label={t('aria_react_with', { emoji })}
                >
                  {emoji}
                </Button>
              ))}
            </div>
          )}

          {/* Message menu (edit/delete) */}
          {showMessageMenu && (
            <div
              ref={messageMenuRef}
              className={`
                absolute ${isOwn ? 'left-0' : 'right-0'} -top-16
                flex flex-col p-1 bg-theme-card rounded-lg border border-theme-default
                shadow-lg z-10 min-w-[100px] max-w-[calc(100dvw-2rem)]
              `}
              role="menu"
              aria-label={t('aria_message_options')}
            >
              {isOwn && (
                <Button
                  variant="tertiary"
                  size="sm"
                  className="min-h-11 justify-start text-sm text-theme-muted"
                  startContent={<Pencil className="w-3 h-3" aria-hidden="true" />}
                  onPress={() => {
                    onEdit?.(message);
                    setShowMessageMenu(false);
                  }}
                  role="menuitem"
                >
                  {t('message_edit')}
                </Button>
              )}
              <Button
                variant="danger-soft"
                size="sm"
                className="min-h-11 justify-start text-sm text-red-600 dark:text-red-400"
                startContent={<Trash2 className="w-3 h-3" aria-hidden="true" />}
                onPress={() => {
                  onDelete?.(message.id);
                  setShowMessageMenu(false);
                }}
                role="menuitem"
              >
                {t('message_delete')}
              </Button>
            </div>
          )}

          {/* Mobile action sheet — reactions + message actions in one native
              bottom sheet (opened by long-press or the ⋮ button). */}
          {isMobileSheet && canUseActions && (
            <BottomSheet
              isOpen={showActionSheet}
              onClose={() => setShowActionSheet(false)}
              title={t('aria_message_options')}
              snapPoints={['auto']}
            >
              <div className="flex items-center justify-between gap-1 pb-4">
                {REACTION_EMOJIS.map((emoji) => (
                  <Button
                    key={emoji}
                    isIconOnly
                    variant="tertiary"
                    className="size-11 min-h-11 min-w-11 rounded-full text-2xl"
                    onPress={() => {
                      onReact?.(message.id, emoji);
                      setShowActionSheet(false);
                    }}
                    aria-label={t('aria_react_with', { emoji })}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
              <div className="flex flex-col gap-1 border-t border-theme-default pt-2">
                {!isVoiceMessage && messageText && (
                  <Button
                    variant="tertiary"
                    className="min-h-12 justify-start gap-3 text-theme-primary"
                    startContent={<Copy className="w-4 h-4 text-theme-muted" aria-hidden="true" />}
                    onPress={async () => {
                      try {
                        await navigator.clipboard.writeText(messageText);
                        showToast(t('message_copied'), 'success');
                      } catch {
                        // Clipboard unavailable (permissions/insecure context) — sheet still closes
                      }
                      setShowActionSheet(false);
                    }}
                  >
                    {t('message_copy')}
                  </Button>
                )}
                {isOwn && !isVoiceMessage && (
                  <Button
                    variant="tertiary"
                    className="min-h-12 justify-start gap-3 text-theme-primary"
                    startContent={<Pencil className="w-4 h-4 text-theme-muted" aria-hidden="true" />}
                    onPress={() => {
                      onEdit?.(message);
                      setShowActionSheet(false);
                    }}
                  >
                    {t('message_edit')}
                  </Button>
                )}
                {!isVoiceMessage && (
                  <Button
                    variant="danger-soft"
                    className="min-h-12 justify-start gap-3 text-red-600 dark:text-red-400"
                    startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                    onPress={() => {
                      onDelete?.(message.id);
                      setShowActionSheet(false);
                    }}
                  >
                    {t('message_delete')}
                  </Button>
                )}
              </div>
            </BottomSheet>
          )}
        </div>

        {/* Display existing reactions */}
        {hasReactions && (
          <div className={`flex max-w-full flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'} px-2`}>
            {reactionEntries.map(([emoji, count]) => (
              <Button
                key={emoji}
                size="sm"
                variant="tertiary"
                className="min-h-11 px-2 py-0.5 bg-theme-elevated rounded-full text-xs gap-0.5"
                onPress={() => onReact?.(message.id, emoji)}
                aria-label={t('aria_toggle_reaction', { emoji })}
              >
                <span>{emoji}</span>
                {count > 1 && (
                  <span className="text-theme-subtle">{count}</span>
                )}
              </Button>
            ))}
          </div>
        )}

        <div className={`flex items-center gap-1 mt-1 px-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
          <span className="text-xs text-theme-subtle">
            {new Date(message.created_at || message.sent_at || Date.now()).toLocaleTimeString(getFormattingLocale(), {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {/* Read receipts - only show for own messages */}
          {isOwn && (
            <span
              className="text-theme-subtle"
              role="img"
              aria-label={
                message.is_read || message.read_at
                  ? t('aria_read_receipt_read')
                  : t('aria_read_receipt_sent')
              }
            >
              {message.is_read || message.read_at ? (
                <CheckCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              ) : (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
});

function ProtectedAttachment({ attachment }: {
  attachment: { id: number | string; url: string; type: string; name: string; size: number };
}) {
  const previewUrl = useAuthenticatedMedia(attachment.type === 'image' ? attachment.url : undefined);

  const download = useCallback(() => {
    if (!attachment.url.startsWith('/api/')) return;
    void api.download(attachment.url.slice(4), { filename: attachment.name });
  }, [attachment.name, attachment.url]);

  return (
    <Button
      variant="tertiary"
      onPress={download}
      className="block h-auto min-w-0 max-w-full p-0"
      aria-label={attachment.name}
    >
      {attachment.type === 'image' && previewUrl ? (
        <img
          src={previewUrl}
          alt={attachment.name}
          className="max-h-[200px] max-w-[min(200px,70vw)] rounded-lg object-cover transition-opacity hover:opacity-90"
          loading="lazy"
        />
      ) : (
        <div className="flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-black/10 px-3 py-2 transition-colors hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20">
          <FileText className="h-4 w-4 shrink-0 opacity-60" />
          <div className="flex min-w-0 flex-col">
            <span className="max-w-[min(150px,55vw)] truncate text-xs opacity-80">{attachment.name}</span>
            <span className="text-[10px] opacity-40">
              {formatNumber(attachment.size / 1024, {
                style: 'unit', unit: 'kilobyte', unitDisplay: 'short', maximumFractionDigits: 1,
              })}
            </span>
          </div>
        </div>
      )}
    </Button>
  );
}
