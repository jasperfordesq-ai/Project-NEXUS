// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  API_BASE: '/api',
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (v: string | null) => v ?? '',
  formatDateTime: (v: string) => v,
}));

// Static import after all mocks are declared
import { api } from '@/lib/api';
import MemberSpotlightTab from './MemberSpotlightTab';

const SPOTLIGHT_MEMBERS = [
  {
    id: 1,
    first_name: 'Alice',
    last_name: 'Smith',
    avatar_url: null,
    bio: 'Community champion',
    member_since: '2024-01',
    level: 5,
    xp: 1200,
    recent_activity: 'Helped 3 members',
  },
  {
    id: 2,
    first_name: 'Bob',
    last_name: 'Jones',
    avatar_url: null,
    bio: null,
    member_since: null,
    level: 3,
    xp: 0,
    recent_activity: 'Joined a group',
  },
];

describe('MemberSpotlightTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeleton grid while loading', () => {
    // Never resolves — component stays in loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    const { container } = render(<MemberSpotlightTab />);

    // During loading a grid with 3 skeleton GlassCards is rendered
    const grid = container.querySelector('.grid');
    expect(grid).not.toBeNull();
  });

  it('renders member cards after successful load', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: SPOTLIGHT_MEMBERS,
    });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    });
  });

  it('renders member recent activity', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: SPOTLIGHT_MEMBERS,
    });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      expect(screen.getByText('Helped 3 members')).toBeInTheDocument();
    });
  });

  it('renders bio when available', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: SPOTLIGHT_MEMBERS,
    });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      expect(screen.getByText('Community champion')).toBeInTheDocument();
    });
  });

  it('renders XP when xp > 0', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: SPOTLIGHT_MEMBERS,
    });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      expect(screen.getByText(/1,200 XP/)).toBeInTheDocument();
    });
  });

  it('does not render XP line for members with xp = 0', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [SPOTLIGHT_MEMBERS[1]], // Bob has xp: 0
    });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    });
    // xp of 0 should not render the XP span
    expect(screen.queryByText(/0 XP/)).not.toBeInTheDocument();
  });

  it('renders member profile links', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: SPOTLIGHT_MEMBERS,
    });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      const links = screen.getAllByRole('link');
      const aliceLink = links.find((l) => l.getAttribute('href') === '/test/members/1');
      expect(aliceLink).toBeDefined();
    });
  });

  it('shows empty state when API returns empty array', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [],
    });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      // No member cards — no profile links present
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  it('shows an error state (not the empty state) when the load fails', async () => {
    // Regression: a failed load (api.get resolves { success:false } without throwing)
    // used to fall through to the "No Spotlight Yet" empty state, so a server/connection
    // failure was indistinguishable from a genuinely empty community. It must now show a
    // distinct error message. Verified live by shimming the spotlight request to fail.
    vi.mocked(api.get).mockResolvedValueOnce({
      success: false,
      error: 'Server error',
    });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      // The error card renders a danger-coloured message.
      expect(document.querySelector('.text-danger-soft-foreground')).not.toBeNull();
    });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    // It must NOT be the empty state.
    expect(screen.queryByText(/No Spotlight Yet|spotlight\.empty_title/i)).not.toBeInTheDocument();
  });

  it('calls the correct API endpoint with limit param', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [] });

    render(<MemberSpotlightTab />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/gamification/member-spotlight')
      );
    });
  });
});
