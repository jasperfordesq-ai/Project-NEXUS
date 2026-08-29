// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface PodcastChapter {
  title: string;
  starts_at_seconds: number;
}

export interface PodcastEpisode {
  id: number;
  show_id: number;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  audio_url: string;
  duration_seconds?: number | null;
  episode_number?: number | null;
  season_number?: number | null;
  explicit: boolean;
  episode_type: 'full' | 'trailer' | 'bonus';
  transcript?: string | null;
  listen_count: number;
  reaction_count?: number;
  viewer_has_reacted?: boolean;
  show?: PodcastShow | null;
  chapters?: PodcastChapter[];
}

export interface PodcastShow {
  id: number;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  artwork_url?: string | null;
  category?: string | null;
  author_name?: string | null;
  explicit?: boolean;
  episode_count: number;
  subscriber_count: number;
  is_subscribed?: boolean;
  episodes?: PodcastEpisode[];
  owner?: { id: number; name: string; avatar_url?: string | null } | null;
}

export interface PodcastPage {
  items: PodcastShow[];
  page: number;
  total: number;
  hasMore: boolean;
  categories: string[];
}

type Envelope<T> = T | { data: T };

function unwrap<T>(value: Envelope<T>): T {
  if (value && typeof value === 'object' && 'data' in value) return (value as { data: T }).data;
  return value as T;
}

export async function getPodcastShows(filters: { query?: string; category?: string; sort?: string; page?: number } = {}): Promise<PodcastPage> {
  const params: Record<string, string> = { per_page: '20' };
  if (filters.query) params.q = filters.query;
  if (filters.category) params.category = filters.category;
  if (filters.sort) params.sort = filters.sort;
  if (filters.page !== undefined) params.page = String(filters.page);
  const response = await api.get<PodcastShow[] | { data: PodcastShow[]; meta?: { current_page?: number; total?: number; has_more?: boolean; categories?: string[] } }>(`${API_V2}/podcasts`, params);
  const body = response as { data?: PodcastShow[]; meta?: { current_page?: number; total?: number; has_more?: boolean; categories?: string[] } };
  const items = Array.isArray(response) ? response : (body.data ?? []);
  return { items, page: Number(body.meta?.current_page ?? filters.page ?? 1), total: Number(body.meta?.total ?? items.length), hasMore: Boolean(body.meta?.has_more), categories: body.meta?.categories ?? [] };
}

export async function getPodcastShow(slug: string): Promise<PodcastShow> {
  return unwrap(await api.get<Envelope<PodcastShow>>(`${API_V2}/podcasts/${encodeURIComponent(slug)}`));
}

export async function getPodcastEpisode(showSlug: string, episodeSlug: string): Promise<PodcastEpisode> {
  return unwrap(await api.get<Envelope<PodcastEpisode>>(`${API_V2}/podcasts/${encodeURIComponent(showSlug)}/${encodeURIComponent(episodeSlug)}`));
}

export async function recordPodcastListen(episodeId: number, payload: { position_seconds: number; completed: boolean }): Promise<{ recorded: boolean }> {
  return unwrap(await api.post<Envelope<{ recorded: boolean }>>(`${API_V2}/podcasts/episodes/${episodeId}/listen`, payload));
}

export async function togglePodcastSubscription(showId: number): Promise<{ subscribed: boolean }> {
  return unwrap(await api.post<Envelope<{ subscribed: boolean }>>(`${API_V2}/podcasts/${showId}/subscribe`, { notify_new_episodes: true }));
}

export async function togglePodcastReaction(episodeId: number): Promise<{ active: boolean }> {
  return unwrap(await api.post<Envelope<{ active: boolean }>>(`${API_V2}/podcasts/episodes/${episodeId}/reaction`, { reaction: 'like' }));
}

export async function reportPodcastEpisode(episodeId: number, reason: 'safety' | 'spam' | 'rights' | 'other'): Promise<unknown> {
  return unwrap(await api.post<Envelope<unknown>>(`${API_V2}/podcasts/episodes/${episodeId}/report`, { reason }));
}
