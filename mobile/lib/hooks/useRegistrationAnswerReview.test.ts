// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook } from '@testing-library/react-native';
import { reviewOrganizerRegistrationAnswers as review } from '@/lib/api/eventRegistration';
import { useRegistrationAnswerReview } from './useRegistrationAnswerReview';
jest.mock('@/lib/api/eventRegistration', () => ({ reviewOrganizerRegistrationAnswers: jest.fn() }));
const scope = { tenantId: 2, userId: 3, eventId: 4, submissionId: 5, revision: 1 };
const props = { scope, permitted: true, sensitive: true, active: true };
const evidence = { purpose: 'Venue support', correlation_id: 'case-1', include_sensitive: false };
const response = { data: { answers: { support: { question_id: 1, value: 'Synthetic answer', purged: false, classification: 'internal' as const } } } };
const run = (p = props) => renderHook((value: typeof props) => useRegistrationAnswerReview(value.scope, value.permitted, value.sensitive, value.active), { initialProps: p });
const deferred = () => { let resolve!: (value: typeof response) => void; const promise = new Promise<typeof response>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(review).mockResolvedValue(response); });
it('reads only after explicit access and clears previous answers on a new request', async () => {
  const { result } = run(); expect(review).not.toHaveBeenCalled();
  await act(async () => { await result.current.open(evidence); });
  expect(result.current.answers).toEqual(response.data.answers);
  const next = deferred(); jest.mocked(review).mockReturnValue(next.promise);
  let pending!: Promise<void>; act(() => { pending = result.current.open(evidence); });
  expect(result.current.answers).toBeNull(); expect(result.current.status).toBe('loading');
  await act(async () => { next.resolve(response); await pending; });
});
it('blocks duplicate callbacks while the audited request is in flight', async () => {
  const wait = deferred(); jest.mocked(review).mockReturnValue(wait.promise); const { result } = run();
  let first!: Promise<void>; act(() => { first = result.current.open(evidence); void result.current.open(evidence); });
  expect(review).toHaveBeenCalledTimes(1);
  await act(async () => { wait.resolve(response); await first; });
});
it.each([
  { ...props, active: false }, { ...props, permitted: false }, { ...props, sensitive: false },
  { ...props, scope: { ...scope, tenantId: 9 } }, { ...props, scope: { ...scope, userId: 9 } },
  { ...props, scope: { ...scope, submissionId: 9 } }, { ...props, scope: { ...scope, revision: 2 } },
])('discards late results and stale callbacks when access context changes %j', async next => {
  const wait = deferred(); jest.mocked(review).mockReturnValue(wait.promise); const { result, rerender } = run();
  const oldOpen = result.current.open; let pending!: Promise<void>;
  act(() => { pending = oldOpen(evidence); }); rerender(next);
  await act(async () => { await oldOpen(evidence); wait.resolve(response); await pending; });
  expect(review).toHaveBeenCalledTimes(1); expect(result.current.answers).toBeNull(); expect(result.current.status).toBe('idle');
});
it('clears accepted answers on background and never restores them on foreground', async () => {
  const { result, rerender } = run(); await act(async () => { await result.current.open(evidence); });
  rerender({ ...props, active: false }); expect(result.current.answers).toBeNull();
  rerender(props); expect(result.current.answers).toBeNull(); expect(review).toHaveBeenCalledTimes(1);
});
it('refuses sensitive access without its separate permission', async () => {
  const { result } = run({ ...props, sensitive: false });
  await act(async () => { await result.current.open({ ...evidence, include_sensitive: true }); });
  expect(review).not.toHaveBeenCalled();
});
it('clear invalidates pending responses and unmount never retries', async () => {
  const wait = deferred(); jest.mocked(review).mockReturnValue(wait.promise); const { result, unmount } = run();
  let pending!: Promise<void>; act(() => { pending = result.current.open(evidence); result.current.clear(); });
  await act(async () => { wait.resolve(response); await pending; }); expect(result.current.answers).toBeNull();
  unmount(); await act(async () => { await result.current.open(evidence); }); expect(review).toHaveBeenCalledTimes(1);
});
it('shows a failed read without retaining old answers or automatically retrying', async () => {
  const { result } = run(); await act(async () => { await result.current.open(evidence); });
  jest.mocked(review).mockRejectedValue(new Error('unavailable'));
  await act(async () => { await result.current.open(evidence); });
  expect(result.current.status).toBe('failed'); expect(result.current.answers).toBeNull(); expect(review).toHaveBeenCalledTimes(2);
});
