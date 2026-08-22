// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { Platform } from 'react-native';

/** Helper to compute a display name from API user objects that may have
 *  `name`, `first_name`/`last_name`, or `organization_name`. */
export function displayName(user: {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  organization_name?: string | null;
} | null | undefined, fallback = 'Unknown'): string {
  if (!user) return fallback;
  if (user.name) return user.name;
  if (user.organization_name) return user.organization_name;
  const first = user.first_name ?? '';
  const last = user.last_name ?? '';
  const full = `${first} ${last}`.trim();
  return full || fallback;
}

export interface ConversationOtherUser {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  organization_name?: string | null;
  avatar_url: string | null;
  is_online?: boolean;
}

export interface Conversation {
  id: number;
  other_user: ConversationOtherUser;
  /** The API returns `last_message` with `content` (not `body`) and `sender_id` (not `is_own`). */
  last_message: {
    id?: number;
    body?: string;
    content?: string;
    sender_id?: number;
    created_at: string;
    is_own?: boolean;
    is_read?: boolean;
  } | null;
  unread_count: number;
  /** The authenticated user's ID, populated from conversation metadata. */
  sender_id?: number;
}

export interface MessageSender {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  organization_name?: string | null;
  avatar_url?: string | null;
}

export interface Message {
  id: number;
  body: string;
  content?: string;
  sender: MessageSender;
  sender_id?: number;
  receiver_id?: number;
  receiver?: MessageSender | null;
  created_at: string;
  is_own: boolean;
  is_voice: boolean;
  audio_url: string | null;
  reactions: Record<string, number>;
  is_read: boolean;
  is_edited?: boolean;
  is_deleted?: boolean;
  listing_id?: number | null;
  context_type?: string | null;
  context_id?: number | null;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: number | string;
  name: string;
  url: string;
  type: 'image' | 'file' | 'audio' | 'video' | string;
  size?: number | null;
  mime_type?: string | null;
}

export interface ConversationListResponse {
  data: Conversation[];
  meta: {
    per_page: number;
    has_more: boolean;
    cursor: string | null;
    base_url?: string;
  };
}

export interface MessageListResponse {
  data: Message[];
  meta: {
    per_page: number;
    has_more: boolean;
    cursor: string | null;
    base_url?: string;
  };
}

export interface SendMessageOptions {
  listing_id?: number;
  context_type?: string;
  context_id?: number;
}

export interface MessageAttachmentUpload {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
}

export interface MessagingRestrictionStatus {
  messaging_disabled: boolean;
  under_monitoring: boolean;
  restriction_reason: string | null;
}

export interface ConversationListOptions {
  archived?: boolean;
}

/** GET /api/v2/messages — list conversations for current user */
export function getConversations(cursor?: string | null, options: ConversationListOptions = {}): Promise<ConversationListResponse> {
  const params: Record<string, string> = {};
  if (cursor) params.cursor = cursor;
  if (options.archived) params.archived = 'true';
  return api.get<ConversationListResponse>(`${API_V2}/messages`, params);
}

/** GET /api/v2/messages/:otherUserId — message thread for a conversation */
export function getThread(otherUserId: number, cursor?: string | null): Promise<MessageListResponse> {
  const params: Record<string, string> = {};
  if (cursor) params.cursor = cursor;
  return api.get<MessageListResponse>(`${API_V2}/messages/${otherUserId}`, params);
}

/**
 * GET /api/v2/messages/:otherUserId — but returns an empty list on 404
 * (conversation doesn't exist yet). Used when navigating from a member profile
 * or exchange detail to start a new conversation.
 */
export async function getOrCreateThread(otherUserId: number): Promise<MessageListResponse> {
  try {
    return await getThread(otherUserId);
  } catch (err: unknown) {
    // If 404 (no conversation yet), return empty data so the UI shows an empty thread
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      return {
        data: [],
        meta: { per_page: 50, has_more: false, cursor: null },
      };
    }
    throw err;
  }
}

/** DELETE /api/v2/messages/conversations/:conversationId — archive a conversation for the current user */
export function archiveConversation(conversationId: number): Promise<void> {
  return api.delete(`${API_V2}/messages/conversations/${conversationId}`);
}

export function restoreConversation(conversationId: number): Promise<{ data?: { success?: boolean; restored_count?: number } }> {
  return api.post(`${API_V2}/messages/conversations/${conversationId}/restore`, {});
}

export function markConversationRead(otherUserId: number): Promise<{ data?: { marked_read?: number } }> {
  return api.put(`${API_V2}/messages/${otherUserId}/read`, {});
}

export function getMessagingRestrictionStatus(): Promise<{ data: MessagingRestrictionStatus }> {
  return api.get<{ data: MessagingRestrictionStatus }>(`${API_V2}/messages/restriction-status`);
}

export function toggleMessageReaction(messageId: number, emoji: string): Promise<{ data?: { action?: 'added' | 'removed'; emoji?: string; message_id?: number } }> {
  return api.post(`${API_V2}/messages/${messageId}/reactions`, { emoji });
}

export function updateMessage(messageId: number, body: string): Promise<{ data: Message }> {
  return api.put<{ data: Message }>(`${API_V2}/messages/${messageId}`, { body });
}

export function deleteMessage(messageId: number, scope: 'self' | 'everyone' = 'self'): Promise<{ data?: { success?: boolean } }> {
  return api.delete(`${API_V2}/messages/${messageId}?scope=${scope}`);
}

/** POST /api/v2/messages — send a message to a recipient */
export function sendMessage(recipientId: number, body: string, options: SendMessageOptions = {}): Promise<{ data: Message }> {
  return api.post<{ data: Message }>(`${API_V2}/messages`, {
    recipient_id: recipientId,
    body,
    ...options,
  });
}

export async function sendMessageWithAttachments(
  recipientId: number,
  body: string,
  attachments: MessageAttachmentUpload[],
  options: SendMessageOptions = {},
): Promise<{ data: Message }> {
  const formData = new FormData();
  formData.append('recipient_id', String(recipientId));
  formData.append('body', body);
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  });

  for (const attachment of attachments) {
    await appendMessageAttachmentFile(formData, attachment);
  }

  return api.upload<{ data: Message }>(`${API_V2}/messages`, formData);
}

/**
 * 🔴 `durationSeconds` is not optional in practice — send it.
 *
 * The server stores `max(1, duration)` (`app/Core/AudioUploader.php`) and takes `duration`
 * straight from the request. Nothing sent it, so EVERY voice message on the platform was
 * stored as one second long. Measured on a device on 2026-08-22: a recording the sender's own
 * screen had just labelled 0:38 arrived as `audio_duration = 1`.
 *
 * The website has the same gap (`ConversationPage.tsx` appends only `recipient_id` and the
 * blob), which is recorded rather than changed from here.
 */
export async function sendVoiceMessage(
  recipientId: number,
  uri: string,
  options: SendMessageOptions = {},
  durationSeconds?: number,
): Promise<{ data: Message }> {
  const formData = new FormData();
  formData.append('recipient_id', String(recipientId));
  if (typeof durationSeconds === 'number' && durationSeconds > 0) {
    formData.append('duration', String(Math.round(durationSeconds)));
  }
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  });
  await appendMessageVoiceFile(formData, uri);

  return api.upload<{ data: Message }>(`${API_V2}/messages/voice`, formData);
}

function getUploadFilename(uri: string, providedName?: string | null): string {
  if (providedName?.trim()) return providedName.trim();
  const cleanUri = uri.split('?')[0] ?? uri;
  const lastSegment = cleanUri.split('/').pop();
  return lastSegment && lastSegment.includes('.') ? lastSegment : 'message-attachment.jpg';
}

function getMimeType(filename: string, fallback?: string | null): string {
  if (fallback?.includes('/')) return fallback;
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'image/jpeg';
}

async function appendMessageAttachmentFile(formData: FormData, attachment: MessageAttachmentUpload): Promise<void> {
  const filename = getUploadFilename(attachment.uri, attachment.name);

  if (Platform.OS === 'web') {
    const response = await fetch(attachment.uri);
    const blob = await response.blob();
    const type = getMimeType(filename, attachment.mimeType ?? blob.type);
    if (typeof File !== 'undefined') {
      formData.append('attachments[]', new File([blob], filename, { type }));
      return;
    }
    formData.append('attachments[]', blob, filename);
    return;
  }

  const type = getMimeType(filename, attachment.mimeType);
  formData.append('attachments[]', { uri: attachment.uri, name: filename, type } as unknown as Blob);
}

async function appendMessageVoiceFile(formData: FormData, uri: string): Promise<void> {
  const filename = getUploadFilename(uri, 'voice-message.m4a');

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    if (typeof File !== 'undefined') {
      formData.append('voice_message', new File([blob], filename, { type: blob.type || 'audio/mp4' }));
      return;
    }
    formData.append('voice_message', blob, filename);
    return;
  }

  formData.append('voice_message', { uri, name: filename, type: 'audio/mp4' } as unknown as Blob);
}
