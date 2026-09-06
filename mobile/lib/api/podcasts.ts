// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Platform } from 'react-native';

import { api } from '@/lib/api/client';
import { uploadWithProgress } from '@/lib/api/uploadWithProgress';
import { API_V2 } from '@/lib/constants';

export interface PodcastChapter {
  title: string;
  starts_at_seconds: number;
  url?: string | null;
  position?: number;
}

/** Show-level visibility. Episodes add `inherit` — see PodcastEpisodeVisibility. */
export type PodcastVisibility = 'public' | 'members' | 'private';
export type PodcastEpisodeVisibility = 'inherit' | PodcastVisibility;
export type PodcastStatus = 'draft' | 'published' | 'archived';
export type PodcastModerationStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type PodcastEpisodeType = 'full' | 'trailer' | 'bonus';

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
  episode_type: PodcastEpisodeType;
  transcript?: string | null;
  listen_count: number;
  reaction_count?: number;
  viewer_has_reacted?: boolean;
  show?: PodcastShow | null;
  chapters?: PodcastChapter[];
  /* Studio-only fields. Absent from the public browse projection, which is why
     every one of them is optional — a listener screen must not start depending
     on a field only an owner is sent. */
  transcript_language?: string | null;
  cover_image_url?: string | null;
  visibility?: PodcastEpisodeVisibility;
  status?: PodcastStatus;
  moderation_status?: PodcastModerationStatus;
  moderation_notes?: string | null;
  moderation_feedback?: string | null;
  media_processing_status?: string | null;
  media_scan_status?: string | null;
  scheduled_for?: string | null;
  published_at?: string | null;
  /** True when NEXUS hosts the audio file, so `audio_url` must not be edited. */
  hosted_audio?: boolean;
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
  /* Studio-only fields — see the note on PodcastEpisode. */
  language?: string;
  owner_email?: string | null;
  copyright?: string | null;
  funding_url?: string | null;
  visibility?: PodcastVisibility;
  status?: PodcastStatus;
  moderation_status?: PodcastModerationStatus;
  moderation_notes?: string | null;
  moderation_feedback?: string | null;
  approved_episode_count?: number;
  published_at?: string | null;
}

/**
 * Studio capabilities and upload limits. The API rides these along in the
 * `meta` of GET /v2/podcasts/mine so the studio can gate creation and reject an
 * oversized file before an upload starts.
 */
export interface PodcastStudioCapabilities {
  max_audio_size_mb?: number;
  allowed_audio_mimes?: string[];
  allow_member_show_creation?: boolean;
  can_create_show?: boolean;
  can_manage_existing_shows?: boolean;
  current_show_count?: number;
  max_shows_per_user?: number;
  enable_private_shows?: boolean;
  enable_transcripts?: boolean;
  enable_chapters?: boolean;
  enable_episode_reactions?: boolean;
}

export interface PodcastFeedValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Episodes the RSS builder would omit for lacking a resolvable audio URL. */
  skipped_episode_count?: number;
}

export interface PodcastShowStats {
  enabled: boolean;
  days?: number;
  totals?: {
    listens: number;
    completed_listens: number;
    completion_rate: number;
    unique_listeners: number;
    subscribers: number;
    episodes: number;
  };
  listens_over_time?: { date: string; listens: number }[];
  top_episodes?: { id: number; show_id: number; title: string; slug: string; listen_count: number }[];
  retention?: { bucket: string; listens: number }[];
  client_breakdown?: { client: string; listens: number }[];
}

export interface CreatePodcastShowPayload {
  title: string;
  summary?: string;
  description?: string;
  artwork_url?: string;
  language?: string;
  category?: string;
  author_name?: string;
  owner_email?: string;
  copyright?: string;
  funding_url?: string;
  explicit?: boolean;
  visibility?: PodcastVisibility;
}

export interface CreatePodcastEpisodePayload {
  title: string;
  summary?: string;
  description?: string;
  audio_url: string;
  duration_seconds?: number;
  episode_number?: number;
  season_number?: number;
  explicit?: boolean;
  episode_type?: PodcastEpisodeType;
  visibility?: PodcastEpisodeVisibility;
  transcript?: string;
  transcript_language?: string;
  cover_image_url?: string;
  scheduled_for?: string;
  chapters?: PodcastChapter[];
}

/** Both halves of GET /v2/podcasts/mine — the studio needs the meta as much as the shows. */
export interface AuthoredPodcasts {
  shows: PodcastShow[];
  capabilities: PodcastStudioCapabilities;
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

/* ------------------------------------------------------------------ *
 * Podcast Studio — authoring endpoints (owner or admin).
 * ------------------------------------------------------------------ */

/**
 * GET /v2/podcasts/mine — every show this member authored.
 *
 * 🔴 Returns the `meta` as well as the shows. The studio cannot be built from
 * the list alone: whether a member may create another show, whether private
 * shows/transcripts/chapters are enabled and how large an audio file may be all
 * arrive only in `meta`. Dropping it would silently offer members features their
 * community has switched off.
 */
export async function getAuthoredPodcasts(): Promise<AuthoredPodcasts> {
  const response = await api.get<{ data?: PodcastShow[]; meta?: PodcastStudioCapabilities } | PodcastShow[]>(`${API_V2}/podcasts/mine`);
  if (Array.isArray(response)) return { shows: response, capabilities: {} };
  const body = response as { data?: PodcastShow[]; meta?: PodcastStudioCapabilities };
  return { shows: body.data ?? [], capabilities: body.meta ?? {} };
}

export async function validatePodcastFeed(showId: number): Promise<PodcastFeedValidation> {
  return unwrap(await api.get<Envelope<PodcastFeedValidation>>(`${API_V2}/podcasts/${showId}/validate-feed`));
}

export async function getPodcastShowStats(showId: number, days = 30): Promise<PodcastShowStats> {
  return unwrap(await api.get<Envelope<PodcastShowStats>>(`${API_V2}/podcasts/${showId}/stats`, { days: String(days) }));
}

export async function createPodcastShow(payload: CreatePodcastShowPayload): Promise<PodcastShow> {
  return unwrap(await api.post<Envelope<PodcastShow>>(`${API_V2}/podcasts`, payload));
}

export async function updatePodcastShow(showId: number, payload: Partial<CreatePodcastShowPayload>): Promise<PodcastShow> {
  return unwrap(await api.put<Envelope<PodcastShow>>(`${API_V2}/podcasts/${showId}`, payload));
}

export async function publishPodcastShow(showId: number): Promise<PodcastShow> {
  return unwrap(await api.post<Envelope<PodcastShow>>(`${API_V2}/podcasts/${showId}/publish`, {}));
}

export async function archivePodcastShow(showId: number): Promise<PodcastShow> {
  return unwrap(await api.post<Envelope<PodcastShow>>(`${API_V2}/podcasts/${showId}/archive`, {}));
}

export async function deletePodcastShow(showId: number): Promise<{ deleted: boolean }> {
  return unwrap(await api.delete<Envelope<{ deleted: boolean }>>(`${API_V2}/podcasts/${showId}`));
}

export async function createPodcastEpisode(showId: number, payload: CreatePodcastEpisodePayload): Promise<PodcastEpisode> {
  return unwrap(await api.post<Envelope<PodcastEpisode>>(`${API_V2}/podcasts/${showId}/episodes`, payload));
}

export async function updatePodcastEpisode(showId: number, episodeId: number, payload: Partial<CreatePodcastEpisodePayload>): Promise<PodcastEpisode> {
  return unwrap(await api.put<Envelope<PodcastEpisode>>(`${API_V2}/podcasts/${showId}/episodes/${episodeId}`, payload));
}

export async function publishPodcastEpisode(showId: number, episodeId: number): Promise<PodcastEpisode> {
  return unwrap(await api.post<Envelope<PodcastEpisode>>(`${API_V2}/podcasts/${showId}/episodes/${episodeId}/publish`, {}));
}

export async function archivePodcastEpisode(showId: number, episodeId: number): Promise<PodcastEpisode> {
  return unwrap(await api.post<Envelope<PodcastEpisode>>(`${API_V2}/podcasts/${showId}/episodes/${episodeId}/archive`, {}));
}

export async function deletePodcastEpisode(showId: number, episodeId: number): Promise<{ deleted: boolean }> {
  return unwrap(await api.delete<Envelope<{ deleted: boolean }>>(`${API_V2}/podcasts/${showId}/episodes/${episodeId}`));
}

function podcastImageFilename(uri: string): string {
  const lastSegment = uri.split('/').pop()?.split('?')[0];
  return lastSegment && lastSegment.includes('.') ? lastSegment : 'podcast.jpg';
}

function podcastImageMime(filename: string, fallback?: string | null): string {
  if (fallback?.startsWith('image/')) return fallback;
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * The API reads the file from the `image` part on both artwork endpoints
 * (`PodcastController::storePodcastImage`), so the field name is not negotiable.
 */
async function appendPodcastImageFile(formData: FormData, uri: string): Promise<void> {
  const filename = podcastImageFilename(uri);

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const type = podcastImageMime(filename, blob.type);
    if (typeof File !== 'undefined') {
      formData.append('image', new File([blob], filename, { type }));
      return;
    }
    formData.append('image', blob, filename);
    return;
  }

  formData.append('image', { uri, name: filename, type: podcastImageMime(filename) } as unknown as Blob);
}

export async function uploadPodcastShowArtwork(showId: number, uri: string): Promise<{ url: string }> {
  const formData = new FormData();
  await appendPodcastImageFile(formData, uri);
  return unwrap(await api.upload<Envelope<{ url: string }>>(`${API_V2}/podcasts/${showId}/artwork`, formData));
}

export async function uploadPodcastEpisodeCover(showId: number, episodeId: number, uri: string): Promise<{ url: string }> {
  const formData = new FormData();
  await appendPodcastImageFile(formData, uri);
  return unwrap(await api.upload<Envelope<{ url: string }>>(`${API_V2}/podcasts/${showId}/episodes/${episodeId}/cover`, formData));
}

/**
 * Create an episode from an audio file on the device, rather than from a URL.
 *
 * 🔴 The multipart part must be named `audio`. `PodcastController::storeEpisode` reads
 * `request()->file('audio')`, and a differently-named part is not an error there — the
 * controller simply sees no file, falls through to the `audio_url` branch, and refuses
 * with "audio URL required" while the file it was sent sits unread.
 *
 * `audio_url` is deliberately NOT sent alongside the file. The API treats a present
 * URL as the authoritative source, so sending both would host the upload and then
 * point the episode at the URL anyway.
 *
 * This is the one call that does not go through `api.upload()`. See
 * `lib/api/uploadWithProgress.ts` for why: a member uploading up to the tenant's
 * ceiling (250 MB by default) needs a real percentage and a working cancel, and the
 * shared `fetch` client can give neither.
 */
export async function createPodcastEpisodeWithAudio(
  showId: number,
  payload: Omit<CreatePodcastEpisodePayload, 'audio_url'>,
  audio: { uri: string; name: string; mimeType: string },
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<PodcastEpisode> {
  const formData = new FormData();

  // Mirrors the web client's serialisation: skip empties, JSON-encode structures,
  // stringify everything else. PHP reads all of it out of $_POST.
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  });

  if (Platform.OS === 'web') {
    const blob = await (await fetch(audio.uri)).blob();
    formData.append('audio', blob, audio.name);
  } else {
    formData.append('audio', {
      uri: audio.uri,
      name: audio.name,
      // An empty type is legitimate — the platform did not tell us. Let the server
      // sniff the content rather than asserting something we do not know.
      type: audio.mimeType || 'application/octet-stream',
    } as unknown as Blob);
  }

  const response = await uploadWithProgress<Envelope<PodcastEpisode>>(
    `${API_V2}/podcasts/${showId}/episodes`,
    formData,
    options,
  );
  return unwrap(response);
}
