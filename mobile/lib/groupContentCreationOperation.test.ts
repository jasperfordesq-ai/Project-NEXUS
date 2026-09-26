// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { clearCreationDraft, loadCreationDraft, saveCreationDraft } from '@/lib/creationDraftStore';
import { storage } from '@/lib/storage';
import {
  completeGroupContentCreationOperation,
  discardGroupContentCreationOperation,
  loadGroupContentCreationOperation,
  reserveGroupContentCreationOperation,
} from './groupContentCreationOperation';

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

const discussion = { title: 'Compost rota', content: 'Who can take Friday?' };

describe('group content creation operation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(storage.getJson).mockResolvedValue({ id: 42 });
    jest.mocked(storage.get).mockResolvedValue('hour-timebank');
    jest.mocked(loadCreationDraft).mockResolvedValue(null);
    jest.mocked(saveCreationDraft).mockResolvedValue(true);
    jest.mocked(clearCreationDraft).mockResolvedValue(true);
  });

  it('restores the exact discussion draft and key after process restart', async () => {
    const first = await reserveGroupContentCreationOperation(9, 'discussion', discussion);
    jest.mocked(loadCreationDraft).mockResolvedValue(first);

    await expect(loadGroupContentCreationOperation(9, 'discussion')).resolves.toEqual(first);
    await expect(reserveGroupContentCreationOperation(9, 'discussion', discussion)).resolves.toEqual(first);
  });

  it('normalizes surrounding whitespace before binding the intent', async () => {
    const operation = await reserveGroupContentCreationOperation(9, 'discussion', {
      title: '  Compost rota  ',
      content: '  Who can take Friday?  ',
    });

    expect(operation.payload).toEqual(discussion);
    expect(operation.intent).toBe(JSON.stringify(discussion));
  });

  it('does not replace unresolved work with changed content', async () => {
    const first = await reserveGroupContentCreationOperation(9, 'discussion', discussion);
    jest.mocked(loadCreationDraft).mockResolvedValue(first);

    await expect(reserveGroupContentCreationOperation(9, 'discussion', {
      ...discussion,
      content: 'Changed message',
    })).rejects.toThrow('pending group discussion');
  });

  it('blocks transport when encrypted persistence fails', async () => {
    jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
    await expect(reserveGroupContentCreationOperation(9, 'discussion', discussion))
      .rejects.toThrow('could not be saved');
  });

  it('stores content through the encrypted file-backed draft scope', async () => {
    await reserveGroupContentCreationOperation(9, 'discussion', discussion);
    expect(saveCreationDraft).toHaveBeenCalledWith(
      { kind: 'group-content', tenantId: 'hour-timebank', userId: 42, contextId: '9:discussion' },
      expect.objectContaining({ kind: 'discussion', groupId: 9, payload: discussion }),
    );
  });

  it('fails closed on unreadable, cross-group, or cross-kind records', async () => {
    jest.mocked(loadCreationDraft).mockResolvedValue('{broken');
    await expect(loadGroupContentCreationOperation(9, 'discussion')).rejects.toThrow('unreadable');

    jest.mocked(loadCreationDraft).mockResolvedValue(null);
    const operation = await reserveGroupContentCreationOperation(9, 'discussion', discussion);
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...operation, groupId: 10 });
    await expect(loadGroupContentCreationOperation(9, 'discussion')).rejects.toThrow('unreadable');
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...operation, kind: 'question' });
    await expect(loadGroupContentCreationOperation(9, 'discussion')).rejects.toThrow('unreadable');
  });

  it('clears only the matching saved operation', async () => {
    const operation = await reserveGroupContentCreationOperation(9, 'discussion', discussion);
    jest.mocked(loadCreationDraft).mockResolvedValue(operation);
    await completeGroupContentCreationOperation(operation);
    expect(clearCreationDraft).toHaveBeenCalledTimes(1);

    jest.mocked(clearCreationDraft).mockClear();
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...operation, key: 'newer-key' });
    await discardGroupContentCreationOperation(operation);
    expect(clearCreationDraft).not.toHaveBeenCalled();
  });

  it('refuses an account change before saving', async () => {
    jest.mocked(storage.getJson).mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99 });
    await expect(reserveGroupContentCreationOperation(9, 'discussion', discussion))
      .rejects.toThrow('identity changed');
    expect(saveCreationDraft).not.toHaveBeenCalled();
  });
});
