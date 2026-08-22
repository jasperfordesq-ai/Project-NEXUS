// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(), upload: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
  registerUnauthorizedCallback: jest.fn(),
}));
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', REFRESH_TOKEN: 'refresh_token', TENANT_SLUG: 'tenant_slug', USER_DATA: 'user_data' },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

import { api } from '@/lib/api/client';
import {
  getConversations,
  getThread,
  getOrCreateThread,
  sendMessage,
  archiveConversation,
  restoreConversation,
  getMessagingRestrictionStatus,
  updateMessage,
  deleteMessage,
  sendMessageWithAttachments,
  sendVoiceMessage,
} from './messages';
import type { ConversationListResponse, MessageListResponse, Message } from './messages';

const mockMessage: Message = {
  id: 100,
  body: 'Hello there!',
  sender: { id: 1, name: 'Alice', avatar_url: null },
  created_at: '2026-01-10T09:00:00Z',
  is_own: true,
  is_voice: false,
  audio_url: null,
  reactions: {},
  is_read: true,
};

const mockConversationListResponse: ConversationListResponse = {
  data: [
    {
      id: 1,
      other_user: { id: 2, name: 'Bob', avatar_url: null, is_online: false },
      last_message: { body: 'Hello there!', created_at: '2026-01-10T09:00:00Z', is_own: true },
      unread_count: 0,
    },
  ],
  meta: { per_page: 20, has_more: false, cursor: null },
};

const mockMessageListResponse: MessageListResponse = {
  data: [mockMessage],
  meta: { per_page: 50, has_more: false, cursor: null },
};

describe('getConversations', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls /api/v2/messages with no cursor on first page', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockConversationListResponse);
    const result = await getConversations();
    expect(api.get).toHaveBeenCalledWith('/api/v2/messages', {});
    expect(result.data).toHaveLength(1);
  });

  it('includes cursor param when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockConversationListResponse);
    await getConversations('cursor-abc');
    expect(api.get).toHaveBeenCalledWith('/api/v2/messages', { cursor: 'cursor-abc' });
  });

  it('omits cursor when null is passed', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockConversationListResponse);
    await getConversations(null);
    const params = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(params).not.toHaveProperty('cursor');
  });

  it('includes archived param when requesting archived conversations', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockConversationListResponse);
    await getConversations(null, { archived: true });
    expect(api.get).toHaveBeenCalledWith('/api/v2/messages', { archived: 'true' });
  });

  it('propagates errors from the API', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('Unauthorized'));
    await expect(getConversations()).rejects.toThrow('Unauthorized');
  });
});

describe('restoreConversation', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('posts to the restore endpoint for a conversation', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { success: true, restored_count: 1 } });

    await restoreConversation(7);

    expect(api.post).toHaveBeenCalledWith('/api/v2/messages/conversations/7/restore', {});
  });
});

describe('getMessagingRestrictionStatus', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the backend restriction status endpoint', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { messaging_disabled: true, under_monitoring: true, restriction_reason: 'Safety review' },
    });

    const result = await getMessagingRestrictionStatus();

    expect(api.get).toHaveBeenCalledWith('/api/v2/messages/restriction-status');
    expect(result.data.messaging_disabled).toBe(true);
  });
});

describe('archiveConversation', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('deletes via the archive endpoint for a conversation', async () => {
    (api.delete as jest.Mock).mockResolvedValue(undefined);

    await archiveConversation(7);

    expect(api.delete).toHaveBeenCalledWith('/api/v2/messages/conversations/7');
  });
});

describe('getThread', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct thread endpoint for a user', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockMessageListResponse);
    const result = await getThread(2);
    expect(api.get).toHaveBeenCalledWith('/api/v2/messages/2', {});
    expect(result.data).toHaveLength(1);
    expect(result.data[0].body).toBe('Hello there!');
  });

  it('includes cursor param when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockMessageListResponse);
    await getThread(2, 'cursor-xyz');
    expect(api.get).toHaveBeenCalledWith('/api/v2/messages/2', { cursor: 'cursor-xyz' });
  });
});

describe('getOrCreateThread', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns thread data when the conversation exists', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockMessageListResponse);
    const result = await getOrCreateThread(2);
    expect(result.data).toHaveLength(1);
  });

  it('returns empty thread when API responds with 404', async () => {
    const err = Object.assign(new Error('Not found'), { status: 404 });
    (api.get as jest.Mock).mockRejectedValue(err);
    const result = await getOrCreateThread(99);
    expect(result.data).toHaveLength(0);
    expect(result.meta.has_more).toBe(false);
    expect(result.meta.cursor).toBeNull();
  });

  it('rethrows non-404 errors', async () => {
    const err = Object.assign(new Error('Server error'), { status: 500 });
    (api.get as jest.Mock).mockRejectedValue(err);
    await expect(getOrCreateThread(99)).rejects.toThrow('Server error');
  });
});

describe('sendMessage', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends POST with recipient_id and body to /api/v2/messages', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: mockMessage });
    const result = await sendMessage(2, 'Hello there!');
    expect(api.post).toHaveBeenCalledWith('/api/v2/messages', {
      recipient_id: 2,
      body: 'Hello there!',
    });
    expect(result.data.body).toBe('Hello there!');
  });

  it('includes contextual compose fields when provided', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: mockMessage });

    await sendMessage(2, 'I can help with this.', {
      listing_id: 9,
      context_type: 'job',
      context_id: 44,
    });

    expect(api.post).toHaveBeenCalledWith('/api/v2/messages', {
      recipient_id: 2,
      body: 'I can help with this.',
      listing_id: 9,
      context_type: 'job',
      context_id: 44,
    });
  });

  it('propagates errors from the API', async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error('Forbidden'));
    await expect(sendMessage(2, 'Hi')).rejects.toThrow('Forbidden');
  });
});

describe('sendMessageWithAttachments', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uploads multipart message attachments', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ data: mockMessage });

    await sendMessageWithAttachments(2, 'Photo update', [{
      uri: 'file:///tmp/photo.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
    }], {
      context_type: 'job',
      context_id: 44,
    });

    expect(api.upload).toHaveBeenCalledWith('/api/v2/messages', expect.any(FormData));
  });
});

describe('sendVoiceMessage', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uploads a voice message', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ data: { ...mockMessage, is_voice: true, audio_url: 'https://cdn.test/voice.m4a' } });

    await sendVoiceMessage(2, 'file:///tmp/voice.m4a', {
      context_type: 'job',
      context_id: 44,
    });

    expect(api.upload).toHaveBeenCalledWith('/api/v2/messages/voice', expect.any(FormData));
  });

  /**
   * 🔴 The server stores `max(1, duration)` and reads `duration` straight from the request.
   * Nothing sent it, so every voice message on the platform was stored as one second long —
   * measured on a device on 2026-08-22, where a recording the sender's own screen labelled
   * 0:38 arrived as `audio_duration = 1`.
   */
  it('sends the recorded length so the message is not stored as one second', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ data: { ...mockMessage, is_voice: true } });

    await sendVoiceMessage(2, 'file:///tmp/voice.m4a', {}, 38);

    const formData = (api.upload as jest.Mock).mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get('duration')).toBe('38');
  });

  it('rounds a fractional length rather than sending a decimal', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ data: { ...mockMessage, is_voice: true } });

    await sendVoiceMessage(2, 'file:///tmp/voice.m4a', {}, 12.6);

    const formData = (api.upload as jest.Mock).mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get('duration')).toBe('13');
  });

  it('omits the field entirely when the length is unknown, so the server default applies', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ data: { ...mockMessage, is_voice: true } });

    await sendVoiceMessage(2, 'file:///tmp/voice.m4a', {});

    const formData = (api.upload as jest.Mock).mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get('duration')).toBeNull();
  });
});

describe('updateMessage', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('updates a message body', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: { ...mockMessage, body: 'Edited body' } });

    await updateMessage(100, 'Edited body');

    expect(api.put).toHaveBeenCalledWith('/api/v2/messages/100', { body: 'Edited body' });
  });
});

describe('deleteMessage', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('deletes a message for the current user by default', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    await deleteMessage(100);

    expect(api.delete).toHaveBeenCalledWith('/api/v2/messages/100?scope=self');
  });

  it('can delete a message for everyone', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    await deleteMessage(100, 'everyone');

    expect(api.delete).toHaveBeenCalledWith('/api/v2/messages/100?scope=everyone');
  });
});
