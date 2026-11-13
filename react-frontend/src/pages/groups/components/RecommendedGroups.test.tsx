// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for RecommendedGroups
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveThumbnailUrl: (url: string | null) => url || '',
  };
});

let isAuthenticated = true;
const stableToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenant = {
  tenantPath: (p: string) => `/test${p}`,
};

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated })),
  useToast: vi.fn(() => stableToast),
  useTenant: vi.fn(() => stableTenant),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated })),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => stableToast),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => stableTenant),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);
// The real Avatar paints its picture only after load, which jsdom never does.
// This stub keeps its alt rule (alt, else the name) so the passed alt is visible.
vi.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ src, alt, name }: { src?: string; alt?: string; name?: string | null }) =>
    src ? <img src={src} alt={alt ?? name ?? ''} /> : <span data-testid="avatar-fallback" />,
}));

import { RecommendedGroups } from './RecommendedGroups';

describe('RecommendedGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAuthenticated = true;
    mockApiPost.mockResolvedValue({
      success: true,
      data: { status: 'active', message: 'Joined group' },
    });
  });

  it('renders nothing when the user is not authenticated', () => {
    isAuthenticated = false;
    const { container } = render(<RecommendedGroups />);
    expect(container).toBeEmptyDOMElement();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('renders nothing when the API call fails', async () => {
    mockApiGet.mockResolvedValue({ success: false });
    const { container } = render(<RecommendedGroups />);
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no group matches', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { matches: [] } });
    const { container } = render(<RecommendedGroups />);
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders up to 3 recommended groups with a score chip', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        matches: [
          { module: 'group', group_id: 1, title: 'Garden Crew', match_score: 82, match_reasons: ['Shared interest in gardening'] },
          { module: 'group', group_id: 2, title: 'Book Club', match_score: 71 },
        ],
      },
    });
    render(<RecommendedGroups />);
    await waitFor(() => {
      expect(screen.getByText('Garden Crew')).toBeInTheDocument();
    });
    expect(screen.getByText('Book Club')).toBeInTheDocument();
    expect(mockApiGet).toHaveBeenCalledWith(
      '/v2/matches/all?modules=groups&limit=3&min_score=50',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reads out the description written for a recommended group picture', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        matches: [
          { module: 'group', group_id: 1, title: 'Garden Crew', match_score: 82, image_url: '/g.jpg', image_alt: 'Three people planting leeks' },
          { module: 'group', group_id: 2, title: 'Book Club', match_score: 71, image_url: '/b.jpg', image_alt: null },
        ],
      },
    });
    render(<RecommendedGroups />);

    expect(await screen.findByRole('img', { name: 'Three people planting leeks' })).toBeInTheDocument();
    // Nothing written: the Avatar keeps its usual label, the group name.
    expect(screen.getByRole('img', { name: 'Book Club' })).toBeInTheDocument();
  });

  it('marks a recommendation joined only after a truthful join response', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        matches: [{ module: 'group', group_id: 1, title: 'Garden Crew', match_score: 82 }],
      },
    });
    render(<RecommendedGroups />);

    fireEvent.click(await screen.findByRole('button', { name: /^Join$/i }));

    await waitFor(() => expect(stableToast.success).toHaveBeenCalledWith('Joined group'));
    expect(mockApiPost).toHaveBeenCalledWith('/v2/groups/1/join', {});
    expect(screen.queryByRole('button', { name: /^Join$/i })).not.toBeInTheDocument();
  });

  it('reports a pending private-group join as a request, not a completed join', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        matches: [{ module: 'group', group_id: 2, title: "Private group", match_score: 76 }],
      },
    });
    mockApiPost.mockResolvedValue({
      success: true,
      data: { status: 'pending', message: 'Request sent' },
    });
    render(<RecommendedGroups />);

    fireEvent.click(await screen.findByRole('button', { name: /^Join$/i }));

    await waitFor(() => expect(stableToast.success).toHaveBeenCalledWith('Join request submitted'));
    expect(stableToast.success).not.toHaveBeenCalledWith('Joined group');
  });

  it('keeps the Join action available when the API resolves with success:false', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        matches: [{ module: 'group', group_id: 1, title: 'Garden Crew', match_score: 82 }],
      },
    });
    mockApiPost.mockResolvedValue({
      success: false,
      code: 'HTTP_500',
      error: 'Raw server copy',
    });
    render(<RecommendedGroups />);

    fireEvent.click(await screen.findByRole('button', { name: /^Join$/i }));

    await waitFor(() => expect(stableToast.error).toHaveBeenCalled());
    expect(stableToast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Join$/i })).toBeInTheDocument();
    expect(screen.queryByText('Raw server copy')).not.toBeInTheDocument();
  });
});
