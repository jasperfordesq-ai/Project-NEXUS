// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { FormSectionHeading } from '@/components/ui/FormSectionHeading';
import { FormWithPreview } from '@/components/ui/FormWithPreview';
import { GroupPreviewCard } from '@/components/groups/GroupPreviewCard';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { useConfirm } from '@/components/ui/ConfirmDialog';
/**
 * Create/Edit Group Page
 * Includes image upload, location, and privacy settings
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import Users from 'lucide-react/icons/users';
import FileText from 'lucide-react/icons/file-text';
import Lock from 'lucide-react/icons/lock';
import Globe from 'lucide-react/icons/globe';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ImagePlus from 'lucide-react/icons/image-plus';
import X from 'lucide-react/icons/x';
import { Breadcrumbs } from '@/components/navigation';
import { LoadingScreen } from '@/components/feedback';
import { PlaceAutocompleteInput } from '@/components/location/PlaceAutocompleteInput';
import { useTranslation } from 'react-i18next';
import { useToast, useTenant } from '@/contexts';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { logError } from '@/lib/logger';
import { resolveAssetUrl } from '@/lib/helpers';
import { GroupApiError } from './api/core';
import { getEditableGroup } from './api/createGroup';
import {
  createGroupFromDraft,
  emptyGroupFormDraft,
  emptyGroupImageDraft,
  getGroupFormCapabilities,
  groupFormFingerprint,
  updateGroupFromDraft,
  type GroupFormCapabilities,
  type GroupFormDraft,
  type GroupImageDraft,
} from './api/groupForm';

export function CreateGroupPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('groups');
  const isEditing = !!id;
  const pageTitle = isEditing ? t('form.edit_title') : t('form.create_title');
  usePageTitle(pageTitle);
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();

  const [formData, setFormData] = useState<GroupFormDraft>(() => emptyGroupFormDraft());
  const [capabilities, setCapabilities] = useState<GroupFormCapabilities | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous re-entry guard: setIsSubmitting(true) only flips the button's
  // pending state (pointer-events), but the native submit button stays enabled,
  // so a double-Enter / double-click submits the form twice before state flushes
  // and creates duplicate groups. A ref updates synchronously and blocks the
  // second submit in the same tick.
  const isSubmittingRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'description', string>>>({});

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const groupLoadControllerRef = useRef<AbortController | null>(null);
  const initialFingerprintRef = useRef(groupFormFingerprint(emptyGroupFormDraft()));
  const formDirtyRef = useRef(false);
  const historyIndexRef = useRef<number | null>(
    typeof window.history.state?.idx === 'number' ? window.history.state.idx : null,
  );
  const allowedPopRef = useRef(false);
  const restoringPopRef = useRef<{ delta: number } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const setDraft = useCallback((updater: (previous: GroupFormDraft) => GroupFormDraft) => {
    setFormData((previous) => {
      const next = updater(previous);
      formDirtyRef.current = groupFormFingerprint(next) !== initialFingerprintRef.current;
      return next;
    });
  }, []);

  // Not part of the form: only the live preview shows it.
  const [memberCount, setMemberCount] = useState<number | null>(null);

  const loadGroup = useCallback(async () => {
    if (!id) return;

    const groupId = Number(id);
    if (!Number.isSafeInteger(groupId) || groupId <= 0) {
      setLoadError(t('form.error_not_found'));
      return;
    }

    groupLoadControllerRef.current?.abort();
    const controller = new AbortController();
    groupLoadControllerRef.current = controller;

    try {
      setIsLoading(true);
      setLoadError(null);
      const group = await getEditableGroup(groupId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const nextDraft: GroupFormDraft = {
        name: group.name,
        description: group.description,
        visibility: group.visibility,
        location: {
          label: group.location,
          latitude: group.latitude ?? null,
          longitude: group.longitude ?? null,
        },
        typeId: group.type_id ?? null,
        parentId: group.parent_id ?? null,
        templateId: group.template_id ?? null,
        primaryColor: group.primary_color ?? null,
        accentColor: group.accent_color ?? null,
        avatar: emptyGroupImageDraft(group.image_url ? resolveAssetUrl(group.image_url) : null, group.image_alt),
        cover: emptyGroupImageDraft(
          group.cover_image_url || group.cover_image
            ? resolveAssetUrl(group.cover_image_url || group.cover_image || '')
            : null,
          group.cover_image_alt,
        ),
      };
      setMemberCount(group.member_count ?? null);
      initialFingerprintRef.current = groupFormFingerprint(nextDraft);
      formDirtyRef.current = false;
      setFormData(nextDraft);
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load group', error);
      setLoadError(
        error instanceof GroupApiError && error.code === 'NOT_FOUND'
          ? t('form.error_not_found')
          : t('form.error_load_failed'),
      );
    } finally {
      if (!controller.signal.aborted && groupLoadControllerRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, [id, t]);

  useEffect(() => {
    if (isEditing) {
      loadGroup();
    }
    return () => groupLoadControllerRef.current?.abort();
  }, [isEditing, loadGroup]);

  // Load the authoritative form contract for both create and edit.
  useEffect(() => {
    const controller = new AbortController();
    getGroupFormCapabilities(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setCapabilities(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) logError('Failed to load group form capabilities', error);
      });
    return () => controller.abort();
  }, []);

  const applyTemplate = (templateId: number) => {
    const tmpl = capabilities?.templates.find((template) => template.id === templateId);
    if (!tmpl) return;
    setDraft((previous) => ({
      ...previous,
      templateId,
      visibility: tmpl.default_visibility,
      typeId: tmpl.default_type_id,
    }));
  };

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      for (const preview of [formData.avatar.previewUrl, formData.cover.previewUrl]) {
        if (preview) URL.revokeObjectURL(preview);
      }
    };
  }, [formData.avatar.previewUrl, formData.cover.previewUrl]);

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error(t('form.toast.image_type'));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > (capabilities?.limits.imageMaxBytes ?? 8 * 1024 * 1024)) {
      toast.error(t('form.toast.image_size'));
      return;
    }

    setDraft((previous) => {
      const current = previous[type];
      if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
      const image: GroupImageDraft = {
        ...current,
        action: 'replace',
        file,
        previewUrl: URL.createObjectURL(file),
      };
      return { ...previous, [type]: image };
    });
    e.target.value = '';
  }

  function clearImage(type: 'avatar' | 'cover') {
    setDraft((previous) => {
      const current = previous[type];
      if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return {
        ...previous,
        [type]: {
          ...current,
          action: current.existingUrl ? 'remove' : 'keep',
          file: null,
          previewUrl: null,
          alt: '',
        },
      };
    });
    const input = type === 'avatar' ? avatarInputRef.current : coverInputRef.current;
    if (input) input.value = '';
  }

  function validateForm(): boolean {
    const newErrors: Partial<Record<'name' | 'description', string>> = {};
    const limits = capabilities?.limits;

    if (!formData.name.trim()) {
      newErrors.name = t('form.validation.name_required');
    } else if (formData.name.length < (limits?.nameMin ?? 3)) {
      newErrors.name = t('form.validation.name_min');
    } else if (formData.name.length > (limits?.nameMax ?? 255)) {
      newErrors.name = t('form.validation.name_max');
    }

    if (!formData.description.trim()) {
      newErrors.description = t('form.validation.description_required');
    } else if (formData.description.length < (limits?.descriptionMin ?? 10)) {
      newErrors.description = t('form.validation.description_min');
    } else if (formData.description.length > (limits?.descriptionMax ?? 5000)) {
      newErrors.description = t('form.validation.description_max');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (isSubmittingRef.current) return;
    if (!validateForm()) return;

    try {
      isSubmittingRef.current = true;
      setIsSubmitting(true);

      const savedGroup = isEditing
        ? await updateGroupFromDraft(Number(id), formData)
        : await createGroupFromDraft(formData);

      initialFingerprintRef.current = groupFormFingerprint(formData);
      formDirtyRef.current = false;
      toast.success(isEditing ? t('form.toast.updated') : t('form.toast.created'));
      navigate(tenantPath(`/groups/${savedGroup.id}`));
    } catch (error) {
      logError('Failed to save group', error);
      toast.error(t('form.toast.something_wrong'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function updateField<K extends 'name' | 'description'>(field: K, value: GroupFormDraft[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  const displayAvatar = formData.avatar.action === 'remove'
    ? null
    : formData.avatar.previewUrl || formData.avatar.existingUrl;
  const displayCover = formData.cover.action === 'remove'
    ? null
    : formData.cover.previewUrl || formData.cover.existingUrl;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (formDirtyRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const requestDiscard = useCallback(async (): Promise<boolean> => {
    if (formDirtyRef.current) {
      const confirmed = await confirm({
        title: tRef.current('form.discard_title'),
        body: tRef.current('form.discard_description'),
        confirmLabel: tRef.current('form.discard_confirm'),
        cancelLabel: tRef.current('form.discard_stay'),
        status: 'warning',
      });
      if (!confirmed) return false;
    }
    return true;
  }, [confirm]);

  const guardedNavigate = useCallback(async (destination: string) => {
    if (!await requestDiscard()) return;
    formDirtyRef.current = false;
    navigate(destination);
  }, [navigate, requestDiscard]);

  // BrowserRouter does not expose useBlocker. Capture same-origin links before
  // React Router handles them so sidebar, breadcrumb, and other in-app links all
  // share the same translated discard confirmation.
  useEffect(() => {
    const handleLinkClick = (event: MouseEvent) => {
      if (!formDirtyRef.current || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const element = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(element instanceof HTMLAnchorElement) || element.target === '_blank' || element.hasAttribute('download')) return;

      const destination = new URL(element.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const next = `${destination.pathname}${destination.search}${destination.hash}`;
      if (current === next) return;

      event.preventDefault();
      event.stopPropagation();
      void guardedNavigate(next);
    };

    document.addEventListener('click', handleLinkClick, true);
    return () => document.removeEventListener('click', handleLinkClick, true);
  }, [guardedNavigate]);

  // Back/Forward changes history before popstate is delivered. Restore the
  // current entry immediately, ask asynchronously, then replay the exact delta
  // only after confirmation. BrowserRouter supplies the monotonic state.idx.
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const nextIndex = typeof event.state?.idx === 'number' ? event.state.idx : null;
      if (allowedPopRef.current) {
        allowedPopRef.current = false;
        historyIndexRef.current = nextIndex;
        return;
      }

      const restoring = restoringPopRef.current;
      if (restoring) {
        restoringPopRef.current = null;
        historyIndexRef.current = nextIndex;
        void requestDiscard().then((confirmed) => {
          if (!confirmed) return;
          formDirtyRef.current = false;
          allowedPopRef.current = true;
          window.history.go(-restoring.delta);
        });
        return;
      }

      if (!formDirtyRef.current) {
        historyIndexRef.current = nextIndex;
        return;
      }

      const currentIndex = historyIndexRef.current;
      if (currentIndex === null || nextIndex === null || currentIndex === nextIndex) {
        // BrowserRouter normally always provides idx; preserve the form on
        // non-conforming history implementations with a synchronous fallback.
        if (!window.confirm(tRef.current('form.discard_description'))) {
          window.history.forward();
        } else {
          formDirtyRef.current = false;
          historyIndexRef.current = nextIndex;
        }
        return;
      }

      const delta = currentIndex - nextIndex;
      event.stopImmediatePropagation();
      restoringPopRef.current = { delta };
      window.history.go(delta);
    };

    window.addEventListener('popstate', handlePopState, true);
    return () => window.removeEventListener('popstate', handlePopState, true);
  }, [requestDiscard]);

  const templates = capabilities?.templates ?? [];
  const isPrivate = formData.visibility !== 'public';

  if (isLoading) {
    return <LoadingScreen message={t('form.loading')} />;
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto">
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('form.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{loadError}</p>
          <div className="flex justify-center gap-3">
            <Button as={Link} to={tenantPath("/groups")}
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
            >
              {t('form.back_to_groups')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => loadGroup()}
            >
              {t('form.try_again')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-5xl space-y-6"
    >
      <PageMeta title={pageTitle} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('title'), href: '/groups' },
        { label: isEditing ? t('form.nav_edit') : t('form.nav_new') },
      ]} />

      <header className="overflow-hidden rounded-2xl border border-theme-default bg-theme-surface">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <Chip size="sm" variant="flat" color={isPrivate ? 'warning' : 'success'} className="mb-3 font-medium">
              {isPrivate ? t('form.private_group') : t('form.public_group')}
            </Chip>
            <h1 className="text-3xl font-bold leading-tight text-theme-primary sm:text-4xl">
              {pageTitle}
            </h1>
            <p className="mt-2 text-sm leading-6 text-theme-muted sm:text-base">
              {t('form.create_intro')}
            </p>
          </div>
          <div className="rounded-xl border border-theme-default bg-theme-elevated px-4 py-3 lg:min-w-72">
            <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('form.summary_visibility')}</span>
            <span className="mt-1 block font-semibold text-theme-primary">
              {isPrivate ? t('form.private_desc') : t('form.public_desc')}
            </span>
          </div>
        </div>
      </header>

      {/* Form, with a live picture of the finished card beside it (as the
          offer form has); on a phone the picture follows the form. */}
      <FormWithPreview
        preview={
          <GroupPreviewCard
            name={formData.name}
            description={formData.description}
            visibility={formData.visibility}
            memberCount={isEditing ? (memberCount ?? 1) : 1}
            coverSrc={formData.cover.action === 'remove' ? null : (formData.cover.previewUrl ?? formData.cover.existingUrl)}
          />
        }
      >
      <GlassCard className="p-5 sm:p-8">
        {/* The kind's own colour, as on the feed and in search (warmth plan B6). */}
        <div className="mb-6">
          <FormSectionHeading icon={Users} kind="group" title={t('form.essentials_section')} />
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-8">
          {/* Avatar and cover are staged locally until Save. */}
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['avatar', displayAvatar, avatarInputRef, t('form.image_label')],
              ['cover', displayCover, coverInputRef, t('detail.settings_cover_label')],
            ] as const).map(([type, displayImage, inputRef, label]) => (
              <div key={type} className="rounded-xl border border-theme-default bg-theme-elevated p-4">
                <p className="mb-3 text-sm font-medium text-theme-muted">{label}</p>
                <div className="flex items-center gap-4">
                  {displayImage ? (
                    <div className="relative">
                      {type === 'avatar' ? (
                        <Avatar src={displayImage} className="h-20 w-20 ring-2 ring-white/20" radius="lg" alt={t('form.image_preview_alt')} />
                      ) : (
                        <img src={displayImage} className="h-20 w-32 rounded-lg object-cover" alt={t('detail.image_alt_cover')} />
                      )}
                      <Button
                        isIconOnly
                        size="sm"
                        variant="flat"
                        className="absolute -right-2 -top-2 h-6 min-w-6 rounded-full bg-red-600/80 text-white"
                        aria-label={t('form.remove_image_aria')}
                        onPress={() => clearImage(type)}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-theme-default">
                      <ImagePlus className="h-8 w-8 text-theme-subtle" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <Button
                      type="button"
                      variant="flat"
                      className="bg-theme-surface text-theme-primary"
                      startContent={<ImagePlus className="h-4 w-4" aria-hidden="true" />}
                      onPress={() => inputRef.current?.click()}
                    >
                      {displayImage ? t('form.change_image') : t('form.upload_image')}
                    </Button>
                    <p className="mt-1 text-xs text-theme-subtle">{t('form.image_hint')}</p>
                    {displayImage && (
                      <Input
                        className="mt-2"
                        label={t('form.image_alt_label')}
                        placeholder={t('form.image_alt_placeholder')}
                        description={t('form.image_alt_hint')}
                        value={formData[type].alt}
                        maxLength={255}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraft((previous) => ({ ...previous, [type]: { ...previous[type], alt: value } }));
                        }}
                      />
                    )}
                    <input
                      ref={inputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      aria-label={type === 'avatar' ? t('form.upload_image_aria') : t('detail.upload_cover')}
                      onChange={(event) => handleImageSelect(event, type)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Template Selector (new groups only) */}
          {!isEditing && templates.length > 0 && (
            <div>
              <p className="text-sm font-medium text-theme-primary mb-2">
                {t('form.template_label')}
              </p>
              <div className="flex flex-wrap gap-2">
                {templates.map((tmpl) => (
                  <Button
                    key={tmpl.id}
                    type="button"
                    size="sm"
                    variant={formData.templateId === tmpl.id ? 'flat' : 'bordered'}
                    color={formData.templateId === tmpl.id ? 'primary' : 'default'}
                    onPress={() => applyTemplate(tmpl.id)}
                    className="px-3 py-2"
                  >
                    {tmpl.icon && <span className="mr-1">{tmpl.icon}</span>}
                    {tmpl.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {(capabilities?.fields.type || capabilities?.fields.parent) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {capabilities.fields.type && capabilities.groupTypes.length > 0 && (
                <Select
                  label={t('form.type_label')}
                  selectedKeys={new Set([formData.typeId === null ? '__none__' : String(formData.typeId)])}
                  onSelectionChange={(keys) => {
                    const [key] = Array.from(keys);
                    setDraft((previous) => ({
                      ...previous,
                      typeId: !key || key === '__none__' ? null : Number(key),
                    }));
                  }}
                >
                  <SelectItem id="__none__">{t('form.type_none')}</SelectItem>
                  {capabilities.groupTypes.map((type) => (
                    <SelectItem key={type.id} id={String(type.id)} textValue={type.name}>
                      {type.name}
                    </SelectItem>
                  ))}
                </Select>
              )}
              {capabilities.fields.parent && capabilities.parentCandidates.length > 0 && (
                <Select
                  label={t('form.parent_label')}
                  selectedKeys={new Set([formData.parentId === null ? '__none__' : String(formData.parentId)])}
                  onSelectionChange={(keys) => {
                    const [key] = Array.from(keys);
                    setDraft((previous) => ({
                      ...previous,
                      parentId: !key || key === '__none__' ? null : Number(key),
                    }));
                  }}
                >
                  <SelectItem id="__none__">{t('form.parent_none')}</SelectItem>
                  {capabilities.parentCandidates
                    .filter((parent) => !isEditing || parent.id !== Number(id))
                    .map((parent) => (
                      <SelectItem key={parent.id} id={String(parent.id)} textValue={parent.name}>
                        {parent.name}
                      </SelectItem>
                    ))}
                </Select>
              )}
            </div>
          )}

          {/* Group Name */}
          <div>
            <Input
              label={t('form.name_label')}
              placeholder={t('form.name_placeholder')}
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              isRequired
              isInvalid={!!errors.name}
              errorMessage={errors.name}
              startContent={<FileText className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
            />
          </div>

          {/* Description */}
          <div>
            <Textarea
              label={t('form.description_label')}
              placeholder={t('form.description_placeholder')}
              value={formData.description}
              onChange={(e) => updateField('description', e.target.value)}
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

          {/* Location */}
          <div>
            <PlaceAutocompleteInput
              label={t('form.location_label')}
              placeholder={t('form.location_placeholder')}
              value={formData.location.label}
              onChange={(label) => setDraft((previous) => ({
                ...previous,
                location: label === previous.location.label
                  ? previous.location
                  : { label, latitude: null, longitude: null },
              }))}
              onPlaceSelect={(place) => {
                setDraft((previous) => ({
                  ...previous,
                  location: { label: place.formattedAddress, latitude: place.lat, longitude: place.lng },
                }));
              }}
              onClear={() => {
                setDraft((previous) => ({
                  ...previous,
                  location: { label: '', latitude: null, longitude: null },
                }));
              }}
              classNames={{
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
                input: 'text-theme-primary placeholder:text-theme-subtle',
              }}
            />
          </div>

          {/* Visibility */}
          <div className="rounded-xl border border-theme-default bg-theme-elevated p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {isPrivate ? (
                  <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                ) : (
                  <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                )}
                <div>
                  <p className="font-medium text-theme-primary">
                    {isPrivate ? t('form.private_group') : t('form.public_group')}
                  </p>
                  <p className="text-sm text-theme-subtle">
                    {isPrivate
                      ? t('form.private_desc')
                      : t('form.public_desc')}
                  </p>
                </div>
              </div>
              <Select
                aria-label={t('form.visibility_label')}
                className="w-full sm:w-48"
                selectedKeys={new Set([formData.visibility])}
                onSelectionChange={(keys) => {
                  const [key] = Array.from(keys);
                  if (key === 'public' || key === 'private' || key === 'secret') {
                    setDraft((previous) => ({ ...previous, visibility: key }));
                  }
                }}
              >
                {(capabilities?.allowedVisibility ?? ['public', 'private']).map((option) => (
                  <SelectItem key={option} id={option} textValue={t(`form.visibility_${option}`)}>
                    {t(`form.visibility_${option}`)}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>

          {/* Submit */}
          <div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row">
            <Button
              type="submit"
              className="flex-1 bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
              startContent={isEditing ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
              isLoading={isSubmitting}
            >
              {isEditing ? t('form.submit_update') : t('form.submit_create')}
            </Button>
            <Button
              type="button"
              variant="flat"
              className="bg-theme-elevated text-theme-primary sm:min-w-32"
              onPress={() => void guardedNavigate(
                isEditing ? tenantPath(`/groups/${id}`) : tenantPath('/groups'),
              )}
            >
              {t('form.cancel')}
            </Button>
          </div>
        </form>
      </GlassCard>
      </FormWithPreview>
    </motion.div>
  );
}

export default CreateGroupPage;
