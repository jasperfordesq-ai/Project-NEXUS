// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api';
import { normalizeGroupApiError, unwrapGroupResponse } from './core';

export interface GroupAnnouncement {
  id: number;
  title: string;
  content: string;
  author: {
    id?: number;
    name: string;
    avatar_url?: string | null;
  };
  created_at: string;
  updated_at?: string;
  is_pinned?: boolean;
}

export interface CreateGroupAnnouncementInput {
  title: string;
  content: string;
  is_pinned: boolean;
}

export interface UpdateGroupAnnouncementInput {
  title?: string;
  content?: string;
  is_pinned?: boolean;
}

interface GroupAnnouncementsEnvelope {
  items?: GroupAnnouncement[];
  announcements?: GroupAnnouncement[];
  cursor?: string | null;
  has_more?: boolean;
}

/** Pages walked by listGroupAnnouncements (100 each) before it stops. */
const ANNOUNCEMENT_PAGE_LIMIT = 10;

export interface GetPinnedAnnouncementsOptions {
  signal?: AbortSignal;
}

export type ListGroupAnnouncementsOptions = GetPinnedAnnouncementsOptions;

export const GROUP_ANNOUNCEMENTS_CHANGED_EVENT = 'nexus:group-announcements-changed';

/** Notify mounted announcement consumers that their server-backed view is stale. */
export function notifyGroupAnnouncementsChanged(groupId: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GROUP_ANNOUNCEMENTS_CHANGED_EVENT, {
    detail: { groupId },
  }));
}

function getAnnouncementItems(payload: unknown): GroupAnnouncement[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object' || payload === null) {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }

  const envelope = payload as GroupAnnouncementsEnvelope;
  if (Array.isArray(envelope.items)) return envelope.items;
  if (Array.isArray(envelope.announcements)) return envelope.announcements;
  throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
}

async function readGroupAnnouncements(
  path: string,
  options: ListGroupAnnouncementsOptions,
): Promise<GroupAnnouncement[]> {
  try {
    const response = await api.get<unknown>(path, {
      signal: options.signal,
    });
    return getAnnouncementItems(unwrapGroupResponse(response));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

/**
 * List every visible announcement for a group. The API pages (20 by default,
 * with `cursor`/`has_more`); until 29 Oct 2026 only the first page was read, so
 * a group with more than 20 announcements lost the rest.
 */
export async function listGroupAnnouncements(
  groupId: number,
  options: ListGroupAnnouncementsOptions = {},
): Promise<GroupAnnouncement[]> {
  const all: GroupAnnouncement[] = [];
  let cursor: string | null = null;
  try {
    for (let page = 0; page < ANNOUNCEMENT_PAGE_LIMIT; page += 1) {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const response = await api.get<unknown>(`/v2/groups/${groupId}/announcements?${query.toString()}`, {
        signal: options.signal,
      });
      const payload = unwrapGroupResponse(response);
      all.push(...getAnnouncementItems(payload));
      const envelope = payload as GroupAnnouncementsEnvelope | null;
      cursor = envelope && !Array.isArray(envelope) && envelope.has_more && envelope.cursor ? envelope.cursor : null;
      if (!cursor) break;
    }
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
  return all;
}

/** Read the non-critical pinned-announcement banner through the Groups contract. */
export async function getPinnedAnnouncements(
  groupId: number,
  options: GetPinnedAnnouncementsOptions = {},
): Promise<GroupAnnouncement[]> {
  const announcements = await readGroupAnnouncements(
    `/v2/groups/${groupId}/announcements?pinned=1`,
    options,
  );
  return announcements.filter((announcement) => announcement.is_pinned !== false);
}

/** Create an announcement through the normalized Groups contract. */
export async function createGroupAnnouncement(
  groupId: number,
  input: CreateGroupAnnouncementInput,
): Promise<GroupAnnouncement | undefined> {
  try {
    return unwrapGroupResponse(await api.post<GroupAnnouncement>(
      `/v2/groups/${groupId}/announcements`,
      input,
    ));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

/** Update an announcement through the normalized Groups contract. */
export async function updateGroupAnnouncement(
  groupId: number,
  announcementId: number,
  input: UpdateGroupAnnouncementInput,
): Promise<GroupAnnouncement | undefined> {
  try {
    return unwrapGroupResponse(await api.put<GroupAnnouncement>(
      `/v2/groups/${groupId}/announcements/${announcementId}`,
      input,
    ));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

/** Delete an announcement through the normalized Groups contract. */
export async function deleteGroupAnnouncement(
  groupId: number,
  announcementId: number,
): Promise<void> {
  try {
    unwrapGroupResponse<void>(await api.delete<void>(
      `/v2/groups/${groupId}/announcements/${announcementId}`,
    ));
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}
