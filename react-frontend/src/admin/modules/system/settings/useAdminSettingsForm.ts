// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * State, dirty tracking, persistence and image uploads for the main admin
 * Settings form. The hook never toasts for save(): the page owns messaging so
 * one Save can report on both halves of the page. Upload handlers do toast,
 * because they persist on their own the moment a file is chosen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant, useToast } from '@/contexts';
import { isPlatformSuperAdminUser } from '@/lib/access';
import { logError } from '@/lib/logger';
import { adminSettings } from '../../../api/adminApi';
import type { AdminSettingsResponse } from '../../../api/types';
import {
  DEFAULT_SETTINGS,
  buildSettingsPayload,
  changedKeys,
  headerColorsChanged,
  settingsFromResponse,
  type PayloadContext,
  type SettingsForm,
  type SettingsFormKey,
} from './settingsForm';

export type SaveOutcome = { ok: true; changed: boolean } | { ok: false; error?: string };

export type UploadSlot =
  | 'partner'
  | 'header_light'
  | 'header_dark'
  | 'powered_light'
  | 'powered_dark'
  | 'network_powered_light'
  | 'network_powered_dark';

/** Powered-by image slots: the upload call and the form field each one fills. */
const POWERED_BY_SLOTS = {
  powered_light: { field: 'powered_by_image_light', upload: adminSettings.uploadPoweredByImageLight },
  powered_dark: { field: 'powered_by_image_dark', upload: adminSettings.uploadPoweredByImageDark },
  network_powered_light: { field: 'network_powered_by_image_light', upload: adminSettings.uploadNetworkPoweredByImageLight },
  network_powered_dark: { field: 'network_powered_by_image_dark', upload: adminSettings.uploadNetworkPoweredByImageDark },
} as const satisfies Record<string, { field: SettingsFormKey; upload: (file: File) => Promise<{ data?: { url: string } }> }>;

export interface AdminSettingsFormState {
  form: SettingsForm;
  originalForm: SettingsForm;
  loading: boolean;
  loadError: boolean;
  saving: boolean;
  dirty: boolean;
  changed: SettingsFormKey[];
  ctx: PayloadContext;
  setField: <K extends SettingsFormKey>(key: K, value: SettingsForm[K]) => void;
  /** PUT /v2/admin/settings with the changed, permitted keys. */
  save: () => Promise<SaveOutcome>;
  /** PUT /v2/admin/settings/header-colors when either colour changed. */
  saveHeaderColors: () => Promise<SaveOutcome>;
  refetch: () => Promise<void>;
  discard: () => void;
  uploading: Record<UploadSlot, boolean>;
  upload: (slot: UploadSlot, file: File) => Promise<void>;
  /** Header logos are removed on the server at once; the others clear the form field. */
  remove: (slot: UploadSlot) => Promise<void>;
}

export function useAdminSettingsForm(): AdminSettingsFormState {
  const { t } = useTranslation('admin_system');
  const toast = useToast();
  const { refreshTenant } = useTenant();
  const { user } = useAuth();
  const userRecord = user as Record<string, unknown> | null;
  // Email verification and member approval are platform-super-admin-only on the
  // server (F-054); this mirrors BaseApiController::isPlatformSuperAdmin().
  const ctx = useMemo<PayloadContext>(
    () => ({ isGod: isPlatformSuperAdminUser(user), isPlatformGod: userRecord?.is_god === true }),
    [user, userRecord?.is_god],
  );

  const [form, setForm] = useState<SettingsForm>(DEFAULT_SETTINGS);
  const [originalForm, setOriginalForm] = useState<SettingsForm>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<Record<UploadSlot, boolean>>({
    partner: false,
    header_light: false,
    header_dark: false,
    powered_light: false,
    powered_dark: false,
    network_powered_light: false,
    network_powered_dark: false,
  });

  const refetch = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminSettings.get();
      const data = res.data as AdminSettingsResponse | undefined;
      if (!res.success || !data) {
        setLoadError(true);
        toast.error(t('system.failed_to_load_settings'));
        return;
      }
      const loaded = settingsFromResponse(data);
      setForm(loaded);
      setOriginalForm(loaded);
    } catch (err) {
      setLoadError(true);
      logError('Settings load error', err);
      toast.error(t('system.failed_to_load_settings'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const changed = useMemo(() => changedKeys(form, originalForm), [form, originalForm]);
  const dirty = changed.length > 0;

  const setField = useCallback(<K extends SettingsFormKey>(key: K, value: SettingsForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(async (): Promise<SaveOutcome> => {
    const payload = buildSettingsPayload(form, originalForm, ctx);
    if (Object.keys(payload).length === 0) return { ok: true, changed: false };
    setSaving(true);
    try {
      const res = await adminSettings.update(payload);
      if (!res.success) {
        // admin-i18n-ignore: localized server message — AdminConfigController
        // refusals are __() keys.
        return { ok: false, error: res.error || t('system.save_failed') };
      }
      return { ok: true, changed: true };
    } catch (err) {
      logError('Settings save error', err);
      return { ok: false, error: t('system.failed_to_save_settings') };
    } finally {
      setSaving(false);
    }
  }, [form, originalForm, ctx, t]);

  const saveHeaderColors = useCallback(async (): Promise<SaveOutcome> => {
    if (!headerColorsChanged(form, originalForm)) return { ok: true, changed: false };
    setSaving(true);
    try {
      const res = await adminSettings.saveHeaderColors(form.header_bg_color || null, form.header_accent_color || null);
      if (res.success === false) {
        // admin-i18n-ignore: localized server message — AdminConfigController
        // refusals (invalid hex colour, prerender reset) are __() keys.
        return { ok: false, error: res.error || t('system.save_failed') };
      }
      return { ok: true, changed: true };
    } catch (err) {
      logError('Header colours save error', err);
      return { ok: false, error: t('system.failed_to_save_settings') };
    } finally {
      setSaving(false);
    }
  }, [form, originalForm, t]);

  const discard = useCallback(() => setForm(originalForm), [originalForm]);

  const setUploadingSlot = (slot: UploadSlot, value: boolean) =>
    setUploading((prev) => ({ ...prev, [slot]: value }));

  const upload = useCallback(
    async (slot: UploadSlot, file: File) => {
      setUploadingSlot(slot, true);
      try {
        switch (slot) {
          case 'partner': {
            const res = await adminSettings.uploadPartnerLogo(file);
            if (!res.data?.url) throw new Error('upload failed');
            const url = res.data.url;
            // The upload itself persisted the URL, so both copies move together.
            setForm((prev) => ({ ...prev, partner_logo_url: url }));
            setOriginalForm((prev) => ({ ...prev, partner_logo_url: url }));
            toast.success(t('admin_settings.logo_uploaded'));
            break;
          }
          case 'powered_light':
          case 'powered_dark':
          case 'network_powered_light':
          case 'network_powered_dark': {
            const { field, upload: uploadImage } = POWERED_BY_SLOTS[slot];
            const res = await uploadImage(file);
            if (!res.data?.url) throw new Error('upload failed');
            const url = res.data.url;
            setForm((prev) => ({ ...prev, [field]: url }));
            setOriginalForm((prev) => ({ ...prev, [field]: url }));
            toast.success(t('system.powered_by_image_uploaded'));
            break;
          }
          case 'header_light':
          case 'header_dark': {
            // Header logos live in tenants.configuration and surface through the
            // tenant bootstrap as branding.logo / branding.logoDark.
            const fn = slot === 'header_light' ? adminSettings.uploadHeaderLogo : adminSettings.uploadHeaderLogoDark;
            const res = await fn(file);
            if (!res.data?.url) throw new Error('upload failed');
            toast.success(t('admin_settings.header_logo_uploaded'));
            break;
          }
        }
        await refreshTenant();
      } catch (err) {
        logError('Settings image upload error', err);
        toast.error(t('admin_settings.upload_failed'));
      } finally {
        setUploadingSlot(slot, false);
      }
    },
    [refreshTenant, t, toast],
  );

  const remove = useCallback(
    async (slot: UploadSlot) => {
      switch (slot) {
        case 'partner':
          // No delete endpoint: the empty value is persisted on Save.
          setForm((prev) => ({ ...prev, partner_logo_url: '' }));
          return;
        case 'powered_light':
        case 'powered_dark':
        case 'network_powered_light':
        case 'network_powered_dark': {
          // No delete endpoint: the empty value is persisted on Save.
          const { field } = POWERED_BY_SLOTS[slot];
          setForm((prev) => ({ ...prev, [field]: '' }));
          return;
        }
        case 'header_light':
        case 'header_dark': {
          const fn = slot === 'header_light' ? adminSettings.removeHeaderLogo : adminSettings.removeHeaderLogoDark;
          try {
            const res = await fn();
            if (res.success === false) {
              toast.error(t('admin_settings.upload_failed'));
              return;
            }
            toast.success(t('admin_settings.header_logo_removed'));
            await refreshTenant();
          } catch (err) {
            logError('Header logo remove error', err);
            toast.error(t('admin_settings.upload_failed'));
          }
        }
      }
    },
    [refreshTenant, t, toast],
  );

  return {
    form,
    originalForm,
    loading,
    loadError,
    saving,
    dirty,
    changed,
    ctx,
    setField,
    save,
    saveHeaderColors,
    refetch,
    discard,
    uploading,
    upload,
    remove,
  };
}

export default useAdminSettingsForm;
