// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { type User } from '@/lib/api/auth';
import { Platform } from 'react-native';

export interface UpdateProfilePayload {
  first_name?: string;
  last_name?: string;
  bio?: string;
  location?: string;
  phone?: string;
}

/**
 * PUT /api/v2/users/me — update the authenticated user's profile.
 * Returns the updated full User.
 */
export function updateProfile(payload: UpdateProfilePayload): Promise<{ data: User }> {
  return api.put<{ data: User }>(`${API_V2}/users/me`, payload);
}

export interface UpdatePasswordPayload {
  current_password: string;
  new_password: string;
  new_password_confirmation: string;
}

/**
 * POST /api/v2/users/me/password — change the authenticated user's password.
 */
export function updatePassword(payload: UpdatePasswordPayload): Promise<void> {
  return api.post<void>(`${API_V2}/users/me/password`, payload);
}

/**
 * POST /api/v2/users/me/avatar — multipart form data upload.
 * Uses the centralized API client which handles auth token refresh,
 * tenant slug, error formatting, and the upload timeout (60s).
 * Returns the updated avatar URL.
 */
type AvatarUploadResponse = {
  data?: { avatar_url?: string | null } | null;
  avatar_url?: string | null;
  message?: string;
};

function getUploadFilename(uri: string): string {
  const cleanUri = uri.split('?')[0] ?? uri;
  const lastSegment = cleanUri.split('/').pop();
  return lastSegment && lastSegment.includes('.') ? lastSegment : 'avatar.jpg';
}

function getMimeType(filename: string, fallback?: string | null): string {
  if (fallback?.startsWith('image/')) return fallback;
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

async function appendAvatarFile(formData: FormData, uri: string): Promise<void> {
  const filename = getUploadFilename(uri);

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const type = getMimeType(filename, blob.type);

    if (typeof File !== 'undefined') {
      formData.append('avatar', new File([blob], filename, { type }));
      return;
    }

    formData.append('avatar', blob, filename);
    return;
  }

  const type = getMimeType(filename);
  // FormData accepts this shape in React Native.
  formData.append('avatar', { uri, name: filename, type } as unknown as Blob);
}

export async function updateAvatar(uri: string): Promise<{ data: { avatar_url: string } }> {
  const formData = new FormData();
  await appendAvatarFile(formData, uri);

  const response = await api.upload<AvatarUploadResponse>(`${API_V2}/users/me/avatar`, formData);
  const avatarUrl = response.data?.avatar_url ?? response.avatar_url ?? null;

  if (!avatarUrl) {
    throw new ApiResponseError(502, response.message ?? i18n.t('common:errors.uploadIncomplete'));
  }

  return { data: { avatar_url: avatarUrl } };
}
