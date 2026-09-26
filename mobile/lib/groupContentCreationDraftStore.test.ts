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

const scope = {
  kind: 'group-content' as const,
  tenantId: 'hour-timebank',
  userId: 42,
  contextId: '9:discussion',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(saveEncryptedDraftFile).mockResolvedValue(undefined);
  jest.mocked(loadEncryptedDraftFile).mockResolvedValue(null);
});

it('stores a long Android group-content operation in the encrypted file store', async () => {
  const operation = { key: 'discussion-key', payload: { content: 'Long discussion. '.repeat(4000) } };
  await expect(saveCreationDraft(scope, operation)).resolves.toBe(true);
  expect(saveEncryptedDraftFile).toHaveBeenCalledWith(
    'nexus_creation_draft_v1_group-content_hour-timebank_42_9_discussion',
    operation,
  );
});

it('loads an Android group-content operation from the encrypted file store', async () => {
  const operation = { key: 'discussion-key', payload: { title: 'Saved discussion' } };
  jest.mocked(loadEncryptedDraftFile).mockResolvedValue({ value: operation });
  await expect(loadCreationDraft(scope, { required: true })).resolves.toEqual(operation);
});

it('commits a file-backed tombstone when Android group content is cleared', async () => {
  await expect(clearCreationDraft(scope)).resolves.toBe(true);
  expect(saveEncryptedDraftFile).toHaveBeenCalledWith(
    'nexus_creation_draft_v1_group-content_hour-timebank_42_9_discussion',
    null,
  );
});
