// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api';
import type { GroupVisibility } from '@/types/api';
import { normalizeGroupApiError, unwrapGroupResponse } from './core';

export interface GroupTemplate {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  default_visibility?: GroupVisibility;
  default_type_id?: number | null;
  default_tags?: number[];
  features?: Record<string, boolean> | string[];
  welcome_message?: string | null;
}

export interface EditableGroup {
  id: number;
  name: string;
  description: string;
  visibility: GroupVisibility;
  location: string;
  latitude?: number;
  longitude?: number;
  image_url?: string | null;
  cover_image_url?: string | null;
  cover_image?: string | null;
  /** Descriptions of the picture and cover (AWID report, Oct 2026). */
  image_alt?: string | null;
  cover_image_alt?: string | null;
  type_id?: number | null;
  parent_id?: number | null;
  template_id?: number | null;
  primary_color?: string | null;
  accent_color?: string | null;
}

export interface SaveGroupPayload {
  name: string;
  description: string;
  visibility: GroupVisibility;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  type_id?: number | null;
  parent_id?: number | null;
  template_id?: number | null;
}

export interface SavedGroupResult {
  id: number;
}

export interface GroupImageUploadResult {
  image_url: string;
}

export interface GroupCreateReadOptions {
  signal?: AbortSignal;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidCreateGroupResponse(): never {
  throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
}

function readPositiveId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return invalidCreateGroupResponse();
  }
  return value;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalidCreateGroupResponse();
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return invalidCreateGroupResponse();
  return value;
}

function normalizeTemplate(value: unknown): GroupTemplate {
  if (!isRecord(value) || typeof value.name !== 'string') return invalidCreateGroupResponse();

  const visibility = value.default_visibility;
  if (
    visibility !== undefined
    && visibility !== null
    && visibility !== 'public'
    && visibility !== 'private'
    && visibility !== 'secret'
  ) {
    return invalidCreateGroupResponse();
  }

  return {
    id: readPositiveId(value.id),
    name: value.name,
    ...(readOptionalString(value.description) === undefined ? {} : { description: value.description as string }),
    ...(readOptionalString(value.icon) === undefined ? {} : { icon: value.icon as string }),
    ...(visibility === undefined || visibility === null ? {} : { default_visibility: visibility }),
  };
}

function normalizeEditableGroup(value: unknown): EditableGroup {
  if (!isRecord(value) || typeof value.name !== 'string') return invalidCreateGroupResponse();
  if (value.visibility !== 'public' && value.visibility !== 'private' && value.visibility !== 'secret') {
    return invalidCreateGroupResponse();
  }

  const description = value.description;
  const location = value.location;
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return invalidCreateGroupResponse();
  }
  if (location !== undefined && location !== null && typeof location !== 'string') {
    return invalidCreateGroupResponse();
  }

  return {
    id: readPositiveId(value.id),
    name: value.name,
    description: typeof description === 'string' ? description : '',
    visibility: value.visibility,
    location: typeof location === 'string' ? location : '',
    latitude: readOptionalNumber(value.latitude),
    longitude: readOptionalNumber(value.longitude),
    image_url: readOptionalString(value.image_url) ?? null,
    cover_image_url: readOptionalString(value.cover_image_url) ?? null,
    cover_image: readOptionalString(value.cover_image) ?? null,
    type_id: readOptionalNumber(value.type_id) ?? null,
    parent_id: readOptionalNumber(value.parent_id) ?? null,
    template_id: readOptionalNumber(value.template_id) ?? null,
    primary_color: readOptionalString(value.primary_color) ?? null,
    accent_color: readOptionalString(value.accent_color) ?? null,
  };
}

function normalizeSavedGroup(value: unknown): SavedGroupResult {
  if (!isRecord(value)) return invalidCreateGroupResponse();
  return { id: readPositiveId(value.id) };
}

export async function getGroupTemplates(
  options: GroupCreateReadOptions = {},
): Promise<GroupTemplate[]> {
  try {
    const response = await api.get<unknown>('/v2/group-templates', { signal: options.signal });
    const payload = unwrapGroupResponse(response);
    if (!Array.isArray(payload)) return invalidCreateGroupResponse();
    return payload.map(normalizeTemplate);
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

export async function getEditableGroup(
  groupId: number,
  options: GroupCreateReadOptions = {},
): Promise<EditableGroup> {
  try {
    const response = await api.get<unknown>(`/v2/groups/${groupId}`, { signal: options.signal });
    return normalizeEditableGroup(unwrapGroupResponse(response));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

export async function createGroup(payload: SaveGroupPayload): Promise<SavedGroupResult> {
  try {
    const response = await api.post<unknown>('/v2/groups', payload);
    return normalizeSavedGroup(unwrapGroupResponse(response));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

export async function updateGroup(
  groupId: number,
  payload: SaveGroupPayload,
): Promise<SavedGroupResult> {
  try {
    const response = await api.put<unknown>(`/v2/groups/${groupId}`, payload);
    return normalizeSavedGroup(unwrapGroupResponse(response));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

export async function uploadGroupImage(
  groupId: number,
  image: File,
): Promise<GroupImageUploadResult> {
  try {
    const response = await api.upload<unknown>(`/v2/groups/${groupId}/image`, image, 'image');
    const payload = unwrapGroupResponse(response);
    if (!isRecord(payload) || typeof payload.image_url !== 'string' || payload.image_url === '') {
      return invalidCreateGroupResponse();
    }
    return { image_url: payload.image_url };
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}
