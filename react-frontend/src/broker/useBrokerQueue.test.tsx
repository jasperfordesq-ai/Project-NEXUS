// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createMockContexts } from '@/test/mock-contexts';

const navigate = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/t${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  }),
);

import { useBrokerQueue } from './useBrokerQueue';

const opts = (fetchQueue: () => Promise<{ ids: number[]; total: number } | null>, currentId = 5) => ({
  currentId,
  fetchQueue,
  itemPath: (id: number) => `/broker/messages/${id}?queue=urgent`,
  listPath: '/broker/messages?status=urgent',
});

describe('useBrokerQueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts the items waiting besides the one on screen and offers the first other one', async () => {
    const { result } = renderHook(() => useBrokerQueue(opts(async () => ({ ids: [5, 8, 9], total: 3 }))));
    await waitFor(() => expect(result.current.nextId).toBe(8));
    expect(result.current.remaining).toBe(2);
  });

  it('after a decision opens the next item in the same queue', async () => {
    // The decided item has left the queue by the time it is read again.
    const { result } = renderHook(() => useBrokerQueue(opts(async () => ({ ids: [8, 9], total: 2 }))));
    await act(async () => { await result.current.goNext(); });
    expect(navigate).toHaveBeenCalledWith('/t/broker/messages/8?queue=urgent');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('when nothing is left, says so and returns to the list', async () => {
    const { result } = renderHook(() => useBrokerQueue(opts(async () => ({ ids: [], total: 0 }))));
    await act(async () => { await result.current.goNext(); });
    expect(toastSuccess).toHaveBeenCalledWith('That was the last one. Nothing else is waiting.');
    expect(navigate).toHaveBeenCalledWith('/t/broker/messages?status=urgent');
  });

  it('if the queue cannot be read, returns to the list without claiming it is empty', async () => {
    const { result } = renderHook(() => useBrokerQueue(opts(async () => { throw new Error('network'); })));
    await act(async () => { await result.current.goNext(); });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/t/broker/messages?status=urgent');
  });
});
