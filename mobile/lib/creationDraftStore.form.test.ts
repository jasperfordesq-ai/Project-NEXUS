// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from './storage';
import { loadCreationDraft as load, saveCreationDraft as save, clearCreationDraft as clear } from './creationDraftStore';
jest.mock('expo-crypto', () => ({ getRandomBytes: (size: number) => new Uint8Array(require('crypto').randomBytes(size)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///private/', EncodingType: { UTF8: 'utf8' },
  makeDirectoryAsync: jest.fn(), writeAsStringAsync: jest.fn(), readAsStringAsync: jest.fn(), deleteAsync: jest.fn() }));
jest.mock('./storage', () => ({ storage: { get: jest.fn(), getJson: jest.fn(), set: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
const scope = { kind: 'event-registration-form' as const, tenantId: 2, userId: 7, contextId: 42 };
const base = 'nexus_creation_draft_v1_event-registration-form_2_7_42';
const values = new Map<string, string>();
const files = new Map<string, string>();
beforeEach(() => {
  jest.resetAllMocks(); values.clear(); files.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.getJson).mockImplementation(async key => values.has(key) ? JSON.parse(values.get(key)!) : null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(FileSystem.writeAsStringAsync).mockImplementation(async (path, value) => { files.set(path, value); });
  jest.mocked(FileSystem.readAsStringAsync).mockImplementation(async path => {
    const value = files.get(path); if (value === undefined) throw new Error('Missing file'); return value;
  });
  jest.mocked(FileSystem.deleteAsync).mockImplementation(async path => { files.delete(path); });
});
function legacy(value: unknown) {
  const characters = Array.from(JSON.stringify(value));
  const chunks = Math.ceil(characters.length / 350);
  values.set(base, JSON.stringify({ version: 1, generation: 'legacy_v1', chunks }));
  for (let index = 0; index < chunks; index++) values.set(`${base}_legacy_v1_${index}`, characters.slice(index * 350, (index + 1) * 350).join(''));
}
it('reads a legacy pending request and migrates on the next successful write', async () => {
  const pending = { status: 'pending', key: 'original-retry-key', definition: 'Original' };
  legacy(pending);
  expect(await load(scope, { required: true })).toEqual(pending);
  const reviewed = { ...pending, status: 'review', definition: 'Long consent 🌱 '.repeat(2000) };
  expect(await save(scope, reviewed)).toBe(true);
  expect(await load(scope, { required: true })).toEqual(reviewed);
  expect(files.size).toBe(1);
});
it('keeps the old request recoverable if migration cannot commit', async () => {
  legacy({ key: 'original' });
  jest.mocked(storage.set).mockRejectedValueOnce(new Error('Keychain unavailable'));
  expect(await save(scope, { key: 'replacement' })).toBe(false);
  expect(await load(scope, { required: true })).toEqual({ key: 'original' });
});
it('does not resurrect legacy data after an explicit clear', async () => {
  legacy({ key: 'original' });
  expect(await clear(scope)).toBe(true);
  expect(values.has(base)).toBe(true);
  expect(await load(scope, { required: true })).toBeNull();
});
it('does not fall back to legacy data when the authoritative file is corrupt', async () => {
  legacy({ key: 'old' });
  await save(scope, { key: 'current' });
  files.set([...files.keys()][0], 'corrupted');
  await expect(load(scope, { required: true })).rejects.toThrow();
});
it('serializes clear behind an in-flight save', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  jest.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async (path, value) => { await gate; files.set(path, value); });
  const saving = save(scope, { key: 'pending' });
  const clearing = clear(scope);
  release();
  expect(await saving).toBe(true);
  expect(await clearing).toBe(true);
  expect(await load(scope, { required: true })).toBeNull();
});
