// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Podcasts module — typed API client.
 */

import { api, type ApiResponse } from '@/lib/api';

export type PodcastVisibility = 'public' | 'members' | 'private';
export type PodcastEpisodeVisibility = 'inherit' | 'public' | 'members' | 'private';
export type PodcastStatus = 'draft' | 'published' | 'archived';
export type PodcastModerationStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type PodcastEpisodeType = 'full' | 'trailer' | 'bonus';

export interface PodcastOwner {
  id: number;
  name: string;
  avatar_url?: string | null;
}

export interface PodcastShow {
  id: number;
  owner_user_id: number;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  artwork_url?: string | null;
  language: string;
  category?: string | null;
  author_name?: string | null;
  owner_email?: string | null;
  copyright?: string | null;
  funding_url?: string | null;
  explicit?: boolean;
  visibility: PodcastVisibility;
  status: PodcastStatus;
  moderation_status: PodcastModerationStatus;
  episode_count: number;
  approved_episode_count?: number;
  subscriber_count: number;
  is_subscribed?: boolean;
  rss_enabled?: boolean;
  published_at?: string | null;
  updated_at?: string | null;
  owner?: PodcastOwner | null;
  episodes?: PodcastEpisode[];
  moderation_notes?: string | null;
  moderation_feedback?: string | null;
}

export interface PodcastChapter {
  id?: number;
  episode_id?: number;
  title: string;
  starts_at_seconds: number;
  url?: string | null;
  position?: number;
}

export interface PodcastEpisode {
  id: number;
  show_id: number;
  author_user_id: number;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  audio_url: string;
  audio_mime?: string | null;
  audio_bytes?: number | null;
  media_processing_status?: string | null;
  media_scan_status?: string | null;
  media_waveform_json?: number[] | null;
  media_duration_source?: string | null;
  duration_seconds?: number | null;
  episode_number?: number | null;
  season_number?: number | null;
  explicit: boolean;
  episode_type: PodcastEpisodeType;
  visibility: PodcastEpisodeVisibility;
  status: PodcastStatus;
  moderation_status: PodcastModerationStatus;
  transcript?: string | null;
  transcript_language?: string | null;
  cover_image_url?: string | null;
  listen_count: number;
  reaction_count?: number;
  viewer_has_reacted?: boolean;
  scheduled_for?: string | null;
  published_at?: string | null;
  show?: PodcastShow | null;
  author?: PodcastOwner | null;
  chapters?: PodcastChapter[];
  moderation_notes?: string | null;
  moderation_feedback?: string | null;
  hosted_audio?: boolean;
  reactions_enabled?: boolean;
  transcripts_enabled?: boolean;
  chapters_enabled?: boolean;
  /** Admin-only moderation history; absent from member-facing projections. */
  report_history?: Array<{
    id: number;
    episode_id: number;
    reporter_user_id?: number | null;
    reporter_name?: string | null;
    reason: string;
    details?: string | null;
    status: string;
    reviewed_by?: number | null;
    reviewed_at?: string | null;
    created_at?: string | null;
  }>;
}

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
  /** Whether public shows get a podcast-app (RSS) feed in this community. */
  enable_rss_feed?: boolean;
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
  top_episodes?: (Pick<PodcastEpisode, 'id' | 'show_id' | 'title' | 'slug' | 'listen_count'> & { show?: { id: number; title: string; slug: string } | null })[];
  retention?: { bucket: string; listens: number }[];
  client_breakdown?: { client: string; listens: number }[];
}

export interface PodcastPage<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

interface PodcastPaginationMeta {
  total?: number;
  current_page?: number;
  per_page?: number;
  has_more?: boolean;
  categories?: string[];
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
  audio_mime?: string;
  audio_bytes?: number;
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
  audio_file?: File | null;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }

  const output = search.toString();
  return output ? `?${output}` : '';
}

export const podcastsApi = {
  browse: async (
    params: { q?: string; category?: string; sort?: string; page?: number; per_page?: number } = {},
    options?: { signal?: AbortSignal },
  ): Promise<ApiResponse<PodcastPage<PodcastShow>>> => {
    const endpoint = `/v2/podcasts${query(params)}`;
    const res = await (options
      ? api.get<PodcastShow[] | PodcastPage<PodcastShow>>(endpoint, options)
      : api.get<PodcastShow[] | PodcastPage<PodcastShow>>(endpoint));
    if (!res.success || !res.data) {
      return { ...res, data: undefined };
    }

    if (Array.isArray(res.data)) {
      const meta = (res.meta ?? {}) as PodcastPaginationMeta;
      return {
        ...res,
        data: {
          items: res.data,
          total: meta.total ?? res.data.length,
          page: meta.current_page ?? params.page ?? 1,
          per_page: meta.per_page ?? params.per_page ?? 12,
          has_more: Boolean(meta.has_more),
        },
      };
    }

    return res as ApiResponse<PodcastPage<PodcastShow>>;
  },

  show: (slug: string) =>
    api.get<PodcastShow>(`/v2/podcasts/${encodeURIComponent(slug)}`),

  episode: (showSlug: string, episodeSlug: string) =>
    api.get<PodcastEpisode>(`/v2/podcasts/${encodeURIComponent(showSlug)}/${encodeURIComponent(episodeSlug)}`),

  authored: () =>
    api.get<PodcastShow[]>('/v2/podcasts/mine'),

  createShow: (data: CreatePodcastShowPayload) =>
    api.post<PodcastShow>('/v2/podcasts', data),

  updateShow: (id: number, data: Partial<CreatePodcastShowPayload>) =>
    api.put<PodcastShow>(`/v2/podcasts/${id}`, data),

  uploadShowArtwork: (showId: number, image: File) =>
    api.upload<{ url: string }>(`/v2/podcasts/${showId}/artwork`, image, 'image'),

  publishShow: (id: number) =>
    api.post<PodcastShow>(`/v2/podcasts/${id}/publish`, {}),

  archiveShow: (id: number) =>
    api.post<PodcastShow>(`/v2/podcasts/${id}/archive`, {}),

  deleteShow: (id: number) =>
    api.delete<{ deleted: boolean }>(`/v2/podcasts/${id}`),

  toggleSubscription: (showId: number, notifyNewEpisodes = true) =>
    api.post<{ subscribed: boolean }>(`/v2/podcasts/${showId}/subscribe`, { notify_new_episodes: notifyNewEpisodes }),

  createEpisode: (showId: number, data: CreatePodcastEpisodePayload, onProgress?: (percent: number) => void, signal?: AbortSignal) => {
    if (data.audio_file) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(data)) {
        if (key === 'audio_file' || value === undefined || value === null || value === '') continue;
        if (key === 'chapters') {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, String(value));
        }
      }
      formData.append('audio', data.audio_file);
      const options = onProgress || signal
        ? { ...(onProgress ? { onUploadProgress: onProgress } : {}), ...(signal ? { signal } : {}) }
        : undefined;
      return api.upload<PodcastEpisode>(
        `/v2/podcasts/${showId}/episodes`,
        formData,
        'file',
        options,
      );
    }

    return api.post<PodcastEpisode>('/v2/podcasts/' + showId + '/episodes', data);
  },

  updateEpisode: (showId: number, episodeId: number, data: Partial<CreatePodcastEpisodePayload>) =>
    api.put<PodcastEpisode>(`/v2/podcasts/${showId}/episodes/${episodeId}`, data),

  uploadEpisodeCover: (showId: number, episodeId: number, image: File) =>
    api.upload<{ url: string }>(`/v2/podcasts/${showId}/episodes/${episodeId}/cover`, image, 'image'),

  publishEpisode: (showId: number, episodeId: number) =>
    api.post<PodcastEpisode>(`/v2/podcasts/${showId}/episodes/${episodeId}/publish`, {}),

  archiveEpisode: (showId: number, episodeId: number) =>
    api.post<PodcastEpisode>(`/v2/podcasts/${showId}/episodes/${episodeId}/archive`, {}),

  deleteEpisode: (showId: number, episodeId: number) =>
    api.delete<{ deleted: boolean }>(`/v2/podcasts/${showId}/episodes/${episodeId}`),

  recordListen: (episodeId: number, data: { listened_seconds?: number; completed?: boolean; session_id?: string }) =>
    api.post<{ recorded: boolean }>(`/v2/podcasts/episodes/${episodeId}/listen`, data),

  toggleReaction: (episodeId: number, reaction = 'like') =>
    api.post<{ active: boolean }>(`/v2/podcasts/episodes/${episodeId}/reaction`, { reaction }),

  reportEpisode: (episodeId: number, data: { reason: string; details?: string }) =>
    api.post(`/v2/podcasts/episodes/${episodeId}/report`, data),

  resolveReport: (reportId: number, status: 'resolved' | 'dismissed' | 'escalated' = 'resolved') =>
    api.post<{ report_id: number; episode_id: number; open_reports: number }>(`/v2/admin/podcasts/reports/${reportId}/resolve`, { status }),

  validateFeed: (showId: number) =>
    api.get<PodcastFeedValidation>(`/v2/admin/podcasts/shows/${showId}/validate-feed`),

  /** Creator-facing feed preflight (owner or admin) — same shape as the admin variant. */
  validateShowFeed: (showId: number) =>
    api.get<PodcastFeedValidation>(`/v2/podcasts/${showId}/validate-feed`),

  /** Creator-facing listen analytics for one show (owner or admin). */
  showStats: (showId: number, days = 30) =>
    api.get<PodcastShowStats>(`/v2/podcasts/${showId}/stats?days=${days}`),
};
