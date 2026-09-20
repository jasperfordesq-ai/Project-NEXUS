// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { act, renderHook } from '@testing-library/react-native';
import { prepareOrganizerRegistrationExport as prepare } from '@/lib/api/eventRegistration';
import { shareAuditedCsv as share } from '@/lib/shareAuditedCsv';
import { useRegistrationExport } from './useRegistrationExport';
jest.mock('@/lib/api/eventRegistration', () => ({ prepareOrganizerRegistrationExport: jest.fn() }));
jest.mock('@/lib/shareAuditedCsv', () => ({ shareAuditedCsv: jest.fn() }));
const scope = { tenantId: 2, userId: 3, eventId: 4 };
const props = { scope, permitted: true, sensitive: true, active: true };
const evidence = { purpose: 'Venue review', correlation_id: 'case-1', include_sensitive: false };
const run = () => renderHook((value: typeof props) => useRegistrationExport(value.scope, value.permitted, value.sensitive, value.active), { initialProps: props });
beforeEach(() => { jest.resetAllMocks(); jest.mocked(share).mockImplementation(async prepareFile => { await prepareFile(); }); });
it('only exports explicitly, forwarding evidence, and does not claim a successful save on dismissal', async () => {
  const { result } = run(); expect(share).not.toHaveBeenCalled();
  await act(async () => { await result.current.open(evidence); });
  expect(prepare).toHaveBeenCalledWith(4, evidence, expect.any(Function));
  expect(result.current.status).toBe('idle'); expect(share).toHaveBeenCalledTimes(1);
});
it('blocks duplicate callbacks while sharing', async () => {
  let resolve!: () => void; jest.mocked(share).mockReturnValue(new Promise<void>(yes => { resolve = yes; }));
  const { result } = run(); let pending!: Promise<void>;
  act(() => { pending = result.current.open(evidence); void result.current.open(evidence); });
  expect(share).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(); await pending; });
});
it.each([
  { ...props, active: false }, { ...props, permitted: false }, { ...props, sensitive: false },
  { ...props, scope: { ...scope, tenantId: 9 } }, { ...props, scope: { ...scope, userId: 9 } }, { ...props, scope: { ...scope, eventId: 9 } },
])('invalidates in-flight handoff and stale callbacks after context replacement %j', async next => {
  let resolve!: () => void; jest.mocked(share).mockReturnValue(new Promise<void>(yes => { resolve = yes; }));
  const { result, rerender } = run(); const oldOpen = result.current.open; let pending!: Promise<void>;
  act(() => { pending = oldOpen(evidence); });
  const guard = jest.mocked(share).mock.calls[0][1]; expect(guard()).toBe(true);
  rerender(next); expect(guard()).toBe(false);
  await act(async () => { await oldOpen(evidence); resolve(); await pending; });
  expect(share).toHaveBeenCalledTimes(1); expect(result.current.status).toBe('idle');
});
it('invalidates the preparation guard when unmounted', async () => {
  let resolve!: () => void; jest.mocked(share).mockReturnValue(new Promise<void>(yes => { resolve = yes; }));
  const { result, unmount } = run(); let pending!: Promise<void>;
  act(() => { pending = result.current.open(evidence); }); const guard = jest.mocked(share).mock.calls[0][1];
  unmount(); expect(guard()).toBe(false); resolve(); await pending;
});
it('requires the separate sensitive permission and refuses invalid scope IDs', async () => {
  const { result, rerender } = run(); rerender({ ...props, sensitive: false });
  await act(async () => { await result.current.open({ ...evidence, include_sensitive: true }); });
  rerender({ ...props, scope: { ...scope, eventId: 0 } });
  await act(async () => { await result.current.open(evidence); }); expect(share).not.toHaveBeenCalled();
});
it('shows availability failure and never retries on foreground or rerender', async () => {
  jest.mocked(share).mockRejectedValue(new Error('sharing_unavailable')); const { result, rerender } = run();
  await act(async () => { await result.current.open(evidence); });
  expect(result.current.unavailable).toBe(true); expect(result.current.status).toBe('failed');
  rerender({ ...props, active: false }); rerender(props); expect(result.current.status).toBe('idle'); expect(share).toHaveBeenCalledTimes(1);
});
