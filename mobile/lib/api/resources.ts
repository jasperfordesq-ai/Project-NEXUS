// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface ResourceItem {
  id: number;
  title: string;
  description?: string | null;
  file_url?: string | null;
  file_path?: string | null;
  file_type?: string | null;
  file_size?: number;
  downloads?: number;
  created_at?: string | null;
  category?: {
    id: number;
    name: string;
    color?: string | null;
  } | null;
  uploader?: {
    id: number;
    name: string;
    avatar?: string | null;
  } | null;
}

export interface ResourceCategory {
  id: number;
  name: string;
  slug?: string | null;
  color?: string | null;
  resource_count?: number;
}

export interface KbArticle {
  children?: { id: number; title: string; slug?: string | null }[];
  attachments?: { id: number; file_name: string; file_size?: number; mime_type?: string }[];
  id: number;
  title: string;
  slug?: string | null;
  content?: string | null;
  content_preview?: string | null;
  content_type?: string | null;
  video_url?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  parent_article_id?: number | null;
  is_published?: boolean;
  views_count?: number;
  view_count?: number;
  helpful_yes?: number;
  helpful_no?: number;
  my_feedback?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  author?: { id: number; name: string } | null;
}

export interface CursorPage<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}

interface CollectionEnvelope<T> {
  data?: T[] | { items?: T[]; cursor?: string | null; has_more?: boolean };
  items?: T[];
  cursor?: string | null;
  has_more?: boolean;
  meta?: {
    cursor?: string | null;
    next_cursor?: string | null;
    has_more?: boolean;
  } | null;
}

type ArrayEnvelope<T> = T[] | { data?: T[] | { items?: T[] }; items?: T[] };

export async function getResources(options: {
  resourceId?: number;
  search?: string;
  categoryId?: number | null;
  cursor?: string | null;
  perPage?: number;
} = {}): Promise<CursorPage<ResourceItem>> {
  const params: Record<string, string> = { per_page: String(options.perPage ?? 20) };
  if (options.search?.trim()) params.search = options.search.trim();
  if (options.categoryId) params.category_id = String(options.categoryId);
  if (options.cursor) params.cursor = options.cursor;
  if (options.resourceId !== undefined) params.resource_id = String(options.resourceId);

  const response = await api.get<CollectionEnvelope<ResourceItem>>(`${API_V2}/resources`, params);
  return normalizeCollection(response);
}

export async function getResourceCategories(): Promise<ResourceCategory[]> {
  const response = await api.get<ArrayEnvelope<ResourceCategory>>(`${API_V2}/resources/categories`);
  return normalizeArray(response);
}

export async function getKbArticles(cursor?: string | null): Promise<CursorPage<KbArticle>> {
  const response = await api.get<CollectionEnvelope<KbArticle>>(`${API_V2}/kb`, { per_page: '100', ...(cursor ? { cursor } : {}) });
  return normalizeCollection(response);
}

export async function searchKbArticles(query: string): Promise<KbArticle[]> {
  const response = await api.get<ArrayEnvelope<KbArticle>>(`${API_V2}/kb/search`, { q: query.trim(), limit: '20' });
  return normalizeArray(response);
}

export async function searchKbArticlePage(query: string, cursor: string | null = null): Promise<CursorPage<KbArticle>> {
  const response = await api.get<CollectionEnvelope<KbArticle>>(`${API_V2}/kb/search`, {
    q: query.trim(), per_page: '20', ...(cursor ? { cursor } : {}),
  });
  return normalizeCollection(response);
}

export async function getKbArticle(id: number): Promise<KbArticle> {
  const response = await api.get<{ data?: KbArticle } | KbArticle>(`${API_V2}/kb/${id}`);
  if (isObjectWithData(response) && response.data) {
    return response.data;
  }
  return response as KbArticle;
}

/** A feedback receipt has no counts; read the saved choice and totals before showing success. */
export async function submitKbFeedback(id: number, isHelpful: boolean): Promise<KbArticle> {
  await api.post(`${API_V2}/kb/${id}/feedback`, { is_helpful: isHelpful });
  return getKbArticle(id);
}

function normalizeCollection<T>(response: CollectionEnvelope<T>): CursorPage<T> {
  const payload = response.data;
  const dataObject = !Array.isArray(payload) && payload ? payload : response;
  return {
    items: Array.isArray(payload) ? payload : dataObject.items ?? [],
    cursor: dataObject.cursor ?? response.meta?.next_cursor ?? response.meta?.cursor ?? null,
    hasMore: dataObject.has_more ?? response.meta?.has_more ?? false,
  };
}

function normalizeArray<T>(response: ArrayEnvelope<T>): T[] {
  if (Array.isArray(response)) return response;
  const payload = response.data ?? response.items ?? [];
  return Array.isArray(payload) ? payload : payload.items ?? [];
}

function isObjectWithData<T>(response: { data?: T } | T): response is { data?: T } {
  return typeof response === 'object' && response !== null && 'data' in response;
}
