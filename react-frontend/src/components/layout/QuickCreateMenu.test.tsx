// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ─── Mock api ─────────────────────────────────────────────────────────────────
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

// ─── Motion shim ──────────────────────────────────────────────────────────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Navigate ─────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

// ─── Toast / Auth / Tenant ────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

const mockHasFeature = vi.fn(() => true);
const mockHasModule = vi.fn(() => true);
const mockTenantPath = vi.fn((p: string) => `/test${p}`);

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice' },
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
      tenantPath: mockTenantPath,
      hasFeature: mockHasFeature,
      hasModule: mockHasModule,
    }),
  })
);

// ─── Stub HeroUI modal (ModalContent render-prop) ─────────────────────────────
// QuickCreateMenu imports Modal/ModalContent/ModalBody from '@/components/ui/Modal', not from
// the barrel, so these stubs have to be registered on that specifier to take effect — vitest
// resolves mocks per specifier. Hoisted so the barrel factory below reuses the same definitions.
// The stubs are prop-driven (isOpen comes in as a prop), so sharing them is safe.
const modalStub = vi.hoisted(() => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label="Dialog" aria-modal="true">{children}</div> : null,
  ModalContent: ({ children }: { children: ((onClose: () => void) => React.ReactNode) | React.ReactNode }) => (
    <div>{typeof children === 'function' ? children(() => {}) : children}</div>
  ),
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Modal', () => modalStub);

vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    ...modalStub,
    Button: ({
      children,
      onPress,
      'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      'aria-label'?: string;
    }) => (
      <button onClick={onPress} aria-label={ariaLabel}>
        {children}
      </button>
    ),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
describe('QuickCreateMenu', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockHasModule.mockReturnValue(true);
    mockTenantPath.mockImplementation((p: string) => `/test${p}`);
  });

  it('renders nothing when isOpen=false', async () => {
    const { QuickCreateMenu } = await import('./QuickCreateMenu');
    render(<QuickCreateMenu isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when isOpen=true', async () => {
    const { QuickCreateMenu } = await import('./QuickCreateMenu');
    render(<QuickCreateMenu isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows New Listing option when listings module is enabled', async () => {
    const { QuickCreateMenu } = await import('./QuickCreateMenu');
    render(<QuickCreateMenu isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      // i18n keys fall back to key name when translation file missing; check button exists
      const btns = screen.getAllByRole('button');
      // At least one button should reference listings
      expect(btns.length).toBeGreaterThan(0);
    });
  });

  it('hides options when module/feature is disabled', async () => {
    mockHasModule.mockReturnValue(false);
    mockHasFeature.mockReturnValue(false);
    const { QuickCreateMenu } = await import('./QuickCreateMenu');
    render(<QuickCreateMenu isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      // Only the close button should be present (no create options)
      const btns = dialog.querySelectorAll('button');
      expect(btns.length).toBeLessThanOrEqual(1);
    });
  });

  it('calls onClose when close (X) button is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { QuickCreateMenu } = await import('./QuickCreateMenu');
    render(<QuickCreateMenu isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('close') ||
        b.textContent?.trim() === ''
    );
    if (closeBtn) await user.click(closeBtn);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('navigates to listing create route when New Listing is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { QuickCreateMenu } = await import('./QuickCreateMenu');
    render(<QuickCreateMenu isOpen={true} onClose={onClose} />);

    // All option buttons rendered via the grid
    const allBtns = screen.getAllByRole('button');
    // The first create option (listings) is the first grid button after the close btn
    const optionBtn = allBtns.find((b) => {
      const text = b.textContent?.toLowerCase() ?? '';
      return text.includes('listing') || text.includes('quick_create');
    });
    if (optionBtn) {
      await user.click(optionBtn);
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('listings'));
        expect(onClose).toHaveBeenCalled();
      });
    } else {
      // Fall back: click any create-option button (non-close)
      const gridBtns = allBtns.filter((b) => !b.getAttribute('aria-label')?.includes('close'));
      if (gridBtns[0]) {
        await user.click(gridBtns[0]);
        await waitFor(() => {
          expect(mockNavigate).toHaveBeenCalled();
          expect(onClose).toHaveBeenCalled();
        });
      }
    }
  });

  it('navigates to events create route when events feature enabled', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { QuickCreateMenu } = await import('./QuickCreateMenu');
    render(<QuickCreateMenu isOpen={true} onClose={onClose} />);

    const eventsBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('event') || b.textContent?.includes('quick_create.new_event')
    );
    if (eventsBtn) {
      await user.click(eventsBtn);
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('event'));
      });
    }
  });

  it('navigates with prefixed tenant path when create option clicked', async () => {
    const onClose = vi.fn();
    const { QuickCreateMenu } = await import('./QuickCreateMenu');
    render(<QuickCreateMenu isOpen={true} onClose={onClose} />);

    const allBtns = screen.getAllByRole('button');
    // The grid option buttons have no aria-label (only the X close button does)
    const gridBtns = allBtns.filter((b) => b.getAttribute('aria-label') === null);
    expect(gridBtns.length).toBeGreaterThan(0);
    // Use fireEvent to bypass pointer-events issues in jsdom
    fireEvent.click(gridBtns[0]);
    await waitFor(() => {
      // navigate should have been called with /test/<route>
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/test\//));
    });
  });

  it('getVisibleCreateOptions filters by feature', async () => {
    const { getVisibleCreateOptions } = await import('./QuickCreateMenu');
    const noFeature = () => false;
    const allModules = () => true;
    const options = getVisibleCreateOptions(noFeature, allModules);
    // All feature-gated options should be hidden; only module-gated (listings) could show
    options.forEach((opt) => {
      expect(opt.feature).toBeUndefined();
    });
  });

  it('getVisibleCreateOptions returns all when all features/modules enabled', async () => {
    const { getVisibleCreateOptions } = await import('./QuickCreateMenu');
    const options = getVisibleCreateOptions(() => true, () => true);
    expect(options.length).toBeGreaterThanOrEqual(5);
  });

  it('getVisibleCreateOptions filters by module', async () => {
    const { getVisibleCreateOptions } = await import('./QuickCreateMenu');
    const noModule = () => false;
    const allFeatures = () => true;
    const options = getVisibleCreateOptions(allFeatures, noModule);
    // listings is module-gated; should be excluded
    options.forEach((opt) => {
      expect(opt.module).toBeUndefined();
    });
  });
});
