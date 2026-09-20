// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { AppState } from 'react-native';
import * as Sharing from 'expo-sharing';
import { shareAuditedCsv } from './shareAuditedCsv';
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
const current = jest.fn(), dispose = jest.fn(), release = jest.fn();
const file = { uri: 'file:///private/export.csv', assertCurrent: current, dispose, releaseAfterSharing: release };
const prepare = jest.fn();
beforeEach(() => {
  jest.resetAllMocks(); AppState.currentState = 'active';
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue();
  prepare.mockResolvedValue(file); current.mockResolvedValue(undefined);
});
it('does not audit/download when native sharing is unavailable', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await expect(shareAuditedCsv(prepare, () => true)).rejects.toThrow('sharing_unavailable');
  expect(prepare).not.toHaveBeenCalled(); expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it.each(['background', 'inactive'] as const)('refuses %s actions before availability or download', async state => {
  AppState.currentState = state;
  await expect(shareAuditedCsv(prepare, () => true)).rejects.toThrow('download_cancelled');
  expect(Sharing.isAvailableAsync).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
});
it('rechecks departure during native availability', async () => {
  let active = true;
  jest.mocked(Sharing.isAvailableAsync).mockImplementation(async () => { active = false; return true; });
  await expect(shareAuditedCsv(prepare, () => active)).rejects.toThrow('download_cancelled');
  expect(prepare).not.toHaveBeenCalled();
});
it('deletes an unshared file after account replacement and preserves the original error', async () => {
  const error = new Error('account changed'); current.mockRejectedValue(error);
  dispose.mockImplementation(() => { throw new Error('disk unavailable'); });
  await expect(shareAuditedCsv(prepare, () => true)).rejects.toBe(error);
  expect(dispose).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalled(); expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it('deletes an unshared file after backgrounding during preparation', async () => {
  prepare.mockImplementation(async () => { AppState.currentState = 'background'; return file; });
  await expect(shareAuditedCsv(prepare, () => true)).rejects.toThrow('download_cancelled');
  expect(dispose).toHaveBeenCalledTimes(1); expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it('hands off exact CSV metadata and retains the source even if the app is still active when native resolves', async () => {
  await shareAuditedCsv(prepare, () => true);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  expect(release).toHaveBeenCalledTimes(1); expect(dispose).not.toHaveBeenCalled();
});
it('retains a handed-off file after departure and does not depend on the originating component remaining mounted', async () => {
  let active = true;
  jest.mocked(Sharing.shareAsync).mockImplementation(async () => { active = false; AppState.currentState = 'background'; });
  await shareAuditedCsv(prepare, () => active);
  expect(release).toHaveBeenCalledTimes(1); expect(dispose).not.toHaveBeenCalled();
});
it('does not erase a potentially handed-off file on native share error, and unlocks the next explicit attempt', async () => {
  const error = new Error('native error'); jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(error);
  await expect(shareAuditedCsv(prepare, () => true)).rejects.toBe(error);
  expect(release).toHaveBeenCalledTimes(1); expect(dispose).not.toHaveBeenCalled();
  await shareAuditedCsv(prepare, () => true); expect(prepare).toHaveBeenCalledTimes(2);
});
it('serializes concurrent callers and unlocks after a failed download without retry', async () => {
  let reject!: (error: Error) => void;
  prepare.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
  const first = shareAuditedCsv(prepare, () => true); const rejection = expect(first).rejects.toThrow('network');
  await Promise.resolve();
  await expect(shareAuditedCsv(prepare, () => true)).rejects.toThrow('export_in_progress');
  reject(new Error('network')); await rejection;
  expect(prepare).toHaveBeenCalledTimes(1);
  await shareAuditedCsv(prepare, () => true); expect(prepare).toHaveBeenCalledTimes(2);
});
