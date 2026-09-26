// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { clearCreationDraft, loadCreationDraft, saveCreationDraft } from '@/lib/creationDraftStore';
import { storage } from '@/lib/storage';
import {
  completeGroupTaskCreationOperation,
  discardGroupTaskCreationOperation,
  loadGroupTaskCreationOperation,
  reserveGroupTaskCreationOperation,
  type GroupTaskCreationDraft,
} from './groupTaskCreationOperation';

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

const draft: GroupTaskCreationDraft = {
  title: 'Water seedlings',
  description: 'Use the small cans.',
  priority: 'high',
  assignedTo: 7,
  dueDate: '2026-06-30',
};

describe('group task creation operation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(storage.getJson).mockResolvedValue({ id: 42 });
    jest.mocked(storage.get).mockResolvedValue('hour-timebank');
    jest.mocked(loadCreationDraft).mockResolvedValue(null);
    jest.mocked(saveCreationDraft).mockResolvedValue(true);
    jest.mocked(clearCreationDraft).mockResolvedValue(true);
  });

  it('restores the exact pending key and draft after process restart', async () => {
    const first = await reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft);
    jest.mocked(loadCreationDraft).mockResolvedValue(first);
    await expect(loadGroupTaskCreationOperation(9)).resolves.toEqual(first);
    await expect(reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft)).resolves.toEqual(first);
  });

  it('does not replace unresolved work with changed intent', async () => {
    const first = await reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft);
    jest.mocked(loadCreationDraft).mockResolvedValue(first);
    await expect(reserveGroupTaskCreationOperation(9, 'changed', { ...draft, title: 'Changed' }))
      .rejects.toThrow('pending group task');
  });

  it('blocks transport when encrypted persistence fails', async () => {
    jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
    await expect(reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft)).rejects.toThrow('could not be saved');
  });

  it('passes long task wording to the encrypted file-backed draft store intact', async () => {
    const longDraft = { ...draft, description: 'Long task detail. '.repeat(400) };
    await reserveGroupTaskCreationOperation(9, JSON.stringify(longDraft), longDraft);
    expect(saveCreationDraft).toHaveBeenCalledWith(
      { kind: 'group-task', tenantId: 'hour-timebank', userId: 42, contextId: 9 },
      expect.objectContaining({ draft: longDraft }),
    );
  });

  it('fails closed when the encrypted record is unreadable', async () => {
    jest.mocked(loadCreationDraft).mockResolvedValue('{broken');
    await expect(loadGroupTaskCreationOperation(9)).rejects.toThrow('unreadable');
    await expect(reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft)).rejects.toThrow('unreadable');
    expect(saveCreationDraft).not.toHaveBeenCalled();
  });

  it('fails closed when a record names a different group', async () => {
    const operation = await reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft);
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...operation, groupId: 10 });
    await expect(loadGroupTaskCreationOperation(9)).rejects.toThrow('unreadable');
  });

  it('removes the pending operation only after confirmed success', async () => {
    const operation = await reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft);
    jest.mocked(loadCreationDraft).mockResolvedValue(operation);
    await completeGroupTaskCreationOperation(operation);
    expect(clearCreationDraft).toHaveBeenCalledWith({
      kind: 'group-task', tenantId: 'hour-timebank', userId: 42, contextId: 9,
    });
  });

  it('discards only the matching operation after a definite server rejection', async () => {
    const operation = await reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft);
    jest.mocked(loadCreationDraft).mockResolvedValue(operation);
    await discardGroupTaskCreationOperation(operation);
    expect(clearCreationDraft).toHaveBeenCalledTimes(1);

    jest.mocked(clearCreationDraft).mockClear();
    jest.mocked(loadCreationDraft).mockResolvedValue({ ...operation, key: 'another-key' });
    await discardGroupTaskCreationOperation(operation);
    expect(clearCreationDraft).not.toHaveBeenCalled();
  });

  it('refuses an account change before the operation is stored', async () => {
    jest.mocked(storage.getJson).mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99 });
    await expect(reserveGroupTaskCreationOperation(9, JSON.stringify(draft), draft)).rejects.toThrow('identity changed');
    expect(saveCreationDraft).not.toHaveBeenCalled();
  });
});
