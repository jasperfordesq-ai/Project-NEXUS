// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useInvitationCampaignOperations } from './useInvitationCampaignOperations';
import { loadInvitationCampaignOperation as load, executeInvitationCampaignOperation as execute,
  recoverInvitationCampaignOperation as recover, reviewInvitationCampaignOperation as review, type SavedInvitationCampaignOperation } from '../eventInvitationCampaignOperation';
jest.mock('../eventInvitationCampaignOperation', () => ({ loadInvitationCampaignOperation: jest.fn(), executeInvitationCampaignOperation: jest.fn(),
  recoverInvitationCampaignOperation: jest.fn(), reviewInvitationCampaignOperation: jest.fn() }));
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const intent = { action: 'preview' as const, campaignType: 'member' as const, source: { member_ids: [9] }, defaultLocale: 'en' as const };
const pending: SavedInvitationCampaignOperation = { ...scope, schemaVersion: 1, status: 'pending', key: 'original', intent };
const receipt = { data: { campaign: { id: 12, event_id: 42, campaign_type: 'member' as const, status: 'previewed' as const,
  revision: 1, preview_count: 1, valid_count: 1, error_count: 0, preview_errors: [], default_locale: 'en' }, changed: true, idempotent_replay: false } };
beforeEach(() => { jest.resetAllMocks(); jest.mocked(load).mockResolvedValue(null); jest.mocked(execute).mockResolvedValue(receipt); });
it('loads pending work without replay and only recovers on an explicit action', async () => {
  jest.mocked(load).mockResolvedValue(pending); jest.mocked(recover).mockResolvedValue(receipt);
  const accepted = jest.fn(); const { result } = renderHook(() => useInvitationCampaignOperations(scope, true, true, accepted));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(recover).not.toHaveBeenCalled(); expect(result.current.blocked).toBe(true);
  await act(async () => result.current.submit(intent)); expect(execute).not.toHaveBeenCalled();
  await act(async () => result.current.recover()); expect(recover).toHaveBeenCalledTimes(1); expect(accepted).toHaveBeenCalledWith(receipt);
});
it('reports failed storage and refuses any write', async () => {
  jest.mocked(load).mockRejectedValue(new Error('Storage unavailable'));
  const { result } = renderHook(() => useInvitationCampaignOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.storageFailed).toBe(true));
  await act(async () => result.current.submit(intent)); expect(execute).not.toHaveBeenCalled();
});
it('ignores an obsolete read completing after a newer reload', async () => {
  let finish!: (value: SavedInvitationCampaignOperation | null) => void;
  jest.mocked(load).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useInvitationCampaignOperations(scope, true, true, jest.fn()));
  jest.mocked(load).mockResolvedValue(pending); await act(async () => result.current.reload());
  await act(async () => finish(null)); expect(result.current.saved).toEqual(pending);
});
it.each(['tenantId', 'userId', 'eventId'] as const)('invalidates old callbacks when %s changes', async field => {
  const { result, rerender } = renderHook<ReturnType<typeof useInvitationCampaignOperations>, { owner: typeof scope }>(({ owner }) => useInvitationCampaignOperations(owner, true, true, jest.fn()), { initialProps: { owner: scope } });
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit;
  rerender({ owner: { ...scope, [field]: scope[field] + 1 } });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => old(intent)); expect(execute).not.toHaveBeenCalled();
});
it.each(['active', 'permitted'] as const)('keeps a departed callback invalid after %s is restored', async field => {
  const { result, rerender } = renderHook<ReturnType<typeof useInvitationCampaignOperations>, { active: boolean; permitted: boolean }>(({ active, permitted }) => useInvitationCampaignOperations(scope, permitted, active, jest.fn()),
    { initialProps: { active: true, permitted: true } });
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit;
  rerender({ active: true, permitted: true, [field]: false }); expect(result.current.saved).toBeNull(); expect(result.current.blocked).toBe(true);
  rerender({ active: true, permitted: true }); await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => old(intent)); expect(execute).not.toHaveBeenCalled();
});
it('ignores late success after departure and prevents duplicate taps', async () => {
  let finish!: (value: typeof receipt) => void;
  jest.mocked(execute).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const accepted = jest.fn(); const { result, rerender } = renderHook<ReturnType<typeof useInvitationCampaignOperations>, { active: boolean }>(({ active }) => useInvitationCampaignOperations(scope, true, active, accepted),
    { initialProps: { active: true } });
  await waitFor(() => expect(result.current.ready).toBe(true)); let first!: Promise<void>;
  act(() => { first = result.current.submit(intent); });
  await act(async () => result.current.submit(intent)); expect(execute).toHaveBeenCalledTimes(1);
  const guard = jest.mocked(execute).mock.calls[0][2]; rerender({ active: false }); expect(guard()).toBe(false);
  await act(async () => { finish(receipt); await first; }); expect(accepted).not.toHaveBeenCalled(); expect(result.current.busy).toBe(false);
});
it('refuses callbacks after unmount', async () => {
  const { result, unmount } = renderHook(() => useInvitationCampaignOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit; unmount();
  await old(intent); expect(execute).not.toHaveBeenCalled();
});

it('keeps recovery errors visible after reloading the pending request', async () => {
  jest.mocked(load).mockResolvedValue(pending); jest.mocked(recover).mockRejectedValue(new Error('Offline'));
  const { result } = renderHook(() => useInvitationCampaignOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.recover());
  expect(result.current.operationFailed).toBe(true); expect(result.current.saved).toEqual(pending);
  expect(result.current.busy).toBe(false); expect(result.current.blocked).toBe(true);
});

it('reviews a rejected request explicitly without replaying it', async () => {
  const rejected: SavedInvitationCampaignOperation = { ...scope, schemaVersion: 1, key: 'rejected-key', status: 'rejected',
    intent: { action: 'cancel', campaignId: 12, expectedRevision: 1, reason: 'Synthetic' } };
  jest.mocked(load).mockResolvedValue(rejected);
  const reviewed = jest.fn();
  jest.mocked(review).mockResolvedValue(receipt.data.campaign);
  const { result } = renderHook(() => useInvitationCampaignOperations(scope, true, true, jest.fn(), reviewed));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.blocked).toBe(true);
  await act(async () => result.current.submit(intent));
  await act(async () => result.current.recover());
  expect(execute).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled();
  await act(async () => result.current.review());
  expect(review).toHaveBeenCalledWith(scope, 'rejected-key', expect.any(Function));
  expect(reviewed).toHaveBeenCalledWith(receipt.data.campaign);
});
