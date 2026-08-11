// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLegalGate } from './useLegalGate';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

const pendingDoc = {
  document_id: 1,
  document_type: 'terms',
  title: 'Terms of Service',
  current_version_id: 2,
  current_version: '2.0',
  acceptance_status: 'not_accepted' as const,
  accepted_at: null,
};

describe('useLegalGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
  });

  it('returns hasPending false while auth is loading', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });
    const { result } = renderHook(() => useLegalGate());
    expect(result.current.hasPending).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('returns hasPending false when unauthenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    const { result } = renderHook(() => useLegalGate());
    expect(result.current.hasPending).toBe(false);
    expect(result.current.pendingDocs).toHaveLength(0);
  });

  it('fetches legal status when authenticated', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: true, documents: [pendingDoc] },
    });

    const { result } = renderHook(() => useLegalGate());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPending).toBe(true);
    expect(result.current.pendingDocs).toHaveLength(1);
    expect(result.current.pendingDocs[0].title).toBe('Terms of Service');
  });

  it('filters out documents with current acceptance status', async () => {
    const currentDoc = { ...pendingDoc, acceptance_status: 'current' as const };
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: false, documents: [currentDoc] },
    });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pendingDocs).toHaveLength(0);
  });

  it('fails closed when the status request rejects', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPending).toBe(false);
    expect(result.current.pendingDocs).toHaveLength(0);
    expect(result.current.error).toBe('Network error');
  });

  it('fails closed when the API resolves a failure envelope', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'Server error' });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPending).toBe(false);
    expect(result.current.error).toBe('Server error');
  });

  it('does not gate when the server says it is not enforcing (report mode)', async () => {
    // 🔴 `has_pending` and "will anything stop them?" are different questions.
    // Under LEGAL_ENFORCEMENT_MODE=report the member genuinely owes an acceptance
    // and the server deliberately blocks nobody, because that mode exists to size
    // the blast radius for a week before enforcing. Gating on has_pending alone
    // blocks everybody during exactly the week meant to block nobody.
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: true, enforcement_blocking: false, documents: [pendingDoc] },
    });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPending).toBe(false);
    // The documents are still reported, so a settings page can show "you have
    // outstanding terms" without the modal standing in the member's way.
    expect(result.current.pendingDocs).toHaveLength(1);
  });

  it('gates when the server says it IS enforcing', async () => {
    // The control. Without it, "never gates" would pass as happily as correct.
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: true, enforcement_blocking: true, documents: [pendingDoc] },
    });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPending).toBe(true);
  });

  it('does not gate when every pending document is display-only', async () => {
    // A community can mark a document as shown-but-not-gating
    // (`acceptance_required_for`). The server honours that; the display query behind
    // has_pending deliberately does not, so gating on has_pending alone blocked
    // members over a document the API would never refuse.
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        has_pending: true,
        enforcement_blocking: true,
        blocking_pending: false,
        documents: [pendingDoc],
      },
    });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPending).toBe(false);
    expect(result.current.pendingDocs).toHaveLength(1);
  });

  it('gates when the field is absent — only an explicit false stands down', async () => {
    // Matches web-uk's rule exactly. Absence means an older backend, which cannot
    // happen in practice (client and API ship from one commit), and treating it as
    // "not enforcing" would let a serialisation fault silently drop the prompt.
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: true, documents: [pendingDoc] },
    });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPending).toBe(true);
  });

  it('acceptAll calls post and clears pending state on success', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: true, documents: [pendingDoc] },
    });
    mockApi.post.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.acceptAll();
    });

    expect(mockApi.post).toHaveBeenCalledWith('/v2/legal/acceptance/accept-all', {});
    expect(result.current.hasPending).toBe(false);
    expect(result.current.pendingDocs).toHaveLength(0);
  });

  it('acceptAll sets isAccepting true while posting', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: false, documents: [] },
    });
    let resolvePost: (value: unknown) => void;
    mockApi.post.mockReturnValue(new Promise((r) => { resolvePost = r; }));

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current.acceptAll();
    });

    expect(result.current.isAccepting).toBe(true);

    await act(async () => {
      resolvePost!({ success: true });
    });

    expect(result.current.isAccepting).toBe(false);
  });

  it('preserves pending documents and exposes an error when acceptance fails', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: true, documents: [pendingDoc] },
    });
    mockApi.post.mockResolvedValue({ success: false, error: 'Could not record acceptance' });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.acceptAll();
    });

    expect(result.current.hasPending).toBe(true);
    expect(result.current.pendingDocs).toEqual([pendingDoc]);
    expect(result.current.error).toBe('Could not record acceptance');
  });

  it('refresh triggers a re-fetch', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { has_pending: false, documents: [] },
    });

    const { result } = renderHook(() => useLegalGate());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockApi.get).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  });
});
