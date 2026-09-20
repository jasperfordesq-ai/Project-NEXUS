// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { AppState, type AppStateStatus } from 'react-native';
import { Directory, File } from 'expo-file-system';
import { cleanAuditedExportCache, createAuditedExportDirectory, observeAuditedExportCleanup } from './auditedExportCache';
const mockList = jest.fn(), mockDelete = jest.fn(), mockCreate = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache' },
  Directory: class {
    uri: string; exists = true;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
    list() { return mockList(); } create() { mockCreate(); }
    delete() { mockDelete(this.uri); }
  },
  File: class { uri: string; constructor(uri: string) { this.uri = uri; } },
}));
const uuid = '22222222-2222-4222-8222-222222222222';
const now = 1800000000000, hour = 3600000;
const dir = (at: number) => new Directory('file:///cache/nexus-audited-export-' + at + '-' + uuid);
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); jest.clearAllMocks(); mockList.mockReset(); mockDelete.mockReset(); mockList.mockReturnValue([]); AppState.currentState = 'active'; });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
it('removes expired orphans while retaining recent files, future timestamps and unrelated cache entries', () => {
  const old = dir(now-hour), recent = dir(now-hour+1), future = dir(now+hour);
  mockList.mockReturnValue([old, recent, future, new Directory('file:///cache/profile-images'),
    new Directory('file:///cache/nexus-audited-export-not-a-lease'), new File(old.uri)]);
  cleanAuditedExportCache(); expect(mockDelete.mock.calls).toEqual([[old.uri]]);
});
it('protects active transfers even beyond expiry, then cleans released files', () => {
  const lease = createAuditedExportDirectory(); mockList.mockReturnValue([lease.directory]);
  jest.advanceTimersByTime(hour+1); cleanAuditedExportCache(); expect(mockDelete).not.toHaveBeenCalled();
  lease.release(); cleanAuditedExportCache(); expect(mockDelete).toHaveBeenCalledWith(lease.directory.uri);
});
it('deletes an unshared file immediately and releases its lease even when deletion fails', () => {
  const lease = createAuditedExportDirectory(); mockList.mockReturnValue([lease.directory]);
  mockDelete.mockImplementationOnce(() => { throw new Error('busy'); });
  expect(lease.dispose).toThrow('busy'); jest.advanceTimersByTime(hour+1); cleanAuditedExportCache();
  expect(mockDelete).toHaveBeenCalledTimes(2);
});
it.each(['background', 'inactive', 'unknown'] as AppStateStatus[])('does no filesystem work while %s', state => {
  AppState.currentState = state; cleanAuditedExportCache(); expect(mockList).not.toHaveBeenCalled();
});
it('retries failed deletion later and still cleans other expired files', () => {
  const first = dir(now-hour), second = dir(now-hour-1); mockList.mockReturnValue([first, second]);
  mockDelete.mockImplementationOnce(() => { throw new Error('busy'); });
  expect(cleanAuditedExportCache).not.toThrow(); expect(mockDelete).toHaveBeenCalledTimes(2);
  cleanAuditedExportCache(); expect(mockDelete).toHaveBeenCalledTimes(4);
});
it('does not prevent startup when the cache is inaccessible', () => {
  mockList.mockImplementation(() => { throw new Error('unavailable'); }); expect(cleanAuditedExportCache).not.toThrow();
});
it('observes launch, foreground and active intervals; teardown removes every observer', () => {
  let change!: (state: AppStateStatus) => void; const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => { change = callback; return { remove }; });
  const stop = observeAuditedExportCleanup(); expect(mockList).toHaveBeenCalledTimes(1);
  AppState.currentState = 'background'; change('background'); jest.advanceTimersByTime(60000); expect(mockList).toHaveBeenCalledTimes(1);
  AppState.currentState = 'active'; change('active'); expect(mockList).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(60000); expect(mockList).toHaveBeenCalledTimes(3);
  stop(); expect(remove).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
