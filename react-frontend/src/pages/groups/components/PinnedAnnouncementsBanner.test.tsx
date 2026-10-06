// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Member' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// F-568 (E-093): announcements are a plain text box, rendered via MemberPlainText.
// Stub it so we can assert on the text without the real conversion in jsdom.
vi.mock('@/components/ui/MemberPlainText', () => ({
  MemberPlainText: ({ content, className }: { content: string | null | undefined; className?: string }) => (
    <p className={className} data-testid="member-plain-text">{content}</p>
  ),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeAnnouncement = (overrides = {}) => ({
  id: 1,
  title: 'Important update',
  content: 'Please read this announcement.',
  author: { name: 'Admin User' },
  created_at: '2025-01-01T10:00:00Z',
  is_pinned: true,
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('PinnedAnnouncementsBanner', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
  });

  it('renders nothing while the initial request is still loading', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { container } = render(<PinnedAnnouncementsBanner groupId={5} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no pinned announcements', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { container } = render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      // Should return null → no announcement content
      expect(container.querySelector('[data-testid="member-plain-text"]')).toBeNull();
    });
  });

  it('renders nothing when isMember is false', async () => {
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { container } = render(<PinnedAnnouncementsBanner groupId={5} isMember={false} />);
    // Should not call API and render nothing
    await waitFor(() => {
      expect(mockApi.get).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="member-plain-text"]')).toBeNull();
    });
  });

  it('fetches announcements from correct group endpoint', async () => {
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    render(<PinnedAnnouncementsBanner groupId={42} />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        '/v2/groups/42/announcements?pinned=1',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('clears the previous group announcement while the next group loads', async () => {
    let resolveSecond: ((value: { success: boolean; data: object[] }) => void) | undefined;
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/groups/5/')) {
        return Promise.resolve({ success: true, data: [makeAnnouncement({ title: 'Group A notice' })] });
      }
      return new Promise((resolve) => { resolveSecond = resolve; });
    });

    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { rerender } = render(<PinnedAnnouncementsBanner groupId={5} />);
    expect(await screen.findByText('Group A notice')).toBeInTheDocument();

    rerender(<PinnedAnnouncementsBanner groupId={6} />);
    expect(screen.queryByText('Group A notice')).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond?.({ success: true, data: [makeAnnouncement({ title: 'Group B notice' })] });
    });
    expect(await screen.findByText('Group B notice')).toBeInTheDocument();
  });

  it('ignores a late response from the previous group', async () => {
    let resolveFirst: ((value: { success: boolean; data: object[] }) => void) | undefined;
    let firstSignal: AbortSignal | undefined;
    mockApi.get.mockImplementation((url: string, options?: { signal?: AbortSignal }) => {
      if (url.includes('/groups/5/')) {
        firstSignal = options?.signal;
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve({ success: true, data: [makeAnnouncement({ title: 'Group B notice' })] });
    });

    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { rerender } = render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    rerender(<PinnedAnnouncementsBanner groupId={6} />);
    expect(firstSignal?.aborted).toBe(true);
    expect(await screen.findByText('Group B notice')).toBeInTheDocument();

    await act(async () => {
      resolveFirst?.({ success: true, data: [makeAnnouncement({ title: 'Late Group A notice' })] });
    });
    expect(screen.queryByText('Late Group A notice')).not.toBeInTheDocument();
    expect(screen.getByText('Group B notice')).toBeInTheDocument();
  });

  it('renders announcement title when pinned items are returned', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [makeAnnouncement({ title: 'Community event next week' })],
    });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      expect(screen.getByText('Community event next week')).toBeInTheDocument();
    });
  });

  it('renders announcement content as plain text (F-568)', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [makeAnnouncement({ content: 'Check the noticeboard.' })],
    });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      expect(screen.getByTestId('member-plain-text')).toHaveTextContent('Check the noticeboard.');
    });
  });

  it('renders a Pinned chip label', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [makeAnnouncement()],
    });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    // i18n key groups:announcements.pinned → "Pinned" in English
    await waitFor(() => {
      expect(screen.getByText(/pinned/i)).toBeInTheDocument();
    });
  });

  it('renders multiple pinned announcements', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [
        makeAnnouncement({ id: 1, title: 'First notice' }),
        makeAnnouncement({ id: 2, title: 'Second notice' }),
      ],
    });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      expect(screen.getByText('First notice')).toBeInTheDocument();
      expect(screen.getByText('Second notice')).toBeInTheDocument();
    });
  });

  it('handles items returned under announcements key', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { announcements: [makeAnnouncement({ title: 'Nested key item' })] },
    });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      expect(screen.getByText('Nested key item')).toBeInTheDocument();
    });
  });

  it('handles items returned under items key', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { items: [makeAnnouncement({ title: 'Items key result' })] },
    });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      expect(screen.getByText('Items key result')).toBeInTheDocument();
    });
  });

  it('filters out announcements with is_pinned=false', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [
        makeAnnouncement({ id: 1, title: 'Pinned one', is_pinned: true }),
        makeAnnouncement({ id: 2, title: 'Not pinned', is_pinned: false }),
      ],
    });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      expect(screen.getByText('Pinned one')).toBeInTheDocument();
      expect(screen.queryByText('Not pinned')).not.toBeInTheDocument();
    });
  });

  it('silently fails (renders nothing) when API throws', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { container } = render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-testid="member-plain-text"]')).toBeNull();
    });
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('refreshes when the matching group announces a mutation', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({
        success: true,
        data: [makeAnnouncement({ title: 'Freshly pinned notice' })],
      });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { notifyGroupAnnouncementsChanged } = await import('../api/announcements');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledOnce());

    act(() => notifyGroupAnnouncementsChanged(5));

    expect(await screen.findByText('Freshly pinned notice')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledTimes(2);
  });

  it('ignores mutation events for another group', async () => {
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { notifyGroupAnnouncementsChanged } = await import('../api/announcements');
    render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledOnce());

    act(() => notifyGroupAnnouncementsChanged(6));

    await Promise.resolve();
    expect(mockApi.get).toHaveBeenCalledOnce();
  });

  it('silently handles thrown cancellation failures', async () => {
    mockApi.get.mockRejectedValue(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { container } = render(<PinnedAnnouncementsBanner groupId={5} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-testid="member-plain-text"]')).toBeNull();
    });
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('renders nothing when API returns success=false', async () => {
    mockApi.get.mockResolvedValue({ success: false, data: null });
    const { PinnedAnnouncementsBanner } = await import('./PinnedAnnouncementsBanner');
    const { container } = render(<PinnedAnnouncementsBanner groupId={5} />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-testid="member-plain-text"]')).toBeNull();
    });
  });
});
