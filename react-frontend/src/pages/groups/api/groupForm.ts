// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api';
import type { GroupVisibility } from '@/types/api';
import { normalizeGroupApiError, unwrapGroupResponse } from './core';

export type GroupImageAction = 'keep' | 'replace' | 'remove';

export interface GroupImageDraft {
  action: GroupImageAction;
  file: File | null;
  previewUrl: string | null;
  existingUrl: string | null;
  /** The image's description for screen readers (AWID report, Oct 2026). */
  alt: string;
}

export interface GroupLocationDraft {
  label: string;
  latitude: number | null;
  longitude: number | null;
}

export interface GroupFormDraft {
  name: string;
  description: string;
  visibility: GroupVisibility;
  location: GroupLocationDraft;
  typeId: number | null;
  parentId: number | null;
  templateId: number | null;
  primaryColor: string | null;
  accentColor: string | null;
  avatar: GroupImageDraft;
  cover: GroupImageDraft;
}

export interface GroupFormTemplate {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  default_visibility: GroupVisibility;
  default_type_id: number | null;
  default_tags: number[];
  features: Record<string, boolean> | string[];
  welcome_message: string | null;
}

export interface GroupFormType {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
}

export interface GroupParentCandidate {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface GroupFormCapabilities {
  allowedVisibility: GroupVisibility[];
  limits: {
    nameMin: number;
    nameMax: number;
    descriptionMin: number;
    descriptionMax: number;
    locationMax: number;
    imageMaxBytes: number;
  };
  templates: GroupFormTemplate[];
  groupTypes: GroupFormType[];
  parentCandidates: GroupParentCandidate[];
  fields: {
    type: boolean;
    parent: boolean;
    location: boolean;
    avatar: boolean;
    cover: boolean;
    branding: boolean;
  };
  canCreate: boolean;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function invalidResponse(): never {
  throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
}

function visibility(value: unknown): GroupVisibility {
  if (value === 'public' || value === 'private' || value === 'secret') return value;
  return invalidResponse();
}

function normalizeCapabilities(value: unknown): GroupFormCapabilities {
  const payload = record(value);
  const rawLimits = record(payload?.limits);
  const rawFields = record(payload?.fields);
  const rawCapabilities = record(payload?.capabilities);
  if (!payload || !rawLimits || !rawFields || !rawCapabilities
    || !Array.isArray(payload.allowed_visibility)
    || !Array.isArray(payload.templates)
    || !Array.isArray(payload.group_types)
    || !Array.isArray(payload.parent_candidates)) {
    return invalidResponse();
  }

  const readLimit = (key: string): number => {
    const parsed = number(rawLimits[key]);
    if (parsed === null || parsed < 0) return invalidResponse();
    return parsed;
  };

  return {
    allowedVisibility: payload.allowed_visibility.map(visibility),
    limits: {
      nameMin: readLimit('name_min'),
      nameMax: readLimit('name_max'),
      descriptionMin: readLimit('description_min'),
      descriptionMax: readLimit('description_max'),
      locationMax: readLimit('location_max'),
      imageMaxBytes: readLimit('image_max_bytes'),
    },
    templates: payload.templates.map((raw) => {
      const item = record(raw);
      const id = number(item?.id);
      if (!item || id === null || typeof item.name !== 'string') return invalidResponse();
      const tags = Array.isArray(item.default_tags)
        ? item.default_tags.map(number).filter((tag): tag is number => tag !== null)
        : [];
      const features = Array.isArray(item.features)
        ? item.features.filter((feature): feature is string => typeof feature === 'string')
        : (record(item.features) as Record<string, boolean> | null) ?? {};
      return {
        id,
        name: item.name,
        description: stringOrNull(item.description),
        icon: stringOrNull(item.icon),
        default_visibility: visibility(item.default_visibility),
        default_type_id: number(item.default_type_id),
        default_tags: tags,
        features,
        welcome_message: stringOrNull(item.welcome_message),
      };
    }),
    groupTypes: payload.group_types.map((raw) => {
      const item = record(raw);
      const id = number(item?.id);
      if (!item || id === null || typeof item.name !== 'string') return invalidResponse();
      return {
        id,
        name: item.name,
        description: stringOrNull(item.description),
        icon: stringOrNull(item.icon),
        color: stringOrNull(item.color),
      };
    }),
    parentCandidates: payload.parent_candidates.map((raw) => {
      const item = record(raw);
      const id = number(item?.id);
      if (!item || id === null || typeof item.name !== 'string') return invalidResponse();
      return { id, name: item.name, parent_id: number(item.parent_id) };
    }),
    fields: {
      type: rawFields.type === true,
      parent: rawFields.parent === true,
      location: rawFields.location === true,
      avatar: rawFields.avatar === true,
      cover: rawFields.cover === true,
      branding: rawFields.branding === true,
    },
    canCreate: rawCapabilities.can_create === true,
  };
}

export function emptyGroupImageDraft(existingUrl: string | null = null, alt: string | null = null): GroupImageDraft {
  return { action: 'keep', file: null, previewUrl: null, existingUrl, alt: alt ?? '' };
}

export function emptyGroupFormDraft(): GroupFormDraft {
  return {
    name: '',
    description: '',
    visibility: 'public',
    location: { label: '', latitude: null, longitude: null },
    typeId: null,
    parentId: null,
    templateId: null,
    primaryColor: null,
    accentColor: null,
    avatar: emptyGroupImageDraft(),
    cover: emptyGroupImageDraft(),
  };
}

export function groupFormFingerprint(draft: GroupFormDraft): string {
  const image = (value: GroupImageDraft) => ({
    action: value.action,
    existingUrl: value.existingUrl,
    file: value.file ? [value.file.name, value.file.size, value.file.lastModified, value.file.type] : null,
  });
  return JSON.stringify({
    name: draft.name,
    description: draft.description,
    visibility: draft.visibility,
    location: draft.location,
    typeId: draft.typeId,
    parentId: draft.parentId,
    templateId: draft.templateId,
    primaryColor: draft.primaryColor,
    accentColor: draft.accentColor,
    avatar: image(draft.avatar),
    cover: image(draft.cover),
  });
}

export async function getGroupFormCapabilities(signal?: AbortSignal): Promise<GroupFormCapabilities> {
  try {
    const response = await api.get<unknown>('/v2/groups/form-capabilities', { signal });
    return normalizeCapabilities(unwrapGroupResponse(response));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

function appendDraft(formData: FormData, draft: GroupFormDraft): void {
  formData.append('name', draft.name.trim());
  formData.append('description', draft.description.trim());
  formData.append('visibility', draft.visibility);
  formData.append('location', draft.location.label.trim());
  if (draft.location.latitude !== null && draft.location.longitude !== null) {
    formData.append('latitude', String(draft.location.latitude));
    formData.append('longitude', String(draft.location.longitude));
  }
  if (draft.typeId !== null) formData.append('type_id', String(draft.typeId));
  if (draft.parentId !== null) formData.append('parent_id', String(draft.parentId));
  if (draft.templateId !== null) formData.append('template_id', String(draft.templateId));
  formData.append('primary_color', draft.primaryColor ?? '');
  formData.append('accent_color', draft.accentColor ?? '');
}

function appendImage(formData: FormData, field: 'avatar' | 'cover', image: GroupImageDraft): void {
  formData.append(`${field}_action`, image.action);
  if (image.action === 'replace' && image.file) formData.append(field, image.file);
  appendImageDescription(formData, field, image);
}

/** Sent whenever there is an image to describe; empty clears it. */
function appendImageDescription(formData: FormData, field: 'avatar' | 'cover', image: GroupImageDraft): void {
  if (image.action === 'remove') return;
  const hasImage = (image.action === 'replace' && image.file) || image.existingUrl;
  if (hasImage) formData.append(`${field}_alt`, image.alt.trim());
}

function normalizeSavedGroup(value: unknown): { id: number } {
  const payload = record(value);
  const id = number(payload?.id);
  if (id === null || !Number.isSafeInteger(id) || id < 1) return invalidResponse();
  return { id };
}

export async function createGroupFromDraft(draft: GroupFormDraft): Promise<{ id: number }> {
  try {
    const formData = new FormData();
    appendDraft(formData, draft);
    if (draft.avatar.action === 'replace' && draft.avatar.file) formData.append('avatar', draft.avatar.file);
    if (draft.cover.action === 'replace' && draft.cover.file) formData.append('cover', draft.cover.file);
    appendImageDescription(formData, 'avatar', draft.avatar);
    appendImageDescription(formData, 'cover', draft.cover);
    const response = await api.upload<unknown>('/v2/groups', formData);
    return normalizeSavedGroup(unwrapGroupResponse(response));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

export async function updateGroupFromDraft(groupId: number, draft: GroupFormDraft): Promise<{ id: number }> {
  try {
    const formData = new FormData();
    appendDraft(formData, draft);
    appendImage(formData, 'avatar', draft.avatar);
    appendImage(formData, 'cover', draft.cover);
    const response = await api.upload<unknown>(`/v2/groups/${groupId}/settings`, formData);
    return normalizeSavedGroup(unwrapGroupResponse(response));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}
