// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { useState, type RefObject, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';import Send from 'lucide-react/icons/send';
import Mic from 'lucide-react/icons/mic';
import Square from 'lucide-react/icons/square';
import Paperclip from 'lucide-react/icons/paperclip';
import ChevronRight from 'lucide-react/icons/chevron-right';
import X from 'lucide-react/icons/x';
import FileText from 'lucide-react/icons/file-text';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '@/contexts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { GifPicker } from '@/components/compose/GifPicker';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

export interface AttachmentPreview {
  file: File;
  preview: string;
  type: 'image' | 'file';
}

export interface MessageInputAreaProps {
  isDirectMessagingEnabled: boolean;
  messagingRestriction: {
    messaging_disabled: boolean;
    under_monitoring: boolean;
    restriction_reason: string | null;
  } | null;
  safeguardingPolicyStatus?: 'allow' | 'deny' | 'unavailable';
  // Text message state
  newMessage: string;
  onNewMessageChange: (value: string) => void;
  onSendMessage: (e: FormEvent) => void;
  isSending: boolean;
  // Typing indicator
  onTypingIndicator: (value: string) => void;
  onBlurTypingStop: () => void;
  // Voice recording
  isRecording: boolean;
  recordingTime: number;
  audioBlob: Blob | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  onSendVoiceMessage: () => void;
  onClearAudioBlob: () => void;
  // Attachments
  attachments: File[];
  attachmentPreviews: AttachmentPreview[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (index: number) => void;
  // GIF picker
  onGifSelect?: (gifUrl: string) => void;
}

/**
 * Format recording time as mm:ss
 */
function formatRecordingTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Message input area — text input, attachments, voice recording controls
 */
export function MessageInputArea({
  isDirectMessagingEnabled,
  messagingRestriction,
  safeguardingPolicyStatus = 'allow',
  newMessage,
  onNewMessageChange,
  onSendMessage,
  isSending,
  onTypingIndicator,
  onBlurTypingStop,
  isRecording,
  recordingTime,
  audioBlob,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  onSendVoiceMessage,
  onClearAudioBlob,
  attachments,
  attachmentPreviews,
  fileInputRef,
  onFileSelect,
  onRemoveAttachment,
  onGifSelect,
}: MessageInputAreaProps) {
  const { t } = useTranslation('messages');
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const isSafeguardingBlocked = safeguardingPolicyStatus !== 'allow';
  const isComposerBlocked = !!messagingRestriction?.messaging_disabled || isSafeguardingBlocked;

  // Messenger-style collapse on phones: while the user is composing, the
  // attach/GIF buttons fold into a single chevron so the input gets the full
  // row width. Desktop always shows the full toolbar.
  const isMobile = useMediaQuery('(max-width: 639px)');
  const [mobileToolsOpen, setMobileToolsOpen] = useState(true);
  const showComposeTools = !isMobile || mobileToolsOpen;
  const collapseTools = () => {
    if (isMobile) setMobileToolsOpen(false);
  };

  return (
    <div className="border-t border-theme-default p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:p-4">
      {/* Messaging disabled notice (feature flag) */}
      {!isDirectMessagingEnabled && (
        <div className="flex flex-col items-stretch gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-center sm:flex-row sm:items-center">
          <span className="text-theme-warning text-sm flex-1">
            {t('disabled_inline')}
          </span>
          <Button
            size="sm"
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            onPress={() => navigate(tenantPath('/exchanges'))}
          >
            {t('exchanges_link')}
          </Button>
        </div>
      )}

      {/* Messaging restricted by broker/admin */}
      {isDirectMessagingEnabled && messagingRestriction?.messaging_disabled && (
        <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg" role="alert">
          <AlertTriangle className="w-5 h-5 text-[var(--color-error)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-theme-danger text-sm font-medium">
              {t('messaging_restricted_title')}
            </p>
            <p className="text-red-600/80 dark:text-red-400/80 text-xs mt-1">
              {t('messaging_restricted_contact')}
            </p>
          </div>
        </div>
      )}

      {/* Safeguarding: composer replaced — direct contact requires coordinator/vetting.
          The full safeguarding panel (with the "Request coordinator help" action) renders
          above the message list; this is the in-composer explanation of why there is no input. */}
      {isDirectMessagingEnabled && !messagingRestriction?.messaging_disabled && isSafeguardingBlocked && (
        <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg" role="status">
          <AlertTriangle className="w-5 h-5 text-[var(--color-warning)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-theme-warning text-sm flex-1">
            {t(safeguardingPolicyStatus === 'unavailable'
              ? 'composer_blocked_safeguarding_unavailable'
              : 'composer_blocked_safeguarding')}
          </p>
        </div>
      )}

      {/* Voice recording preview */}
      {isDirectMessagingEnabled && !isComposerBlocked && audioBlob && !isRecording && (
        <div className="flex min-w-0 flex-col gap-3 mb-3 p-3 bg-theme-elevated rounded-lg sm:flex-row sm:items-center">
          <VoiceMessagePlayer audioBlob={audioBlob} />
          <div className="flex gap-2 sm:ml-auto">
            <Button
              size="sm"
              variant="secondary"
              className="bg-theme-elevated text-theme-muted"
              onPress={onClearAudioBlob}
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white dark:text-white"
              onPress={onSendVoiceMessage}
              isLoading={isSending}
            >
              {t('send')}
            </Button>
          </div>
        </div>
      )}

      {/* Recording indicator */}
      {isDirectMessagingEnabled && !isComposerBlocked && isRecording && (
        <div className="flex flex-wrap items-center gap-3 mb-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse shrink-0" aria-hidden="true" />
          <span className="text-theme-primary font-medium">{formatRecordingTime(recordingTime)}</span>
          <span className="min-w-0 text-theme-subtle text-sm">{t('recording')}</span>
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <Button
              size="sm"
              variant="secondary"
              className="bg-theme-elevated text-theme-muted"
              onPress={onCancelRecording}
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onPress={onStopRecording}
              startContent={<Square className="w-3 h-3" />}
            >
              {t('stop_recording')}
            </Button>
          </div>
        </div>
      )}

      {/* Attachment previews */}
      {isDirectMessagingEnabled && !isComposerBlocked && attachmentPreviews.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {attachmentPreviews.map((item, index) => (
            <div key={item.preview} className="relative group">
              {item.type === 'image' ? (
                <img
                  src={item.preview}
                  alt={item.file.name}
                  className="w-16 h-16 object-cover rounded-lg border border-theme-default"
                />
              ) : (
                <div className="w-16 h-16 flex flex-col items-center justify-center bg-theme-elevated rounded-lg border border-theme-default">
                  <FileText className="w-6 h-6 text-theme-subtle" aria-hidden="true" />
                  <span className="text-[10px] text-theme-subtle truncate max-w-14 px-1">
                    {item.file.name.split('.').pop()?.toUpperCase()}
                  </span>
                </div>
              )}
              <Button
                isIconOnly
                size="sm"
                className="absolute -top-1.5 -right-1.5 w-6 h-6 min-w-0 bg-red-500 rounded-full shadow-sm flex items-center justify-center"
                onPress={() => onRemoveAttachment(index)}
                aria-label={t('aria_remove_attachment', { name: item.file.name })}
              >
                <X className="w-3.5 h-3.5 text-white" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Text input form */}
      {isDirectMessagingEnabled && !isComposerBlocked && !isRecording && !audioBlob && (
        <form onSubmit={onSendMessage} className="flex min-w-0 items-end gap-2 sm:gap-3">
          {/* Hidden file input — triggered programmatically via the labelled Button; hidden from AT */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt"
            className="hidden"
            onChange={onFileSelect}
            aria-hidden="true"
            tabIndex={-1}
          />
          {showComposeTools ? (
            <>
              {/* Attachment button */}
              <Button
                type="button"
                isIconOnly
                variant="secondary"
                className="shrink-0 bg-theme-elevated text-theme-muted hover:text-theme-primary"
                onPress={() => fileInputRef.current?.click()}
                aria-label={t('aria_add_attachment')}
                isDisabled={attachments.length >= 5}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              {/* GIF picker */}
              {onGifSelect && (
                <GifPicker onSelect={onGifSelect} />
              )}
            </>
          ) : (
            /* Collapsed compose tools (mobile, while typing) — chevron re-expands */
            <Button
              type="button"
              isIconOnly
              variant="secondary"
              className="shrink-0 bg-theme-elevated text-theme-muted"
              onPress={() => setMobileToolsOpen(true)}
              aria-label={t('aria_show_compose_tools')}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1 flex flex-col">
            <Textarea
              // Structural hook for the E2E suite. The fixture used to find this
              // with `textarea[placeholder*="message"]`, which only worked because
              // the placeholder happens to read "Type a message..." in English —
              // it matched nothing the moment the suite ran in any other locale.
              data-message-input=""
              placeholder={t('type_placeholder')}
              value={newMessage}
              maxLength={10000}
              enterKeyHint="send"
              onChange={(e) => {
                onNewMessageChange(e.target.value);
                onTypingIndicator(e.target.value);
                if (e.target.value) collapseTools();
              }}
              onFocus={collapseTools}
              onBlur={() => {
                onBlurTypingStop();
                if (!newMessage.trim()) setMobileToolsOpen(true);
              }}
              onKeyDown={(e) => {
                // Enter sends message, Shift+Enter adds newline
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (newMessage.trim() || attachments.length > 0) {
                    const form = e.currentTarget.closest('form');
                    if (form) form.requestSubmit();
                  }
                }
              }}
              minRows={1}
              maxRows={6}
              classNames={{
                input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle rounded-2xl px-4 py-2.5 leading-6',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
              aria-label={t('aria_message_input')}
            />
            {newMessage.length > 8000 && (
              <p className={`text-xs mt-0.5 text-right ${newMessage.length >= 10000 ? 'text-danger' : 'text-theme-muted'}`}>
                {t('character_count', { current: newMessage.length, max: 10000 })}
              </p>
            )}
          </div>
          {/* Voice recording button - show when no text and no attachments */}
          {!newMessage.trim() && attachments.length === 0 && (
            <Button
              type="button"
              isIconOnly
              variant="secondary"
              className="shrink-0 bg-theme-elevated text-theme-muted hover:text-theme-primary"
              onPress={onStartRecording}
              aria-label={t('aria_record_voice')}
            >
              <Mic className="w-4 h-4" />
            </Button>
          )}
          {/* Send button - show when there's text or attachments */}
          {(newMessage.trim() || attachments.length > 0) && (
            <Button
              type="submit"
              isIconOnly
              // Structural hook for the E2E suite. This button is ICON-ONLY, so
              // the old `button:has-text("Send")` could never match it, and its
              // aria-label is translated. Note it is also conditional — it only
              // exists once there is text or an attachment (see the guard above),
              // so a test must type first and then locate it.
              data-message-send=""
              aria-label={t('aria_send_message')}
              className="shrink-0 bg-gradient-to-r from-accent to-accent-gradient-end text-white dark:text-white"
              isLoading={isSending}
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
