// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GoalTab — personal/community goal creation form for the Compose Hub.
 * Now with character count and draft persistence.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { DateInputValue } from '@/components/ui';
import { DatePicker } from '@/components/ui';
import { today, getLocalTimeZone } from '@internationalized/date';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant, useToast } from '@/contexts';
import { userScopedStorageKey } from '@/lib/userScopedStorage';
import { useDraftPersistence } from '@/hooks';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { CharacterCount } from '../shared/CharacterCount';
import { EmojiPicker } from '../shared/EmojiPicker';
import { useComposeSubmit } from '../ComposeSubmitContext';
import type { TabSubmitProps } from '../types';
import { Button, Input, Textarea, Switch } from '@/components/ui';

const inputClasses = {
  input: 'bg-transparent text-[var(--text-primary)] text-base',
  inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
};

const MAX_DESC_CHARS = 1000;

interface GoalDraft {
  title: string;
  description: string;
}

export function GoalTab({ onSuccess, onClose, templateData }: TabSubmitProps) {
  const { t } = useTranslation('feed');
  const toast = useToast();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { register, unregister } = useComposeSubmit();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const submitRef = useRef<() => void>(() => {});

  const [draft, setDraft, clearDraft] = useDraftPersistence<GoalDraft>(
    // F-109: drafts belong to one member of one community.
    userScopedStorageKey('compose-draft-goal', tenant?.id, user?.id),
    { title: '', description: '' },
  );

  const [targetValue, setTargetValue] = useState('');
  const [deadline, setDeadline] = useState<DateInputValue | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Apply template data when selected from TemplatePicker
  useEffect(() => {
    if (templateData) {
      setDraft((prev) => ({
        ...prev,
        title: templateData.title || prev.title,
        description: templateData.content,
      }));
    }
  }, [templateData, setDraft]);

  const canSubmit = draft.title.trim().length > 0;

  const setTitle = useCallback(
    (v: string) => setDraft((prev) => ({ ...prev, title: v })),
    [setDraft],
  );
  const setDescription = useCallback(
    (v: string) => setDraft((prev) => ({ ...prev, description: v })),
    [setDraft],
  );

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      setDraft((prev) => ({ ...prev, description: prev.description + emoji }));
    },
    [setDraft],
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: draft.title.trim(),
      };
      if (draft.description.trim()) payload.description = draft.description.trim();
      if (targetValue) payload.target_value = parseFloat(targetValue) || 0;
      if (deadline) payload.deadline = deadline.toString();
      payload.is_public = isPublic;

      const res = await api.post('/v2/goals', payload);
      if (res.success) {
        clearDraft();
        toast.success(t('compose.goal_created'));
        onClose();
        onSuccess('goal');
      } else {
        toast.error(t('compose.goal_failed'));
      }
    } catch (err) {
      logError('Failed to create goal', err);
      toast.error(t('compose.goal_failed'));
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
      buttonLabel: t('compose.create_goal'),
      gradientClass: 'from-accent to-pink-600',
    });
    return unregister;
  }, [canSubmit, isSubmitting, register, unregister, t]);

  return (
    <div className="space-y-4">
      <Input
        label={t('compose.goal_title_label')}
        placeholder={t('compose.goal_title_placeholder')}
        value={draft.title}
        onChange={(e) => setTitle(e.target.value)}
        isRequired
        classNames={inputClasses}
      />

      <div>
        <Textarea
          label={t('compose.description_label')}
          placeholder={t('compose.goal_desc_placeholder')}
          value={draft.description}
          onChange={(e) => setDescription(e.target.value)}
          minRows={2}
          maxRows={5}
          classNames={inputClasses}
        />
        <CharacterCount current={draft.description.length} max={MAX_DESC_CHARS} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          type="number"
          label={t('compose.target_value_label')}
          placeholder={t('compose.target_value_placeholder')}
          value={targetValue}
          onChange={(e) => setTargetValue(e.target.value)}
          classNames={inputClasses}
        />
        <DatePicker
          label={t('compose.deadline_label')}
          value={deadline}
          onChange={setDeadline}
          granularity="day"
          minValue={today(getLocalTimeZone())}
          classNames={{
            inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
          }}
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-default)]">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">{t('compose.make_public')}</p>
          <p className="text-xs text-[var(--text-muted)]">{t('compose.make_public_desc')}</p>
        </div>
        <Switch
          isSelected={isPublic}
          onValueChange={setIsPublic}
          size="sm"
          aria-label={t('compose.make_public')}
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
              className="bg-gradient-to-r from-accent to-pink-600 text-white shadow-lg shadow-accent/20"
              onPress={handleSubmit}
              isLoading={isSubmitting}
              isDisabled={!canSubmit}
            >
              {t('compose.create_goal')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
