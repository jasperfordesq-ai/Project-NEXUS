// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api';
import type { Event, FeedPost, Group, User } from '@/types/api';
import {
  normalizeGroupApiError,
  unwrapGroupResponse,
  type GroupApiResponse,
} from './core';

export interface GroupDetailRecord extends Group {
  members?: User[];
  recent_posts?: FeedPost[];
}

export interface GroupMemberRecord extends Omit<User, 'role'> {
  name: string;
  role?: 'member' | 'admin' | 'owner';
  joined_at?: string;
  capabilities?: {
    can_change_role: boolean;
    can_remove: boolean;
  };
}

export interface GroupJoinRequestRecord {
  user_id: number;
  user: {
    id: number;
    name: string;
    avatar?: string | null;
  };
  created_at: string;
  message?: string;
}

export type GroupMembershipStatus = 'active' | 'pending' | 'invited' | 'banned' | 'none';

export type GroupMembershipAction =
  | 'joined'
  | 'requested'
  | 'already_member'
  | 'already_requested'
  | 'left'
  | 'request_cancelled';

export interface GroupMembershipMutation {
  status: 'active' | 'pending' | 'none';
  action: GroupMembershipAction;
  membership?: {
    status: 'active' | 'pending';
    role: 'member' | 'admin' | 'owner';
  };
}

export interface GroupInviteRecord {
  id: number;
  type: 'link' | 'email';
  invite_type?: 'link' | 'email';
  email?: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invite_url?: string | null;
  expires_at: string;
  created_at?: string;
  inviter?: { id: number; name: string };
  capabilities?: { can_revoke: boolean };
}

export type GroupInviteSendStatus =
  | 'sent'
  | 'invalid'
  | 'already_member'
  | 'already_invited'
  | 'limit_reached';

export interface GroupInviteSendResult {
  email: string;
  status: GroupInviteSendStatus;
  email_delivered?: boolean | null;
  message?: string;
  invite?: Pick<GroupInviteRecord, 'id' | 'type' | 'status' | 'expires_at'>;
}

export interface GroupInvitePreview {
  invite: Pick<GroupInviteRecord, 'id' | 'type' | 'status' | 'expires_at'> & {
    email_bound: boolean;
  };
  group: {
    id: number;
    name: string;
    image_url?: string | null;
    visibility: 'public' | 'private';
    member_count: number;
  };
  membership: { status: GroupMembershipStatus };
}

export interface GroupInviteAcceptance {
  action: 'joined' | 'already_member';
  group: { id: number; name: string };
  membership: { status: 'active'; role: 'member' };
  invite: Pick<GroupInviteRecord, 'id' | 'type' | 'status'>;
}

export interface GroupDetailReadOptions {
  signal?: AbortSignal;
}

export interface GroupMemberListOptions extends GroupDetailReadOptions {
  cursor?: string;
  perPage?: number;
  search?: string;
}

export interface GroupEventListOptions extends GroupDetailReadOptions {
  cursor?: string;
  perPage?: number;
}

export interface GroupCursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  perPage: number;
}

export interface SendGroupInvitesInput {
  emails: string[];
  message: string;
}

export interface UpdateGroupSettingsInput {
  name: string;
  description: string;
  visibility: 'public' | 'private';
  location: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function normalizeRequest<T>(request: Promise<import('./core').GroupApiResponse<T>>): Promise<T> {
  try {
    return unwrapGroupResponse(await request);
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

function normalizePerPage(value: number | undefined): number {
  const perPage = value ?? 20;
  if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
    throw normalizeGroupApiError({ code: 'VALIDATION_ERROR', status: 422 });
  }
  return perPage;
}

function normalizeCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cursor = value.trim();
  if (!cursor) throw normalizeGroupApiError({ code: 'VALIDATION_ERROR', status: 422 });
  return cursor;
}

function normalizeMemberSearch(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const search = value.trim().replace(/\s+/g, ' ');
  if (search.length > 100) {
    throw normalizeGroupApiError({ code: 'VALIDATION_ERROR', status: 422 });
  }
  return search || undefined;
}

async function normalizeCursorCollection<T>(
  request: Promise<GroupApiResponse<T[]>>,
  expectedPerPage: number,
  requestedCursor: string | undefined,
  isItem: (value: unknown) => value is T,
): Promise<GroupCursorPage<T>> {
  try {
    const response = await request;
    const items = unwrapGroupResponse(response);
    const meta = isRecord(response.meta) ? response.meta : null;

    if (!Array.isArray(items) || !items.every(isItem) || !meta) {
      throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
    }

    const perPage = meta.per_page;
    const hasMore = meta.has_more;
    const cursorValue = meta.cursor;
    if (
      !Number.isSafeInteger(perPage)
      || perPage !== expectedPerPage
      || typeof hasMore !== 'boolean'
    ) {
      throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
    }

    const nextCursor = typeof cursorValue === 'string' && cursorValue.trim() !== ''
      ? cursorValue.trim()
      : null;
    const cursorIsAbsent = cursorValue === undefined || cursorValue === null;
    if (
      (hasMore && nextCursor === null)
      || (!hasMore && !cursorIsAbsent)
      || (requestedCursor !== undefined && nextCursor === requestedCursor)
    ) {
      throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
    }

    return { items, nextCursor, hasMore, perPage };
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

function isGroupMemberRecord(value: unknown): value is GroupMemberRecord {
  if (!isRecord(value)) return false;
  if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0) return false;
  if (typeof value.name !== 'string' || value.name.trim() === '') return false;
  if (value.role !== undefined && !['member', 'admin', 'owner'].includes(String(value.role))) return false;
  if (value.joined_at !== undefined && typeof value.joined_at !== 'string') return false;
  if (value.capabilities !== undefined) {
    if (!isRecord(value.capabilities)) return false;
    if (
      typeof value.capabilities.can_change_role !== 'boolean'
      || typeof value.capabilities.can_remove !== 'boolean'
    ) return false;
  }
  return true;
}

function isGroupEventRecord(value: unknown): value is Event {
  return isRecord(value)
    && Number.isSafeInteger(value.id)
    && Number(value.id) > 0
    && typeof value.title === 'string'
    && value.title.trim() !== ''
    && typeof value.start_date === 'string'
    && value.start_date.trim() !== '';
}

function requireArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  return value as T[];
}

export async function getGroupDetail(
  groupId: number,
  options: GroupDetailReadOptions = {},
): Promise<GroupDetailRecord> {
  const group = await normalizeRequest(api.get<GroupDetailRecord>(`/v2/groups/${groupId}`, {
    signal: options.signal,
  }));
  if (!isRecord(group) || typeof group.id !== 'number') {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return group as GroupDetailRecord;
}

export async function createGroupInviteLink(groupId: number): Promise<GroupInviteRecord> {
  const payload = await normalizeRequest(api.post<GroupInviteRecord>(
    `/v2/groups/${groupId}/invites/link`,
  ));
  if (!isGroupInviteRecord(payload) || payload.type !== 'link' || !payload.invite_url) {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return payload;
}

export async function sendGroupInvites(
  groupId: number,
  input: SendGroupInvitesInput,
): Promise<GroupInviteSendResult[]> {
  const payload = await normalizeRequest(api.post<GroupInviteSendResult[]>(
    `/v2/groups/${groupId}/invites/email`,
    input,
  ));
  if (!Array.isArray(payload) || !payload.every(isGroupInviteSendResult)) {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return payload;
}

export async function listGroupInvites(
  groupId: number,
  options: GroupDetailReadOptions = {},
): Promise<GroupInviteRecord[]> {
  const payload = await normalizeRequest(api.get<GroupInviteRecord[]>(
    `/v2/groups/${groupId}/invites`,
    { signal: options.signal },
  ));
  if (!Array.isArray(payload) || !payload.every(isGroupInviteRecord)) {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return payload;
}

export async function revokeGroupInvite(groupId: number, inviteId: number): Promise<void> {
  await normalizeRequest(api.delete(`/v2/groups/${groupId}/invites/${inviteId}`));
}

export async function getGroupInvitePreview(
  token: string,
  options: GroupDetailReadOptions = {},
): Promise<GroupInvitePreview> {
  const payload = await normalizeRequest(api.get<GroupInvitePreview>(
    `/v2/groups/invite/${encodeURIComponent(token)}`,
    { signal: options.signal },
  ));
  if (!isGroupInvitePreview(payload)) {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return payload;
}

export async function acceptGroupInvite(token: string): Promise<GroupInviteAcceptance> {
  const payload = await normalizeRequest(api.post<GroupInviteAcceptance>(
    `/v2/groups/invite/${encodeURIComponent(token)}/accept`,
  ));
  if (!isGroupInviteAcceptance(payload)) {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return payload;
}

export async function listGroupMembers(
  groupId: number,
  options: GroupMemberListOptions = {},
): Promise<GroupCursorPage<GroupMemberRecord>> {
  const perPage = normalizePerPage(options.perPage);
  const cursor = normalizeCursor(options.cursor);
  const search = normalizeMemberSearch(options.search);
  const query = new URLSearchParams({ per_page: String(perPage) });
  if (search !== undefined) query.set('q', search);
  if (cursor !== undefined) query.set('cursor', cursor);

  return normalizeCursorCollection(
    api.get<GroupMemberRecord[]>(`/v2/groups/${groupId}/members?${query.toString()}`, {
      signal: options.signal,
    }),
    perPage,
    cursor,
    isGroupMemberRecord,
  );
}

export async function listGroupEvents(
  groupId: number,
  options: GroupEventListOptions = {},
): Promise<GroupCursorPage<Event>> {
  const perPage = normalizePerPage(options.perPage);
  const cursor = normalizeCursor(options.cursor);
  const query = new URLSearchParams({
    group_id: String(groupId),
    when: 'all',
    per_page: String(perPage),
  });
  if (cursor !== undefined) query.set('cursor', cursor);

  return normalizeCursorCollection(
    api.get<Event[]>(`/v2/events?${query.toString()}`, { signal: options.signal }),
    perPage,
    cursor,
    isGroupEventRecord,
  );
}

export async function listGroupJoinRequests(
  groupId: number,
  options: GroupDetailReadOptions = {},
): Promise<GroupJoinRequestRecord[]> {
  return requireArray<GroupJoinRequestRecord>(await normalizeRequest(api.get<GroupJoinRequestRecord[]>(
    `/v2/groups/${groupId}/requests`,
    { signal: options.signal },
  )));
}

export async function joinGroup(groupId: number): Promise<GroupMembershipMutation> {
  const payload = await normalizeRequest(api.post<GroupMembershipMutation>(`/v2/groups/${groupId}/join`));
  if (!isMembershipMutation(payload, ['active', 'pending'], ['joined', 'requested', 'already_member', 'already_requested'])) {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return payload;
}

export async function leaveGroup(groupId: number): Promise<GroupMembershipMutation> {
  const payload = await normalizeRequest(api.delete<GroupMembershipMutation>(`/v2/groups/${groupId}/membership`));
  if (!isMembershipMutation(payload, ['none'], ['left', 'request_cancelled'])) {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return payload;
}

export async function uploadGroupImage(
  groupId: number,
  image: File,
  type: 'avatar' | 'cover',
): Promise<string> {
  const formData = new FormData();
  formData.append('image', image);
  formData.append('type', type);
  const payload = await normalizeRequest(api.upload<{ url?: string; image_url?: string }>(
    `/v2/groups/${groupId}/image`,
    formData,
  ));
  const record = isRecord(payload) ? payload : null;
  const url = record && (typeof record.url === 'string' ? record.url : record.image_url);
  if (typeof url !== 'string' || url === '') {
    throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
  }
  return url;
}

export async function updateGroupSettings(
  groupId: number,
  input: UpdateGroupSettingsInput,
): Promise<void> {
  await normalizeRequest(api.put<void>(`/v2/groups/${groupId}`, input));
}

export async function deleteGroup(groupId: number): Promise<void> {
  await normalizeRequest(api.delete<void>(`/v2/groups/${groupId}`));
}

export async function decideGroupJoinRequest(
  groupId: number,
  userId: number,
  action: 'accept' | 'reject',
): Promise<void> {
  await normalizeRequest(api.post<void>(`/v2/groups/${groupId}/requests/${userId}`, { action }));
}

export async function updateGroupMemberRole(
  groupId: number,
  userId: number,
  role: 'member' | 'admin',
): Promise<void> {
  await normalizeRequest(api.put<void>(`/v2/groups/${groupId}/members/${userId}`, { role }));
}

export async function removeGroupMember(groupId: number, userId: number): Promise<void> {
  await normalizeRequest(api.delete<void>(`/v2/groups/${groupId}/members/${userId}`));
}

function isGroupInviteRecord(value: unknown): value is GroupInviteRecord {
  if (!isRecord(value)) return false;
  return typeof value.id === 'number'
    && (value.type === 'link' || value.type === 'email')
    && ['pending', 'accepted', 'expired', 'revoked'].includes(String(value.status))
    && typeof value.expires_at === 'string';
}

function isGroupInviteSendResult(value: unknown): value is GroupInviteSendResult {
  if (!isRecord(value)) return false;
  return typeof value.email === 'string'
    && ['sent', 'invalid', 'already_member', 'already_invited', 'limit_reached'].includes(String(value.status));
}

function isGroupInvitePreview(value: unknown): value is GroupInvitePreview {
  if (!isRecord(value) || !isRecord(value.invite) || !isRecord(value.group) || !isRecord(value.membership)) {
    return false;
  }
  return typeof value.invite.id === 'number'
    && (value.invite.type === 'link' || value.invite.type === 'email')
    && typeof value.invite.expires_at === 'string'
    && typeof value.group.id === 'number'
    && typeof value.group.name === 'string'
    && typeof value.group.member_count === 'number'
    && ['none', 'active', 'pending', 'invited', 'banned'].includes(String(value.membership.status));
}

function isGroupInviteAcceptance(value: unknown): value is GroupInviteAcceptance {
  if (!isRecord(value) || !isRecord(value.group) || !isRecord(value.membership) || !isRecord(value.invite)) {
    return false;
  }
  return (value.action === 'joined' || value.action === 'already_member')
    && typeof value.group.id === 'number'
    && typeof value.group.name === 'string'
    && value.membership.status === 'active'
    && value.membership.role === 'member'
    && typeof value.invite.id === 'number';
}

function isMembershipMutation(
  value: unknown,
  statuses: string[],
  actions: string[],
): value is GroupMembershipMutation {
  return isRecord(value)
    && statuses.includes(String(value.status))
    && actions.includes(String(value.action));
}
