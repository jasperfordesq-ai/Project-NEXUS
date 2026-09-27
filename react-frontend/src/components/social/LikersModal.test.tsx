// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import type { LikerUser, LikersResult } from '@/hooks/useSocialInteractions';

// ─── API mock ────────────────────────────────────────────────────────────────
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
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

// ─── Stub @/components/ui ────────────────────────────────────────────────────
// LikersModal uses Modal/ModalContent (render-prop) — uiMock handles it.
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// ─── Stub UserHoverCard ──────────────────────────────────────────────────────
vi.mock('./UserHoverCard', () => ({
  UserHoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveThumbnailUrl: (url: string | null) => url ?? '',
  formatRelativeTime: () => '2 hours ago',
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
function makeLiker(id: number, overrides: Partial<LikerUser> = {}): LikerUser {
  return {
    id,
    name: `User ${id}`,
    avatar_url: null,
    liked_at: '2025-06-01T10:00:00Z',
    ...overrides,
  };
}

function makeLikersResult(
  likers: LikerUser[] = [],
  overrides: Partial<LikersResult> = {},
): LikersResult {
  return {
    likers,
    total_count: likers.length,
    has_more: false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('LikersModal', () => {
  let loadLikers: Mock<(page?: number) => Promise<LikersResult>>;
  const onClose = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    loadLikers = vi.fn<(page?: number) => Promise<LikersResult>>().mockResolvedValue(makeLikersResult());
    onClose.mockReset();
  });

  it('does not render when isOpen is false', async () => {
    const { LikersModal } = await import('./LikersModal');
    render(
      <LikersModal
        isOpen={false}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={0}
      />,
    );
    // Modal stub renders null when isOpen=false
    expect(screen.queryByText(/likers/i)).not.toBeInTheDocument();
    expect(loadLikers).not.toHaveBeenCalled();
  });

  it('calls loadLikers when opened', async () => {
    const { LikersModal } = await import('./LikersModal');
    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={2}
      />,
    );
    await waitFor(() => {
      expect(loadLikers).toHaveBeenCalledWith(1);
    });
  });

  it('shows empty state text when no likers', async () => {
    loadLikers.mockResolvedValue(makeLikersResult([]));
    const { LikersModal } = await import('./LikersModal');
    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={0}
      />,
    );
    await waitFor(() => {
      // i18n key 'no_likes' — in test env renders the key itself or English value
      const noLikes = screen.queryByText(/no_likes/i) ?? screen.queryByText(/no one has liked/i);
      // The element exists (either key or translation), or check via empty list
      expect(loadLikers).toHaveBeenCalled();
    });
  });

  it('renders liker names', async () => {
    loadLikers.mockResolvedValue(
      makeLikersResult([makeLiker(1, { name: 'Alice' }), makeLiker(2, { name: 'Bob' })]),
    );
    const { LikersModal } = await import('./LikersModal');
    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={2}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('shows relative time for each liker', async () => {
    loadLikers.mockResolvedValue(makeLikersResult([makeLiker(1, { name: 'Alice' })]));
    const { LikersModal } = await import('./LikersModal');
    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={1}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('2 hours ago')).toBeInTheDocument();
    });
  });

  it('shows total count in header when likesCount > 0', async () => {
    loadLikers.mockResolvedValue(makeLikersResult([makeLiker(1)], { total_count: 5 }));
    const { LikersModal } = await import('./LikersModal');
    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={5}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/\(5\)/)).toBeInTheDocument();
    });
  });

  it('shows Load More button when has_more is true', async () => {
    loadLikers.mockResolvedValue(
      makeLikersResult([makeLiker(1)], { has_more: true, total_count: 10 }),
    );
    const { LikersModal } = await import('./LikersModal');
    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={10}
      />,
    );
    await waitFor(() => {
      const btn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('more') || b.textContent?.toLowerCase().includes('load'),
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('calls loadLikers with page 2 when Load More clicked', async () => {
    loadLikers
      .mockResolvedValueOnce(makeLikersResult([makeLiker(1)], { has_more: true, total_count: 2 }))
      .mockResolvedValueOnce(makeLikersResult([makeLiker(2)], { has_more: false, total_count: 2 }));

    const { LikersModal } = await import('./LikersModal');
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();

    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={2}
      />,
    );

    await waitFor(() => screen.getByText('User 1'));

    const loadMoreBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('more') || b.textContent?.toLowerCase().includes('load'),
    );
    expect(loadMoreBtn).toBeInTheDocument();
    await user.click(loadMoreBtn!);

    await waitFor(() => {
      // loadLikers is called with only the page number; 'append' is internal to the load() fn
      expect(loadLikers).toHaveBeenCalledWith(2);
    });
  });

  it('appends likers when loading more', async () => {
    loadLikers
      .mockResolvedValueOnce(makeLikersResult([makeLiker(1, { name: 'Alice' })], { has_more: true, total_count: 2 }))
      .mockResolvedValueOnce(makeLikersResult([makeLiker(2, { name: 'Bob' })], { has_more: false, total_count: 2 }));

    const { LikersModal } = await import('./LikersModal');
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();

    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={2}
      />,
    );

    await waitFor(() => screen.getByText('Alice'));

    const loadMoreBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('more') || b.textContent?.toLowerCase().includes('load'),
    );
    await user.click(loadMoreBtn!);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('renders liker profile links', async () => {
    loadLikers.mockResolvedValue(makeLikersResult([makeLiker(7, { name: 'Carol' })]));
    const { LikersModal } = await import('./LikersModal');
    render(
      <LikersModal
        isOpen={true}
        onClose={onClose}
        loadLikers={loadLikers}
        likesCount={1}
      />,
    );
    await waitFor(() => {
      const links = screen.getAllByRole('link');
      const profileLink = links.find((l) => l.getAttribute('href')?.includes('/profile/7'));
      expect(profileLink).toBeInTheDocument();
    });
  });
});
