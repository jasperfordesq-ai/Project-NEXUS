// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { clearCreationDraft, loadCreationDraft, saveCreationDraft } from '@/lib/creationDraftStore';
import { storage } from '@/lib/storage';

jest.mock('@/lib/storage', () => ({
  storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
  },
}));

const values = new Map<string, string>();
const scope = { kind: 'poll' as const, tenantId: 2, userId: 7 };

beforeEach(() => {
  values.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
  jest.mocked(storage.getJson).mockImplementation(async key => {
    const value = values.get(key);
    return value ? JSON.parse(value) : null;
  });
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
});

it('round-trips a multi-chunk Unicode draft within its account and community scope', async () => {
  const draft = { question: `Repair café 🌱 ${'long answer '.repeat(80)}`, options: ['One', 'Two'] };

  await expect(saveCreationDraft(scope, draft)).resolves.toBe(true);
  await expect(loadCreationDraft(scope)).resolves.toEqual(draft);
  await expect(loadCreationDraft({ ...scope, userId: 8 })).resolves.toBeNull();
  expect([...values.keys()].filter(key => key.includes('_poll_2_7_')).length).toBeGreaterThan(1);
});

it('keeps message drafts isolated by conversation as well as account and community', async () => {
  const firstConversation = { kind: 'message' as const, tenantId: 2, userId: 7, contextId: 'conversation_41' };
  const secondConversation = { ...firstConversation, contextId: 'conversation_42' };

  await saveCreationDraft(firstConversation, { text: 'Reply to conversation 41' });

  await expect(loadCreationDraft(firstConversation)).resolves.toEqual({ text: 'Reply to conversation 41' });
  await expect(loadCreationDraft(secondConversation)).resolves.toBeNull();
});

it('publishes the manifest only after every encrypted chunk is durable', async () => {
  const order: string[] = [];
  jest.mocked(storage.set).mockImplementation(async key => { order.push(`chunk:${key}`); });
  jest.mocked(storage.setJson).mockImplementation(async key => { order.push(`manifest:${key}`); });

  await saveCreationDraft(scope, { question: 'A'.repeat(800) });

  expect(order.at(-1)).toContain('manifest:nexus_creation_draft_v1_poll_2_7');
});

it('uses a tombstone so failed chunk cleanup cannot resurrect a discarded draft', async () => {
  const draft = { question: 'Keep this only until discard' };
  await saveCreationDraft(scope, draft);
  jest.mocked(storage.remove).mockRejectedValue(new Error('keychain unavailable'));

  await expect(clearCreationDraft(scope)).resolves.toBe(true);

  // The tombstone was committed before cleanup failed, so stale chunks are ignored.
  await expect(loadCreationDraft(scope)).resolves.toBeNull();
});

it('keeps the previous complete manifest when a replacement chunk write fails', async () => {
  const original = { question: `Original complete draft ${'A'.repeat(900)}` };
  await saveCreationDraft(scope, original);
  let replacementWrites = 0;
  jest.mocked(storage.set).mockImplementation(async (key, value) => {
    replacementWrites += 1;
    if (replacementWrites === 2) throw new Error('interrupted');
    values.set(key, value);
  });

  await expect(saveCreationDraft(scope, { question: `Replacement ${'B'.repeat(900)}` })).resolves.toBe(false);
  await expect(loadCreationDraft(scope)).resolves.toEqual(original);
});

it('serializes an overlapping autosave before a later discard so the tombstone wins', async () => {
  let releaseFirstChunk!: () => void;
  const firstChunkBlocked = new Promise<void>((resolve) => { releaseFirstChunk = resolve; });
  let firstWrite = true;
  jest.mocked(storage.set).mockImplementation(async (key, value) => {
    if (firstWrite) {
      firstWrite = false;
      await firstChunkBlocked;
    }
    values.set(key, value);
  });

  const save = saveCreationDraft(scope, { question: 'Autosave already in flight' });
  const clear = clearCreationDraft(scope);
  releaseFirstChunk();

  await expect(save).resolves.toBe(true);
  await expect(clear).resolves.toBe(true);
  await expect(loadCreationDraft(scope)).resolves.toBeNull();
});

it('returns safe failure values when encrypted manifest reads are unavailable', async () => {
  jest.mocked(storage.getJson).mockRejectedValue(new Error('keystore unavailable'));

  await expect(saveCreationDraft(scope, { question: 'Keep this in memory' })).resolves.toBe(false);
  await expect(loadCreationDraft(scope)).resolves.toBeNull();
  await expect(clearCreationDraft(scope)).resolves.toBe(false);
});
