// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from './storage';
import { loadEncryptedDraftFile as load, saveEncryptedDraftFile as save } from './encryptedDraftFile';
jest.mock('expo-crypto', () => ({ getRandomBytes: (size: number) => new Uint8Array(require('crypto').randomBytes(size)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///private/', EncodingType: { UTF8: 'utf8' },
  makeDirectoryAsync: jest.fn(), writeAsStringAsync: jest.fn(), readAsStringAsync: jest.fn(), deleteAsync: jest.fn() }));
jest.mock('./storage', () => ({ storage: { get: jest.fn(), set: jest.fn() } }));
const files = new Map<string, string>();
const keys = new Map<string, string>();
const scope = 'nexus_creation_draft_v1_event-registration-form_2_7_42';
beforeEach(() => {
  jest.resetAllMocks(); files.clear(); keys.clear();
  jest.mocked(storage.get).mockImplementation(async key => keys.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { keys.set(key, value); });
  jest.mocked(FileSystem.writeAsStringAsync).mockImplementation(async (path, value) => { files.set(path, value); });
  jest.mocked(FileSystem.readAsStringAsync).mockImplementation(async path => {
    const value = files.get(path); if (value === undefined) throw new Error('Missing file'); return value;
  });
  jest.mocked(FileSystem.deleteAsync).mockImplementation(async path => { files.delete(path); });
});
it('round-trips large Unicode definitions with no plaintext in files and isolates owners', async () => {
  const draft = { consent: 'Private consent café 🌱 '.repeat(10000) };
  await save(scope, draft);
  expect(await load(scope)).toEqual({ value: draft });
  expect([...files.values()][0]).not.toContain('Private consent');
  expect([...keys.values()][0].length).toBeLessThan(200);
  expect(await load(scope.replace('_7_', '_8_'))).toBeNull();
});
it.each(['write', 'verify', 'commit'])('preserves the previous complete draft after %s failure', async phase => {
  await save(scope, { name: 'Original' });
  if (phase === 'write') jest.mocked(FileSystem.writeAsStringAsync).mockRejectedValueOnce(new Error('Disk full'));
  if (phase === 'verify') jest.mocked(FileSystem.readAsStringAsync).mockResolvedValueOnce('corrupt');
  if (phase === 'commit') jest.mocked(storage.set).mockRejectedValueOnce(new Error('Keychain unavailable'));
  await expect(save(scope, { name: 'Replacement' })).rejects.toThrow();
  expect(await load(scope)).toEqual({ value: { name: 'Original' } });
});
it('does not treat corruption as a missing draft', async () => {
  await save(scope, { name: 'Original' });
  files.set([...files.keys()][0], 'damaged');
  await expect(load(scope)).rejects.toThrow();
});
it('distinguishes an explicit cleared value from absence for migration', async () => {
  expect(await load(scope)).toBeNull();
  await save(scope, null);
  expect(await load(scope)).toEqual({ value: null });
});
it('keeps a committed replacement even when old ciphertext cleanup fails', async () => {
  await save(scope, { name: 'Original' });
  jest.mocked(FileSystem.deleteAsync).mockRejectedValueOnce(new Error('Busy'));
  await save(scope, { name: 'Replacement' });
  expect(await load(scope)).toEqual({ value: { name: 'Replacement' } });
});
