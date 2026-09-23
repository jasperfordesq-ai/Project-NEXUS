// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PollTab — poll creation form with question, options, and end date.
 * Now with character count, draft persistence, and emoji picker.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { DateInputValue } from '@/components/ui';
import { DatePicker } from '@/components/ui';
import { today, getLocalTimeZone } from '@internationalized/date';
import Plus from 'lucide-react/icons/plus';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant, useToast } from '@/contexts';
import { userScopedStorageKey } from '@/lib/userScopedStorage';
import { useDraftPersistence } from '@/hooks';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';
import { CharacterCount } from '../shared/CharacterCount';
import { EmojiPicker } from '../shared/EmojiPicker';
import { useComposeSubmit } from '../ComposeSubmitContext';
import type { TabSubmitProps } from '../types';
import { Button, Input, Avatar } from '@/components/ui';

const MAX_QUESTION_CHARS = 500;

interface PollDraft {
  question: string;
  options: string[];
}

export function PollTab({ onSuccess, onClose, groupId, templateData }: TabSubmitProps) {
  const { t } = useTranslation('feed');
  const { user } = useAuth();
  const { tenant } = useTenant();
  const toast = useToast();
  const { register, unregister } = useComposeSubmit();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const submitRef = useRef<() => void>(() => {});

  const [draft, setDraft, clearDraft] = useDraftPersistence<PollDraft>(
    // F-109: drafts belong to one member of one community.
    userScopedStorageKey('compose-draft-poll', tenant?.id, user?.id),
    { question: '', options: ['', ''] },
  );

  const [expiresAt, setExpiresAt] = useState<DateInputValue | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Apply template data when selected from TemplatePicker
  useEffect(() => {
    if (templateData) {
      setDraft((prev) => ({ ...prev, question: templateData.content }));
    }
  }, [templateData, setDraft]);

  const validOptions = draft.options.map((o) => o.trim()).filter((o) => o.length > 0);
  const canSubmit = draft.question.trim().length > 0 && validOptions.length >= 2;

  const setQuestion = useCallback(
    (q: string) => setDraft((prev) => ({ ...prev, question: q })),
    [setDraft],
  );

  const addOption = () => {
    if (draft.options.length < 6) {
      setDraft((prev) => ({ ...prev, options: [...prev.options, ''] }));
    }
  };

  const updateOption = (index: number, value: string) => {
    setDraft((prev) => {
      const updated = [...prev.options];
      updated[index] = value;
      return { ...prev, options: updated };
    });
  };

  const removeOption = (index: number) => {
    if (draft.options.length > 2) {
      setDraft((prev) => ({
        ...prev,
        options: prev.options.filter((_, i) => i !== index),
      }));
    }
  };

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      setDraft((prev) => ({ ...prev, question: prev.question + emoji }));
    },
    [setDraft],
  );

  const handleSubmit = async () => {
    if (!draft.question.trim()) {
      toast.error(t('compose.poll_question_required'));
      return;
    }
    if (validOptions.length < 2) {
      toast.error(t('compose.poll_min_options'));
      return;
    }
    if (expiresAt) {
      const expiry = new Date(expiresAt.toString());
      if (expiry <= new Date()) {
        toast.error(t('poll.expiry_past'));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        question: draft.question.trim(),
        options: validOptions,
      };

      if (expiresAt) {
        payload.expires_at = expiresAt.toString();
      }
      if (groupId) {
        payload.group_id = groupId;
      }

      const res = await api.post('/v2/feed/polls', payload);
      if (res.success) {
        clearDraft();
        toast.success(t('compose.poll_created'));
        onClose();
        onSuccess('poll');
      } else {
        toast.error(t('compose.poll_failed'));
      }
    } catch (err) {
      logError('Failed to create poll', err);
      toast.error(t('compose.poll_failed'));
    } finally {
      setIsSubmitting(false);
    }
  };
  submitRef.current = handleSubmit;

  // Register submit capabilities for mobile header button
  useEffect(() => {
    register({
      canSubmit,
      isSubmitting,
      onSubmit: () => submitRef.current(),
      buttonLabel: t('compose.create_poll'),
      gradientClass: 'from-amber-500 to-orange-600',
    });
    return unregister;
  }, [canSubmit, isSubmitting, register, unregister, t]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Avatar
          name={user?.first_name || 'You'}
          src={resolveAvatarUrl(user?.avatar)}
          size="sm"
          className="mt-1"
          isBordered
        />
        <div className="flex-1">
          <Input
            placeholder={t('compose.poll_question_placeholder')}
            aria-label={t('compose.poll_question_placeholder')}
            value={draft.question}
            onChange={(e) => setQuestion(e.target.value)}
            classNames={{
              input: 'bg-transparent text-[var(--text-primary)] text-base',
              inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
            }}
          />
          <CharacterCount current={draft.question.length} max={MAX_QUESTION_CHARS} />
        </div>
      </div>

      <div className="space-y-2 pl-0 sm:pl-11">
        {draft.options.map((opt, index) => (
          <div key={`option-${index}`} className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-[var(--border-default)] flex-shrink-0 flex items-center justify-center text-[10px] text-[var(--text-subtle)] font-medium">
              {index + 1}
            </div>
            <Input
              placeholder={t('compose.poll_option_placeholder', { number: index + 1 })}
              aria-label={`Poll option ${index + 1}`}
              value={opt}
              onChange={(e) => updateOption(index, e.target.value)}
              size="sm"
              classNames={{
                input: 'bg-transparent text-[var(--text-primary)] text-base',
                inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
              }}
            />
            {draft.options.length > 2 && (
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                className="size-11 min-h-11 text-[var(--text-muted)] hover:text-danger"
                onPress={() => removeOption(index)}
                aria-label={`Remove option ${index + 1}`}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        ))}

        {draft.options.length < 6 && (
          <Button
            size="sm"
            variant="secondary"
            className="bg-[var(--surface-elevated)] text-[var(--color-primary)]"
            startContent={<Plus className="w-3 h-3" aria-hidden="true" />}
            onPress={addOption}
          >
            {t('compose.add_option')}
          </Button>
        )}

        {validOptions.length < 2 && (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('poll.min_options_hint')}
          </p>
        )}

        <DatePicker
          label={t('compose.poll_end_date')}
          value={expiresAt}
          onChange={setExpiresAt}
          granularity="day"
          minValue={today(getLocalTimeZone())}
          classNames={{
            inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
          }}
          description={t('compose.poll_no_deadline')}
        />
      </div>

      <div className={`flex items-center justify-between pt-1 ${isMobile ? 'sticky bottom-0 bg-[var(--surface-base)] py-3 border-t border-[var(--border-default)]' : ''}`}>
        <div className="flex items-center gap-1">
          <EmojiPicker onSelect={handleEmojiSelect} />
        </div>

        {!isMobile && (
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              size="sm"
              onPress={onClose}
              className="text-[var(--text-muted)]"
            >
              {t('compose.cancel')}
            </Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/20"
              onPress={handleSubmit}
              isLoading={isSubmitting}
              isDisabled={!canSubmit}
            >
              {t('compose.create_poll')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
