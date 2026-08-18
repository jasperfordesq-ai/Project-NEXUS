// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ListingForm — shared create/edit listing form.
 *
 * Single source of truth for the listing form, used by:
 * - CreateListingPage (`variant="page"`): full-page experience with header
 *   banner, GlassCard wrapper and navigation on success.
 * - ComposeHub ListingTab (`variant="sheet"`): compact layout for the
 *   compose modal / mobile overlay, reporting submit state upward so the
 *   overlay header button can drive submission.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Save from 'lucide-react/icons/save';
import Clock from 'lucide-react/icons/clock';
import Tag from 'lucide-react/icons/tag';
import FileText from 'lucide-react/icons/file-text';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import ImagePlus from 'lucide-react/icons/image-plus';
import X from 'lucide-react/icons/x';
import MapPin from 'lucide-react/icons/map-pin';
import Monitor from 'lucide-react/icons/monitor';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import HelpCircle from 'lucide-react/icons/circle-help';
import Sparkles from 'lucide-react/icons/sparkles';
import Info from 'lucide-react/icons/info';
import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { Select, SelectItem } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { SkillTagsInput } from '@/components/listings/SkillTagsInput';
import { LoadingScreen } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api, type ApiErrorDetail } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { safeImageSource } from '@/lib/safeImageSource';
import type { Listing, Category } from '@/types/api';

interface FormData {
  title: string;
  description: string;
  type: 'offer' | 'request';
  service_type: 'physical_only' | 'remote_only' | 'hybrid' | 'location_dependent';
  category_id: string;
  hours_estimate: string;
  /** Empty string means "no limit" — see hours_available on the Listing type. */
  hours_available: string;
  location: string;
  latitude?: number;
  longitude?: number;
  skill_tags: string[];
  experience_level?: string;
  equipment_provided?: string;
  accessibility_notes?: string;
}

/**
 * FormData keys a server-side validation error is allowed to name.
 *
 * The API returns per-field validation failures as
 * `{errors: [{code, message, field}, ...]}` (see
 * ListingsController::store/update → BaseApiController::respondWithErrors), but
 * this form used to discard them and show only a generic toast — so a member
 * whose save was rejected was told it failed and never which field was wrong.
 * That was TBUK's J-05 finding ("on create failure, no sys message about
 * what/why"). Anything not in this set falls back to the toast, so an unexpected
 * field name can never silently vanish.
 */
const SERVER_FIELD_KEYS = new Set<string>([
  'title',
  'description',
  'type',
  'service_type',
  'category_id',
  'hours_estimate',
  'hours_available',
  'location',
  'latitude',
  'longitude',
  'skill_tags',
  'experience_level',
  'equipment_provided',
  'accessibility_notes',
]);

/**
 * Split an API error payload into per-field messages this form can render, plus
 * anything left over that belongs in the toast.
 */
function splitServerErrors(details: ApiErrorDetail[] | undefined): {
  fieldErrors: Partial<Record<keyof FormData, string>>;
  unmapped: string[];
} {
  const fieldErrors: Partial<Record<keyof FormData, string>> = {};
  const unmapped: string[] = [];

  for (const detail of details ?? []) {
    const message = detail?.message?.trim();
    if (!message) continue;
    const field = typeof detail.field === 'string' ? detail.field : '';
    if (field && SERVER_FIELD_KEYS.has(field)) {
      // Keep the first message per field — the API may report several.
      const key = field as keyof FormData;
      if (!fieldErrors[key]) fieldErrors[key] = message;
    } else {
      unmapped.push(message);
    }
  }

  return { fieldErrors, unmapped };
}

const initialFormData: FormData = {
  title: '',
  description: '',
  type: 'offer',
  service_type: 'hybrid',
  category_id: '',
  hours_estimate: '1',
  hours_available: '',
  location: '',
  skill_tags: [],
};

/** The subset of form state that callers may seed / mirror (draft persistence). */
export interface ListingFormValues {
  title: string;
  description: string;
  type: 'offer' | 'request';
}

export interface ListingFormSubmitState {
  canSubmit: boolean;
  isSubmitting: boolean;
  submit: () => void;
  type: 'offer' | 'request';
}

export interface ListingFormProps {
  variant: 'page' | 'sheet';
  /** When set, the form loads and edits an existing listing. */
  listingId?: string;
  /** Seed values (e.g. restored composer draft). Applied once on mount. */
  initialValues?: Partial<ListingFormValues>;
  /** Template content from the composer TemplatePicker. */
  templateData?: { title?: string; content: string } | null;
  /** Called after a successful save. Page variant also navigates. */
  onSuccess?: (id?: number) => void;
  /** Sheet variant cancel button handler. */
  onCancel?: () => void;
  /** Reports whether the form holds unsaved content (composer beforeunload gate). */
  onContentChange?: (hasContent: boolean) => void;
  /** Mirrors draft-relevant values upward (composer draft persistence). */
  onValuesChange?: (values: ListingFormValues) => void;
  /** Reports submit availability upward (mobile overlay header button). */
  onSubmitStateChange?: (state: ListingFormSubmitState) => void;
  /** Hide the footer buttons (mobile overlay renders its own submit). */
  hideFooter?: boolean;
  /**
   * Redirects the save somewhere other than the member's own listings.
   *
   * Exists so a supporter acting for someone else gets THIS form — every
   * field, the same validation, the same AI description helper — rather than
   * a hand-rolled subset that drifts out of date each time this one gains a
   * field. See SupportPrepareModal.
   *
   * 🔴 When set, the form does NOT perform the owner-scoped follow-up calls
   * (`PUT /v2/listings/:id/tags`, image upload). Those endpoints check
   * ListingService::canModify(), which admits the owner or an admin and
   * nobody else — a carer is refused. Tags and the image are handed to the
   * adapter instead, which is responsible for routing them through a path
   * that carries the supporter's authority.
   *
   * Returning `{ success: false }` leaves the form state intact exactly as a
   * rejected save does, so the supporter does not lose their typing.
   */
  submitAdapter?: (
    payload: ListingSubmitPayload,
    extras: { skillTags: string[]; imageFile: File | null },
  ) => Promise<ListingSubmitResult>;
  /** Overrides the success toast (e.g. "sent for their approval"). */
  successMessage?: string;
}

/** The listing fields POST /v2/listings accepts, after description enrichment. */
export interface ListingSubmitPayload {
  title: string;
  description: string;
  type: string;
  location: string;
  latitude?: number;
  longitude?: number;
  category_id?: number;
  hours_estimate: number;
  /** null = no cap on the total hours offered. */
  hours_available: number | null;
  service_type: string;
}

export interface ListingSubmitResult {
  success: boolean;
  id?: number;
  error?: string;
  errors?: ApiErrorDetail[];
}

export function ListingForm({
  variant,
  listingId,
  initialValues,
  templateData,
  onSuccess,
  onCancel,
  onContentChange,
  onValuesChange,
  onSubmitStateChange,
  hideFooter = false,
  submitAdapter,
  successMessage,
}: ListingFormProps) {
  const { t } = useTranslation('listings');
  const navigate = useNavigate();
  const { tenantPath, listingConfig } = useTenant();
  const { user } = useAuth();
  const toast = useToast();
  const isEditing = !!listingId;
  const isSheet = variant === 'sheet';

  const [formData, setFormData] = useState<FormData>(() => ({
    ...initialFormData,
    title: initialValues?.title ?? '',
    description: initialValues?.description ?? '',
    type: initialValues?.type ?? 'offer',
    location: user?.location ?? '',
    latitude: user?.latitude ?? undefined,
    longitude: user?.longitude ?? undefined,
  }));
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const editAbortRef = useRef<AbortController | null>(null);
  // Stable ref so async handlers always use the latest t() without re-creation
  const tRef = useRef(t);
  tRef.current = t;
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous re-entry guard — the submit button stays natively enabled while
  // pending, so a double-Enter / double-click would otherwise fire two POSTs and
  // create duplicate listings before isSubmitting state flushes. A ref blocks the
  // second submit in the same tick. See CreateGroupPage for the same fix.
  const isSubmittingRef = useRef(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const selectedCategoryName = categories.find((c) => c.id.toString() === formData.category_id)?.name;
  const safeLocalImagePreview = safeImageSource(imagePreview, { allowBlob: true });
  const safeExistingImagePreview = existingImageUrl
    ? safeImageSource(resolveThumbnailUrl(existingImageUrl, { width: 640, height: 360 }))
    : null;
  const previewImageSource = safeLocalImagePreview ?? safeExistingImagePreview;

  // Cleanup object URL on unmount or when preview changes
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  // Apply template data selected from the composer TemplatePicker
  useEffect(() => {
    if (templateData) {
      setFormData((prev) => ({
        ...prev,
        title: templateData.title || prev.title,
        description: templateData.content,
      }));
    }
  }, [templateData]);

  // Report unsaved content upward (composer beforeunload gate)
  const hasContent = formData.title.trim().length > 0 || formData.description.trim().length > 0;
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  useEffect(() => {
    onContentChangeRef.current?.(hasContent);
  }, [hasContent]);

  // Mirror draft-relevant values upward (composer draft persistence)
  const onValuesChangeRef = useRef(onValuesChange);
  onValuesChangeRef.current = onValuesChange;
  useEffect(() => {
    onValuesChangeRef.current?.({
      title: formData.title,
      description: formData.description,
      type: formData.type,
    });
  }, [formData.title, formData.description, formData.type]);

  useEffect(() => {
    async function loadCategories() {
      try {
        const response = await api.get<Category[]>('/v2/categories?type=listing');
        if (response.success && response.data) {
          setCategories(response.data);
        }
      } catch (error) {
        logError('Failed to load categories', error);
      }
    }

    async function loadListing() {
      if (!listingId) return;

      editAbortRef.current?.abort();
      const controller = new AbortController();
      editAbortRef.current = controller;

      try {
        setIsLoading(true);
        const response = await api.get<Listing>(`/v2/listings/${listingId}`);
        if (controller.signal.aborted) return;
        if (response.success && response.data) {
          const listing = response.data;
          setFormData((prev) => ({
            ...prev,
            title: listing.title,
            description: listing.description,
            type: listing.type,
            service_type: listing.service_type || 'hybrid',
            category_id: listing.category_id?.toString() || '',
            hours_estimate: (listing.hours_estimate ?? listing.estimated_hours ?? 1).toString(),
            hours_available:
              listing.hours_available === null || listing.hours_available === undefined
                ? ''
                : listing.hours_available.toString(),
            skill_tags: Array.isArray(listing.skill_tags) ? listing.skill_tags : [],
            // location/latitude/longitude are always sourced from the user's profile
            // (set during state initialisation above); do not overwrite with stored
            // listing values here.
          }));
          if (listing.image_url) {
            setExistingImageUrl(listing.image_url);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        logError('Failed to load listing', error);
        toast.error(t('form.load_error'));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadCategories();
    if (isEditing) {
      loadListing();
    }
    return () => { editAbortRef.current?.abort(); };
  }, [listingId, isEditing, t, toast]);

  // True when the title is just the selected category name, or a generic
  // "I can help with X" / "Help with X" template. Drives a non-blocking
  // nudge under the title input.
  const isGenericTitle = (() => {
    const title = formData.title.trim().toLowerCase();
    if (!title || title.length < 3) return false;
    const stripped = title
      .replace(/^(i can help with|help with|looking for help with|need help with)\s+/i, '')
      .trim();
    const categoryName = selectedCategoryName?.toLowerCase().trim() || '';
    if (categoryName && (title === categoryName || stripped === categoryName)) return true;
    // Bare category-style titles with no qualifier beyond a couple of words.
    return stripped.length > 0 && stripped !== title && stripped.split(/\s+/).length <= 2;
  })();

  function validateForm(): boolean {
    const newErrors: Partial<Record<keyof FormData, string>> = {};
    const minTitle = listingConfig['listing.min_title_length'] || 5;
    const minDesc = listingConfig['listing.min_description_length'] || 20;

    if (!formData.title.trim()) {
      newErrors.title = t('form.title_required');
    } else if (formData.title.length < minTitle) {
      newErrors.title = t('form.title_min_length');
    }

    if (!formData.description.trim()) {
      newErrors.description = t('form.description_required');
    } else if (formData.description.length < minDesc) {
      newErrors.description = t('form.description_min_length');
    }

    if (listingConfig['listing.require_category'] && !formData.category_id) {
      newErrors.category_id = t('form.category_required');
    }

    const hours = parseFloat(formData.hours_estimate);
    if (listingConfig['listing.require_hours_estimate'] && (isNaN(hours) || hours < 0.5 || hours > 100)) {
      newErrors.hours_estimate = t('form.hours_range');
    } else if (formData.hours_estimate && (isNaN(hours) || hours < 0.5 || hours > 100)) {
      newErrors.hours_estimate = t('form.hours_range');
    }

    // Total-hours cap. Blank is valid and means no cap.
    const rawAvailable = formData.hours_available.trim();
    if (rawAvailable !== '') {
      const available = parseFloat(rawAvailable);
      if (isNaN(available) || available < 0.5) {
        newErrors.hours_available = t('form.hours_available_range');
      } else if (!isNaN(hours) && available < hours) {
        // A cap below one exchange's duration makes the listing unbookable.
        newErrors.hours_available = t('form.hours_available_below_estimate');
      }
    }

    if (formData.accessibility_notes && formData.accessibility_notes.length > 200) {
      newErrors.accessibility_notes = t('form.accessibility_max_length');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function doSubmit() {
    if (isSubmittingRef.current) return;
    if (!validateForm()) return;

    try {
      isSubmittingRef.current = true;
      setIsSubmitting(true);

      // Build enriched description with optional structured details
      let enrichedDescription = formData.description;
      const details: string[] = [];
      const tFn = tRef.current ?? t;
      if (formData.experience_level) {
        const experienceLabels: Record<string, string> = {
          beginner_friendly: tFn('form.experience_beginner'),
          some_experience: tFn('form.experience_some'),
          experienced: tFn('form.experience_experienced'),
          professional: tFn('form.experience_professional'),
        };
        details.push(`${tFn('form.experience_label')}: ${experienceLabels[formData.experience_level] || formData.experience_level}`);
      }
      if (formData.equipment_provided) {
        const equipmentLabels: Record<string, string> = {
          provided: tFn('form.equipment_provided_option'),
          partial: tFn('form.equipment_partial'),
          bring_own: tFn('form.equipment_bring_own'),
          not_applicable: tFn('form.equipment_na'),
        };
        details.push(`${tFn('form.equipment_label')}: ${equipmentLabels[formData.equipment_provided] || formData.equipment_provided}`);
      }
      if (formData.accessibility_notes) {
        details.push(`${tFn('form.accessibility_label')}: ${formData.accessibility_notes}`);
      }
      if (details.length > 0) {
        enrichedDescription += '\n\n---\n' + details.join('\n');
      }

      const payload = {
        title: formData.title,
        description: enrichedDescription,
        type: formData.type,
        location: formData.location,
        latitude: formData.latitude,
        longitude: formData.longitude,
        category_id: formData.category_id ? parseInt(formData.category_id, 10) : undefined,
        hours_estimate: parseFloat(formData.hours_estimate),
        // Blank means "no limit", which the API stores as NULL. Sending an empty
        // string instead would be cast to 0 and read as "no hours left".
        hours_available: formData.hours_available.trim() === ''
          ? null
          : parseFloat(formData.hours_available),
        service_type: formData.service_type,
      };

      // api.put/api.post resolve { success: false } on 4xx WITHOUT throwing (the
      // global error toast only covers 5xx), so the catch below never runs for a
      // rejected save. Check success explicitly and bail out — otherwise the user
      // gets a false success toast and is navigated away while their listing was
      // never created/updated. Returning here keeps the form state intact.
      // Surface per-field validation failures on the fields themselves, and put
      // anything unattributable in the toast. Returns true when the save failed.
      const handleSaveFailure = (response: { error?: string; errors?: ApiErrorDetail[] }): void => {
        const { fieldErrors, unmapped } = splitServerErrors(response.errors);
        if (Object.keys(fieldErrors).length > 0) {
          setErrors((prev) => ({ ...prev, ...fieldErrors }));
        }
        // Only fall back to the generic subtitle when the server told us nothing
        // more specific than "it failed".
        const detail = unmapped.length > 0
          ? unmapped.join(' ')
          : (Object.keys(fieldErrors).length > 0 ? undefined : response.error);
        toast.error(
          t('form.save_error_title'),
          detail || (Object.keys(fieldErrors).length > 0 ? undefined : t('form.save_error_subtitle')),
        );
      };

      // Acting for someone else: the adapter owns the destination, and the
      // owner-scoped tag/image follow-ups below cannot run under a carer's
      // authority, so they travel with it instead.
      if (submitAdapter) {
        const result = await submitAdapter(payload, {
          skillTags: formData.skill_tags,
          imageFile,
        });
        if (!result.success) {
          handleSaveFailure(result);
          return;
        }
        toast.success(successMessage ?? t('form.create_success'));
        onSuccess?.(result.id);
        return;
      }

      let savedId = listingId;
      if (isEditing) {
        const response = await api.put(`/v2/listings/${listingId}`, payload);
        if (!response.success) {
          handleSaveFailure(response);
          return;
        }
      } else {
        const response = await api.post<{ id: number }>('/v2/listings', payload);
        if (!response.success) {
          handleSaveFailure(response);
          return;
        }
        if (response.data) {
          savedId = String(response.data.id);
        }
      }

      if (savedId) {
        try {
          await api.put(`/v2/listings/${savedId}/tags`, { tags: formData.skill_tags });
        } catch (tagErr) {
          logError('Failed to save listing skill tags', tagErr);
          toast.warning(t('form.tags_save_failed'));
        }
      }

      // Upload image if selected
      if (imageFile && savedId) {
        try {
          await api.upload(`/v2/listings/${savedId}/image`, imageFile, 'image');
        } catch (imgErr) {
          logError('Failed to upload listing image', imgErr);
          toast.warning(t('form.image_upload_failed'));
        }
      } else if (removeExistingImage && savedId) {
        try {
          await api.delete(`/v2/listings/${savedId}/image`);
        } catch (imgErr) {
          logError('Failed to remove listing image', imgErr);
        }
      }

      toast.success(isEditing ? t('form.update_success') : t('form.create_success'));
      const numericId = savedId ? parseInt(savedId, 10) : undefined;
      onSuccess?.(Number.isNaN(numericId) ? undefined : numericId);
      if (variant === 'page') {
        navigate(tenantPath(savedId ? `/listings/${savedId}` : '/listings'));
      }
    } catch (error) {
      logError('Failed to save listing', error);
      toast.error(t('form.save_error_title'), t('form.save_error_subtitle'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doSubmit();
  }

  // Report submit availability upward (mobile overlay header button)
  const canSubmit = formData.title.trim().length > 0 && formData.description.trim().length > 0;
  const submitRef = useRef(doSubmit);
  submitRef.current = doSubmit;
  const onSubmitStateChangeRef = useRef(onSubmitStateChange);
  onSubmitStateChangeRef.current = onSubmitStateChange;
  useEffect(() => {
    onSubmitStateChangeRef.current?.({
      canSubmit,
      isSubmitting,
      submit: () => { void submitRef.current(); },
      type: formData.type,
    });
  }, [canSubmit, isSubmitting, formData.type]);

  function updateField<K extends keyof FormData>(field: K, value: FormData[K]) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  async function handleGenerateDescription() {
    if (!formData.title.trim()) return;
    setIsGenerating(true);
    try {
      const response = await api.post<{ description: string }>('/v2/listings/generate-description', {
        title: formData.title,
        category: selectedCategoryName || '',
        type: formData.type,
        notes: formData.description, // Use existing description as context
      });
      if (response.success && response.data) {
        const desc = ((response.data as Record<string, unknown>)?.description ?? '') as string;
        if (desc) {
          updateField('description', desc);
          toast.success(t('form.ai_generated'));
        }
      }
    } catch (error) {
      logError('Failed to generate description', error);
      toast.error(t('form.ai_generate_failed'));
    } finally {
      setIsGenerating(false);
    }
  }

  if (isLoading) {
    return <LoadingScreen message={t('loading')} />;
  }

  const sectionClass = isSheet
    ? 'space-y-3 border-t border-theme-default pt-5'
    : 'space-y-4 border-t border-theme-default pt-8';
  const headingClass = isSheet
    ? 'text-base font-semibold text-theme-primary'
    : 'text-lg font-semibold text-theme-primary';

  const formBody = (
    <form onSubmit={handleSubmit} className={isSheet ? 'space-y-5' : 'space-y-8'} noValidate>
      {/* Type Selection */}
      <section className={isSheet ? 'space-y-3' : 'space-y-4'}>
        <div>
          <h2 className={headingClass}>{t('form.intent_section')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('form.intent_section_hint')}</p>
        </div>
        <RadioGroup
          aria-label={t('form.type_question')}
          value={formData.type}
          onValueChange={(value) => updateField('type', value as 'offer' | 'request')}
          classNames={{ wrapper: 'gap-3 sm:flex-row' }}
        >
          <Radio
            value="offer"
            classNames={{
              base: 'm-0 max-w-none rounded-xl border border-theme-default bg-theme-elevated p-4 data-[selected=true]:border-emerald-500 data-[selected=true]:bg-emerald-500/10 sm:flex-1',
              label: 'text-theme-primary',
            }}
          >
            <div className="flex items-start gap-3">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
              <div>
                <div className="font-semibold">{t('form.offer_title')}</div>
                <div className="text-xs leading-5 text-theme-subtle">{t('form.offer_subtitle')}</div>
              </div>
            </div>
          </Radio>
          <Radio
            value="request"
            classNames={{
              base: 'm-0 max-w-none rounded-xl border border-theme-default bg-theme-elevated p-4 data-[selected=true]:border-amber-500 data-[selected=true]:bg-amber-500/10 sm:flex-1',
              label: 'text-theme-primary',
            }}
          >
            <div className="flex items-start gap-3">
              <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              <div>
                <div className="font-semibold">{t('form.request_title')}</div>
                <div className="text-xs leading-5 text-theme-subtle">{t('form.request_subtitle')}</div>
              </div>
            </div>
          </Radio>
        </RadioGroup>
      </section>

      <section className={sectionClass}>
        <div>
          <h2 className={headingClass}>{t('form.essentials_section')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('form.essentials_section_hint')}</p>
        </div>

        {/* Title */}
        <div>
          <Input
            label={t('form.title_label')}
            placeholder={t('form.title_placeholder')}
            value={formData.title}
            onChange={(e) => updateField('title', e.target.value)}
            isRequired
            isInvalid={!!errors.title}
            errorMessage={errors.title}
            maxLength={255}
            description={t('form.character_count', { count: formData.title.length, max: 255 })}
            startContent={<FileText className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
              label: 'text-theme-muted',
              description: 'text-theme-subtle',
            }}
          />
          {/* Soft nudge when the title is just the category name or a generic
              "I can help with X" template. Not blocking — listing still
              submits. Aimed at the SERP/discovery quality regression where
              titles like "I can help with Events" indexed as thin content. */}
          {isGenericTitle && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-theme-warning">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{t('form.title_too_generic_hint')}</span>
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <Textarea
            label={t('form.description_label')}
            placeholder={t('form.description_placeholder')}
            value={formData.description}
            onChange={(e) => updateField('description', e.target.value)}
            minRows={isSheet ? 4 : 6}
            isRequired
            isInvalid={!!errors.description}
            errorMessage={errors.description}
            maxLength={10000}
            description={t('form.character_count', { count: formData.description.length, max: 10000 })}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
              label: 'text-theme-muted',
              description: 'text-theme-subtle',
            }}
          />
          <div className="flex flex-col items-stretch gap-2 mt-2 sm:flex-row sm:items-center">
            <Button
              size="sm"
              variant="secondary"
              className="bg-theme-elevated text-theme-primary"
              startContent={<Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
              onPress={handleGenerateDescription}
              isLoading={isGenerating}
              isDisabled={!formData.title.trim() || isGenerating}
            >
              {isGenerating
                ? t('form.ai_generating')
                : t('form.ai_help_write')}
            </Button>
            {!formData.title.trim() && (
              <span className="text-xs text-theme-subtle">
                {t('form.ai_enter_title_first')}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Optional Service Details */}
      <section className={sectionClass}>
        <details className="group rounded-xl border border-theme-default bg-theme-surface p-4 open:bg-theme-elevated">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 text-sm font-semibold text-theme-primary">
            <span className="flex items-center gap-2">
              <Info className="w-4 h-4" aria-hidden="true" />
              {t('form.service_details_toggle')}
            </span>
            <span className="text-xs font-medium text-theme-subtle group-open:hidden">{t('form.optional_label')}</span>
          </summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {/* Experience Level */}
            <Select
              label={t('form.experience_label')}
              placeholder={t('form.experience_placeholder')}
              selectedKeys={formData.experience_level ? [formData.experience_level] : []}
              onChange={(e) => updateField('experience_level', e.target.value)}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
                label: 'text-theme-muted',
              }}
            >
              <SelectItem key="beginner_friendly" id="beginner_friendly">
                {t('form.experience_beginner')}
              </SelectItem>
              <SelectItem key="some_experience" id="some_experience">
                {t('form.experience_some')}
              </SelectItem>
              <SelectItem key="experienced" id="experienced">
                {t('form.experience_experienced')}
              </SelectItem>
              <SelectItem key="professional" id="professional">
                {t('form.experience_professional')}
              </SelectItem>
            </Select>

            {/* Equipment/Tools */}
            <Select
              label={t('form.equipment_label')}
              placeholder={t('form.equipment_placeholder')}
              selectedKeys={formData.equipment_provided ? [formData.equipment_provided] : []}
              onChange={(e) => updateField('equipment_provided', e.target.value)}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
                label: 'text-theme-muted',
              }}
            >
              <SelectItem key="provided" id="provided">
                {t('form.equipment_provided_option')}
              </SelectItem>
              <SelectItem key="partial" id="partial">
                {t('form.equipment_partial')}
              </SelectItem>
              <SelectItem key="bring_own" id="bring_own">
                {t('form.equipment_bring_own')}
              </SelectItem>
              <SelectItem key="not_applicable" id="not_applicable">
                {t('form.equipment_na')}
              </SelectItem>
            </Select>

            {/* Accessibility Notes */}
            <Input
              label={t('form.accessibility_label')}
              placeholder={t('form.accessibility_placeholder')}
              value={formData.accessibility_notes || ''}
              onChange={(e) => updateField('accessibility_notes', e.target.value)}
              isInvalid={!!errors.accessibility_notes}
              errorMessage={errors.accessibility_notes}
              maxLength={200}
              description={t('form.character_count', { count: formData.accessibility_notes?.length || 0, max: 200 })}
              className="md:col-span-2"
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
                description: 'text-theme-subtle',
              }}
            />
          </div>
        </details>
      </section>

      {/* Service Delivery Mode */}
      <section className={sectionClass}>
        <div>
          <h2 className={headingClass}>{t('form.logistics_section')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('form.logistics_section_hint')}</p>
        </div>
        <RadioGroup
          label={t('form.service_type_label')}
          value={formData.service_type}
          onValueChange={(value) => updateField('service_type', value as FormData['service_type'])}
          classNames={{
            label: 'text-sm font-medium text-theme-muted',
            wrapper: 'grid grid-cols-1 sm:grid-cols-2 gap-3',
          }}
        >
          <Radio
            value="physical_only"
            classNames={{
              base: 'm-0 max-w-none p-3 border border-theme-default rounded-xl bg-theme-elevated data-[selected=true]:border-emerald-500 data-[selected=true]:bg-emerald-500/10',
              label: 'text-theme-primary',
            }}
          >
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="font-semibold text-sm">{t('form.service_type_physical')}</div>
                <div className="text-xs leading-5 text-theme-subtle">{t('form.service_type_physical_hint')}</div>
              </div>
            </div>
          </Radio>
          <Radio
            value="remote_only"
            classNames={{
              base: 'm-0 max-w-none p-3 border border-theme-default rounded-xl bg-theme-elevated data-[selected=true]:border-blue-500 data-[selected=true]:bg-blue-500/10',
              label: 'text-theme-primary',
            }}
          >
            <div className="flex items-start gap-2">
              <Monitor className="w-4 h-4 text-[var(--color-info)] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="font-semibold text-sm">{t('form.service_type_remote')}</div>
                <div className="text-xs leading-5 text-theme-subtle">{t('form.service_type_remote_hint')}</div>
              </div>
            </div>
          </Radio>
          <Radio
            value="hybrid"
            classNames={{
              base: 'm-0 max-w-none p-3 border border-theme-default rounded-xl bg-theme-elevated data-[selected=true]:border-teal-500 data-[selected=true]:bg-teal-500/10',
              label: 'text-theme-primary',
            }}
          >
            <div className="flex items-start gap-2">
              <ArrowRightLeft className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="font-semibold text-sm">{t('form.service_type_hybrid')}</div>
                <div className="text-xs leading-5 text-theme-subtle">{t('form.service_type_hybrid_hint')}</div>
              </div>
            </div>
          </Radio>
          <Radio
            value="location_dependent"
            classNames={{
              base: 'm-0 max-w-none p-3 border border-theme-default rounded-xl bg-theme-elevated data-[selected=true]:border-slate-500 data-[selected=true]:bg-slate-500/10',
              label: 'text-theme-primary',
            }}
          >
            <div className="flex items-start gap-2">
              <HelpCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="font-semibold text-sm">{t('form.service_type_depends')}</div>
                <div className="text-xs leading-5 text-theme-subtle">{t('form.service_type_depends_hint')}</div>
              </div>
            </div>
          </Radio>
        </RadioGroup>
      </section>

      <section className={sectionClass}>
        <div>
          <h2 className={headingClass}>{t('form.organise_section')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('form.organise_section_hint')}</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {/* Category */}
          <div>
            <Autocomplete
              label={t('form.category_label')}
              placeholder={t('form.category_placeholder')}
              searchPlaceholder={t('form.category_search')}
              value={formData.category_id || null}
              onChange={(key) => updateField('category_id', key != null && !Array.isArray(key) ? String(key) : '')}
              isRequired
              isInvalid={!!errors.category_id}
              errorMessage={errors.category_id}
              startContent={<Tag className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
                popover: 'bg-theme-elevated border border-theme-default shadow-lg',
                listbox: 'max-h-60 overflow-y-auto',
              }}
            >
              {categories.map((cat) => (
                <AutocompleteItem key={cat.id.toString()} id={cat.id.toString()} textValue={cat.name}>
                  {cat.name}
                </AutocompleteItem>
              ))}
            </Autocomplete>
          </div>

          {/* Skill Tags */}
          <SkillTagsInput
            tags={formData.skill_tags}
            onChange={(tags) => setFormData((prev) => ({ ...prev, skill_tags: tags }))}
          />
        </div>
      </section>

      {/* Hours & Location */}
      <section className={isSheet ? 'space-y-3' : 'space-y-4'}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Input
              type="number"
              inputMode="decimal"
              label={t('form.hours_estimated_label')}
              placeholder={t('form.hours_placeholder')}
              value={formData.hours_estimate}
              onChange={(e) => updateField('hours_estimate', e.target.value)}
              min={0.5}
              max={100}
              step={0.5}
              isInvalid={!!errors.hours_estimate}
              errorMessage={errors.hours_estimate}
              startContent={<Clock className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
            />
          </div>

          <div>
            <Input
              type="number"
              inputMode="decimal"
              label={t('form.hours_available_label')}
              placeholder={t('form.hours_available_placeholder')}
              description={t('form.hours_available_help')}
              value={formData.hours_available}
              onChange={(e) => updateField('hours_available', e.target.value)}
              min={0.5}
              step={0.5}
              isInvalid={!!errors.hours_available}
              errorMessage={errors.hours_available}
              startContent={<Clock className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
            />
          </div>

          <div>
            <Input
              label={t('form.location_optional_label')}
              value={formData.location}
              isDisabled
              description={t('form.location_from_profile')}
              startContent={<MapPin className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
                description: 'text-theme-subtle',
              }}
            />
          </div>
        </div>
      </section>

      {/* Image Upload */}
      <section className={sectionClass}>
        <div>
          <h2 className={headingClass}>{t('form.media_section')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('form.media_section_hint')}</p>
        </div>
        {previewImageSource ? (
          <div className="relative inline-block">
            <img
              src={previewImageSource}
              alt={t('form.image_preview_alt')}
              className={`${isSheet ? 'h-40' : 'h-56'} w-full max-w-md rounded-xl border border-theme-default object-cover`}
            />
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={() => { setImageFile(null); setImagePreview(null); if (existingImageUrl) setRemoveExistingImage(true); setExistingImageUrl(null); }}
              className="absolute right-2 top-2 min-h-8 min-w-8 rounded-full bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80"
              aria-label={t('form.aria_remove_image')}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <label className={`flex ${isSheet ? 'h-32' : 'h-44'} w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-theme-default bg-theme-elevated transition-colors hover:border-teal-500/60 hover:bg-theme-hover focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/30`}>
            <ImagePlus className="mb-2 h-8 w-8 text-theme-subtle" aria-hidden="true" />
            <span className="text-sm text-theme-muted">{t('form.image_upload_hint')}</span>
            <span className="text-xs text-theme-subtle mt-1">{t('form.image_formats')}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-label={t('form.image_label')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 8 * 1024 * 1024) {
                    toast.error(t('form.image_too_large'));
                    return;
                  }
                  setImageFile(file);
                  setImagePreview(URL.createObjectURL(file));
                }
              }}
            />
          </label>
        )}
      </section>

      {/* Submit */}
      {!hideFooter && (
        <div className={`flex flex-col-reverse gap-3 border-t border-theme-default sm:flex-row sm:items-center sm:justify-end ${isSheet ? 'pt-4' : 'pt-6'}`}>
          {isSheet ? (
            <Button
              type="button"
              variant="tertiary"
              onPress={onCancel}
              className="sm:mr-auto w-full bg-theme-elevated text-theme-primary sm:w-auto sm:min-w-24"
            >
              {t('form.cancel')}
            </Button>
          ) : (
            <Button as={Link} to={tenantPath("/listings")}
              type="button"
              variant="tertiary"
              className="sm:mr-auto w-full bg-theme-elevated text-theme-primary sm:w-auto sm:min-w-24"
            >
              {t('form.cancel')}
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full font-semibold text-white sm:w-auto sm:min-w-44"
            startContent={isEditing ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
            isLoading={isSubmitting}
          >
            {isEditing ? t('form.update') : t('create')}
          </Button>
        </div>
      )}
    </form>
  );

  if (isSheet) {
    return formBody;
  }

  return (
    <>
      <header className="overflow-hidden rounded-2xl border border-theme-default bg-theme-elevated">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <Chip size="sm" variant="soft" color={formData.type === 'offer' ? 'success' : 'warning'} className="font-medium">
              {formData.type === 'offer' ? t('form.offer_badge') : t('form.request_badge')}
            </Chip>
            <div>
              <h1 className="text-3xl font-bold tracking-normal text-theme-primary sm:text-4xl">
                {isEditing ? t('form.edit_title') : t('form.create_title')}
              </h1>
              <p className="mt-2 text-sm leading-6 text-theme-muted sm:text-base">
                {t('form.create_intro')}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:min-w-64">
            <div className="rounded-xl border border-theme-default bg-theme-surface px-4 py-3">
              <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('form.summary_type')}</span>
              <span className="mt-1 block font-semibold text-theme-primary">
                {formData.type === 'offer' ? t('form.offer_title') : t('form.request_title')}
              </span>
            </div>
            <div className="rounded-xl border border-theme-default bg-theme-surface px-4 py-3">
              <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('form.summary_category')}</span>
              <span className="mt-1 block truncate font-semibold text-theme-primary">
                {selectedCategoryName || t('form.summary_not_set')}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Form */}
      <GlassCard className="p-5 sm:p-8">
        {formBody}
      </GlassCard>
    </>
  );
}

export default ListingForm;
