// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

/** One notification inside a group, as returned by the grouped endpoint. */
export interface NotificationGroupItem {
  id: number;
  title?: string | null;
  message: string;
  link?: string | null;
  is_read: boolean;
  created_at?: string | null;
}

export interface NotificationActor {
  id: number;
  name: string | null;
  avatar_url: string | null;
}

export interface Notification {
  id: number;
  type: string;
  /**
   * The category the row's icon and tint come from.
   *
   * 🔴 These names are PLURAL, and that is not a style choice — they are exactly what
   * `NotificationService::categoryNames()` publishes and what the category filter and the
   * unread counts already use. This field was previously typed with SINGULAR guesses
   * (`message`, `listing`, `connection`) that the server has never sent; in fact the server
   * did not send the field at all until 2026-09-06, so every notification fell to the
   * default icon and every row in the list rendered the same grey bell.
   *
   * Optional, because a build of the app can outlive a server that does not send it yet.
   */
  category?:
    | 'messages' | 'connections' | 'reviews' | 'transactions' | 'social' | 'groups'
    | 'listings' | 'jobs' | 'safeguarding' | 'system' | 'ideation' | 'security'
    | 'events' | 'other'
    | string;
  title: string | null;
  /** Primary display text */
  message: string;
  body: string;
  is_read: boolean;
  read_at: string | null;
  actor: NotificationActor | null;
  /** Deep-link URL (web format — e.g. /exchanges/123) */
  link: string | null;
  created_at: string;
  latest_at?: string | null;
  group_key?: string | null;
  group_count?: number | null;
  remaining_count?: number | null;
  is_grouped?: boolean;
  actors?: NotificationActor[];
  /**
   * The notifications this group is made of, newest first, capped server-side.
   *
   * 🔴 Without this a group could not be expanded into anything. Both clients offered an
   * expand control for every grouped notification and then rendered only the actor avatars
   * inside it — so a group whose notifications have no actor (an achievement, a wallet
   * movement, a listing expiry) expanded to nothing at all. `remaining_count` says how many
   * are beyond the cap.
   */
  group_items?: NotificationGroupItem[];
}

export interface NotificationListResponse {
  data: Notification[];
  meta: {
    per_page: number;
    has_more: boolean;
    cursor: string | null;
    base_url?: string;
  };
}

export interface NotificationCounts {
  total: number;
  messages: number;
  transactions: number;
  social: number;
  system: number;
}

/** GET /api/v2/notifications — paginated notification list */
export function getNotifications(cursor?: string | null): Promise<NotificationListResponse> {
  const params: Record<string, string> = { per_page: '25' };
  if (cursor) params.cursor = cursor;
  return api.get<NotificationListResponse>(`${API_V2}/notifications/grouped`, params);
}

/** GET /api/v2/notifications/counts — unread counts by category */
export function getNotificationCounts(): Promise<{ data: NotificationCounts }> {
  return api.get<{ data: NotificationCounts }>(`${API_V2}/notifications/counts`);
}

/** POST /api/v2/notifications/{id}/read */
export function markRead(id: number): Promise<void> {
  return api.post<void>(`${API_V2}/notifications/${id}/read`);
}

/** POST /api/v2/notifications/read-all */
export function markAllRead(): Promise<void> {
  return api.post<void>(`${API_V2}/notifications/read-all`);
}

export function markGroupRead(groupKey: string): Promise<void> {
  return api.post<void>(`${API_V2}/notifications/group/read`, { group_key: groupKey });
}

/** DELETE /api/v2/notifications/{id} */
export function deleteNotification(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/notifications/${id}`);
}
