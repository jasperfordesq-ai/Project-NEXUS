// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * EventTab — quick event creation form for the Compose Hub.
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
import { TimeInput, type TimeInputValue, Button, Input, Textarea } from '@/components/ui';
import { eventsApi } from '@/lib/events-api';
import { logError } from '@/lib/logger';
import { PlaceAutocompleteInput } from '@/components/location/PlaceAutocompleteInput';
import { AiAssistButton } from '../shared/AiAssistButton';
import { CharacterCount } from '../shared/CharacterCount';
import { EmojiPicker } from '../shared/EmojiPicker';
import { useComposeSubmit } from '../ComposeSubmitContext';
import type { TabSubmitProps } from '../types';

const inputClasses = {
  input: 'bg-transparent text-[var(--text-primary)] text-base',
  inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
};

const MAX_DESC_CHARS = 3000;

/** Convert DateInputValue + optional TimeInputValue to ISO string */
function toIsoString(date: DateInputValue, time: TimeInputValue | null): string {
  const dateStr = date.toString(); // "2026-02-21"
  if (time) {
    const h = String(time.hour).padStart(2, '0');
    const m = String(time.minute).padStart(2, '0');
    return `${dateStr}T${h}:${m}:00`;
  }
  return `${dateStr}T00:00:00`;
}

interface EventDraft {
  title: string;
  description: string;
}

export function EventTab({ onSuccess, onClose, groupId, templateData }: TabSubmitProps) {
  const { t } = useTranslation('feed');
  const toast = useToast();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { register, unregister } = useComposeSubmit();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const submitRef = useRef<() => void>(() => {});
  const geocodedAddressRef = useRef<string | null>(null);

  const [draft, setDraft, clearDraft] = useDraftPersistence<EventDraft>(
    // F-109: drafts belong to one member of one community.
    userScopedStorageKey('compose-draft-event', tenant?.id, user?.id),
    { title: '', description: '' },
  );

  const [startDate, setStartDate] = useState<DateInputValue | null>(null);
  const [startTime, setStartTime] = useState<TimeInputValue | null>(null);
  const [endDate, setEndDate] = useState<DateInputValue | null>(null);
  const [endTime, setEndTime] = useState<TimeInputValue | null>(null);
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
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

  const canSubmit = draft.title.trim().length > 0 && startDate !== null;

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
    if (!draft.title.trim()) {
      toast.error(t('compose.event_title_required'));
      return;
    }
    if (!startDate) {
      toast.error(t('compose.event_date_required'));
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: draft.title.trim(),
        start_time: toIsoString(startDate, startTime),
      };
      if (draft.description.trim()) payload.description = draft.description.trim();
      if (endDate) payload.end_time = toIsoString(endDate, endTime);
      if (location) payload.location = location;
      if (latitude != null) payload.latitude = latitude;
      if (longitude != null) payload.longitude = longitude;
      if (groupId) payload.group_id = groupId;

      const res = await eventsApi.create(payload);
      if (res.success) {
        clearDraft();
        toast.success(t('compose.event_created'));
        onClose();
        onSuccess('event', res.data?.id);
      } else {
        toast.error(t('compose.event_failed'));
      }
    } catch (err) {
      logError('Failed to create event', err);
      toast.error(t('compose.event_failed'));
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
      buttonLabel: t('compose.create_event'),
      gradientClass: 'from-emerald-500 to-teal-600',
    });
    return unregister;
  }, [canSubmit, isSubmitting, register, unregister, t]);

  return (
    <div className="space-y-4">
      <Input
        label={t('compose.event_title_label')}
        placeholder={t('compose.event_title_placeholder')}
        value={draft.title}
        onChange={(e) => setTitle(e.target.value)}
        isRequired
        classNames={inputClasses}
      />

      <div>
        <Textarea
          label={t('compose.description_label')}
          placeholder={t('compose.event_desc_placeholder')}
          value={draft.description}
          onChange={(e) => setDescription(e.target.value)}
          minRows={2}
          maxRows={5}
          classNames={inputClasses}
        />
        <CharacterCount current={draft.description.length} max={MAX_DESC_CHARS} />
        <div className="flex justify-end mt-1">
          <AiAssistButton
            type="event"
            title={draft.title}
            onGenerated={setDescription}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DatePicker
          label={t('compose.start_date_label')}
          value={startDate}
          onChange={setStartDate}
          granularity="day"
          minValue={today(getLocalTimeZone())}
          isRequired
          classNames={{
            inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
          }}
        />
        <TimeInput
          label={t('compose.start_time_label')}
          value={startTime}
          onChange={setStartTime}
          classNames={{
            inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
          }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DatePicker
          label={t('compose.end_date_label')}
          value={endDate}
          onChange={setEndDate}
          granularity="day"
          minValue={startDate || today(getLocalTimeZone())}
          classNames={{
            inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
          }}
        />
        <TimeInput
          label={t('compose.end_time_label')}
          value={endTime}
          onChange={setEndTime}
          classNames={{
            inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)] hover:border-[var(--color-primary)]/40',
          }}
        />
      </div>

      <PlaceAutocompleteInput
        label={t('compose.location_label')}
        placeholder={t('compose.location_placeholder')}
        value={location}
        onPlaceSelect={(place) => {
          geocodedAddressRef.current = place.formattedAddress;
          setLocation(place.formattedAddress);
          setLatitude(place.lat);
          setLongitude(place.lng);
        }}
        onChange={(value) => {
          if (
            geocodedAddressRef.current !== null
            && value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
              !== geocodedAddressRef.current.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
          ) {
            geocodedAddressRef.current = null;
            setLatitude(undefined);
            setLongitude(undefined);
          }
          setLocation(value);
        }}
      />

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
              className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20"
              onPress={handleSubmit}
              isLoading={isSubmitting}
              isDisabled={!canSubmit}
            >
              {t('compose.create_event')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
