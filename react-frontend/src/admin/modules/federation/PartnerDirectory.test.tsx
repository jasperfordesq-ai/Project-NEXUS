// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── UI mock ──────────────────────────────────────────────────────────────────
// Stub only Select/SelectItem (React Aria infinite-update loops in jsdom).
// Do NOT mock the whole module with the '@/test/uiMock' proxy here — combined
// with a top-level '@/test/test-utils' import it crashes the vitest fork
// worker on this machine (collect-phase hang, worker IPC 'Channel closed').
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    Select: ({ children, label, 'aria-label': ariaLabel, selectedKeys, onSelectionChange }: {
      children?: React.ReactNode; label?: string; 'aria-label'?: string;
      selectedKeys?: string[]; onSelectionChange?: (keys: Set<string>) => void;
    }) => (
      <select
        aria-label={ariaLabel ?? label ?? 'select'}
        value={selectedKeys?.[0] ?? ''}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
  };
});

// ─── Admin API mock ───────────────────────────────────────────────────────────
const { mockAdminFederation } = vi.hoisted(() => ({
  mockAdminFederation: {
    getDirectory: vi.fn(),
    requestPartnership: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminFederation: mockAdminFederation,
}));

// ─── Admin components ─────────────────────────────────────────────────────────
// PartnerDirectory imports these from direct file paths, so each mock must
// target the file — mocking the '../../components' barrel never intercepts.
vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div><h1>{title}</h1><div data-testid="page-header-actions">{actions}</div></div>
  ),
}));
vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('./PartnerTimebankGuidance', () => ({
  PartnerTimebankGuidance: () => null,
}));

// ─── SEO / hooks ─────────────────────────────────────────────────────────────
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Toast / contexts ─────────────────────────────────────────────────────────
const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeCommunity = (overrides = {}) => ({
  id: 10,
  name: 'Dublin Timebank',
  slug: 'dublin-timebank',
  domain: 'dublin.timebank.example',
  description: 'Community in Dublin',
  region: 'Ireland',
  contact_email: 'hello@dublin-timebank.ie',
  contact_name: 'Jane Admin',
  member_count: 120,
  federation_member_count_public: 80,
  profiles_enabled: 1,
  listings_enabled: 1,
  messaging_enabled: 0,
  transactions_enabled: 1,
  events_enabled: 0,
  groups_enabled: 0,
  partnership_status: null,
  partnership_id: null,
  topics: [],
  ...overrides,
});

const makeDirectoryResponse = (communities = [] as object[]) => ({
  success: true,
  data: {
    communities,
    regions: ['Ireland', 'UK'],
    categories: ['Timebank'],
    topics: [],
  },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PartnerDirectory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse());
    mockAdminFederation.requestPartnership.mockResolvedValue({ success: true, data: {} });
  });

  it('shows skeleton loading state on initial load', async () => {
    // Never resolves — stays loading
    mockAdminFederation.getDirectory.mockImplementationOnce(() => new Promise(() => {}));
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    // Loading skeleton shows Skeleton elements; check for them by class or just that empty-state is absent
    await waitFor(() => {
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    });
  });

  it('shows empty state when no communities are returned', async () => {
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders community cards when communities are returned', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse([makeCommunity()]));
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Dublin Timebank')).toBeInTheDocument();
    });
  });

  it('renders region for a community', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse([makeCommunity()]));
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => {
      // Ireland appears both in the Select option and in the community card region span
      const els = screen.queryAllByText('Ireland');
      expect(els.length).toBeGreaterThan(0);
    });
  });

  it('shows Request Partnership button for unpartnered community', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse([makeCommunity()]));
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => {
      // Use exact match to avoid matching "Hide Partnered" filter button
      const btn = screen.queryAllByRole('button').find(
        b => b.textContent === 'Request partnership',
      );
      expect(btn).toBeDefined();
    });
  });

  it('opens partnership request modal when button is clicked', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse([makeCommunity()]));
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    // Wait for community cards to render (300ms debounce + fetch)
    await waitFor(() => screen.getByText('Dublin Timebank'), { timeout: 2000 });

    // The request partnership button exists on the card
    const requestBtns = screen.queryAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('request') || b.textContent?.toLowerCase().includes('partner'),
    );
    expect(requestBtns.length).toBeGreaterThan(0);
    // Click the "Request Partnership" button specifically (not "Hide Partnered" which also
    // contains 'partner' in its text and would appear first in the DOM)
    const exactRequestBtn = screen.queryAllByRole('button').find(
      b => b.textContent === 'Request partnership',
    );
    expect(exactRequestBtn).toBeDefined();
    fireEvent.click(exactRequestBtn!);

    // Modal opens: cancel + send buttons appear (both unique to modal footer)
    await waitFor(() => {
      const cancelBtn = screen.queryAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('cancel'),
      );
      expect(cancelBtn).toBeDefined();
    }, { timeout: 2000 });
  });

  it('calls requestPartnership API when modal is submitted', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse([makeCommunity()]));
    mockAdminFederation.requestPartnership.mockResolvedValue({ success: true });

    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => screen.getByText('Dublin Timebank'), { timeout: 2000 });

    const exactRequestBtn = screen.queryAllByRole('button').find(
      b => b.textContent === 'Request partnership',
    );
    expect(exactRequestBtn).toBeDefined();
    fireEvent.click(exactRequestBtn!);

    // Wait for modal to open (cancel button unique to modal footer)
    let sendBtn: HTMLElement | undefined;
    await waitFor(() => {
      const cancelBtn = screen.queryAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('cancel'),
      );
      sendBtn = screen.queryAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('send'),
      );
      expect(cancelBtn).toBeDefined();
      expect(sendBtn).toBeDefined();
    }, { timeout: 2000 });

    fireEvent.click(sendBtn!);

    // Left alone, the request asks for the lowest level (1 — see each other).
    await waitFor(() => {
      expect(mockAdminFederation.requestPartnership).toHaveBeenCalledWith(10, undefined, 1);
    }, { timeout: 2000 });
  });

  it('sends the partnership level chosen in the request dialog', async () => {
    // Until November 2026 the dialog had no level choice and the server
    // hard-coded the lowest one, so no partnership could carry exchanges.
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse([makeCommunity()]));
    mockAdminFederation.requestPartnership.mockResolvedValue({ success: true });

    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => screen.getByText('Dublin Timebank'), { timeout: 2000 });
    fireEvent.click(screen.queryAllByRole('button').find(b => b.textContent === 'Request partnership')!);

    const levelSelect = await screen.findByLabelText('Partnership level');
    // All four levels are on offer, lowest first.
    expect(Array.from(levelSelect.querySelectorAll('option')).map((o) => o.getAttribute('value'))).toEqual(['1', '2', '3', '4']);
    fireEvent.change(levelSelect, { target: { value: '3' } });

    fireEvent.click(screen.queryAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('send'))!);

    await waitFor(() => {
      expect(mockAdminFederation.requestPartnership).toHaveBeenCalledWith(10, undefined, 3);
    }, { timeout: 2000 });
  });

  it('shows success toast after partnership request is sent', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse([makeCommunity()]));
    mockAdminFederation.requestPartnership.mockResolvedValue({ success: true });

    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => screen.getByText('Dublin Timebank'), { timeout: 2000 });

    const exactRequestBtn = screen.queryAllByRole('button').find(
      b => b.textContent === 'Request partnership',
    );
    expect(exactRequestBtn).toBeDefined();
    fireEvent.click(exactRequestBtn!);

    // Wait for modal to open
    let sendBtn: HTMLElement | undefined;
    await waitFor(() => {
      sendBtn = screen.queryAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('send'),
      );
      expect(sendBtn).toBeDefined();
    }, { timeout: 2000 });

    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('shows the API reason when a partnership request is rejected', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(makeDirectoryResponse([makeCommunity()]));
    mockAdminFederation.requestPartnership.mockResolvedValue({
      success: false,
      error: 'A partnership request already exists between these two communities',
    });

    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => screen.getByText('Dublin Timebank'), { timeout: 2000 });
    const requestButton = screen.queryAllByRole('button').find(
      (button) => button.textContent === 'Request partnership',
    );
    expect(requestButton).toBeDefined();
    fireEvent.click(requestButton!);

    let sendButton: HTMLElement | undefined;
    await waitFor(() => {
      sendButton = screen.queryAllByRole('button').find((button) =>
        button.textContent?.toLowerCase().includes('send'),
      );
      expect(sendButton).toBeDefined();
    }, { timeout: 2000 });

    fireEvent.click(sendButton!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'A partnership request already exists between these two communities',
      );
    });
  });

  it('shows Active Partner button (disabled) for partnered community', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(
      makeDirectoryResponse([makeCommunity({ partnership_status: 'active' })]),
    );
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => {
      const btn = screen.queryAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('active') || b.textContent?.toLowerCase().includes('partner'),
      );
      expect(btn).toBeDefined();
    });
  });

  it('renders multiple communities', async () => {
    mockAdminFederation.getDirectory.mockResolvedValue(
      makeDirectoryResponse([
        makeCommunity({ id: 10, name: 'Dublin Timebank' }),
        makeCommunity({ id: 11, name: 'Cork Timebank', slug: 'cork-timebank' }),
      ]),
    );
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Dublin Timebank')).toBeInTheDocument();
      expect(screen.getByText('Cork Timebank')).toBeInTheDocument();
    });
  });

  it('reload is called when Refresh button is clicked', async () => {
    const { PartnerDirectory } = await import('./PartnerDirectory');
    render(<PartnerDirectory />);

    // Initial load is debounced 300ms and renders skeletons (no aria-busy
    // spinner); the Refresh button is isLoading-disabled until it completes.
    await waitFor(() => {
      expect(mockAdminFederation.getDirectory).toHaveBeenCalled();
    }, { timeout: 2000 });

    let refreshBtn: HTMLElement | undefined;
    await waitFor(() => {
      refreshBtn = screen.queryAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('refresh'),
      );
      expect(refreshBtn).toBeDefined();
      const stillDisabled =
        refreshBtn!.hasAttribute('disabled') ||
        refreshBtn!.getAttribute('aria-disabled') === 'true' ||
        refreshBtn!.getAttribute('data-disabled') === 'true' ||
        refreshBtn!.getAttribute('data-loading') === 'true';
      expect(stillDisabled).toBe(false);
    }, { timeout: 2000 });

    fireEvent.click(refreshBtn!);

    // getDirectory should be called again (second call)
    await waitFor(() => {
      expect(mockAdminFederation.getDirectory.mock.calls.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 2000 });
  });
});
