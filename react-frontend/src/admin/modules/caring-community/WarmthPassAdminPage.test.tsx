// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── api mock (default import) ─────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  default: mockApi,
  api: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      branding: { name: 'Test', logo_url: null },
      tenantSlug: 'test',
      isLoading: false,
      refreshTenant: vi.fn(),
    }),
  }),
);

// react-router params – no route userId by default
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ userId: undefined }) };
});

// Mock AdminMetaContext (used by sibling pages but not this one directly)
vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

// ── component ─────────────────────────────────────────────────────────────
import { WarmthPassAdminPage } from './WarmthPassAdminPage';

const WARMTH_PASS_DATA = {
  eligible: true,
  tier: 3,
  tier_label: 'Trusted',
  hours_logged: 12,
  reviews_received: 5,
  identity_verified: true,
  member_since: '2023-01-10T00:00:00Z',
  pass_active_since: '2024-03-01T00:00:00Z',
  tenant_name: 'hOUR Timebank',
  member_name: 'Jane Doe',
  categories: ['Gardening', 'Cooking'],
};

describe('WarmthPassAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: get the lookup button by its rendered text "Look up"
  function getLookupBtn() {
    return screen.getByRole('button', { name: /look up/i });
  }

  // ── initial render ───────────────────────────────────────────────────────
  it('renders the lookup form initially', () => {
    render(<WarmthPassAdminPage />);
    expect(getLookupBtn()).toBeInTheDocument();
  });

  it('does not show result or error on initial render', () => {
    render(<WarmthPassAdminPage />);
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  // ── lookup flow ──────────────────────────────────────────────────────────
  it('calls API on lookup and shows result', async () => {
    const user = userEvent.setup();
    mockApi.get.mockResolvedValueOnce({ success: true, data: WARMTH_PASS_DATA });

    render(<WarmthPassAdminPage />);

    const input = screen.getByRole('textbox');
    await user.type(input, '42');

    await user.click(getLookupBtn());

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    expect(mockApi.get).toHaveBeenCalledWith(
      '/v2/admin/caring-community/warmth-pass/42',
    );
  });

  // ── populated state ──────────────────────────────────────────────────────
  it('shows hours logged and categories in result', async () => {
    const user = userEvent.setup();
    mockApi.get.mockResolvedValueOnce({ success: true, data: WARMTH_PASS_DATA });

    render(<WarmthPassAdminPage />);
    const input = screen.getByRole('textbox');
    await user.type(input, '42');
    await user.click(getLookupBtn());

    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.getByText('Gardening')).toBeInTheDocument();
    expect(screen.getByText('Cooking')).toBeInTheDocument();
  });

  it('shows not-eligible chip when eligible=false', async () => {
    const user = userEvent.setup();
    mockApi.get.mockResolvedValueOnce({
      success: true,
      data: { ...WARMTH_PASS_DATA, eligible: false, tier: 1 },
    });

    render(<WarmthPassAdminPage />);
    const input = screen.getByRole('textbox');
    await user.type(input, '1');
    await user.click(getLookupBtn());

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    // tier < 2 → notice card is rendered
    const busyEls = screen.queryAllByRole('status').filter(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(busyEls.length).toBe(0);
  });

  // ── loading state ────────────────────────────────────────────────────────
  it('shows loading spinner while fetching', async () => {
    const user = userEvent.setup();
    // Never resolves
    mockApi.get.mockReturnValue(new Promise(() => {}));

    render(<WarmthPassAdminPage />);
    const input = screen.getByRole('textbox');
    await user.type(input, '5');
    await user.click(getLookupBtn());

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  // ── error state ──────────────────────────────────────────────────────────
  it('shows error message when API returns failure', async () => {
    const user = userEvent.setup();
    mockApi.get.mockResolvedValueOnce({
      success: false,
      error: 'Member not found',
    });

    render(<WarmthPassAdminPage />);
    const input = screen.getByRole('textbox');
    await user.type(input, '99');
    await user.click(getLookupBtn());

    await waitFor(() => {
      expect(screen.getByText(/Member not found/i)).toBeInTheDocument();
    });
  });

  it('shows error message when API throws', async () => {
    const user = userEvent.setup();
    mockApi.get.mockRejectedValueOnce(new Error('Network failure'));

    render(<WarmthPassAdminPage />);
    const input = screen.getByRole('textbox');
    await user.type(input, '99');
    await user.click(getLookupBtn());

    // A thrown exception is deliberately NOT surfaced verbatim — the page shows
    // its own translated "Member lookup failed." rather than leaking a raw JS
    // error message to an admin. This test asserted the raw 'Network failure'
    // text, which the page has never rendered.
    await waitFor(() => {
      expect(screen.getByText(/member not found or an error occurred/i)).toBeInTheDocument();
    });
  });

  // ── Enter key triggers lookup ────────────────────────────────────────────
  it('triggers lookup on Enter key in the input', async () => {
    const user = userEvent.setup();
    mockApi.get.mockResolvedValueOnce({ success: true, data: WARMTH_PASS_DATA });

    render(<WarmthPassAdminPage />);
    const input = screen.getByRole('textbox');
    await user.type(input, '42');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });
  });
});
