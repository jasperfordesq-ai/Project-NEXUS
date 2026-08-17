// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { CheckboxGroup, Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { DatePicker } from '@/components/ui/DatePicker';
import type { DateInputValue } from '@/components/ui/DatePicker';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { TimeInput } from '@/components/ui/TimeInput';
import type { TimeInputValue } from '@/components/ui/TimeInput';
/**
 * Create/Edit Event Page with image upload, category selection, * and HeroUI DatePicker + app-local TimeInput components.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import { parseDate, parseTime, today, getLocalTimeZone } from '@internationalized/date';
import Save from 'lucide-react/icons/save';
import Calendar from 'lucide-react/icons/calendar';
import FileText from 'lucide-react/icons/file-text';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Users from 'lucide-react/icons/users';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ImagePlus from 'lucide-react/icons/image-plus';
import X from 'lucide-react/icons/x';
import Tag from 'lucide-react/icons/tag';
import Repeat from 'lucide-react/icons/repeat';
import Video from 'lucide-react/icons/video';
import BarChart3 from 'lucide-react/icons/chart-column';
import { Breadcrumbs } from '@/components/navigation';
import { LoadingScreen } from '@/components/feedback';
import { PlaceAutocompleteInput } from '@/components/location/PlaceAutocompleteInput';
import { useToast, useTenant, useAuth } from '@/contexts';
import { canCreateEvents } from '@/lib/access';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import {
  eventsApi,
  type EventCategory,
  type EventRecurrenceCapabilities,
  type EventRecurrenceRevisionPatch,
  type EventRecurrenceRevisionPreview,
} from '@/lib/events-api';
import { eventIsoToLocalInput, eventLocalInputToIso } from '@/lib/eventLocalDateTime';
import { logError } from '@/lib/logger';
import { resolveAssetUrl, responsiveThumbnailProps } from '@/lib/helpers';
import {
  EMPTY_VENUE_ACCESSIBILITY,
  EventVenueAccessibilityFields,
  type VenueAccessibilityDraft,
} from './components/EventVenueAccessibilityFields';

const MAX_IMAGE_SIZE_MB = 5;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
type RecurrenceEndType = 'after_count' | 'on_date' | 'never';

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

interface FormData {
  title: string;
  description: string;
  startDate: DateInputValue | null;
  startTime: TimeInputValue | null;
  endDate: DateInputValue | null;
  endTime: TimeInputValue | null;
  timezone: string;
  allDay: boolean;
  location: string;
  latitude?: number;
  longitude?: number;
  venueAccessibility: VenueAccessibilityDraft;
  max_attendees: string;
  category: string;
  // Video conferencing
  allowRemoteAttendance: boolean;
  videoUrl: string;
  // Recurrence
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceDays: string[];
  recurrenceEndType: RecurrenceEndType;
  recurrenceCount: string;
  recurrenceEndDate: DateInputValue | null;
}

const WEEKDAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const WEEKDAY_LABEL_KEYS = ['weekday_mon', 'weekday_tue', 'weekday_wed', 'weekday_thu', 'weekday_fri', 'weekday_sat', 'weekday_sun'] as const;

const initialFormData: FormData = {
  title: '',
  description: '',
  startDate: null,
  startTime: null,
  endDate: null,
  endTime: null,
  timezone: getLocalTimeZone(),
  allDay: false,
  location: '',
  venueAccessibility: { ...EMPTY_VENUE_ACCESSIBILITY },
  max_attendees: '',
  category: '',
  allowRemoteAttendance: false,
  videoUrl: '',
  isRecurring: false,
  recurrenceFrequency: 'weekly',
  recurrenceDays: [],
  recurrenceEndType: 'after_count',
  recurrenceCount: '10',
  recurrenceEndDate: null,
};

function wallClockValue(date: DateInputValue, time: TimeInputValue | null, allDay: boolean): string {
  const hour = allDay ? '00' : String(time?.hour ?? 0).padStart(2, '0');
  const minute = allDay ? '00' : String(time?.minute ?? 0).padStart(2, '0');
  return `${date.toString()}T${hour}:${minute}`;
}

function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Build an RRULE string from recurrence form data */
function buildRecurrenceRule(data: FormData): string | null {
  if (!data.isRecurring) return null;

  const parts: string[] = [];

  // Frequency
  if (data.recurrenceFrequency === 'biweekly') {
    parts.push('FREQ=WEEKLY');
    parts.push('INTERVAL=2');
  } else {
    parts.push(`FREQ=${data.recurrenceFrequency.toUpperCase()}`);
  }

  // Days of week (for weekly/biweekly)
  if (
    (data.recurrenceFrequency === 'weekly' || data.recurrenceFrequency === 'biweekly') &&
    data.recurrenceDays.length > 0
  ) {
    parts.push(`BYDAY=${data.recurrenceDays.join(',')}`);
  }

  // End condition
  if (data.recurrenceEndType === 'after_count' && data.recurrenceCount) {
    const count = parseInt(data.recurrenceCount);
    if (!isNaN(count) && count > 0) {
      parts.push(`COUNT=${count}`);
    }
  } else if (data.recurrenceEndType === 'on_date' && data.recurrenceEndDate) {
    // Keep the preview date-only so it does not imply a UTC boundary that the
    // server-owned recurrence contract did not receive.
    const dateStr = data.recurrenceEndDate.toString().replace(/-/g, '');
    parts.push(`UNTIL=${dateStr}`);
  }

  return `RRULE:${parts.join(';')}`;
}

function handleDragOver(e: React.DragEvent) {
  e.preventDefault();
}

function normalizeAddress(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function CreateEventPage() {
  const { t } = useTranslation('events');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const toast = useToast();
  const isEditing = !!id;
  // Creation only. Editing an existing Event is governed by the Event policy
  // (organiser / delegated staff / admin), NOT by the community's
  // "who can create Events" setting — so an organiser whose community later
  // restricted creation must still be able to edit what they already own.
  const blockedFromCreating = !isEditing && !canCreateEvents(user);
  const groupId = searchParams.get('group_id');
  const pageTitle = isEditing ? t('form.edit_title') : t('form.create_title');
  usePageTitle(pageTitle);

  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [recurrenceCapabilities, setRecurrenceCapabilities] = useState<EventRecurrenceCapabilities>(
    SAFE_RECURRENCE_CAPABILITIES,
  );

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [coverRemovalRequested, setCoverRemovalRequested] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Synchronous re-entry guard: isSubmitting is async state, so a double-Enter (the
  // form submits on Enter, bypassing the button's disabled state) or a fast
  // double-click can fire handleSubmit twice before React re-renders and create two
  // events. This ref blocks the second call immediately.
  const submittingRef = useRef(false);
  const geocodedAddressRef = useRef<string | null>(null);

  // Poll attachment state
  const [availablePolls, setAvailablePolls] = useState<{ id: number; question: string }[]>([]);
  const [selectedPollIds, setSelectedPollIds] = useState<Set<string>>(new Set());
  const loadedPollIdsRef = useRef<string[]>([]);
  const [isLoadingPolls, setIsLoadingPolls] = useState(false);

  // Recurring-series edit scope ("only this event" vs "all future events")
  const [seriesLinked, setSeriesLinked] = useState(false);
  const [showScopeModal, setShowScopeModal] = useState(false);
  const [showImpactModal, setShowImpactModal] = useState(false);
  const [revisionPreview, setRevisionPreview] = useState<EventRecurrenceRevisionPreview | null>(null);
  const [isPreviewingRevision, setIsPreviewingRevision] = useState(false);
  const pendingPayloadRef = useRef<Record<string, unknown> | null>(null);
  const pendingRevisionPatchRef = useRef<EventRecurrenceRevisionPatch | null>(null);
  const revisionCommitKeyRef = useRef<string | null>(null);
  const loadedScheduleRef = useRef<{
    timezone: string;
    allDay: boolean;
    startDate: string;
    endDate: string | null;
    startClock: string | null;
    endClock: string | null;
  } | null>(null);

  const loadEvent = useCallback(async () => {
    if (!id) return;

    try {
      setIsLoading(true);
      setLoadError(null);
      const response = await eventsApi.get(id);
      if (response.success && response.data) {
        const event = response.data;
        setSeriesLinked(event.series.recurrence !== null);
        const timezone = event.schedule.timezone || 'UTC';
        const startLocal = eventIsoToLocalInput(event.schedule.start_at, timezone);
        const endBoundaryLocal = eventIsoToLocalInput(event.schedule.end_at, timezone);
        const startDateValue = startLocal.slice(0, 10);
        const visibleEndDate = event.schedule.all_day && endBoundaryLocal
          ? shiftCalendarDate(endBoundaryLocal.slice(0, 10), -1)
          : endBoundaryLocal.slice(0, 10);
        loadedScheduleRef.current = {
          timezone,
          allDay: event.schedule.all_day,
          startDate: startDateValue,
          endDate: visibleEndDate || null,
          startClock: event.schedule.all_day ? null : startLocal.slice(11, 16),
          endClock: event.schedule.all_day || !endBoundaryLocal ? null : endBoundaryLocal.slice(11, 16),
        };
        geocodedAddressRef.current = event.location.latitude !== null && event.location.longitude !== null
          ? event.location.label
          : null;

        setFormData({
          title: event.title,
          description: event.description || '',
          startDate: startDateValue ? parseDate(startDateValue) : null,
          startTime: !event.schedule.all_day && startLocal
            ? parseTime(startLocal.slice(11, 16))
            : null,
          endDate: visibleEndDate ? parseDate(visibleEndDate) : null,
          endTime: !event.schedule.all_day && endBoundaryLocal
            ? parseTime(endBoundaryLocal.slice(11, 16))
            : null,
          timezone,
          allDay: event.schedule.all_day,
          location: event.location.label || '',
          latitude: event.location.latitude ?? undefined,
          longitude: event.location.longitude ?? undefined,
          venueAccessibility: {
            ...EMPTY_VENUE_ACCESSIBILITY,
            ...(event.location.accessibility ?? {}),
            parking_details: event.location.accessibility?.parking_details ?? '',
            transit_details: event.location.accessibility?.transit_details ?? '',
            assistance_contact: event.location.accessibility?.assistance_contact ?? '',
            notes: event.location.accessibility?.notes ?? '',
          },
          max_attendees: event.relationship.capacity.limit?.toString() || '',
          category: event.category?.id ? String(event.category.id) : '',
          allowRemoteAttendance: event.location.mode !== 'in_person',
          videoUrl: event.online_access.video_url || event.online_access.join_url || '',
          // Recurrence fields default (editing a recurring event is not supported yet)
          isRecurring: false,
          recurrenceFrequency: 'weekly',
          recurrenceDays: [],
          recurrenceEndType: 'after_count',
          recurrenceCount: '10',
          recurrenceEndDate: null,
        });

        if (event.primary_image?.url) {
          setExistingImage(resolveAssetUrl(event.primary_image.url));
        }
      } else {
        setLoadError(t('form.error_not_found'));
      }
    } catch (error) {
      logError('Failed to load event', error);
      setLoadError(t('form.error_load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (isEditing) {
      loadEvent();
    }
  }, [isEditing, loadEvent]);

  useEffect(() => {
    const controller = new AbortController();
    eventsApi.categories({ signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted && response.success && response.data) {
        setCategories(response.data);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) logError('Failed to load event categories', error);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    eventsApi.recurrenceCapabilities({ signal: controller.signal }).then((response) => {
      if (controller.signal.aborted || !response.success || !response.data) return;
      const capabilities = response.data;
      setRecurrenceCapabilities(capabilities);
      setFormData((current) => {
        const serverFrequency = current.recurrenceFrequency === 'biweekly'
          ? 'weekly'
          : current.recurrenceFrequency;
        const recurrenceFrequency = capabilities.supported_frequencies.includes(serverFrequency)
          ? current.recurrenceFrequency
          : (capabilities.supported_frequencies[0] ?? 'weekly');
        const recurrenceEndType = capabilities.supported_end_types.includes(current.recurrenceEndType)
          && (current.recurrenceEndType !== 'never' || capabilities.supports_rolling_never)
          && (current.recurrenceEndType !== 'after_count' || capabilities.max_occurrences >= 2)
          ? current.recurrenceEndType
          : (capabilities.max_occurrences >= 2 && capabilities.supported_end_types.includes('after_count')
              ? 'after_count'
              : capabilities.supported_end_types.includes('on_date')
                ? 'on_date'
                : 'never');
        const count = Number(current.recurrenceCount);
        const recurrenceCount = Number.isInteger(count) && count > capabilities.max_occurrences
          ? String(capabilities.max_occurrences)
          : current.recurrenceCount;

        return { ...current, recurrenceFrequency, recurrenceEndType, recurrenceCount };
      });
    }).catch((error) => {
      if (!controller.signal.aborted) {
        logError('Failed to negotiate event recurrence capabilities', error);
      }
    });
    return () => controller.abort();
  }, []);

  // Load available polls for attachment
  useEffect(() => {
    let cancelled = false;
    async function fetchPolls() {
      setIsLoadingPolls(true);
      try {
        const res = await api.get<{ items?: { id: number; question: string; event_id?: number | null }[] }>(
          '/v2/polls?status=all&limit=100'
        );
        if (!cancelled && res.success && res.data) {
          const items = Array.isArray(res.data) ? res.data : (res.data.items ?? []);
          setAvailablePolls(items.map((p) => ({ id: p.id, question: p.question })));

          // If editing, pre-select polls linked to this event
          if (isEditing && id) {
            const linked = items.filter((p) => p.event_id === Number(id));
            loadedPollIdsRef.current = linked.map((p) => String(p.id)).sort();
            if (linked.length > 0) {
              setSelectedPollIds(new Set(linked.map((p) => String(p.id))));
            }
          }
        }
      } catch {
        // Non-critical — poll attachment is optional
      } finally {
        if (!cancelled) setIsLoadingPolls(false);
      }
    }
    fetchPolls();
    return () => { cancelled = true; };
  }, [isEditing, id]);

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error(t('form.toast.image_type'));
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      toast.error(t('form.toast.image_size', { size: MAX_IMAGE_SIZE_MB }));
      return;
    }

    setImageFile(file);
    setCoverRemovalRequested(false);

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!ev.target?.result) return;
      setImagePreview(ev.target.result as string);
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    if (imageFile || imagePreview) {
      setImageFile(null);
      setImagePreview(null);
    } else if (existingImage) {
      setExistingImage(null);
      setCoverRemovalRequested(true);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error(t('form.toast.drop_type'));
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      toast.error(t('form.toast.image_size', { size: MAX_IMAGE_SIZE_MB }));
      return;
    }

    setImageFile(file);
    setCoverRemovalRequested(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!ev.target?.result) return;
      setImagePreview(ev.target.result as string);
    };
    reader.readAsDataURL(file);
  }

  function validateForm(): boolean {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = t('form.validation.title_required');
    } else if (formData.title.length < 5) {
      newErrors.title = t('form.validation.title_min');
    }

    if (!formData.description.trim()) {
      newErrors.description = t('form.validation.description_required');
    } else if (formData.description.length < 20) {
      newErrors.description = t('form.validation.description_min');
    }

    if (!formData.startDate) {
      newErrors.startDate = t('form.validation.start_date_required');
    }

    if (!formData.allDay && !formData.startTime) {
      newErrors.startTime = t('form.validation.start_time_required');
    }

    if (!formData.timezone.trim()) {
      newErrors.timezone = t('form.validation.timezone_required');
    }

    if (formData.allDay && !formData.endDate) {
      newErrors.endDate = t('form.validation.all_day_end_date_required');
    } else if (!formData.allDay && formData.endDate && !formData.endTime) {
      newErrors.endTime = t('form.validation.end_time_required');
    }

    if (formData.startDate && formData.endDate) {
      if (formData.endDate.toString() < formData.startDate.toString()) {
        newErrors.endDate = t('form.validation.end_date_before_start');
      }
    }

    if (formData.max_attendees) {
      const max = parseInt(formData.max_attendees);
      if (isNaN(max) || max < 1 || max > 10000) {
        newErrors.max_attendees = t('form.validation.max_attendees_range');
      }
    }

    // Recurrence validation
    if (formData.isRecurring) {
      const serverFrequency = formData.recurrenceFrequency === 'biweekly'
        ? 'weekly'
        : formData.recurrenceFrequency;
      if (!recurrenceCapabilities.supported_frequencies.includes(serverFrequency)) {
        newErrors.recurrenceFrequency = t('form.validation.recurrence_unavailable');
      }
      if (!recurrenceCapabilities.supported_end_types.includes(formData.recurrenceEndType)
        || (formData.recurrenceEndType === 'never' && !recurrenceCapabilities.supports_rolling_never)
        || (formData.recurrenceEndType === 'after_count' && recurrenceCapabilities.max_occurrences < 2)) {
        newErrors.recurrenceEndType = t('form.validation.recurrence_unavailable');
      }
      if (
        (formData.recurrenceFrequency === 'weekly' || formData.recurrenceFrequency === 'biweekly') &&
        formData.recurrenceDays.length === 0
      ) {
        newErrors.recurrenceDays = t('form.validation.select_day');
      }

      if (formData.recurrenceEndType === 'after_count') {
        const count = parseInt(formData.recurrenceCount);
        if (isNaN(count) || count < 2 || count > recurrenceCapabilities.max_occurrences) {
          newErrors.recurrenceCount = t('form.validation.occurrences_range', {
            max: recurrenceCapabilities.max_occurrences,
          });
        }
      }

      if (formData.recurrenceEndType === 'on_date' && !formData.recurrenceEndDate) {
        newErrors.recurrenceEndDate = t('form.validation.select_end_date');
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function uploadImage(eventId: number, scope?: 'single' | 'all'): Promise<void> {
    if (!imageFile) return;

    try {
      setIsUploadingImage(true);
      const response = await eventsApi.uploadCover(eventId, imageFile, scope);
      if (!response.success) {
        toast.error(t('form.toast.image_failed'));
      }
    } catch (err) {
      logError('Failed to upload event image', err);
      toast.error(t('form.toast.image_failed'));
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return; // block a second in-flight submit

    if (!validateForm()) {
      // Make the failure visible — a silent early-return looked like "nothing
      // happened" when an out-of-range value (e.g. 100 occurrences) was entered.
      toast.error(t('form.toast.fix_errors'));
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus?.();
        }
      });
      return;
    }

    submittingRef.current = true;
    try {
      setIsSubmitting(true);

      const timezone = formData.timezone.trim();
      const startWallClock = formData.startDate
        ? wallClockValue(formData.startDate, formData.startTime, formData.allDay)
        : '';
      const endDateValue = formData.endDate
        ? (formData.allDay
            ? shiftCalendarDate(formData.endDate.toString(), 1)
            : formData.endDate.toString())
        : null;
      const endWallClock = endDateValue
        ? `${endDateValue}T${formData.allDay ? '00:00' : `${String(formData.endTime?.hour ?? 0).padStart(2, '0')}:${String(formData.endTime?.minute ?? 0).padStart(2, '0')}`}`
        : null;
      const startDateTime = eventLocalInputToIso(startWallClock, timezone);
      const endDateTime = endWallClock ? eventLocalInputToIso(endWallClock, timezone) : null;
      if (!startDateTime || (endWallClock !== null && !endDateTime)) {
        setErrors((current) => ({
          ...current,
          timezone: t('form.validation.timezone_or_time_invalid'),
        }));
        toast.error(t('form.toast.fix_errors'));
        return;
      }
      if (endDateTime && new Date(endDateTime) <= new Date(startDateTime)) {
        setErrors((current) => ({
          ...current,
          endDate: t('form.validation.end_date_before_start'),
        }));
        toast.error(t('form.toast.fix_errors'));
        return;
      }

      const payload: Record<string, unknown> = {
        title: formData.title,
        description: formData.description,
        start_time: startDateTime,
        end_time: endDateTime,
        timezone,
        all_day: formData.allDay,
        location: formData.location || null,
        latitude: formData.latitude,
        longitude: formData.longitude,
        venue_accessibility: {
          step_free_access: formData.venueAccessibility.step_free_access,
          accessible_toilet: formData.venueAccessibility.accessible_toilet,
          hearing_loop: formData.venueAccessibility.hearing_loop,
          quiet_space: formData.venueAccessibility.quiet_space,
          seating_available: formData.venueAccessibility.seating_available,
          accessible_parking: formData.venueAccessibility.accessible_parking,
          parking_details: formData.venueAccessibility.parking_details.trim() || null,
          transit_details: formData.venueAccessibility.transit_details.trim() || null,
          assistance_contact: formData.venueAccessibility.assistance_contact.trim() || null,
          notes: formData.venueAccessibility.notes.trim() || null,
        },
        max_attendees: formData.max_attendees ? parseInt(formData.max_attendees) : null,
        allow_remote_attendance: formData.allowRemoteAttendance,
        video_url: formData.allowRemoteAttendance && formData.videoUrl.trim() ? formData.videoUrl.trim() : null,
      };

      if (coverRemovalRequested) {
        payload.cover_image = null;
        payload.image_url = null;
      }

      // Associate event with group when created from group Events tab
      if (groupId && !isEditing) {
        payload.group_id = parseInt(groupId);
      }

      if (formData.category) {
        const categoryInt = Number(formData.category);
        if (!isNaN(categoryInt)) {
          payload.category_id = categoryInt;
        }
      }

      // Attached polls
      if (selectedPollIds.size > 0) {
        payload.poll_ids = Array.from(selectedPollIds).map(Number);
      } else if (isEditing) {
        // Explicitly send empty array to unlink all polls when editing
        payload.poll_ids = [];
      }

      const revisionPatch: EventRecurrenceRevisionPatch = {
        title: formData.title,
        description: formData.description,
        location: formData.location || null,
        latitude: formData.latitude ?? null,
        longitude: formData.longitude ?? null,
        max_attendees: formData.max_attendees ? parseInt(formData.max_attendees) : null,
        is_online: formData.allowRemoteAttendance,
        allow_remote_attendance: formData.allowRemoteAttendance,
        video_url: formData.allowRemoteAttendance && formData.videoUrl.trim()
          ? formData.videoUrl.trim()
          : null,
        category_id: formData.category ? Number(formData.category) : null,
        accessibility_step_free: formData.venueAccessibility.step_free_access,
        accessibility_toilet: formData.venueAccessibility.accessible_toilet,
        accessibility_hearing_loop: formData.venueAccessibility.hearing_loop,
        accessibility_quiet_space: formData.venueAccessibility.quiet_space,
        accessibility_seating: formData.venueAccessibility.seating_available,
        accessibility_parking: formData.venueAccessibility.accessible_parking,
        accessibility_parking_details: formData.venueAccessibility.parking_details.trim() || null,
        accessibility_transit_details: formData.venueAccessibility.transit_details.trim() || null,
        accessibility_assistance_contact: formData.venueAccessibility.assistance_contact.trim() || null,
        accessibility_notes: formData.venueAccessibility.notes.trim() || null,
      };
      const baselineSchedule = loadedScheduleRef.current;
      const currentStartClock = formData.allDay
        ? null
        : `${String(formData.startTime?.hour ?? 0).padStart(2, '0')}:${String(formData.startTime?.minute ?? 0).padStart(2, '0')}`;
      const currentEndClock = formData.allDay || !formData.endTime
        ? null
        : `${String(formData.endTime.hour).padStart(2, '0')}:${String(formData.endTime.minute).padStart(2, '0')}`;
      if (!baselineSchedule || baselineSchedule.timezone !== timezone) revisionPatch.timezone = timezone;
      if (!baselineSchedule || baselineSchedule.allDay !== formData.allDay) revisionPatch.all_day = formData.allDay;
      if (!formData.allDay && (!baselineSchedule || baselineSchedule.startClock !== currentStartClock)) {
        revisionPatch.local_start_time = currentStartClock;
      }
      if (!formData.allDay && (!baselineSchedule || baselineSchedule.endClock !== currentEndClock)) {
        revisionPatch.local_end_time = currentEndClock;
      }

      // Recurrence uses only the server-owned structured contract. The RRULE
      // below is a human-readable preview and is deliberately not submitted.
      const recurrenceRule = buildRecurrenceRule(formData);
      if (recurrenceRule) {
        payload.recurrence_frequency = formData.recurrenceFrequency === 'biweekly' ? 'weekly' : formData.recurrenceFrequency;
        payload.recurrence_interval = formData.recurrenceFrequency === 'biweekly' ? 2 : 1;
        if (
          (formData.recurrenceFrequency === 'weekly' || formData.recurrenceFrequency === 'biweekly')
          && formData.recurrenceDays.length > 0
        ) {
          payload.recurrence_days = formData.recurrenceDays.join(',');
        }
        payload.recurrence_ends_type = formData.recurrenceEndType;
        if (formData.recurrenceEndType === 'after_count') {
          payload.recurrence_ends_after_count = parseInt(formData.recurrenceCount) || 10;
        } else if (formData.recurrenceEndType === 'on_date' && formData.recurrenceEndDate) {
          payload.recurrence_ends_on_date = formData.recurrenceEndDate.toString();
        }
      }

      let response;
      if (isEditing) {
        if (seriesLinked) {
          // Part of a recurring series — ask the organiser whether the edit
          // applies to just this event or the whole series (saveWithScope).
          pendingPayloadRef.current = payload;
          pendingRevisionPatchRef.current = revisionPatch;
          setShowScopeModal(true);
          return; // finally{} clears isSubmitting
        }
        response = await eventsApi.update(id!, payload);
      } else if (recurrenceRule) {
        // Recurrence-aware endpoint — creates the template event AND its
        // occurrences. Plain POST /v2/events ignores recurrence fields.
        response = await eventsApi.createRecurring(payload);
      } else {
        response = await eventsApi.create(payload);
      }

      if (response.success) {
        const responseData = response.data as { id?: number; template?: { id?: number } } | undefined;
        const eventId = isEditing
          ? Number(id)
          : (responseData?.template?.id ?? responseData?.id);

        if (imageFile && eventId) {
          await uploadImage(eventId, recurrenceRule ? 'all' : undefined);
        }

        toast.success(isEditing ? t('form.toast.updated') : t('form.toast.created'));
        navigate(tenantPath(!isEditing && eventId && !recurrenceRule ? `/events/${eventId}` : '/events'));
      } else {
        toast.error(response.error || t('form.toast.error'));
      }
    } catch (error) {
      logError('Failed to save event', error);
      toast.error(t('form.toast.error'));
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  }

  // Confirmed scope from the recurring-series modal.
  async function saveWithScope(scope: 'single' | 'all') {
    const payload = pendingPayloadRef.current;
    if (!payload || !id) return;

    if (scope === 'all') {
      if (!recurrenceCapabilities.supports_effective_revisions) {
        toast.error(t('form.revision_unavailable'));
        return;
      }
      const patch = pendingRevisionPatchRef.current;
      if (!patch) return;
      if (imageFile || coverRemovalRequested) {
        toast.error(t('form.revision_image_scope_unsupported'));
        return;
      }
      const currentPollIds = Array.from(selectedPollIds).sort();
      if (JSON.stringify(currentPollIds) !== JSON.stringify(loadedPollIdsRef.current)) {
        toast.error(t('form.revision_association_scope_unsupported'));
        return;
      }
      const baseline = loadedScheduleRef.current;
      if (baseline && (
        baseline.startDate !== formData.startDate?.toString()
        || baseline.endDate !== (formData.endDate?.toString() ?? null)
      )) {
        toast.error(t('form.revision_date_scope_unsupported'));
        return;
      }
      setIsPreviewingRevision(true);
      try {
        const response = await eventsApi.previewRecurrenceRevision(id, patch);
        if (!response.success || !response.data) {
          toast.error(
            response.code === 'EVENT_RECURRENCE_REVISION_UNAVAILABLE'
              ? t('form.revision_unavailable')
              : response.error || t('form.toast.error'),
          );
          return;
        }
        setRevisionPreview(response.data);
        revisionCommitKeyRef.current = null;
        setShowScopeModal(false);
        setShowImpactModal(true);
      } catch (error) {
        logError('Failed to preview recurrence revision', error);
        toast.error(t('form.revision_unavailable'));
      } finally {
        setIsPreviewingRevision(false);
      }
      return;
    }

    setShowScopeModal(false);

    try {
      setIsSubmitting(true);
      const response = await eventsApi.updateRecurring(id, { ...payload, scope: 'single' });

      if (response.success) {
        if (imageFile) {
          await uploadImage(Number(id), 'single');
        }
        toast.success(t('form.toast.updated'));
        navigate(tenantPath('/events'));
      } else {
        toast.error(response.error || t('form.toast.error'));
      }
    } catch (error) {
      logError('Failed to save event', error);
      toast.error(t('form.toast.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function commitRevision() {
    const patch = pendingRevisionPatchRef.current;
    if (!id || !patch || !revisionPreview || !revisionPreview.can_commit) return;

    try {
      setIsSubmitting(true);
      const idempotencyKey = revisionCommitKeyRef.current
        ?? (typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `event-revision-${id}-${Date.now()}`);
      revisionCommitKeyRef.current = idempotencyKey;
      const response = await eventsApi.commitRecurrenceRevision(
        id,
        patch,
        revisionPreview.preview_token,
        idempotencyKey,
      );
      if (!response.success) {
        toast.error(response.error || t('form.revision_commit_failed'));
        return;
      }
      setShowImpactModal(false);
      toast.success(t('form.toast.updated'));
      navigate(tenantPath('/events'));
    } catch (error) {
      logError('Failed to commit recurrence revision', error);
      toast.error(t('form.revision_commit_failed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <LoadingScreen message={t('form.loading')} />;
  }

  // Direct navigation to /events/create when the community restricts creation.
  // The server refuses the POST regardless; this avoids presenting a long form
  // that cannot be submitted.
  if (blockedFromCreating) {
    return (
      <div className="max-w-2xl mx-auto">
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('form.creation_restricted_title')}</h2>
          <p className="text-theme-muted mb-4">{t('form.creation_restricted_body')}</p>
          <div className="flex justify-center">
            <Button as={Link} to={tenantPath('/events')} color="primary">
              {t('form.back_to_events')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto">
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('form.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{loadError}</p>
          <div className="flex justify-center gap-3">
            <Button as={Link} to={tenantPath("/events")}
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
            >
              {t('form.back_to_events')}
            </Button>
            <Button
              color="primary"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => loadEvent()}
            >
              {t('form.try_again')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  const hasImage = imagePreview || existingImage;
  const existingImagePreviewProps = !imagePreview && existingImage
    ? responsiveThumbnailProps(existingImage, {
        width: 960,
        height: 540,
        sizes: '(min-width: 1024px) 896px, 92vw',
      })
    : null;
  const selectedCategoryLabel = formData.category
    ? categories.find((category) => String(category.id) === formData.category)?.name ?? t('form.summary_not_set')
    : t('form.summary_not_set');
  const supportedRecurrenceFrequencies = recurrenceCapabilities.supported_frequencies
    .flatMap<RecurrenceFrequency>((frequency) => frequency === 'weekly' ? ['weekly', 'biweekly'] : [frequency]);
  const supportedRecurrenceEndTypes = recurrenceCapabilities.supported_end_types.filter(
    (endType) => (endType !== 'never' || recurrenceCapabilities.supports_rolling_never)
      && (endType !== 'after_count' || recurrenceCapabilities.max_occurrences >= 2),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-5xl space-y-6"
    >
      <PageMeta title={pageTitle} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('title'), href: '/events' },
        { label: isEditing ? t('form.nav_edit') : t('form.nav_new') },
      ]} />

      <header className="overflow-hidden rounded-2xl border border-theme-default bg-theme-surface">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <Chip size="sm" variant="flat" color="warning" className="mb-3 font-medium">
              {isEditing ? t('form.edit_badge') : t('form.create_badge')}
            </Chip>
            <h1 className="text-3xl font-bold leading-tight text-theme-primary sm:text-4xl">
              {pageTitle}
            </h1>
            <p className="mt-2 text-sm leading-6 text-theme-muted sm:text-base">
              {t('form.create_intro')}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-72">
            <div className="rounded-xl border border-theme-default bg-theme-elevated px-4 py-3">
              <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('form.summary_category')}</span>
              <span className="mt-1 block truncate font-semibold text-theme-primary">{selectedCategoryLabel}</span>
            </div>
            <div className="rounded-xl border border-theme-default bg-theme-elevated px-4 py-3">
              <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('form.summary_format')}</span>
              <span className="mt-1 block font-semibold text-theme-primary">
                {formData.allowRemoteAttendance ? t('form.summary_remote') : t('form.summary_in_person')}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Form */}
      <GlassCard className="p-5 sm:p-8">
        <h2 className="mb-6 flex items-center gap-3 text-xl font-bold text-theme-primary">
          <Calendar className="w-7 h-7 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          {t('form.essentials_section')}
        </h2>

        {groupId && !isEditing && (
          <div className="flex items-center gap-3 p-3 mb-4 rounded-lg bg-accent/5 border border-accent/20">
            <Users className="w-5 h-5 text-accent flex-shrink-0" />
            <p className="text-sm text-theme-primary">
              {t('form.group_event_notice')}
            </p>
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-8">
          {/* Cover Image Upload */}
          <div>
            <label className="block text-sm font-medium text-theme-muted mb-2">
              {t('form.cover_label')}
            </label>
            {hasImage ? (
              <div className="relative rounded-xl overflow-hidden border border-theme-default">
                <img
                  {...(existingImagePreviewProps ?? { src: imagePreview || existingImage || '' })}
                  alt={t('form.cover_preview_alt')}
                  className="w-full h-48 object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <div className="absolute top-2 right-2 flex gap-2">
                  <Button
                    isIconOnly
                    size="sm"
                    className="bg-black/50 text-white backdrop-blur-sm"
                    onPress={removeImage}
                    aria-label={t('form.remove_image_aria')}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="absolute bottom-2 left-2">
                  <Button
                    size="sm"
                    className="bg-black/50 text-white backdrop-blur-sm"
                    startContent={<ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />}
                    onPress={() => fileInputRef.current?.click()}
                  >
                    {t('form.change_image')}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-theme-default rounded-xl p-8 text-center cursor-pointer hover:border-accent/50 hover:bg-accent/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                role="button"
                tabIndex={0}
                aria-label={t('form.upload_aria')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <ImagePlus className="w-10 h-10 text-theme-subtle mx-auto mb-3" aria-hidden="true" />
                <p className="text-theme-muted font-medium mb-1">
                  {t('form.upload_label')}
                </p>
                <p className="text-theme-subtle text-sm">
                  {t('form.upload_hint', { size: MAX_IMAGE_SIZE_MB })}
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              onChange={handleImageSelect}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>

          {/* Title */}
          <div>
            <Input
              label={t('form.title_label')}
              placeholder={t('form.title_placeholder')}
              value={formData.title}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, title: e.target.value }));
                if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
              }}
              isRequired
              isInvalid={!!errors.title}
              errorMessage={errors.title}
              startContent={<FileText className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
            />
          </div>

          {/* Category */}
          <div>
            <Select
              label={t('form.category_label')}
              placeholder={t('form.category_placeholder')}
              aria-label={t('form.category_aria')}
              selectedKeys={formData.category ? [formData.category] : []}
              onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
              startContent={<Tag className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
                label: 'text-theme-muted',
              }}
            >
              {categories.map((category) => (
                <SelectItem key={category.id} id={String(category.id)}>{category.name}</SelectItem>
              ))}
            </Select>
          </div>

          {/* Description */}
          <div>
            <Textarea
              label={t('form.description_label')}
              placeholder={t('form.description_placeholder')}
              value={formData.description}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, description: e.target.value }));
                if (errors.description) setErrors((prev) => ({ ...prev, description: '' }));
              }}
              minRows={4}
              isRequired
              isInvalid={!!errors.description}
              errorMessage={errors.description}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('form.timezone_label')}
              description={t('form.timezone_hint')}
              value={formData.timezone}
              onChange={(event) => {
                setFormData((current) => ({ ...current, timezone: event.target.value }));
                if (errors.timezone) setErrors((current) => ({ ...current, timezone: '' }));
              }}
              isRequired
              isInvalid={!!errors.timezone}
              errorMessage={errors.timezone}
              autoComplete="off"
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
            />
            <div className="flex items-center justify-between gap-4 rounded-xl border border-theme-default bg-theme-elevated p-4">
              <div>
                <p className="font-medium text-theme-primary">{t('form.all_day_label')}</p>
                <p className="text-sm text-theme-subtle">{t('form.all_day_hint')}</p>
              </div>
              <Switch
                aria-label={t('form.all_day_label')}
                isSelected={formData.allDay}
                onValueChange={(allDay) => setFormData((current) => ({ ...current, allDay }))}
              />
            </div>
          </div>

          {/* Start Date & Time */}
          <fieldset className={`grid gap-4 ${formData.allDay ? '' : 'sm:grid-cols-2'}`}>
            <legend className="sr-only">{t('form.legend_start_datetime')}</legend>
            <div>
              <DatePicker
                label={t('form.start_date_label')}
                value={formData.startDate}
                onChange={(val) => {
                  setFormData((prev) => ({ ...prev, startDate: val }));
                  if (errors.startDate) setErrors((prev) => ({ ...prev, startDate: '' }));
                }}
                minValue={today(getLocalTimeZone())}
                isInvalid={!!errors.startDate}
                errorMessage={errors.startDate}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
              />
            </div>

            {!formData.allDay && <div>
              <TimeInput
                label={t('form.start_time_label')}
                value={formData.startTime}
                onChange={(val) => {
                  setFormData((prev) => ({ ...prev, startTime: val }));
                  if (errors.startTime) setErrors((prev) => ({ ...prev, startTime: '' }));
                }}
                isInvalid={!!errors.startTime}
                errorMessage={errors.startTime}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
              />
            </div>}
          </fieldset>

          {/* End Date & Time (optional) */}
          <fieldset className={`grid gap-4 ${formData.allDay ? '' : 'sm:grid-cols-2'}`}>
            <legend className="sr-only">{t('form.legend_end_datetime')}</legend>
            <div>
              <DatePicker
                label={t(formData.allDay ? 'form.all_day_end_date_label' : 'form.end_date_label')}
                value={formData.endDate}
                onChange={(val) => {
                  setFormData((prev) => ({ ...prev, endDate: val }));
                  if (errors.endDate) setErrors((prev) => ({ ...prev, endDate: '' }));
                }}
                minValue={formData.startDate || today(getLocalTimeZone())}
                isInvalid={!!errors.endDate}
                errorMessage={errors.endDate}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
              />
            </div>

            {!formData.allDay && <div>
              <TimeInput
                label={t('form.end_time_label')}
                value={formData.endTime}
                onChange={(val) => {
                  setFormData((prev) => ({ ...prev, endTime: val }));
                  if (errors.endTime) setErrors((prev) => ({ ...prev, endTime: '' }));
                }}
                isInvalid={!!errors.endTime}
                errorMessage={errors.endTime}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
              />
            </div>}
          </fieldset>

          {/* Recurring Event Toggle */}
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-theme-elevated border border-theme-default">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-accent/20">
                  <Repeat className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-theme-primary">
                    {t('form.recurring_toggle')}
                  </p>
                  <p className="text-sm text-theme-subtle">
                    {t('form.recurring_desc')}
                  </p>
                </div>
              </div>
              <Switch
                aria-label={t('form.recurring_toggle_aria')}
                isSelected={formData.isRecurring}
                onValueChange={(checked) => setFormData((prev) => ({ ...prev, isRecurring: checked }))}
                classNames={{
                  wrapper: 'group-data-[selected=true]:bg-accent',
                }}
              />
            </div>

            {/* Recurrence Options (shown when toggled on) */}
            {formData.isRecurring && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 p-4 rounded-xl border border-accent/30 bg-accent/5"
              >
                {/* Frequency */}
                <Select
                  label={t('form.recurrence_frequency')}
                  aria-label={t('form.recurrence_frequency_aria')}
                  selectedKeys={[formData.recurrenceFrequency]}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, recurrenceFrequency: e.target.value as RecurrenceFrequency }));
                    if (errors.recurrenceFrequency) setErrors((prev) => ({ ...prev, recurrenceFrequency: '' }));
                  }}
                  isInvalid={!!errors.recurrenceFrequency}
                  errorMessage={errors.recurrenceFrequency}
                  classNames={{
                    trigger: 'bg-theme-elevated border-theme-default',
                    value: 'text-theme-primary',
                    label: 'text-theme-muted',
                  }}
                >
                  {supportedRecurrenceFrequencies.map((frequency) => (
                    <SelectItem key={frequency} id={frequency}>{t(`form.freq_${frequency}`)}</SelectItem>
                  ))}
                </Select>

                {/* Days of Week (for weekly/biweekly) */}
                {(formData.recurrenceFrequency === 'weekly' || formData.recurrenceFrequency === 'biweekly') && (
                  <div>
                    <CheckboxGroup
                      label={t('form.recurrence_days')}
                      orientation="horizontal"
                      value={formData.recurrenceDays}
                      onChange={(val) => {
                        setFormData((prev) => ({ ...prev, recurrenceDays: val as string[] }));
                        if (errors.recurrenceDays) setErrors((prev) => ({ ...prev, recurrenceDays: '' }));
                      }}
                      classNames={{
                        wrapper: 'gap-2 flex-wrap',
                      }}
                    >
                      {WEEKDAY_KEYS.map((key, idx) => (
                        <Checkbox
                          key={key}
                          value={key}
                          classNames={{
                            base: 'px-3 py-1.5 rounded-lg border border-theme-default bg-theme-elevated data-[selected=true]:bg-accent/20 data-[selected=true]:border-accent/50 cursor-pointer',
                            label: 'text-sm text-theme-primary',
                          }}
                        >
                          {t(`form.${WEEKDAY_LABEL_KEYS[idx]}`)}
                        </Checkbox>
                      ))}
                    </CheckboxGroup>
                    {errors.recurrenceDays && (
                      <p role="alert" className="text-xs text-danger mt-1">{errors.recurrenceDays}</p>
                    )}
                  </div>
                )}

                {/* End Condition */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <Select
                    label={t('form.recurrence_end_type')}
                    aria-label={t('form.recurrence_end_type_aria')}
                    selectedKeys={[formData.recurrenceEndType]}
                    onChange={(e) => {
                      setFormData((prev) => ({ ...prev, recurrenceEndType: e.target.value as RecurrenceEndType }));
                      if (errors.recurrenceEndType) setErrors((prev) => ({ ...prev, recurrenceEndType: '' }));
                    }}
                    isInvalid={!!errors.recurrenceEndType}
                    errorMessage={errors.recurrenceEndType}
                    classNames={{
                      trigger: 'bg-theme-elevated border-theme-default',
                      value: 'text-theme-primary',
                      label: 'text-theme-muted',
                    }}
                  >
                    {supportedRecurrenceEndTypes.map((endType) => (
                      <SelectItem key={endType} id={endType}>{t(`form.end_${endType}`)}</SelectItem>
                    ))}
                  </Select>

                  {formData.recurrenceEndType === 'after_count' ? (
                    <div>
                      <Input
                        type="number"
                        inputMode="numeric"
                        label={t('form.recurrence_count')}
                        placeholder={t('form.recurrence_count_placeholder')}
                        value={formData.recurrenceCount}
                        onChange={(e) => {
                          setFormData((prev) => ({ ...prev, recurrenceCount: e.target.value }));
                          if (errors.recurrenceCount) setErrors((prev) => ({ ...prev, recurrenceCount: '' }));
                        }}
                        min={2}
                        max={recurrenceCapabilities.max_occurrences}
                        isInvalid={!!errors.recurrenceCount}
                        errorMessage={errors.recurrenceCount}
                        classNames={{
                          input: 'bg-transparent text-theme-primary',
                          inputWrapper: 'bg-theme-elevated border-theme-default',
                          label: 'text-theme-muted',
                        }}
                      />
                      {!errors.recurrenceCount && (
                        <p className="text-xs text-theme-subtle mt-1">
                          {t('form.recurrence_count_hint', { max: recurrenceCapabilities.max_occurrences })}
                        </p>
                      )}
                    </div>
                  ) : formData.recurrenceEndType === 'on_date' ? (
                    <DatePicker
                      label={t('form.recurrence_end_date')}
                      value={formData.recurrenceEndDate}
                      onChange={(val) => {
                        setFormData((prev) => ({ ...prev, recurrenceEndDate: val }));
                        if (errors.recurrenceEndDate) setErrors((prev) => ({ ...prev, recurrenceEndDate: '' }));
                      }}
                      minValue={formData.startDate || today(getLocalTimeZone())}
                      isInvalid={!!errors.recurrenceEndDate}
                      errorMessage={errors.recurrenceEndDate}
                      classNames={{
                        inputWrapper: 'bg-theme-elevated border-theme-default',
                        label: 'text-theme-muted',
                      }}
                    />
                  ) : (
                    <p className="text-sm text-theme-muted self-center">{t('form.end_never_hint')}</p>
                  )}
                </div>

                {/* Preview of generated RRULE (for transparency) */}
                {formData.isRecurring && (
                  <div className="text-xs text-theme-subtle p-2 rounded-lg bg-theme-elevated font-mono break-all">
                    {buildRecurrenceRule(formData) || t('form.recurrence_preview_empty')}
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* Location & Max Attendees */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <PlaceAutocompleteInput
                label={t('form.location_label')}
                placeholder={t('form.location_placeholder')}
                value={formData.location}
                onChange={(val) => {
                  const selectedAddress = geocodedAddressRef.current;
                  const diverged = selectedAddress !== null
                    && normalizeAddress(val) !== normalizeAddress(selectedAddress);
                  if (diverged) geocodedAddressRef.current = null;
                  setFormData((prev) => ({
                    ...prev,
                    location: val,
                    latitude: diverged ? undefined : prev.latitude,
                    longitude: diverged ? undefined : prev.longitude,
                    venueAccessibility: val.trim()
                      ? prev.venueAccessibility
                      : { ...EMPTY_VENUE_ACCESSIBILITY },
                  }));
                }}
                onPlaceSelect={(place) => {
                  geocodedAddressRef.current = place.formattedAddress;
                  setFormData((prev) => ({
                    ...prev,
                    location: place.formattedAddress,
                    latitude: place.lat,
                    longitude: place.lng,
                  }));
                }}
                onClear={() => {
                  geocodedAddressRef.current = null;
                  setFormData((prev) => ({
                    ...prev,
                    location: '',
                    latitude: undefined,
                    longitude: undefined,
                    venueAccessibility: { ...EMPTY_VENUE_ACCESSIBILITY },
                  }));
                }}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }}
              />
            </div>

            <div>
              <Input
                type="number"
                inputMode="numeric"
                label={t('form.max_attendees_label')}
                placeholder={t('form.max_attendees_placeholder')}
                value={formData.max_attendees}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, max_attendees: e.target.value }));
                  if (errors.max_attendees) setErrors((prev) => ({ ...prev, max_attendees: '' }));
                }}
                min={1}
                max={10000}
                isInvalid={!!errors.max_attendees}
                errorMessage={errors.max_attendees}
                startContent={<Users className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                classNames={{
                  input: 'bg-transparent text-theme-primary',
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
              />
            </div>
          </div>

          {formData.location.trim() && (
            <EventVenueAccessibilityFields
              value={formData.venueAccessibility}
              onChange={(venueAccessibility) => setFormData((previous) => ({
                ...previous,
                venueAccessibility,
              }))}
              isDisabled={isSubmitting}
            />
          )}

          {/* Remote Attendance / Video Conferencing */}
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-theme-elevated border border-theme-default">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <Video className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-theme-primary">
                    {t('form.remote_attendance_toggle')}
                  </p>
                  <p className="text-sm text-theme-subtle">
                    {t('form.remote_attendance_desc')}
                  </p>
                </div>
              </div>
              <Switch
                aria-label={t('form.remote_attendance_toggle_aria')}
                isSelected={formData.allowRemoteAttendance}
                onValueChange={(checked) => setFormData((prev) => ({ ...prev, allowRemoteAttendance: checked }))}
                classNames={{
                  wrapper: 'group-data-[selected=true]:bg-blue-500',
                }}
              />
            </div>

            {formData.allowRemoteAttendance && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Input
                  label={t('form.video_url_label')}
                  placeholder={t('form.video_url_placeholder')}
                  value={formData.videoUrl}
                  onChange={(e) => setFormData((prev) => ({ ...prev, videoUrl: e.target.value }))}
                  startContent={<Video className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
              </motion.div>
            )}
          </div>

          {/* Attach Polls */}
          {availablePolls.length > 0 && (
            <div>
              <Select
                label={t('form.attach_polls_label')}
                placeholder={t('form.attach_polls_placeholder')}
                selectionMode="multiple"
                selectedKeys={selectedPollIds}
                onSelectionChange={(keys) => setSelectedPollIds(new Set(Array.from(keys).map(String)))}
                isLoading={isLoadingPolls}
                startContent={<BarChart3 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                classNames={{
                  trigger: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  value: 'text-theme-primary',
                  popoverContent: 'bg-overlay border border-theme-default',
                }}
              >
                {availablePolls.map((poll) => (
                  <SelectItem key={String(poll.id)} id={String(poll.id)}>
                    {poll.question}
                  </SelectItem>
                ))}
              </Select>
              <p className="text-xs text-theme-subtle mt-1">
                {t('form.attach_polls_hint')}
              </p>
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              color="primary"
              className="flex-1"
              startContent={
                isEditing
                  ? <CheckCircle className="w-4 h-4" aria-hidden="true" />
                  : <Save className="w-4 h-4" aria-hidden="true" />
              }
              isLoading={isSubmitting || isUploadingImage}
            >
              {isSubmitting && imageFile
                ? t('form.submit_saving')
                : isEditing
                  ? t('form.submit_update')
                  : t('form.submit_create')
              }
            </Button>
            <Button as={Link} to={tenantPath("/events")}
              type="button"
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
            >
              {t('form.cancel')}
            </Button>
          </div>
        </form>
      </GlassCard>

      {/* Recurring-series edit scope */}
      <Modal isOpen={showScopeModal} onClose={() => setShowScopeModal(false)}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('form.edit_scope_title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">{t('form.edit_scope_message')}</p>
            <p className="text-sm text-theme-muted">
              {t(recurrenceCapabilities.supports_effective_revisions
                ? 'form.edit_scope_all_note'
                : 'form.revision_unavailable')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              onPress={() => void saveWithScope('single')}
              isDisabled={isSubmitting}
            >
              {t('form.edit_scope_single')}
            </Button>
            {recurrenceCapabilities.supports_effective_revisions && (
              <Button
                color="primary"
                onPress={() => void saveWithScope('all')}
                isLoading={isPreviewingRevision}
              >
                {t('form.edit_scope_all')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={showImpactModal} onClose={() => !isSubmitting && setShowImpactModal(false)}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('form.revision_impact_title')}</ModalHeader>
          <ModalBody>
            {revisionPreview && (
              <div className="space-y-3 text-sm text-theme-muted">
                <p>{t('form.revision_impact_message', { count: revisionPreview.impact.changed_count })}</p>
                <ul className="list-disc space-y-1 ps-5">
                  <li>{t('form.revision_impact_recipients', { count: revisionPreview.impact.unique_recipient_count })}</li>
                  <li>{t('form.revision_impact_registrations', { count: revisionPreview.impact.registrations_count })}</li>
                  <li>{t('form.revision_impact_customized', { count: revisionPreview.impact.customized_exception_conflicts.length })}</li>
                </ul>
                {revisionPreview.impact.blocking_conflicts.length > 0 && (
                  <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-danger">
                    {t('form.revision_blocked', { count: revisionPreview.impact.blocking_conflicts.length })}
                  </div>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setShowImpactModal(false)} isDisabled={isSubmitting}>
              {t('form.cancel')}
            </Button>
            <Button
              color="primary"
              onPress={() => void commitRevision()}
              isLoading={isSubmitting}
              isDisabled={!revisionPreview?.can_commit}
            >
              {t('form.revision_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </motion.div>
  );
}

export default CreateEventPage;
