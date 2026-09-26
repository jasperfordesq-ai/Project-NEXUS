// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { clearCreationDraft, loadCreationDraft, saveCreationDraft } from './creationDraftStore';
import { loadEncryptedDraftFile, saveEncryptedDraftFile } from './encryptedDraftFile';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('@/lib/storage', () => ({ storage: {} }));
jest.mock('./encryptedDraftFile', () => ({
  loadEncryptedDraftFile: jest.fn(),
  saveEncryptedDraftFile: jest.fn(),
}));

const scope = { kind: 'group-task' as const, tenantId: 'hour-timebank', userId: 42, contextId: 9 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(saveEncryptedDraftFile).mockResolvedValue(undefined);
  jest.mocked(loadEncryptedDraftFile).mockResolvedValue(null);
});

it('stores a long Android group-task draft in the encrypted file store', async () => {
  const operation = { key: 'task-key', draft: { description: 'Long task detail. '.repeat(400) } };
  await expect(saveCreationDraft(scope, operation)).resolves.toBe(true);
  expect(saveEncryptedDraftFile).toHaveBeenCalledWith(
    'nexus_creation_draft_v1_group-task_hour-timebank_42_9',
    operation,
  );
});

it('loads an Android group-task draft from the encrypted file store', async () => {
  const operation = { key: 'task-key', draft: { title: 'Water seedlings' } };
  jest.mocked(loadEncryptedDraftFile).mockResolvedValue({ value: operation });
  await expect(loadCreationDraft(scope, { required: true })).resolves.toEqual(operation);
});

it('commits a file-backed tombstone when an Android group-task draft is cleared', async () => {
  await expect(clearCreationDraft(scope)).resolves.toBe(true);
  expect(saveEncryptedDraftFile).toHaveBeenCalledWith(
    'nexus_creation_draft_v1_group-task_hour-timebank_42_9',
    null,
  );
});
