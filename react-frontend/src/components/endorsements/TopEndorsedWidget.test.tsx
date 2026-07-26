// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── API mock ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
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
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── NO barrel mock of '@/components/ui' ──────────────────────────────────────
// TopEndorsedWidget imports Avatar, Chip, GlassCard and Spinner from their DIRECT
// module paths ('@/components/ui/Avatar' etc.), so overrides on the
// '@/components/ui' barrel never apply — the real components load either way.
// Real DOM they emit:
//   GlassCard -> <div class="card card--default glass-card p-4 …" data-slot="card">
//   Chip      -> <span class="chip …" data-slot="chip">
//                  <svg …/><span class="chip__label" data-slot="chip-label">42</span>
//                </span>
//   Avatar    -> <span class="avatar avatar--sm">
//                  <span class="avatar__fallback …" data-slot="avatar-fallback">AS</span>
//                </span>
//                (jsdom never loads images, so the Radix-backed Avatar shows its
//                 initials fallback rather than an <img>)
// The loading state's role="status"/aria-busy comes from the widget's own wrapper
// div, not from Spinner, so the spinner assertion needs no stub.
const CARD = '.glass-card';
const AVATAR = '.avatar';

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null | undefined) => url ?? '',
  formatDateTime: (_date: Date, _opts?: object) => '10:00 AM',
  formatMonthShort: (_date: Date, _upper?: boolean) => 'JAN',
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeMember = (overrides = {}) => ({
  id: 1,
  name: 'Alice Smith',
  avatar_url: null,
  total_endorsements: 15,
  top_skills: ['Gardening', 'Cooking'],
  ...overrides,
});

const makeResponse = (data: object[]) => ({
  success: true,
  data,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TopEndorsedWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: empty list — component renders null
    mockApi.get.mockResolvedValue(makeResponse([]));
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders nothing when members list is empty', async () => {
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    const { container } = render(<TopEndorsedWidget />);

    // Positive precondition: the loading state DOES render a card, so the null
    // assertion below only holds once the empty response has actually landed.
    expect(container.querySelector(CARD)).not.toBeNull();

    await waitFor(() => {
      // GlassCard is not rendered when members.length === 0
      expect(container.querySelector(CARD)).toBeNull();
    });
    expect(mockApi.get).toHaveBeenCalledWith('/v2/members/top-endorsed?limit=5');
  });

  it('calls GET /v2/members/top-endorsed with default limit=5', async () => {
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/members/top-endorsed?limit=5');
    });
  });

  it('calls GET /v2/members/top-endorsed with custom limit', async () => {
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget limit={3} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/members/top-endorsed?limit=3');
    });
  });

  it('renders member names when API returns data', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeMember({ name: 'Bob Jones' })]));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    });
  });

  it('renders endorsement count for each member', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeMember({ total_endorsements: 42 })]));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('renders top skills for a member', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeMember({ top_skills: ['Gardening', 'Cooking'] })]));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      expect(screen.getByText(/Gardening/)).toBeInTheDocument();
    });
  });

  it('handles members with null top_skills gracefully', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeMember({ top_skills: null })]));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      // Still renders the name
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  it('renders multiple members', async () => {
    mockApi.get.mockResolvedValue(makeResponse([
      makeMember({ id: 1, name: 'Alice' }),
      makeMember({ id: 2, name: 'Bob', total_endorsements: 8 }),
    ]));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('each member row is a link to their profile', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeMember({ id: 99 })]));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      const links = screen.getAllByRole('link');
      const profileLink = links.find((l) => l.getAttribute('href')?.includes('/profile/99'));
      expect(profileLink).toBeDefined();
    });
  });

  it('shows 0 endorsements when total_endorsements is undefined', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeMember({ total_endorsements: undefined })]));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  it('renders widget title heading', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeMember()]));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    render(<TopEndorsedWidget />);

    await waitFor(() => {
      // Heading text from i18n key 'most_endorsed' — rendered as real text by test-utils
      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toHaveTextContent('Most Endorsed');
    });
  });

  it('renders avatar for each member', async () => {
    mockApi.get.mockResolvedValue(
      makeResponse([makeMember({ id: 1, name: 'Alice Smith' }), makeMember({ id: 2, name: 'Bob' })])
    );
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    const { container } = render(<TopEndorsedWidget />);

    await waitFor(() => {
      const avatars = Array.from(container.querySelectorAll(AVATAR));
      // Exactly one avatar per member, each showing that member's initials.
      expect(avatars).toHaveLength(2);
      expect(avatars[0]).toHaveTextContent(/^AS$/);
      expect(avatars[1]).toHaveTextContent(/^B$/);
    });
  });

  it('silently handles API failure — renders nothing', async () => {
    mockApi.get.mockRejectedValue(new Error('network error'));
    const { TopEndorsedWidget } = await import('./TopEndorsedWidget');
    const { container } = render(<TopEndorsedWidget />);

    // Positive precondition: the loading card mounted, so the null assertion
    // below proves the rejection actually unwound the widget.
    expect(container.querySelector(CARD)).not.toBeNull();

    await waitFor(() => {
      expect(container.querySelector(CARD)).toBeNull();
    });
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });
});
