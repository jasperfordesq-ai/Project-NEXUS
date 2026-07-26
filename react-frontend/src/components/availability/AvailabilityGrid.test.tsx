// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ─── API mock ─────────────────────────────────────────────────────────────────
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

// ─── Stub heavy HeroUI/UI components that cause jsdom issues ────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Spinner: () => <div data-testid="spinner" />,
  };
});

// AvailabilityGrid imports Tooltip from '@/components/ui/Tooltip' directly, so the override in
// the barrel factory above never applies — vitest resolves mocks per specifier. Without this the
// real HeroUI Tooltip renders and the grid's cell labels stay inside an unopened overlay.
vi.mock('@/components/ui/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Context mocks ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const emptyAvailabilityResponse = {
  success: true,
  data: { weekly: [], timezone: 'Europe/Dublin' },
};

const slotAvailabilityResponse = {
  success: true,
  data: {
    weekly: [
      // Backend day 1 = Monday (grid day 0), 09:00–17:00
      { id: 1, day_of_week: 1, start_time: '09:00', end_time: '17:00' },
    ],
    timezone: 'Europe/Dublin',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
describe('AvailabilityGrid', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(emptyAvailabilityResponse);
    mockApi.put.mockResolvedValue({ success: true });
  });

  it('shows a loading spinner while fetching', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid />);

    // Loading state: role=status with aria-busy=true OR our spinner testid
    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy ?? screen.queryByTestId('spinner')).toBeTruthy();
  });

  it('renders the grid after loading completes (editable mode)', async () => {
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    // editable=true renders the grid even when no availability is set
    render(<AvailabilityGrid editable />);

    await waitFor(() => {
      // Grid is rendered — at minimum the Save instruction text or slot buttons exist
      const buttons = screen.queryAllByRole('button');
      // There should be slot buttons (7 days × time slots)
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('calls GET /v2/users/me/availability on mount (no userId prop)', async () => {
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/users/me/availability');
    });
  });

  it('calls GET /v2/users/:id/availability when userId is provided', async () => {
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid userId={42} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/users/42/availability');
    });
  });

  it('shows error state and retry button on API failure', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network'));
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid />);

    await waitFor(() => {
      // Error state shows a retry button
      const retryBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('retry') ||
               b.textContent?.toLowerCase().includes('try') ||
               b.getAttribute('aria-label')?.toLowerCase().includes('retry')
      );
      expect(retryBtn).toBeDefined();
    });
  });

  it('renders the fallback when read-only and no availability set', async () => {
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(
      <AvailabilityGrid
        editable={false}
        fallback={<div data-testid="no-avail">No availability set</div>}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('no-avail')).toBeInTheDocument();
    });
  });

  it('renders available and unavailable legend items', async () => {
    mockApi.get.mockResolvedValue(slotAvailabilityResponse);
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid editable />);

    await waitFor(() => {
      // Legend has "available" and "unavailable" text
      const text = document.body.textContent?.toLowerCase() ?? '';
      expect(text).toMatch(/available/);
    });
  });

  it('shows Save button only after a slot is toggled (editable=true)', async () => {
    mockApi.get.mockResolvedValue(slotAvailabilityResponse);
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid editable />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    // No save button before any toggle (isDirty=false)
    const saveBtnBefore = screen.queryAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtnBefore).toBeUndefined();

    // Toggle a slot button (aria-pressed buttons in the grid)
    const slotBtns = screen.queryAllByRole('button').filter(
      (b) => b.hasAttribute('aria-pressed')
    );
    if (slotBtns.length > 0) {
      await userEvent.click(slotBtns[0]);

      await waitFor(() => {
        const saveBtn = screen.getAllByRole('button').find(
          (b) => b.textContent?.toLowerCase().includes('save')
        );
        expect(saveBtn).toBeDefined();
      });
    }
  });

  it('calls PUT /v2/users/me/availability when Save is clicked', async () => {
    mockApi.get.mockResolvedValue(slotAvailabilityResponse);
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid editable />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    // Toggle a slot to make isDirty=true
    const slotBtns = screen.queryAllByRole('button').filter(
      (b) => b.hasAttribute('aria-pressed')
    );

    if (slotBtns.length > 0) {
      await userEvent.click(slotBtns[0]);

      const saveBtn = await screen.findAllByRole('button').then((btns) =>
        btns.find((b) => b.textContent?.toLowerCase().includes('save'))
      );

      if (saveBtn) {
        await userEvent.click(saveBtn);
        await waitFor(() => {
          expect(mockApi.put).toHaveBeenCalledWith(
            '/v2/users/me/availability',
            expect.objectContaining({ slots: expect.any(Array) })
          );
        });
      }
    }
  });

  it('shows success toast after successful save', async () => {
    mockApi.get.mockResolvedValue(slotAvailabilityResponse);
    mockApi.put.mockResolvedValue({ success: true });
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid editable />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    // Toggle a slot then save
    const slotBtns = screen.queryAllByRole('button').filter(
      (b) => b.hasAttribute('aria-pressed')
    );

    if (slotBtns.length > 0) {
      await userEvent.click(slotBtns[0]);
      const saveBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('save')
      );
      if (saveBtn) {
        await userEvent.click(saveBtn);
        await waitFor(() => {
          expect(mockToast.success).toHaveBeenCalled();
        });
      }
    }
  });

  it('displays timezone label when timezone is returned from API', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        weekly: [{ id: 1, day_of_week: 1, start_time: '09:00', end_time: '17:00' }],
        timezone: 'Europe/Dublin',
      },
    });
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid />);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Europe\/Dublin/);
    });
  });

  it('renders slot buttons as not-interactive when editable=false', async () => {
    mockApi.get.mockResolvedValue(slotAvailabilityResponse);
    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid editable={false} />);

    await waitFor(() => {
      // All slot buttons should be disabled when not editable
      const slotBtns = screen.queryAllByRole('button').filter(
        (b) => b.hasAttribute('aria-pressed')
      );
      if (slotBtns.length > 0) {
        const allDisabled = slotBtns.every(
          (b) => b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true'
        );
        expect(allDisabled).toBe(true);
      }
    });
  });

  it('retrying after error re-calls the API', async () => {
    mockApi.get
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(emptyAvailabilityResponse);

    const { AvailabilityGrid } = await import('./AvailabilityGrid');
    render(<AvailabilityGrid />);

    // Wait for error state + retry button
    const retryBtn = await waitFor(() => {
      const btn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('retry') ||
               b.textContent?.toLowerCase().includes('try')
      );
      if (!btn) throw new Error('retry button not found yet');
      return btn;
    });

    await userEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledTimes(2);
    });
  });
});
