// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { Platform } from 'react-native';

export interface GroupMember {
  id: number;
  name: string;
  avatar_url: string | null;
}

export interface Group {
  id: number;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  cover_image: string | null;
  image_url?: string | null;
  is_featured: boolean;
  member_count: number;
  posts_count: number;
  is_member: boolean;
  owner_id?: number | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  federated_visibility?: 'none' | 'listed' | 'joinable' | string | null;
  created_at: string;
  recent_members: GroupMember[];
}

export interface GroupDetail extends Group {
  long_description?: string | null;
  /**
   * 🔴 NOT sent by `GET /v2/groups/{id}` — measured 2026-08-24. It was declared required,
   * and the detail screen guards with `group.admin ? …`, so the "Admin" section of every
   * group page simply never rendered: a member could not see who runs their own group. The
   * server does send `creator` (id, name, avatar) and `owner_id`, so the screen now falls
   * back to `creator` and the field stays optional here.
   */
  admin?: GroupMember | null;
  creator?: GroupMember | null;
  tags?: string[];
  viewer_membership?: {
    status?: string | null;
    role?: string | null;
    is_admin?: boolean;
  } | null;
}

export interface GroupMemberListItem extends GroupMember {
  role: 'owner' | 'admin' | 'member' | string;
  joined_at: string | null;
}

export interface GroupDiscussion {
  id: number;
  title: string;
  author: GroupMember;
  reply_count: number;
  is_pinned: boolean;
  created_at: string | null;
  last_reply_at: string | null;
}

export interface GroupAnnouncement {
  id: number;
  title: string;
  content: string;
  is_pinned: boolean;
  priority: number;
  is_expired: boolean;
  author: GroupMember;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
}

export interface GroupFileItem {
  id: number;
  group_id: number;
  file_name: string;
  file_path?: string | null;
  file_type: string;
  file_size: number;
  uploaded_by: number;
  uploader_name?: string | null;
  uploader_avatar?: string | null;
  folder?: string | null;
  description?: string | null;
  created_at: string | null;
}

export interface GroupQuestionAuthor {
  id: number;
  name: string;
  avatar?: string | null;
  avatar_url?: string | null;
}

export interface GroupQuestion {
  id: number;
  group_id?: number;
  title: string;
  body: string | null;
  vote_count: number;
  user_vote: 1 | -1 | 0;
  answer_count: number;
  has_accepted_answer: boolean;
  is_closed?: boolean;
  author: GroupQuestionAuthor;
  created_at: string | null;
}

export interface GroupAnswer {
  id: number;
  question_id: number;
  body: string;
  vote_count: number;
  user_vote: 1 | -1 | 0;
  is_accepted: boolean;
  author: GroupQuestionAuthor;
  created_at: string | null;
}

export interface GroupQuestionDetail extends GroupQuestion {
  answers: GroupAnswer[];
}

export interface GroupWikiAuthor {
  id: number | null;
  name: string | null;
}

export interface GroupWikiPage {
  id: number;
  title: string;
  slug: string;
  parent_id: number | null;
  sort_order: number;
  is_published: boolean;
  author?: GroupWikiAuthor | null;
  created_at?: string | null;
  updated_at: string | null;
}

export interface GroupWikiPageDetail extends GroupWikiPage {
  content: string;
}

export interface GroupWikiRevision {
  id: number;
  content: string;
  change_summary?: string | null;
  created_at?: string | null;
  editor?: {
    id: number | null;
    name: string | null;
  } | null;
}

export type GroupTaskStatus = 'todo' | 'in_progress' | 'done';
export type GroupTaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface GroupTask {
  id: number;
  group_id: number;
  title: string;
  description: string | null;
  status: GroupTaskStatus;
  priority: GroupTaskPriority;
  assigned_to: number | null;
  due_date: string | null;
  created_at: string | null;
  updated_at?: string | null;
  assignee?: {
    id: number;
    name: string;
    avatar_url?: string | null;
  } | null;
}

export interface GroupTaskStats {
  total: number;
  todo: number;
  in_progress: number;
  done: number;
  overdue: number;
}

export type GroupMediaType = 'image' | 'video';

export interface GroupMediaItem {
  id: number;
  file_path?: string | null;
  url: string | null;
  type: GroupMediaType;
  thumbnail_url?: string | null;
  caption?: string | null;
  file_size?: number | null;
  uploaded_by: number | null;
  uploader_name?: string | null;
  created_at: string | null;
}

export interface GroupAnalyticsOverview {
  total_members: number;
  total_discussions: number;
  total_posts: number;
  total_events: number;
  total_files: number;
  pending_requests: number;
  created_at?: string | null;
  visibility?: string | null;
}

export interface GroupAnalyticsGrowthPoint {
  date: string;
  new_members: number;
  total_members: number;
}

export interface GroupAnalyticsEngagementPoint {
  date: string;
  posts: number;
  discussions: number;
  active_members: number;
}

export interface GroupAnalyticsEngagement {
  timeline: GroupAnalyticsEngagementPoint[];
  summary: {
    total_members: number;
    active_members: number;
    participation_rate: number;
    avg_posts_per_day: number;
  };
}

export interface GroupAnalyticsContributor {
  user_id: number;
  name: string;
  avatar_url?: string | null;
  post_count: number;
}

export interface GroupAnalyticsContentItem {
  id: number;
  title: string;
  created_at?: string | null;
  author_name?: string | null;
  reply_count: number;
  unique_participants: number;
}

export interface GroupAnalyticsActivityBreakdown {
  discussions: number;
  posts: number;
  events: number;
  files: number;
  member_joins: number;
  total: number;
}

export interface GroupAnalyticsRetentionCohort {
  month: string;
  joined: number;
  still_active: number;
  retention_rate: number;
}

export interface GroupAnalyticsComparative {
  group_members: number;
  avg_members: number;
  percentile: number;
  total_groups: number;
  rank: number;
}

export interface GroupAnalyticsDashboard {
  overview: GroupAnalyticsOverview;
  member_growth: GroupAnalyticsGrowthPoint[];
  engagement: GroupAnalyticsEngagement;
  top_contributors: GroupAnalyticsContributor[];
  content_performance: GroupAnalyticsContentItem[];
  activity_breakdown: GroupAnalyticsActivityBreakdown;
}

export interface GroupTemplate {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  default_visibility?: 'public' | 'private' | string | null;
}

export interface GroupsResponse {
  data: Group[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

export interface GroupCollectionResponse<T> {
  data: T[];
  meta: {
    has_more: boolean;
    cursor: string | null;
    per_page?: number;
  };
}

export interface GroupAnnouncementsResponse {
  data: {
    items: GroupAnnouncement[];
    cursor: string | null;
    has_more: boolean;
  };
}

export interface GroupFilesResponse {
  data: {
    items: GroupFileItem[];
    cursor: string | null;
    has_more: boolean;
  };
}

export interface GroupQuestionsResponse {
  data: {
    items: GroupQuestion[];
    cursor: string | null;
    has_more: boolean;
  };
}

export interface GroupWikiPagesResponse {
  data: GroupWikiPage[];
}

export type GroupTasksResponse = GroupCollectionResponse<GroupTask>;

export interface GroupMediaResponse {
  data: {
    items: GroupMediaItem[];
    cursor: string | null;
    has_more: boolean;
  };
}

export interface CreateGroupAnnouncementPayload {
  title: string;
  content: string;
  is_pinned?: boolean;
}

export interface CreateGroupPayload {
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  federated_visibility?: 'none' | 'listed' | 'joinable';
}

/**
 * GET /api/v2/groups — list groups for the current tenant (cursor-based pagination).
 * Optionally filter by search query or visibility.
 */
export function getGroups(
  cursor: string | null,
  params?: { search?: string; visibility?: string },
): Promise<GroupsResponse> {
  const query: Record<string, string> = { per_page: '20' };
  if (cursor) query['cursor'] = cursor;
  if (params?.search) query['q'] = params.search;
  if (params?.visibility) query['visibility'] = params.visibility;
  return api.get<GroupsResponse>(`${API_V2}/groups`, query);
}

/**
 * GET /api/v2/groups/{id} — get a single group by ID.
 */
export function getGroup(id: number): Promise<{ data: GroupDetail }> {
  return api.get<{ data: GroupDetail }>(`${API_V2}/groups/${id}`);
}

/**
 * POST /api/v2/groups — create a community group.
 */
export function createGroup(payload: CreateGroupPayload): Promise<{ data: GroupDetail }> {
  return api.post<{ data: GroupDetail }>(`${API_V2}/groups`, payload);
}

export function updateGroup(id: number, payload: CreateGroupPayload): Promise<{ data: GroupDetail }> {
  return api.put<{ data: GroupDetail }>(`${API_V2}/groups/${id}`, payload);
}

export function getGroupTemplates(): Promise<{ data: GroupTemplate[] } | GroupTemplate[]> {
  return api.get<{ data: GroupTemplate[] } | GroupTemplate[]>(`${API_V2}/group-templates`);
}

type UploadGroupImageResponse = {
  data?: { image_url?: string | null } | null;
  image_url?: string | null;
  message?: string;
};

type UploadGroupMediaResponse = {
  data?: GroupMediaItem | null;
  message?: string;
};

export interface GroupMediaUploadAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

function getUploadFilename(uri: string, fallback = 'group.jpg'): string {
  const cleanUri = uri.split('?')[0] ?? uri;
  const lastSegment = cleanUri.split('/').pop();
  return lastSegment && lastSegment.includes('.') ? lastSegment : fallback;
}

function getMimeType(filename: string, fallback?: string | null): string {
  if (fallback?.startsWith('image/') || fallback?.startsWith('video/')) return fallback;
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'avi') return 'video/x-msvideo';
  return 'image/jpeg';
}

async function appendGroupImageFile(formData: FormData, uri: string): Promise<void> {
  const filename = getUploadFilename(uri);

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const type = getMimeType(filename, blob.type);
    if (typeof File !== 'undefined') {
      formData.append('image', new File([blob], filename, { type }));
      return;
    }
    formData.append('image', blob, filename);
    return;
  }

  const type = getMimeType(filename);
  formData.append('image', { uri, name: filename, type } as unknown as Blob);
}

async function appendGroupMediaFile(formData: FormData, asset: GroupMediaUploadAsset): Promise<void> {
  const fallbackName = asset.mimeType?.startsWith('video/') ? 'group-video.mp4' : 'group-media.jpg';
  const filename = asset.fileName || getUploadFilename(asset.uri, fallbackName);

  if (Platform.OS === 'web') {
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const type = getMimeType(filename, asset.mimeType ?? blob.type);
    if (typeof File !== 'undefined') {
      formData.append('file', new File([blob], filename, { type }));
      return;
    }
    formData.append('file', blob, filename);
    return;
  }

  const type = getMimeType(filename, asset.mimeType);
  formData.append('file', { uri: asset.uri, name: filename, type } as unknown as Blob);
}

/**
 * POST /api/v2/groups/{id}/image — upload or replace a group image.
 */
export async function uploadGroupImage(id: number, uri: string): Promise<{ data: { image_url: string } }> {
  const formData = new FormData();
  await appendGroupImageFile(formData, uri);

  const response = await api.upload<UploadGroupImageResponse>(`${API_V2}/groups/${id}/image`, formData);
  const imageUrl = response.data?.image_url ?? response.image_url ?? null;
  if (!imageUrl) {
    throw new Error(response.message ?? 'Group image upload did not return an image URL.');
  }

  return { data: { image_url: imageUrl } };
}

/**
 * GET /api/v2/groups/{id}/members — list active group members.
 */
export function getGroupMembers(
  id: number,
  cursor: string | null = null,
): Promise<GroupCollectionResponse<GroupMemberListItem>> {
  const query: Record<string, string> = { per_page: '20' };
  if (cursor) query['cursor'] = cursor;
  return api.get<GroupCollectionResponse<GroupMemberListItem>>(`${API_V2}/groups/${id}/members`, query);
}

/**
 * GET /api/v2/groups/{id}/discussions — list member-only discussions.
 */
export function getGroupDiscussions(
  id: number,
  cursor: string | null = null,
): Promise<GroupCollectionResponse<GroupDiscussion>> {
  const query: Record<string, string> = { per_page: '20' };
  if (cursor) query['cursor'] = cursor;
  return api.get<GroupCollectionResponse<GroupDiscussion>>(`${API_V2}/groups/${id}/discussions`, query);
}

/**
 * GET /api/v2/groups/{id}/announcements — list member-only announcements.
 */
export function getGroupAnnouncements(
  id: number,
  cursor: string | null = null,
): Promise<GroupAnnouncementsResponse> {
  const query: Record<string, string> = { limit: '20' };
  if (cursor) query['cursor'] = cursor;
  return api.get<GroupAnnouncementsResponse>(`${API_V2}/groups/${id}/announcements`, query);
}

/**
 * GET /api/v2/groups/{id}/files — list member-only group files.
 */
export function getGroupFiles(
  id: number,
  cursor: string | null = null,
): Promise<GroupFilesResponse> {
  const query: Record<string, string> = { per_page: '20' };
  if (cursor) query['cursor'] = cursor;
  return api.get<GroupFilesResponse>(`${API_V2}/groups/${id}/files`, query);
}

export function deleteGroupFile(id: number, fileId: number): Promise<{ data: { message: string } }> {
  return api.delete<{ data: { message: string } }>(`${API_V2}/groups/${id}/files/${fileId}`);
}

/**
 * GET /api/v2/groups/{id}/media — list group gallery media.
 */
export function getGroupMedia(
  id: number,
  params: { type?: GroupMediaType | 'all'; cursor?: string | null } = {},
): Promise<GroupMediaResponse> {
  const query: Record<string, string> = { per_page: '20' };
  if (params.type && params.type !== 'all') query['type'] = params.type;
  if (params.cursor) query['cursor'] = params.cursor;
  return api.get<GroupMediaResponse>(`${API_V2}/groups/${id}/media`, query);
}

export function deleteGroupMedia(id: number, mediaId: number): Promise<{ data: { message: string } }> {
  return api.delete<{ data: { message: string } }>(`${API_V2}/groups/${id}/media/${mediaId}`);
}

export async function uploadGroupMedia(id: number, asset: GroupMediaUploadAsset): Promise<{ data: GroupMediaItem }> {
  const formData = new FormData();
  await appendGroupMediaFile(formData, asset);
  const response = await api.upload<UploadGroupMediaResponse>(`${API_V2}/groups/${id}/media`, formData);
  if (!response.data) {
    throw new Error(response.message ?? 'Group media upload did not return a media item.');
  }
  return { data: response.data };
}

/**
 * GET /api/v2/groups/{id}/analytics — group admin dashboard metrics.
 */
export function getGroupAnalytics(id: number, days = 30): Promise<{ data: GroupAnalyticsDashboard }> {
  return api.get<{ data: GroupAnalyticsDashboard }>(`${API_V2}/groups/${id}/analytics`, {
    days: String(days),
  });
}

export function getGroupAnalyticsRetention(id: number, months = 6): Promise<{ data: GroupAnalyticsRetentionCohort[] }> {
  return api.get<{ data: GroupAnalyticsRetentionCohort[] }>(`${API_V2}/groups/${id}/analytics/retention`, {
    months: String(months),
  });
}

export function getGroupAnalyticsComparative(id: number): Promise<{ data: GroupAnalyticsComparative }> {
  return api.get<{ data: GroupAnalyticsComparative }>(`${API_V2}/groups/${id}/analytics/comparative`);
}

/**
 * GET /api/v2/groups/{id}/questions — list member-only group Q&A questions.
 */
export function getGroupQuestions(
  id: number,
  cursor: string | null = null,
  sort: 'newest' | 'votes' | 'unanswered' = 'newest',
): Promise<GroupQuestionsResponse> {
  const query: Record<string, string> = { per_page: '20', sort };
  if (cursor) query['cursor'] = cursor;
  return api.get<GroupQuestionsResponse>(`${API_V2}/groups/${id}/questions`, query);
}

export function getGroupQuestion(id: number, questionId: number): Promise<{ data: GroupQuestionDetail }> {
  return api.get<{ data: GroupQuestionDetail }>(`${API_V2}/groups/${id}/questions/${questionId}`);
}

export function createGroupQuestion(
  id: number,
  payload: { title: string; body: string },
): Promise<{ data: { id: number; title: string } }> {
  return api.post<{ data: { id: number; title: string } }>(`${API_V2}/groups/${id}/questions`, payload);
}

export function answerGroupQuestion(
  id: number,
  questionId: number,
  payload: { body: string },
): Promise<{ data: { id: number; question_id: number } }> {
  return api.post<{ data: { id: number; question_id: number } }>(
    `${API_V2}/groups/${id}/questions/${questionId}/answers`,
    payload,
  );
}

export function voteGroupQA(
  id: number,
  payload: { type: 'question' | 'answer'; target_id: number; vote: 'up' | 'down' },
): Promise<{ data: { message: string } }> {
  return api.post<{ data: { message: string } }>(`${API_V2}/groups/${id}/qa/vote`, payload);
}

export function acceptGroupAnswer(id: number, answerId: number): Promise<{ data: { message: string } }> {
  return api.post<{ data: { message: string } }>(`${API_V2}/groups/${id}/answers/${answerId}/accept`, {});
}

/**
 * GET /api/v2/groups/{id}/wiki — list member-viewable group wiki pages.
 */
export function getGroupWikiPages(id: number): Promise<GroupWikiPagesResponse> {
  return api.get<GroupWikiPagesResponse>(`${API_V2}/groups/${id}/wiki`);
}

export function getGroupWikiPage(id: number, slug: string): Promise<{ data: GroupWikiPageDetail }> {
  return api.get<{ data: GroupWikiPageDetail }>(`${API_V2}/groups/${id}/wiki/${encodeURIComponent(slug)}`);
}

export function createGroupWikiPage(
  id: number,
  payload: { title: string; content: string; parent_id?: number | null },
): Promise<{ data: GroupWikiPageDetail }> {
  return api.post<{ data: GroupWikiPageDetail }>(`${API_V2}/groups/${id}/wiki`, payload);
}

export function updateGroupWikiPage(
  id: number,
  pageId: number,
  payload: { title?: string; content: string; change_summary?: string },
): Promise<{ data: GroupWikiPageDetail }> {
  return api.put<{ data: GroupWikiPageDetail }>(`${API_V2}/groups/${id}/wiki/${pageId}`, payload);
}

export function deleteGroupWikiPage(id: number, pageId: number): Promise<{ data: { message: string } }> {
  return api.delete<{ data: { message: string } }>(`${API_V2}/groups/${id}/wiki/${pageId}`);
}

export function getGroupWikiRevisions(id: number, pageId: number): Promise<{ data: GroupWikiRevision[] }> {
  return api.get<{ data: GroupWikiRevision[] }>(`${API_V2}/groups/${id}/wiki/${pageId}/revisions`);
}

/**
 * GET /api/v2/groups/{id}/tasks — list member-viewable group team tasks.
 */
export function getGroupTasks(
  id: number,
  params: { status?: GroupTaskStatus | 'all'; cursor?: string | null } = {},
): Promise<GroupTasksResponse> {
  const query: Record<string, string> = { per_page: '50' };
  if (params.status && params.status !== 'all') query['status'] = params.status;
  if (params.cursor) query['cursor'] = params.cursor;
  return api.get<GroupTasksResponse>(`${API_V2}/groups/${id}/tasks`, query);
}

export function getGroupTaskStats(id: number): Promise<{ data: GroupTaskStats }> {
  return api.get<{ data: GroupTaskStats }>(`${API_V2}/groups/${id}/task-stats`);
}

export function createGroupTask(
  id: number,
  payload: {
    title: string;
    description?: string | null;
    status?: GroupTaskStatus;
    priority?: GroupTaskPriority;
    assigned_to?: number | null;
    due_date?: string | null;
  },
): Promise<{ data: GroupTask }> {
  return api.post<{ data: GroupTask }>(`${API_V2}/groups/${id}/tasks`, payload);
}

export function updateGroupTask(
  taskId: number,
  payload: Partial<Pick<GroupTask, 'title' | 'description' | 'assigned_to' | 'status' | 'priority' | 'due_date'>>,
): Promise<{ data: GroupTask }> {
  return api.put<{ data: GroupTask }>(`${API_V2}/team-tasks/${taskId}`, payload);
}

export function deleteGroupTask(taskId: number): Promise<void> {
  return api.delete<void>(`${API_V2}/team-tasks/${taskId}`);
}

/**
 * POST /api/v2/groups/{id}/discussions — start a new member discussion.
 */
export function createGroupDiscussion(
  id: number,
  payload: { title: string; content: string },
): Promise<{ data: GroupDiscussion }> {
  return api.post<{ data: GroupDiscussion }>(`${API_V2}/groups/${id}/discussions`, payload);
}

/**
 * POST /api/v2/groups/{id}/announcements — create an admin announcement.
 */
export function createGroupAnnouncement(
  id: number,
  payload: CreateGroupAnnouncementPayload,
): Promise<{ data: GroupAnnouncement }> {
  return api.post<{ data: GroupAnnouncement }>(`${API_V2}/groups/${id}/announcements`, payload);
}

/**
 * PUT /api/v2/groups/{id}/announcements/{announcementId} — update announcement fields.
 */
export function updateGroupAnnouncement(
  id: number,
  announcementId: number,
  payload: Partial<CreateGroupAnnouncementPayload>,
): Promise<{ data: GroupAnnouncement }> {
  return api.put<{ data: GroupAnnouncement }>(`${API_V2}/groups/${id}/announcements/${announcementId}`, payload);
}

/**
 * DELETE /api/v2/groups/{id}/announcements/{announcementId} — delete an admin announcement.
 */
export function deleteGroupAnnouncement(id: number, announcementId: number): Promise<{ data: { deleted: boolean } }> {
  return api.delete<{ data: { deleted: boolean } }>(`${API_V2}/groups/${id}/announcements/${announcementId}`);
}

/**
 * POST /api/v2/groups/{id}/join — join a group.
 */
export function joinGroup(id: number): Promise<{ message: string }> {
  return api.post<{ message: string }>(`${API_V2}/groups/${id}/join`, {});
}

/**
 * DELETE /api/v2/groups/{id}/membership — leave a group.
 */
export function leaveGroup(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/groups/${id}/membership`);
}

export interface GroupInvitePreview {
  group: { id: number; name: string; image_url?: string | null; visibility: 'public' | 'private'; member_count: number };
  membership: { status: string };
  invite: { id: number; type: string; status: string; expires_at?: string | null; email_bound?: boolean };
}

export interface GroupInviteAcceptance {
  action: 'joined' | 'already_member';
  group: { id: number; name: string };
  membership: { status: 'active'; role: 'member' };
}

export async function getGroupInvitePreview(token: string): Promise<GroupInvitePreview> {
  const response = await api.get<{ data: GroupInvitePreview } | GroupInvitePreview>(`${API_V2}/groups/invite/${encodeURIComponent(token)}`);
  return response && typeof response === 'object' && 'data' in response ? response.data : response;
}

export async function acceptGroupInvite(token: string): Promise<GroupInviteAcceptance> {
  const response = await api.post<{ data: GroupInviteAcceptance } | GroupInviteAcceptance>(`${API_V2}/groups/invite/${encodeURIComponent(token)}/accept`, {});
  return response && typeof response === 'object' && 'data' in response ? response.data : response;
}
