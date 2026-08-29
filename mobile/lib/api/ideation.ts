// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export type IdeationStatus = 'draft' | 'open' | 'voting' | 'evaluating' | 'closed' | 'archived';
export type IdeationIdeaStatus = 'draft' | 'submitted' | 'shortlisted' | 'winner' | 'withdrawn';
export type IdeationSort = 'votes' | 'newest';

export interface IdeationChallenge {
  id: number;
  title: string;
  description: string;
  category?: string | null;
  status: IdeationStatus;
  ideas_count?: number;
  submission_deadline?: string | null;
  voting_deadline?: string | null;
  prize_description?: string | null;
  max_ideas_per_user?: number | null;
  user_idea_count?: number;
  tags?: string[];
  cover_image?: string | null;
  is_favorited?: boolean;
  favorites_count?: number;
  views_count?: number;
  creator?: {
    id: number;
    name: string;
    avatar_url?: string | null;
  } | null;
}

export interface IdeationCategory {
  id: number;
  name: string;
  slug?: string | null;
  icon?: string | null;
  color?: string | null;
  challenges_count?: number;
}

export interface IdeationIdea {
  id: number;
  challenge_id: number;
  user_id?: number;
  title: string;
  description: string;
  votes_count?: number;
  comments_count?: number;
  status: IdeationIdeaStatus;
  has_voted?: boolean;
  created_at?: string;
  image_url?: string | null;
  creator?: {
    id: number;
    name: string;
    avatar_url?: string | null;
  } | null;
}

export interface IdeationComment {
  id: number;
  idea_id: number;
  user_id: number;
  body: string;
  created_at?: string;
  author?: {
    id: number;
    name: string;
    avatar_url?: string | null;
  } | null;
}

export interface IdeationCampaignChallenge extends IdeationChallenge {
  views_count?: number;
  favorites_count?: number;
  is_featured?: boolean;
}

export interface IdeationCampaign {
  id: number;
  title: string;
  description: string | null;
  cover_image?: string | null;
  challenges_count: number;
  status?: string;
  created_at?: string;
  challenges?: IdeationCampaignChallenge[];
}

export type IdeationOutcomeStatus = 'not_started' | 'in_progress' | 'implemented' | 'abandoned';

export interface IdeationOutcomeEntry {
  challenge_id: number;
  challenge_title: string;
  winning_idea_title: string | null;
  implementation_status: IdeationOutcomeStatus;
  impact_description: string | null;
  updated_at: string | null;
}

export interface IdeationOutcomeDashboard {
  total: number;
  implemented: number;
  in_progress: number;
  not_started: number;
  abandoned: number;
  outcomes: IdeationOutcomeEntry[];
}

export interface IdeationVoteResult {
  voted: boolean;
  votes_count: number;
}

export interface CreateIdeationChallengePayload {
  title: string;
  description: string;
  status?: IdeationStatus;
  category?: string | null;
  submission_deadline?: string | null;
  voting_deadline?: string | null;
  prize_description?: string | null;
  max_ideas_per_user?: number | null;
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

export async function getIdeationChallenges(options: {
  status?: IdeationStatus | 'all';
  search?: string;
  categoryId?: number | null;
  cursor?: string | null;
  perPage?: number;
} = {}): Promise<CursorPage<IdeationChallenge>> {
  const params: Record<string, string> = { per_page: String(options.perPage ?? 20) };
  if (options.status && options.status !== 'all') params.status = options.status;
  if (options.search?.trim()) params.search = options.search.trim();
  if (options.categoryId) params.category_id = String(options.categoryId);
  if (options.cursor) params.cursor = options.cursor;

  const response = await api.get<CollectionEnvelope<IdeationChallenge>>(`${API_V2}/ideation-challenges`, params);
  return normalizeCollection(response);
}

export async function getIdeationCategories(): Promise<IdeationCategory[]> {
  const response = await api.get<ArrayEnvelope<IdeationCategory>>(`${API_V2}/ideation-categories`);
  return normalizeArray(response);
}

export async function getIdeationChallenge(id: number): Promise<IdeationChallenge> {
  const response = await api.get<{ data?: IdeationChallenge } | IdeationChallenge>(`${API_V2}/ideation-challenges/${id}`);
  if (isObjectWithData(response) && response.data) {
    return response.data;
  }
  return response as IdeationChallenge;
}

export async function createIdeationChallenge(payload: CreateIdeationChallengePayload): Promise<IdeationChallenge> {
  const response = await api.post<{ data?: IdeationChallenge } | IdeationChallenge>(`${API_V2}/ideation-challenges`, payload);
  if (isObjectWithData(response) && response.data) {
    return response.data;
  }
  return response as IdeationChallenge;
}

export async function updateIdeationChallenge(id: number, payload: Omit<CreateIdeationChallengePayload, 'status'>): Promise<IdeationChallenge> {
  return unwrapData(await api.put<{ data?: IdeationChallenge } | IdeationChallenge>(`${API_V2}/ideation-challenges/${id}`, payload));
}

export async function getIdeationIdeas(challengeId: number, sort: IdeationSort = 'votes'): Promise<CursorPage<IdeationIdea>> {
  const response = await api.get<CollectionEnvelope<IdeationIdea>>(`${API_V2}/ideation-challenges/${challengeId}/ideas`, {
    per_page: '20',
    sort,
  });
  return normalizeCollection(response);
}

export async function submitIdeationIdea(challengeId: number, payload: { title: string; description: string }): Promise<{ id: number }> {
  const response = await api.post<{ data?: { id: number } } | { id: number }>(`${API_V2}/ideation-challenges/${challengeId}/ideas`, payload);
  if (isObjectWithData(response) && response.data) {
    return response.data;
  }
  return response as { id: number };
}

export async function voteIdeationIdea(ideaId: number): Promise<IdeationVoteResult> {
  const response = await api.post<{ data?: IdeationVoteResult } | IdeationVoteResult>(`${API_V2}/ideation-ideas/${ideaId}/vote`);
  if (isObjectWithData(response) && response.data) {
    return response.data;
  }
  return response as IdeationVoteResult;
}

export async function getIdeationIdea(ideaId: number): Promise<IdeationIdea> {
  return unwrapData(await api.get<{ data?: IdeationIdea } | IdeationIdea>(`${API_V2}/ideation-ideas/${ideaId}`));
}

export async function updateIdeationIdea(ideaId: number, payload: { title: string; description: string }): Promise<IdeationIdea> {
  return unwrapData(await api.put<{ data?: IdeationIdea } | IdeationIdea>(`${API_V2}/ideation-ideas/${ideaId}`, payload));
}

export async function getIdeationComments(ideaId: number, cursor?: string | null): Promise<CursorPage<IdeationComment>> {
  const params: Record<string, string> = { per_page: '20' };
  if (cursor) params.cursor = cursor;
  return normalizeCollection(await api.get<CollectionEnvelope<IdeationComment>>(`${API_V2}/ideation-ideas/${ideaId}/comments`, params));
}

export async function addIdeationComment(ideaId: number, body: string): Promise<IdeationComment> {
  return unwrapData(await api.post<{ data?: IdeationComment } | IdeationComment>(`${API_V2}/ideation-ideas/${ideaId}/comments`, { body }));
}

export async function getIdeationCampaigns(cursor?: string | null): Promise<CursorPage<IdeationCampaign>> {
  const params: Record<string, string> = { per_page: '20' };
  if (cursor) params.cursor = cursor;
  return normalizeCollection(await api.get<CollectionEnvelope<IdeationCampaign>>(`${API_V2}/ideation-campaigns`, params));
}

export async function getIdeationCampaign(id: number): Promise<IdeationCampaign> {
  return unwrapData(await api.get<{ data?: IdeationCampaign } | IdeationCampaign>(`${API_V2}/ideation-campaigns/${id}`));
}

export async function getIdeationOutcomes(): Promise<IdeationOutcomeDashboard> {
  return unwrapData(await api.get<{ data?: IdeationOutcomeDashboard } | IdeationOutcomeDashboard>(`${API_V2}/ideation-outcomes/dashboard`));
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

function unwrapData<T>(response: { data?: T } | T): T {
  if (isObjectWithData(response) && response.data !== undefined) return response.data;
  return response as T;
}
