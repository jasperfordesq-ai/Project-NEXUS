// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useVolunteeringHubSummary } from './useVolunteeringHubSummary';

const list = (items: unknown[], hasMore = false) => ({ success: true, data: items, meta: { cursor: null, has_more: hasMore } });

function answer(routes: Record<string, unknown>) {
  vi.mocked(api.get).mockImplementation((async (endpoint: string) => {
    const hit = Object.entries(routes).find(([prefix]) => endpoint.startsWith(prefix));
    return hit ? hit[1] : list([]);
  }) as unknown as typeof api.get);
}

const ALL = new Set(['opportunities', 'applications', 'hours', 'alerts']);

describe('useVolunteeringHubSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for nothing when the preview is off', () => {
    answer({});
    renderHook(() => useVolunteeringHubSummary({ enabled: false, sections: ALL }));
    expect(api.get).not.toHaveBeenCalled();
  });

  it('never asks about a section the community has switched off', async () => {
    answer({});
    renderHook(() => useVolunteeringHubSummary({ enabled: true, sections: new Set(['opportunities', 'applications']) }));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const urls = vi.mocked(api.get).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(['/v2/volunteering/applications?status=pending&per_page=50']);
  });

  it('picks the soonest shift still to come, whatever order the list is in', async () => {
    answer({
      '/v2/volunteering/shifts': { success: true, data: { items: [
        { start_time: '2099-05-01T10:00:00Z', opportunity_title: 'Later' },
        { start_time: '2020-01-01T10:00:00Z', opportunity_title: 'Past' },
        { start_time: '2099-02-01T10:00:00Z', opportunity_title: 'Soonest' },
      ], cursor: null, has_more: false } },
    });
    const { result } = renderHook(() => useVolunteeringHubSummary({ enabled: true, sections: ALL }));
    await waitFor(() => expect(result.current.nextShift?.title).toBe('Soonest'));
  });

  it('counts only urgent requests still waiting for an answer', async () => {
    answer({
      '/v2/volunteering/emergency-alerts': { success: true, data: { alerts: [
        { my_response: 'pending' }, { my_response: 'accepted' }, { my_response: 'declined' }, { my_response: 'pending' },
      ] } },
    });
    const { result } = renderHook(() => useVolunteeringHubSummary({ enabled: true, sections: ALL }));
    await waitFor(() => expect(result.current.urgentRequests).toBe(2));
  });

  it('marks a full page of pending applications as "more than this"', async () => {
    answer({ '/v2/volunteering/applications?status=pending': list(new Array(50).fill({ status: 'pending' }), true) });
    const { result } = renderHook(() => useVolunteeringHubSummary({ enabled: true, sections: ALL }));
    await waitFor(() => expect(result.current.pendingApplications).toBe(50));
    expect(result.current.pendingApplicationsCapped).toBe(true);
  });

  it('reports whether the member has an approved application, and approved hours', async () => {
    answer({
      '/v2/volunteering/applications?status=approved': list([{ id: 1 }]),
      '/v2/volunteering/hours/summary': { success: true, data: { total_verified: '7.5' } },
    });
    const { result } = renderHook(() => useVolunteeringHubSummary({ enabled: true, sections: ALL }));
    await waitFor(() => expect(result.current.hasApprovedApplication).toBe(true));
    await waitFor(() => expect(result.current.approvedHours).toBe(7.5));
  });

  it('leaves a number blank, without throwing, when its request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useVolunteeringHubSummary({ enabled: true, sections: ALL }));
    await waitFor(() => expect(logError).toHaveBeenCalled());
    expect(result.current.pendingApplications).toBeNull();
    expect(result.current.nextShift).toBeNull();
    expect(result.current.urgentRequests).toBe(0);
  });
});
