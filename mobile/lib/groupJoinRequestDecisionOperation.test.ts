// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { clearCreationDraft, loadCreationDraft, saveCreationDraft } from '@/lib/creationDraftStore';
import { storage } from '@/lib/storage';
import {
  completeGroupJoinRequestDecisionOperation,
  discardGroupJoinRequestDecisionOperation,
  loadGroupJoinRequestDecisionOperation,
  reserveGroupJoinRequestDecisionOperation,
} from './groupJoinRequestDecisionOperation';

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

describe('group join request decision operation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(storage.getJson).mockResolvedValue({ id: 42 });
    jest.mocked(storage.get).mockResolvedValue('hour-timebank');
    jest.mocked(loadCreationDraft).mockResolvedValue(null);
    jest.mocked(saveCreationDraft).mockResolvedValue(true);
    jest.mocked(clearCreationDraft).mockResolvedValue(true);
  });

  it('restores the exact requester, action, and key after restart', async () => {
    const first = await reserveGroupJoinRequestDecisionOperation(9, 21, 'accept');
    jest.mocked(loadCreationDraft).mockResolvedValue(first);
    await expect(loadGroupJoinRequestDecisionOperation(9)).resolves.toEqual(first);
    await expect(reserveGroupJoinRequestDecisionOperation(9, 21, 'accept')).resolves.toEqual(first);
  });

  it('does not replace unresolved work with another requester or action', async () => {
    const first = await reserveGroupJoinRequestDecisionOperation(9, 21, 'accept');
    jest.mocked(loadCreationDraft).mockResolvedValue(first);
    await expect(reserveGroupJoinRequestDecisionOperation(9, 22, 'accept')).rejects.toThrow('pending group join decision');
    await expect(reserveGroupJoinRequestDecisionOperation(9, 21, 'reject')).rejects.toThrow('pending group join decision');
  });

  it('persists before transport can begin and fails closed when persistence fails', async () => {
    jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
    await expect(reserveGroupJoinRequestDecisionOperation(9, 21, 'accept')).rejects.toThrow('could not be saved');
    expect(saveCreationDraft).toHaveBeenCalledWith(
      { kind: 'group-join-decision', tenantId: 'hour-timebank', userId: 42, contextId: 9 },
      expect.objectContaining({ groupId: 9, requesterId: 21, action: 'accept' }),
    );
  });

  it('fails closed on unreadable or cross-group records', async () => {
    jest.mocked(loadCreationDraft).mockResolvedValue('{broken');
    await expect(loadGroupJoinRequestDecisionOperation(9)).rejects.toThrow('unreadable');
    const first = await reserveGroupJoinRequestDecisionOperation(9, 21, 'accept').catch(() => null);
    expect(first).toBeNull();

    jest.mocked(loadCreationDraft).mockResolvedValue(null);
    const valid = await reserveGroupJoinRequestDecisionOperation(9, 21, 'accept');
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...valid, groupId: 10 });
    await expect(loadGroupJoinRequestDecisionOperation(9)).rejects.toThrow('unreadable');
  });

  it('clears only the matching saved operation after success or definite refusal', async () => {
    const operation = await reserveGroupJoinRequestDecisionOperation(9, 21, 'reject');
    jest.mocked(loadCreationDraft).mockResolvedValue(operation);
    await completeGroupJoinRequestDecisionOperation(operation);
    expect(clearCreationDraft).toHaveBeenCalledTimes(1);

    jest.mocked(clearCreationDraft).mockClear();
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...operation, key: 'newer-key' });
    await discardGroupJoinRequestDecisionOperation(operation);
    expect(clearCreationDraft).not.toHaveBeenCalled();
  });

  it('refuses an account change before the operation is saved', async () => {
    jest.mocked(storage.getJson).mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99 });
    await expect(reserveGroupJoinRequestDecisionOperation(9, 21, 'accept')).rejects.toThrow('identity changed');
    expect(saveCreationDraft).not.toHaveBeenCalled();
  });
});
