// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { Button as HeroButton, Card as HeroCard, TagGroup, Text } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  createEvent,
  createRecurringEvent,
  commitEventRecurrenceRevision,
  getEvent,
  getEventCategories,
  getEventRecurrenceCapabilities,
  previewEventRecurrenceRevision,
  updateEvent,
  updateRecurringEvent,
  uploadEventImage,
  type CanonicalEvent,
  type CreateEventPayload,
  type EventCategory,
  type EventFederatedVisibilityMutation,
  type EventRecurrenceCapabilities,
  type EventRecurrenceRevisionPatch,
  type EventRecurrenceRevisionPreview,
} from '@/lib/api/events';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { contrastText, withAlpha } from '@/lib/utils/color';
import { parseDecimalInput } from '@/lib/utils/decimal';
import { describeApiError } from '@/lib/api/describeApiError';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import {
  eventIsoToLocalInput,
  eventLocalInputToIso,
  localEventTimeZone,
  shiftEventLocalDate,
} from '@/lib/utils/eventDateTime';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import EmptyState from '@/components/ui/EmptyState';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

const eventCategoryIds = ['workshop', 'social', 'outdoor', 'online', 'meeting', 'training', 'other'] as const;
const MAX_COVER_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_COVER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DEFAULT_EVENT_TIME_ZONE = localEventTimeZone();
const RECURRENCE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
type RecurrenceEndType = 'after_count' | 'on_date' | 'never';
type RecurrenceEditScope = 'single' | 'this_and_future';
const SAFE_RECURRENCE_CAPABILITIES: EventRecurrenceCapabilities = {
  contract_version: 1,
  engine: 'legacy',
  structured_input: true,
  supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'],
  max_occurrences: 52,
  supported_end_types: ['after_count', 'on_date'],
  supports_rolling_never: false,
  supports_effective_revisions: false,
  supports_definition_blueprints: false,
  schema_ready: false,
  rollout_state: 'legacy',
};
type AccessibilityBooleanKey = 'step_free_access' | 'accessible_toilet' | 'hearing_loop' | 'quiet_space' | 'seating_available' | 'accessible_parking';
interface VenueAccessibilityDraft {
  step_free_access: boolean | null;
  accessible_toilet: boolean | null;
  hearing_loop: boolean | null;
  quiet_space: boolean | null;
  seating_available: boolean | null;
  accessible_parking: boolean | null;
  parking_details: string;
  transit_details: string;
  assistance_contact: string;
  notes: string;
}
const EMPTY_VENUE_ACCESSIBILITY: VenueAccessibilityDraft = {
  step_free_access: null,
  accessible_toilet: null,
  hearing_loop: null,
  quiet_space: null,
  seating_available: null,
  accessible_parking: null,
  parking_details: '',
  transit_details: '',
  assistance_contact: '',
  notes: '',
};

function tomorrowLocalValue(timeZone = DEFAULT_EVENT_TIME_ZONE) {
  const value = eventIsoToLocalInput(
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    timeZone,
  );
  return value ? `${value.slice(0, 13)}:00` : '';
}

function toApiDate(value: string, timeZone: string, allDay: boolean, isEnd: boolean) {
  const trimmed = value.trim();
  const dateOnly = trimmed.slice(0, 10);
  const localValue = allDay
    ? `${isEnd ? shiftEventLocalDate(dateOnly, 1) : dateOnly}T00:00`
    : trimmed;
  return eventLocalInputToIso(localValue, timeZone) ?? '';
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function resolveEventCategory(event: CanonicalEvent): string {
  if (event.category?.id) return String(event.category.id);
  return event.category?.slug?.trim().toLowerCase() ?? '';
}

export default function NewEventRoute() {
  return (
    <ModalErrorBoundary>
      <NewEventScreen />
    </ModalErrorBoundary>
  );
}

function NewEventScreen() {
  const { t } = useTranslation(['events', 'common']);
  const params = useLocalSearchParams<{ group_id?: string; id?: string; series_id?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const parsedGroupId = Number(params.group_id);
  const groupId = Number.isFinite(parsedGroupId) && parsedGroupId > 0 ? parsedGroupId : null;
  const eventId = Number(params.id);
  const isEditing = Number.isFinite(eventId) && eventId > 0;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_EVENT_TIME_ZONE);
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(tomorrowLocalValue(DEFAULT_EVENT_TIME_ZONE));
  const [endTime, setEndTime] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [venueAccessibility, setVenueAccessibility] = useState<VenueAccessibilityDraft>({ ...EMPTY_VENUE_ACCESSIBILITY });
  const [videoUrl, setVideoUrl] = useState('');
  const [maxAttendees, setMaxAttendees] = useState('');
  const [allowRemoteAttendance, setAllowRemoteAttendance] = useState(false);
  const [federatedVisibility, setFederatedVisibility] = useState<EventFederatedVisibilityMutation | undefined>(
    isEditing ? undefined : 'none',
  );
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('weekly');
  const [recurrenceDays, setRecurrenceDays] = useState<string[]>([]);
  const [recurrenceEndType, setRecurrenceEndType] = useState<RecurrenceEndType>('after_count');
  const [recurrenceCount, setRecurrenceCount] = useState('10');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [recurrenceCapabilities, setRecurrenceCapabilities] = useState<EventRecurrenceCapabilities>(
    SAFE_RECURRENCE_CAPABILITIES,
  );
  const [isRecurringSeries, setIsRecurringSeries] = useState(false);
  const [recurrenceEditScope, setRecurrenceEditScope] = useState<RecurrenceEditScope>('single');
  const [revisionPreview, setRevisionPreview] = useState<EventRecurrenceRevisionPreview | null>(null);
  const [revisionPatch, setRevisionPatch] = useState<EventRecurrenceRevisionPatch | null>(null);
  const [revisionFingerprint, setRevisionFingerprint] = useState<string | null>(null);
  const revisionIdempotencyKeyRef = useRef<string | null>(null);
  const originalScheduleRef = useRef<{
    timezone: string;
    allDay: boolean;
    startDate: string;
    endDate: string | null;
    startClock: string | null;
    endClock: string | null;
    /** The stored start instant, so an unchanged past start is not re-validated as "future" (S4-18). */
    startIso: string | null;
  } | null>(null);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [existingCoverImage, setExistingCoverImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [hasHydratedEdit, setHasHydratedEdit] = useState(false);
  const [editLoadFailed, setEditLoadFailed] = useState(false);
  const [editRetryToken, setEditRetryToken] = useState(0);
  const attemptedEditRetryRef = useRef<number | null>(null);
  const parsedSeriesId = Number(params.series_id);
  const [seriesId, setSeriesId] = useState<number | null>(
    Number.isFinite(parsedSeriesId) && parsedSeriesId > 0 ? parsedSeriesId : null,
  );
  const fallbackHref = isEditing
    ? ({ pathname: '/(modals)/event-detail', params: { id: String(eventId) } } as unknown as Href)
    : groupId
      ? ({ pathname: '/(modals)/group-detail', params: { id: String(groupId) } } as unknown as Href)
      : '/(tabs)/events';

  // Mount tracking lives in its own effect so a re-render mid-fetch (a toast, a category
  // response, a re-created `t`) cannot cancel the hydration through a dependency cleanup.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!isEditing || hasHydratedEdit || attemptedEditRetryRef.current === editRetryToken) return;
    attemptedEditRetryRef.current = editRetryToken;

    setEditLoadFailed(false);
    getEvent(eventId)
      .then((response) => {
        if (!isMountedRef.current) return;
        if (!response.data.permissions.edit) throw new Error('EVENT_EDIT_NOT_ALLOWED');
        hydrateFromEvent(response.data);
        setHasHydratedEdit(true);
      })
      .catch(() => {
        if (!isMountedRef.current) return;
        // 🔴 Not a dead form. A failed hydration used to leave the empty fields on screen
        // with a live "Update event" button — one tap would have overwritten the server
        // record with blanks (audit 2026-09-05, S4-03). The form is withheld until the
        // event loads, and the failure is shown with a retry.
        setEditLoadFailed(true);
        showToastRef.current({
          title: tRef.current('create.failedTitle'),
          description: tRef.current('create.loadFailed'),
          variant: 'danger',
        });
      });
    // hydrateFromEvent is a plain closure over setters; the ref-based reads above are
    // deliberate so the fetch does not restart on every render.
     
  }, [editRetryToken, eventId, hasHydratedEdit, isEditing]);

  useEffect(() => {
    let isMounted = true;
    getEventCategories()
      .then((response) => {
        if (isMounted) setCategories(response.data);
      })
      .catch(() => {
        if (isMounted) setCategories([]);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    getEventRecurrenceCapabilities()
      .then((response) => {
        if (!isMounted) return;
        const capabilities = response.data;
        setRecurrenceCapabilities(capabilities);
        setRecurrenceFrequency((current) => {
          const serverFrequency = current === 'biweekly' ? 'weekly' : current;
          return capabilities.supported_frequencies.includes(serverFrequency)
            ? current
            : (capabilities.supported_frequencies[0] ?? 'weekly');
        });
        setRecurrenceEndType((current) => (
          capabilities.supported_end_types.includes(current)
            && (current !== 'never' || capabilities.supports_rolling_never)
            && (current !== 'after_count' || capabilities.max_occurrences >= 2)
            ? current
            : (capabilities.max_occurrences >= 2 && capabilities.supported_end_types.includes('after_count')
                ? 'after_count'
                : capabilities.supported_end_types.includes('on_date')
                  ? 'on_date'
                  : 'never')
        ));
        setRecurrenceCount((current) => {
          const count = Number(current);
          return Number.isInteger(count) && count > capabilities.max_occurrences
            ? String(capabilities.max_occurrences)
            : current;
        });
        if (!capabilities.supports_effective_revisions) {
          setRecurrenceEditScope('single');
          setRevisionPreview(null);
        }
      })
      .catch(() => {
        // Keep the conservative legacy contract when capability negotiation fails.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  function hydrateFromEvent(event: CanonicalEvent) {
    const eventTimezone = event.schedule.timezone || 'UTC';
    const startLocal = eventIsoToLocalInput(event.schedule.start_at, eventTimezone);
    const endBoundaryLocal = eventIsoToLocalInput(event.schedule.end_at, eventTimezone);
    const visibleEndLocal = event.schedule.all_day && endBoundaryLocal
      ? shiftEventLocalDate(endBoundaryLocal.slice(0, 10), -1)
      : endBoundaryLocal;
    originalScheduleRef.current = {
      timezone: eventTimezone,
      allDay: event.schedule.all_day,
      startDate: startLocal.slice(0, 10),
      endDate: visibleEndLocal ? visibleEndLocal.slice(0, 10) : null,
      startClock: event.schedule.all_day ? null : startLocal.slice(11, 16),
      endClock: event.schedule.all_day || !endBoundaryLocal ? null : endBoundaryLocal.slice(11, 16),
      startIso: event.schedule.start_at,
    };
    setTitle(event.title ?? '');
    setDescription(event.description ?? '');
    setTimezone(eventTimezone);
    setAllDay(event.schedule.all_day);
    setStartTime(event.schedule.all_day ? startLocal.slice(0, 10) : startLocal);
    setEndTime(visibleEndLocal);
    setCategory(resolveEventCategory(event));
    setLocation(event.location.label ?? '');
    setLatitude(event.location.latitude !== null ? String(event.location.latitude) : '');
    setLongitude(event.location.longitude !== null ? String(event.location.longitude) : '');
    setVenueAccessibility({
      step_free_access: event.location.accessibility.step_free_access,
      accessible_toilet: event.location.accessibility.accessible_toilet,
      hearing_loop: event.location.accessibility.hearing_loop,
      quiet_space: event.location.accessibility.quiet_space,
      seating_available: event.location.accessibility.seating_available,
      accessible_parking: event.location.accessibility.accessible_parking,
      parking_details: event.location.accessibility.parking_details ?? '',
      transit_details: event.location.accessibility.transit_details ?? '',
      assistance_contact: event.location.accessibility.assistance_contact ?? '',
      notes: event.location.accessibility.notes ?? '',
    });
    setVideoUrl(event.online_access.video_url ?? event.online_access.join_url ?? '');
    setMaxAttendees(event.relationship.capacity.limit !== null ? String(event.relationship.capacity.limit) : '');
    setAllowRemoteAttendance(event.location.mode !== 'in_person');
    setFederatedVisibility(
      event.federated_visibility === 'bookable'
        ? 'joinable'
        : event.federated_visibility ?? undefined,
    );
    setExistingCoverImage(event.primary_image?.url ?? null);
    setSeriesId(event.series.named?.id ?? null);
    setIsRecurringSeries(event.series.recurrence !== null);
    setSelectedImageUri(null);
  }

  function toggleAllDay() {
    const next = !allDay;
    setAllDay(next);
    setStartTime((current) => next
      ? current.slice(0, 10)
      : (current.length === 10 ? `${current}T09:00` : current));
    setEndTime((current) => next
      ? current.slice(0, 10)
      : (current.length === 10 ? `${current}T10:00` : current));
  }

  function currentRevisionFingerprint(): string {
    return JSON.stringify([
      title, description, timezone, allDay, startTime, endTime, category,
      location, latitude, longitude, videoUrl, maxAttendees,
      allowRemoteAttendance, federatedVisibility, seriesId, selectedImageUri,
      venueAccessibility,
    ]);
  }

  // Everything the member can type or choose. Recurrence settings count only once the
  // recurring toggle is on, because capability negotiation may normalise them silently.
  const formFingerprint = JSON.stringify([
    currentRevisionFingerprint(),
    isRecurring,
    isRecurring ? [recurrenceFrequency, recurrenceDays, recurrenceEndType, recurrenceCount, recurrenceEndDate] : null,
  ]);
  // The baseline is the form as first shown: the defaults for a new event, the hydrated
  // values for an edit. Anything different from it is unsaved input worth asking about.
  const baselineRef = useRef<string | null>(null);
  if (!isEditing && baselineRef.current === null) baselineRef.current = formFingerprint;
  useEffect(() => {
    if (isEditing && hasHydratedEdit && baselineRef.current === null) baselineRef.current = formFingerprint;
  }, [formFingerprint, hasHydratedEdit, isEditing]);
  const isDirty = baselineRef.current !== null && formFingerprint !== baselineRef.current;
  // 🔴 A mistaken Back used to drop a whole event description without a word (S4-04).
  useUnsavedChangesGuard({
    isDirty,
    isBusy: isSubmitting || hasSaved,
    confirm,
    title: t('create.unsavedTitle'),
    message: t('create.unsavedMessage'),
    discardLabel: t('create.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const requiredFieldsFilled = title.trim().length > 0
    && description.trim().length > 0
    && startTime.trim().length > 0
    && (!isEditing || hasHydratedEdit);

  async function pickCoverImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      if (asset.mimeType && !ALLOWED_COVER_IMAGE_TYPES.includes(asset.mimeType)) {
        showToast({ title: t('create.validationTitle'), description: t('create.imageTypeError'), variant: 'warning' });
        return;
      }
      if (asset.fileSize && asset.fileSize > MAX_COVER_IMAGE_SIZE) {
        showToast({ title: t('create.validationTitle'), description: t('create.imageSizeError'), variant: 'warning' });
        return;
      }

      setSelectedImageUri(asset.uri);
    } catch (err) {
      showToast({ title: t('create.imagePickFailedTitle'), description: describeApiError(err, t('create.imagePickFailedDescription')), variant: 'danger' });
    }
  }

  async function submit() {
    if (isEditing && !hasHydratedEdit) {
      showToast({ title: t('create.failedTitle'), description: t('create.loadFailed'), variant: 'danger' });
      return;
    }

    const eventTimezone = timezone.trim();
    const startInput = startTime.trim();
    const endInput = endTime.trim();
    if (!title.trim() || !description.trim() || !eventTimezone || !startInput || (allDay && !endInput)) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationRequired'), variant: 'warning' });
      return;
    }
    if (!isValidTimeZone(eventTimezone)) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationRequired'), variant: 'warning' });
      return;
    }

    const start = toApiDate(startTime, eventTimezone, allDay, false);
    const end = endInput ? toApiDate(endTime, eventTimezone, allDay, true) : null;
    // A typed date that does not parse is a FORMAT problem, not a missing field — saying
    // "required" over a filled box sent members in circles (S4-25).
    if (!start || (endInput && !end)) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationDateFormat'), variant: 'warning' });
      return;
    }

    const startDate = new Date(start);
    // An event that has already started may still be edited as long as its start is left
    // alone; only a start the member actually changed has to be in the future (S4-18).
    const startUnchanged = isEditing && originalScheduleRef.current?.startIso !== null
      && originalScheduleRef.current?.startIso !== undefined
      && new Date(originalScheduleRef.current.startIso).getTime() === startDate.getTime();
    if (startDate <= new Date() && !startUnchanged) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationStartFuture'), variant: 'warning' });
      return;
    }

    if (end && new Date(end) <= startDate) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationEndAfterStart'), variant: 'warning' });
      return;
    }

    const parsedMaxAttendees = maxAttendees.trim() ? Number(maxAttendees) : null;
    if (parsedMaxAttendees !== null && (!Number.isFinite(parsedMaxAttendees) || parsedMaxAttendees < 1 || parsedMaxAttendees > 10000)) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationCapacity'), variant: 'warning' });
      return;
    }

    const hasLatitude = latitude.trim().length > 0;
    const hasLongitude = longitude.trim().length > 0;
    const latitudeValue = parseDecimalInput(latitude);
    const longitudeValue = parseDecimalInput(longitude);
    if (
      hasLatitude !== hasLongitude
      || (hasLatitude && (latitudeValue === null || latitudeValue < -90 || latitudeValue > 90))
      || (hasLongitude && (longitudeValue === null || longitudeValue < -180 || longitudeValue > 180))
    ) {
      showToast({ title: t('create.validationTitle'), description: t('create.invalidCoordinates'), variant: 'warning' });
      return;
    }

    if (!isEditing && isRecurring) {
      const count = Number(recurrenceCount);
      const serverFrequency = recurrenceFrequency === 'biweekly' ? 'weekly' : recurrenceFrequency;
      if (
        !recurrenceCapabilities.supported_frequencies.includes(serverFrequency)
        || !recurrenceCapabilities.supported_end_types.includes(recurrenceEndType)
        || (recurrenceEndType === 'never' && !recurrenceCapabilities.supports_rolling_never)
        || (recurrenceEndType === 'after_count' && recurrenceCapabilities.max_occurrences < 2)
        || ((recurrenceFrequency === 'weekly' || recurrenceFrequency === 'biweekly') && recurrenceDays.length === 0)
        || (recurrenceEndType === 'after_count' && (!Number.isInteger(count) || count < 2 || count > recurrenceCapabilities.max_occurrences))
        || (recurrenceEndType === 'on_date' && !/^\d{4}-\d{2}-\d{2}$/.test(recurrenceEndDate))
      ) {
        showToast({
          title: t('create.validationTitle'),
          description: t('create.recurrenceValidation', { max: recurrenceCapabilities.max_occurrences }),
          variant: 'warning',
        });
        return;
      }
    }

    setIsSubmitting(true);
    let successDestination: Parameters<typeof router.push>[0] | null = null;
    let saved = false;
    let attemptedRecurrenceRevision = false;
    try {
      const selectedCategory = categories.find((option) => String(option.id) === category);
      const numericCategoryId = /^\d+$/.test(category) ? Number(category) : null;
      const payload: CreateEventPayload = {
        title: title.trim(),
        description: description.trim(),
        start_time: start,
        end_time: end,
        timezone: eventTimezone,
        all_day: allDay,
        group_id: isEditing ? undefined : groupId,
        location: location.trim() || null,
        latitude: latitudeValue,
        longitude: longitudeValue,
        category_id: selectedCategory?.id ?? numericCategoryId,
        category_name: selectedCategory || numericCategoryId ? null : category || null,
        series_id: seriesId,
        is_online: allowRemoteAttendance,
        allow_remote_attendance: allowRemoteAttendance,
        video_url: allowRemoteAttendance && videoUrl.trim() ? videoUrl.trim() : null,
        max_attendees: parsedMaxAttendees,
        federated_visibility: federatedVisibility,
        venue_accessibility: {
          step_free_access: venueAccessibility.step_free_access,
          accessible_toilet: venueAccessibility.accessible_toilet,
          hearing_loop: venueAccessibility.hearing_loop,
          quiet_space: venueAccessibility.quiet_space,
          seating_available: venueAccessibility.seating_available,
          accessible_parking: venueAccessibility.accessible_parking,
          parking_details: venueAccessibility.parking_details.trim() || null,
          transit_details: venueAccessibility.transit_details.trim() || null,
          assistance_contact: venueAccessibility.assistance_contact.trim() || null,
          notes: venueAccessibility.notes.trim() || null,
        },
      };

      if (!isEditing && isRecurring) {
        payload.recurrence_frequency = recurrenceFrequency === 'biweekly' ? 'weekly' : recurrenceFrequency;
        payload.recurrence_interval = recurrenceFrequency === 'biweekly' ? 2 : 1;
        if (recurrenceFrequency === 'weekly' || recurrenceFrequency === 'biweekly') {
          payload.recurrence_days = recurrenceDays.join(',');
        }
        payload.recurrence_ends_type = recurrenceEndType;
        if (recurrenceEndType === 'after_count') payload.recurrence_ends_after_count = Number(recurrenceCount);
        if (recurrenceEndType === 'on_date') payload.recurrence_ends_on_date = recurrenceEndDate;
      }

      const effectivePatch: EventRecurrenceRevisionPatch = {
        title: payload.title,
        description: payload.description,
        location: payload.location,
        latitude: payload.latitude,
        longitude: payload.longitude,
        category_id: payload.category_id,
        max_attendees: payload.max_attendees,
        is_online: allowRemoteAttendance,
        allow_remote_attendance: allowRemoteAttendance,
        video_url: payload.video_url,
        accessibility_step_free: venueAccessibility.step_free_access,
        accessibility_toilet: venueAccessibility.accessible_toilet,
        accessibility_hearing_loop: venueAccessibility.hearing_loop,
        accessibility_quiet_space: venueAccessibility.quiet_space,
        accessibility_seating: venueAccessibility.seating_available,
        accessibility_parking: venueAccessibility.accessible_parking,
        accessibility_parking_details: venueAccessibility.parking_details.trim() || null,
        accessibility_transit_details: venueAccessibility.transit_details.trim() || null,
        accessibility_assistance_contact: venueAccessibility.assistance_contact.trim() || null,
        accessibility_notes: venueAccessibility.notes.trim() || null,
      };
      const originalSchedule = originalScheduleRef.current;
      const startClock = allDay ? null : startTime.slice(11, 16);
      const endClock = allDay || !endTime ? null : endTime.slice(11, 16);
      if (!originalSchedule || originalSchedule.timezone !== eventTimezone) effectivePatch.timezone = eventTimezone;
      if (!originalSchedule || originalSchedule.allDay !== allDay) effectivePatch.all_day = allDay;
      if (startClock !== null && (!originalSchedule || originalSchedule.startClock !== startClock)) {
        effectivePatch.local_start_time = startClock;
      }
      if (!allDay && (!originalSchedule || originalSchedule.endClock !== endClock)) {
        effectivePatch.local_end_time = endClock;
      }

      if (isEditing && isRecurringSeries && recurrenceEditScope === 'this_and_future') {
        if (!recurrenceCapabilities.supports_effective_revisions) {
          showToast({ title: t('create.validationTitle'), description: t('create.revisionUnavailable'), variant: 'warning' });
          setRecurrenceEditScope('single');
          return;
        }
        if (selectedImageUri) {
          showToast({ title: t('create.validationTitle'), description: t('create.revisionImageUnsupported'), variant: 'warning' });
          return;
        }
        if (originalSchedule && (
          originalSchedule.startDate !== startTime.slice(0, 10)
          || originalSchedule.endDate !== (endTime ? endTime.slice(0, 10) : null)
        )) {
          showToast({ title: t('create.validationTitle'), description: t('create.revisionDateUnsupported'), variant: 'warning' });
          return;
        }
        attemptedRecurrenceRevision = true;
        const preview = await previewEventRecurrenceRevision(eventId, effectivePatch);
        setRevisionPatch(effectivePatch);
        setRevisionPreview(preview.data);
        setRevisionFingerprint(currentRevisionFingerprint());
        revisionIdempotencyKeyRef.current = null;
        return;
      }

      let id = eventId;
      let createdRecurring = false;
      if (isEditing && isRecurringSeries) {
        const result = await updateRecurringEvent(eventId, { ...payload, scope: 'single' });
        id = result.data.id;
      } else if (isEditing) {
        const result = await updateEvent(eventId, payload);
        id = result.data.id;
      } else if (isRecurring) {
        const result = await createRecurringEvent(payload);
        id = result.data.template.id;
        createdRecurring = true;
      } else {
        const result = await createEvent(payload);
        id = result.data.id;
      }
      saved = true;
      setHasSaved(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (id) {
        if (selectedImageUri) {
          try {
            const imageScope = isEditing && isRecurringSeries
              ? 'single'
              : createdRecurring
                ? 'all'
                : undefined;
            if (imageScope) await uploadEventImage(id, selectedImageUri, imageScope);
            else await uploadEventImage(id, selectedImageUri);
          } catch (err) {
            showToast({ title: t('create.imageUploadFailedTitle'), description: describeApiError(err, t('create.imageUploadFailedDescription')), variant: 'danger' });
          }
        }
        successDestination = createdRecurring
          ? '/(tabs)/events'
          : { pathname: '/(modals)/event-detail', params: { id: String(id) } };
      } else {
        // No id came back, so there is nothing to land on — the else branch below leaves the form.
      }
    } catch (err) {
      showToast({
        title: t('create.failedTitle'),
        description: describeApiError(err, t(attemptedRecurrenceRevision ? 'create.revisionUnavailable' : 'create.failedDescription')),
        variant: 'danger',
      });
    } finally {
      setIsSubmitting(false);
    }

    // 🔴 A rejected save used to fall through to the navigation below and leave the form
    // anyway — the toast showed for a frame and every typed field was gone (S4-01).
    if (!saved) return;

    // 🔴 `replace`, not `push`, and it is the difference between working and silent.
    //
    // Measured on a device on 2026-08-22: posting a listing returned 201, the row was
    // written — and the member was left sitting on the filled form with no confirmation of
    // any kind. `router.push` from a screen that was opened as the deep-link ROOT does
    // nothing, and `router.back()` from a root has nothing to go back to, so both arms of
    // the old branch could no-op. The next thing a member does is tap the button again,
    // which posts a duplicate.
    //
    // `replace` lands on the created event whether or not there is a back stack, and it is
    // also the right history: going "back" to a form whose contents have already been
    // posted is a duplicate-post trap in itself.
    if (successDestination) {
      setTimeout(() => router.replace(successDestination), 0);
    } else {
      setTimeout(() => {
        if (typeof router.canGoBack === 'function' && router.canGoBack()) router.back();
        else router.replace('/(tabs)/events');
      }, 0);
    }
  }

  async function commitRevision() {
    if (!revisionPreview?.can_commit || !revisionPatch || !isEditing
      || !recurrenceCapabilities.supports_effective_revisions) return;
    if (revisionFingerprint !== currentRevisionFingerprint()) {
      setRevisionPreview(null);
      setRevisionPatch(null);
      setRevisionFingerprint(null);
      revisionIdempotencyKeyRef.current = null;
      showToast({ title: t('create.validationTitle'), description: t('create.revisionPreviewStale'), variant: 'warning' });
      return;
    }
    setIsSubmitting(true);
    try {
      const idempotencyKey = revisionIdempotencyKeyRef.current ?? randomUUID();
      revisionIdempotencyKeyRef.current = idempotencyKey;
      await commitEventRecurrenceRevision(
        eventId,
        revisionPatch,
        revisionPreview.preview_token,
        idempotencyKey,
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHasSaved(true);
      setRevisionPreview(null);
      setRevisionPatch(null);
      setRevisionFingerprint(null);
      revisionIdempotencyKeyRef.current = null;
      router.replace({ pathname: '/(modals)/event-detail', params: { id: String(eventId) } });
    } catch (err) {
      showToast({ title: t('create.failedTitle'), description: describeApiError(err, t('create.revisionCommitFailed')), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  const categoryOptions = categories.length > 0
    ? categories.map((option) => ({
        id: String(option.id),
        label: option.name,
      }))
    : eventCategoryIds.map((id) => ({
        id,
        label: t(`category.${id}`),
      }));
  const supportedRecurrenceFrequencies = recurrenceCapabilities.supported_frequencies
    .flatMap<RecurrenceFrequency>((frequency) => frequency === 'weekly' ? ['weekly', 'biweekly'] : [frequency]);
  const supportedRecurrenceEndTypes = recurrenceCapabilities.supported_end_types.filter(
    (endType) => (endType !== 'never' || recurrenceCapabilities.supports_rolling_never)
      && (endType !== 'after_count' || recurrenceCapabilities.max_occurrences >= 2),
  );

  return (
    <SafeAreaView testID="new-event-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={isEditing ? t('create.editTitle') : t('create.title')}
        backLabel={t('common:back')}
        fallbackHref={fallbackHref}
      />
      {isEditing && editLoadFailed ? (
        <View className="flex-1 justify-center" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-event-load-failed">
          <EmptyState
            icon="calendar-outline"
            title={t('create.loadFailedTitle')}
            subtitle={t('create.loadFailed')}
            actionLabel={t('common:buttons.retry')}
            onAction={() => setEditRetryToken((value) => value + 1)}
          />
        </View>
      ) : isEditing && !hasHydratedEdit ? (
        <View className="flex-1 items-center justify-center" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-event-loading">
          <LoadingSpinner />
        </View>
      ) : (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        testID="new-event-scroll"
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 120, backgroundColor: theme.bg }}
        keyboardShouldPersistTaps="handled"
      >
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: '#f59e0b' }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha('#f59e0b', 0.14) }}>
                <Ionicons name="calendar-outline" size={25} color="#f59e0b" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.eyebrow')}</Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{isEditing ? t('create.editTitle') : t('create.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('create.subtitle')}</Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-4 p-4">
            <FormField label={t('create.titleLabel')} value={title} onChangeText={setTitle} placeholder={t('create.titlePlaceholder')} theme={theme} />
            <FormField label={t('create.descriptionLabel')} value={description} onChangeText={setDescription} placeholder={t('create.descriptionPlaceholder')} theme={theme} multiline />
            <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
              <View className="flex-row items-start gap-3">
                <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                  <Ionicons name="image-outline" size={18} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.coverImageLabel')}</Text>
                  <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>{t('create.coverImageHint')}</Text>
                </View>
              </View>
              {selectedImageUri || existingCoverImage ? (
                <View className="overflow-hidden rounded-panel-inner border" style={{ borderColor: theme.border }}>
                  <Image
                    source={{ uri: selectedImageUri ?? resolveImageUrl(existingCoverImage) ?? undefined }}
                    style={{ width: '100%', height: 180, backgroundColor: theme.surface }}
                    contentFit="cover"
                  />
                  <View className="flex-row gap-2 p-3" style={{ backgroundColor: theme.surface }}>
                    <HeroButton className="flex-1" variant="secondary" onPress={() => void pickCoverImage()}>
                      <Ionicons name="image-outline" size={16} color={primary} />
                      <HeroButton.Label>{t('create.replaceImage')}</HeroButton.Label>
                    </HeroButton>
                    {selectedImageUri ? (
                      <HeroButton className="flex-1" variant="danger-soft" onPress={() => setSelectedImageUri(null)}>
                        <Ionicons name="trash-outline" size={16} color={theme.error} />
                        <HeroButton.Label>{t('create.removeImage')}</HeroButton.Label>
                      </HeroButton>
                    ) : null}
                  </View>
                </View>
              ) : (
                <HeroButton variant="secondary" onPress={() => void pickCoverImage()}>
                  <Ionicons name="image-outline" size={16} color={primary} />
                  <HeroButton.Label>{t('create.addImage')}</HeroButton.Label>
                </HeroButton>
              )}
            </View>
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.categoryLabel')}</Text>
              <TagGroup
                size="sm"
                selectionMode="single"
                selectedKeys={category ? [category] : []}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys)[0];
                  setCategory(next === undefined ? '' : String(next));
                }}
              >
                <TagGroup.List>
                  {categoryOptions.map((option) => {
                    const isSelected = category === option.id;
                    return (
                      <TagGroup.Item
                        key={option.id}
                        id={option.id}
                      >
                        <TagGroup.ItemLabel style={isSelected ? { color: contrastText(primary) } : undefined}>
                          {option.label}
                        </TagGroup.ItemLabel>
                      </TagGroup.Item>
                    );
                  })}
                </TagGroup.List>
              </TagGroup>
            </View>
            <FormField label={t('create.timezoneLabel')} value={timezone} onChangeText={setTimezone} placeholder={t('create.timezonePlaceholder')} theme={theme} />
            <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>{t('create.timezoneHint')}</Text>
            <ToggleChip
              label={t('create.allDay')}
              selected={allDay}
              onPress={toggleAllDay}
              primary={primary}
            />
            <FormField label={t('create.startLabel')} value={startTime} onChangeText={setStartTime} placeholder={t(allDay ? 'create.dateOnlyPlaceholder' : 'create.datePlaceholder')} theme={theme} />
            <FormField label={t(allDay ? 'create.allDayEndLabel' : 'create.endLabel')} value={endTime} onChangeText={setEndTime} placeholder={t(allDay ? 'create.dateOnlyPlaceholder' : 'create.optionalDatePlaceholder')} theme={theme} />
            {!isEditing ? (
              <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: theme.border, backgroundColor: withAlpha(primary, 0.06) }}>
                <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.recurrenceTitle')}</Text>
                <ToggleChip label={t('create.recurrenceToggle')} selected={isRecurring} onPress={() => setIsRecurring((value) => !value)} primary={primary} />
                {isRecurring ? (
                  <>
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.recurrenceFrequency')}</Text>
                    <TagGroup
                      size="sm"
                      selectionMode="single"
                      selectedKeys={[recurrenceFrequency]}
                      onSelectionChange={(keys) => {
                        const value = Array.from(keys)[0];
                        if (value) setRecurrenceFrequency(String(value) as RecurrenceFrequency);
                      }}
                    >
                      <TagGroup.List>
                        {supportedRecurrenceFrequencies.map((value) => (
                          <TagGroup.Item key={value} id={value}>
                            <TagGroup.ItemLabel>{t(`create.recurrenceFrequencies.${value}`)}</TagGroup.ItemLabel>
                          </TagGroup.Item>
                        ))}
                      </TagGroup.List>
                    </TagGroup>
                    {recurrenceFrequency === 'weekly' || recurrenceFrequency === 'biweekly' ? (
                      <>
                        <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.recurrenceDays')}</Text>
                        <TagGroup
                          size="sm"
                          selectionMode="multiple"
                          selectedKeys={recurrenceDays}
                          onSelectionChange={(keys) => setRecurrenceDays(Array.from(keys).map(String))}
                        >
                          <TagGroup.List>
                            {RECURRENCE_WEEKDAYS.map((value) => (
                              <TagGroup.Item key={value} id={value}>
                                <TagGroup.ItemLabel>{t(`create.recurrenceWeekdays.${value}`)}</TagGroup.ItemLabel>
                              </TagGroup.Item>
                            ))}
                          </TagGroup.List>
                        </TagGroup>
                      </>
                    ) : null}
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.recurrenceEnds')}</Text>
                    <TagGroup
                      size="sm"
                      selectionMode="single"
                      selectedKeys={[recurrenceEndType]}
                      onSelectionChange={(keys) => {
                        const value = Array.from(keys)[0];
                        if (value) setRecurrenceEndType(String(value) as RecurrenceEndType);
                      }}
                    >
                      <TagGroup.List>
                        {supportedRecurrenceEndTypes.map((value) => (
                          <TagGroup.Item key={value} id={value}>
                            <TagGroup.ItemLabel>{t(`create.recurrenceEndTypes.${value}`)}</TagGroup.ItemLabel>
                          </TagGroup.Item>
                        ))}
                      </TagGroup.List>
                    </TagGroup>
                    {recurrenceEndType === 'after_count' ? (
                      <FormField label={t('create.recurrenceCount')} value={recurrenceCount} onChangeText={setRecurrenceCount} placeholder={t('create.recurrenceCountPlaceholder', { max: recurrenceCapabilities.max_occurrences })} theme={theme} keyboardType="number-pad" />
                    ) : recurrenceEndType === 'on_date' ? (
                      <FormField label={t('create.recurrenceEndDate')} value={recurrenceEndDate} onChangeText={setRecurrenceEndDate} placeholder={t('create.dateOnlyPlaceholder')} theme={theme} />
                    ) : (
                      <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>{t('create.recurrenceNeverHint')}</Text>
                    )}
                  </>
                ) : null}
              </View>
            ) : null}
            {isEditing && isRecurringSeries ? (
              <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: theme.border, backgroundColor: withAlpha(primary, 0.06) }}>
                <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.recurrenceEditScope')}</Text>
                <TagGroup
                  size="sm"
                  selectionMode="single"
                  selectedKeys={[recurrenceEditScope]}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0];
                    if (value) {
                      setRecurrenceEditScope(String(value) as RecurrenceEditScope);
                      setRevisionPreview(null);
                    }
                  }}
                >
                  <TagGroup.List>
                    <TagGroup.Item id="single"><TagGroup.ItemLabel>{t('create.recurrenceScopeSingle')}</TagGroup.ItemLabel></TagGroup.Item>
                    {recurrenceCapabilities.supports_effective_revisions ? (
                      <TagGroup.Item id="this_and_future"><TagGroup.ItemLabel>{t('create.recurrenceScopeFuture')}</TagGroup.ItemLabel></TagGroup.Item>
                    ) : null}
                  </TagGroup.List>
                </TagGroup>
                <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>
                  {t(recurrenceCapabilities.supports_effective_revisions && recurrenceEditScope === 'this_and_future'
                    ? 'create.recurrenceScopeFutureHint'
                    : recurrenceCapabilities.supports_effective_revisions
                      ? 'create.recurrenceScopeSingleHint'
                      : 'create.revisionUnavailable')}
                </Text>
              </View>
            ) : null}
            {revisionPreview ? (
              <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: revisionPreview.can_commit ? theme.border : theme.error, backgroundColor: theme.surface }}>
                <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.revisionImpactTitle')}</Text>
                <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('create.revisionImpact', { count: revisionPreview.impact.changed_count })}</Text>
                <Text className="text-xs" style={{ color: theme.textMuted }}>{t('create.revisionRecipients', { count: revisionPreview.impact.unique_recipient_count })}</Text>
                {revisionPreview.impact.blocking_conflicts.length > 0 ? (
                  <Text className="text-sm" style={{ color: theme.error }}>{t('create.revisionBlocked', { count: revisionPreview.impact.blocking_conflicts.length })}</Text>
                ) : (
                  <HeroButton variant="primary" onPress={() => void commitRevision()} isDisabled={isSubmitting}>
                    <HeroButton.Label>{t('create.revisionConfirm')}</HeroButton.Label>
                  </HeroButton>
                )}
              </View>
            ) : null}
            <FormField label={t('create.locationLabel')} value={location} onChangeText={setLocation} placeholder={t('create.locationPlaceholder')} theme={theme} />
            <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: theme.border, backgroundColor: withAlpha(primary, 0.06) }}>
              <View className="flex-row items-start gap-3">
                <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="navigate-outline" size={18} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.coordinatesLabel')}</Text>
                  <Text className="text-xs leading-5" style={{ color: theme.textSecondary }}>{t('create.coordinatesHint')}</Text>
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="min-w-0 flex-1">
                  <FormField label={t('create.latitudeLabel')} value={latitude} onChangeText={setLatitude} placeholder={t('create.latitudePlaceholder')} theme={theme} keyboardType="decimal-pad" />
                </View>
                <View className="min-w-0 flex-1">
                  <FormField label={t('create.longitudeLabel')} value={longitude} onChangeText={setLongitude} placeholder={t('create.longitudePlaceholder')} theme={theme} keyboardType="decimal-pad" />
                </View>
              </View>
            </View>
            <View className="gap-3 rounded-panel-inner border p-3" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
              <View className="flex-row items-start gap-3">
                <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="accessibility-outline" size={18} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('create.venueAccessibilityTitle')}</Text>
                  <Text className="text-xs leading-5" style={{ color: theme.textSecondary }}>{t('create.venueAccessibilityHint')}</Text>
                </View>
              </View>
              {(['step_free_access', 'accessible_toilet', 'hearing_loop', 'quiet_space', 'seating_available', 'accessible_parking'] as AccessibilityBooleanKey[]).map((key) => (
                <AccessibilityChoice
                  key={key}
                  label={t(`create.venueAccessibilityFeatures.${key}`)}
                  value={venueAccessibility[key]}
                  onChange={(value) => setVenueAccessibility((current) => ({ ...current, [key]: value }))}
                  unknownLabel={t('create.venueAccessibilityStatus.unknown')}
                  yesLabel={t('create.venueAccessibilityStatus.yes')}
                  noLabel={t('create.venueAccessibilityStatus.no')}
                  primary={primary}
                />
              ))}
              <FormField label={t('create.venueAccessibilityParkingDetails')} value={venueAccessibility.parking_details} onChangeText={(value) => setVenueAccessibility((current) => ({ ...current, parking_details: value }))} placeholder={t('create.venueAccessibilityParkingPlaceholder')} theme={theme} multiline />
              <FormField label={t('create.venueAccessibilityTransitDetails')} value={venueAccessibility.transit_details} onChangeText={(value) => setVenueAccessibility((current) => ({ ...current, transit_details: value }))} placeholder={t('create.venueAccessibilityTransitPlaceholder')} theme={theme} multiline />
              <FormField label={t('create.venueAccessibilityAssistanceContact')} value={venueAccessibility.assistance_contact} onChangeText={(value) => setVenueAccessibility((current) => ({ ...current, assistance_contact: value }))} placeholder={t('create.venueAccessibilityAssistancePlaceholder')} theme={theme} />
              <FormField label={t('create.venueAccessibilityNotes')} value={venueAccessibility.notes} onChangeText={(value) => setVenueAccessibility((current) => ({ ...current, notes: value }))} placeholder={t('create.venueAccessibilityNotesPlaceholder')} theme={theme} multiline />
              <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>{t('create.venueAccessibilityPrivacy')}</Text>
            </View>
            <ToggleChip label={t('create.remoteAttendance')} selected={allowRemoteAttendance} onPress={() => setAllowRemoteAttendance((value) => !value)} primary={primary} />
            {allowRemoteAttendance ? (
              <FormField label={t('create.videoUrlLabel')} value={videoUrl} onChangeText={setVideoUrl} placeholder={t('create.videoUrlPlaceholder')} theme={theme} />
            ) : null}
            <FormField label={t('create.maxAttendeesLabel')} value={maxAttendees} onChangeText={setMaxAttendees} placeholder={t('create.maxAttendeesPlaceholder')} theme={theme} keyboardType="number-pad" />

            <View className="flex-row flex-wrap gap-2">
              <ToggleChip
                label={t('create.federated')}
                selected={federatedVisibility === 'listed' || federatedVisibility === 'joinable'}
                onPress={() => setFederatedVisibility((value) => (
                  value === 'listed' || value === 'joinable' ? 'none' : 'joinable'
                ))}
                primary={primary}
              />
            </View>

          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
        <FormActionFooter
          title={isEditing ? t('create.editReviewTitle') : t('create.reviewTitle')}
          subtitle={!requiredFieldsFilled
            ? t('create.reviewMissing')
            : isEditing ? t('create.editReviewSubtitle') : t('create.reviewSubtitle')}
          submitLabel={isEditing && isRecurringSeries && recurrenceEditScope === 'this_and_future'
            ? t('create.revisionPreview')
            : isEditing
              ? t('create.updateSubmit')
              : t('create.submit')}
          primary={primary}
          isSubmitting={isSubmitting}
          isDisabled={!requiredFieldsFilled}
          onSubmit={submit}
        />
      </KeyboardAvoidingView>
      )}
      {confirmDialog}
    </SafeAreaView>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  theme,
  multiline = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  theme: ReturnType<typeof useTheme>;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
}) {
  return (
    <View>
      <Input
        label={label}
        style={{ color: theme.text, minHeight: multiline ? 112 : undefined, textAlignVertical: multiline ? 'top' : 'center' }}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function ToggleChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void; primary: string }) {
  return (
    <HeroButton
      size="sm"
      variant={selected ? 'primary' : 'secondary'}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function AccessibilityChoice({
  label,
  value,
  onChange,
  unknownLabel,
  yesLabel,
  noLabel,
  primary,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  unknownLabel: string;
  yesLabel: string;
  noLabel: string;
  primary: string;
}) {
  const theme = useTheme();
  const selected = value === true ? 'yes' : value === false ? 'no' : 'unknown';
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{label}</Text>
      <TagGroup
        size="sm"
        selectionMode="single"
        selectedKeys={[selected]}
        onSelectionChange={(keys) => {
          const next = String(Array.from(keys)[0] ?? 'unknown');
          onChange(next === 'yes' ? true : next === 'no' ? false : null);
        }}
      >
        <TagGroup.List>
          {([
            ['unknown', unknownLabel],
            ['yes', yesLabel],
            ['no', noLabel],
          ] as const).map(([id, optionLabel]) => (
            <TagGroup.Item key={id} id={id}>
              <TagGroup.ItemLabel>{optionLabel}</TagGroup.ItemLabel>
            </TagGroup.Item>
          ))}
        </TagGroup.List>
      </TagGroup>
    </View>
  );
}
