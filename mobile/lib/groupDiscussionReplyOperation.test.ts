// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { clearCreationDraft, loadCreationDraft, saveCreationDraft } from '@/lib/creationDraftStore';
import { storage } from '@/lib/storage';
import {
  completeGroupDiscussionReplyOperation,
  discardGroupDiscussionReplyOperation,
  loadGroupDiscussionReplyOperation,
  reserveGroupDiscussionReplyOperation,
} from './groupDiscussionReplyOperation';

jest.mock('@/lib/storage', () => ({ storage: { getJson: jest.fn(), get: jest.fn() } }));
jest.mock('@/lib/creationDraftStore', () => ({
  loadCreationDraft: jest.fn(),
  saveCreationDraft: jest.fn(),
  clearCreationDraft: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `hash-${value}`),
}));

describe('group discussion reply operation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(storage.getJson).mockResolvedValue({ id: 42 });
    jest.mocked(storage.get).mockResolvedValue('hour-timebank');
    jest.mocked(loadCreationDraft).mockResolvedValue(null);
    jest.mocked(saveCreationDraft).mockResolvedValue(true);
    jest.mocked(clearCreationDraft).mockResolvedValue(true);
  });

  it('restores the exact reply and key after process restart', async () => {
    const first = await reserveGroupDiscussionReplyOperation(9, 17, '  Exact reply  ');
    jest.mocked(loadCreationDraft).mockResolvedValue(first);
    await expect(loadGroupDiscussionReplyOperation(9, 17)).resolves.toEqual(first);
    await expect(reserveGroupDiscussionReplyOperation(9, 17, 'Exact reply')).resolves.toEqual(first);
  });

  it('does not replace unresolved work with changed text', async () => {
    const first = await reserveGroupDiscussionReplyOperation(9, 17, 'Exact reply');
    jest.mocked(loadCreationDraft).mockResolvedValue(first);
    await expect(reserveGroupDiscussionReplyOperation(9, 17, 'Changed reply'))
      .rejects.toThrow('pending group discussion reply');
  });

  it('blocks transport when encrypted persistence fails', async () => {
    jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
    await expect(reserveGroupDiscussionReplyOperation(9, 17, 'Exact reply'))
      .rejects.toThrow('could not be saved');
  });

  it('passes long valid wording intact to the encrypted file-backed store', async () => {
    const content = 'Long reply. '.repeat(4000);
    await reserveGroupDiscussionReplyOperation(9, 17, content);
    expect(saveCreationDraft).toHaveBeenCalledWith(
      { kind: 'group-discussion-reply', tenantId: 'hour-timebank', userId: 42, contextId: '9:17' },
      expect.objectContaining({ content: content.trim() }),
    );
  });

  it('uses the server byte limit for multibyte reply text', async () => {
    await expect(reserveGroupDiscussionReplyOperation(9, 17, '😀'.repeat(15001)))
      .rejects.toThrow('Invalid group discussion reply');
    expect(saveCreationDraft).not.toHaveBeenCalled();
  });

  it('fails closed on unreadable or cross-thread records', async () => {
    jest.mocked(loadCreationDraft).mockResolvedValue('{broken');
    await expect(loadGroupDiscussionReplyOperation(9, 17)).rejects.toThrow('unreadable');
    jest.mocked(loadCreationDraft).mockResolvedValue(null);
    const operation = await reserveGroupDiscussionReplyOperation(9, 17, 'Exact reply');
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...operation, discussionId: 18 });
    await expect(loadGroupDiscussionReplyOperation(9, 17)).rejects.toThrow('unreadable');
  });

  it('clears only the matching saved operation', async () => {
    const operation = await reserveGroupDiscussionReplyOperation(9, 17, 'Exact reply');
    jest.mocked(loadCreationDraft).mockResolvedValue(operation);
    await completeGroupDiscussionReplyOperation(operation);
    expect(clearCreationDraft).toHaveBeenCalledTimes(1);

    jest.mocked(clearCreationDraft).mockClear();
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...operation, key: 'newer-key' });
    await discardGroupDiscussionReplyOperation(operation);
    expect(clearCreationDraft).not.toHaveBeenCalled();
  });

  it('refuses an account change before saving', async () => {
    jest.mocked(storage.getJson).mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99 });
    await expect(reserveGroupDiscussionReplyOperation(9, 17, 'Exact reply'))
      .rejects.toThrow('identity changed');
    expect(saveCreationDraft).not.toHaveBeenCalled();
  });
});
