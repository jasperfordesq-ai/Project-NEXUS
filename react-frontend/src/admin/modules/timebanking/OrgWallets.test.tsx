// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── vi.hoisted: stable mock references ─────────────────────────────────────
const { mockGetOrgWallets } = vi.hoisted(() => ({
  mockGetOrgWallets: vi.fn(),
}));

// ─── Mock adminTimebanking from adminApi ─────────────────────────────────────
vi.mock('../../api/adminApi', () => ({
  adminTimebanking: {
    getOrgWallets: mockGetOrgWallets,
  },
  adminMatching: { getApprovals: vi.fn() },
  adminSettings: { getFeedAlgorithm: vi.fn(), updateFeedAlgorithm: vi.fn() },
}));

// ─── Mock @/contexts ─────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

// ─── Mock @/hooks ────────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Mock AdminMetaContext — useAdminPageMeta is a side-effect-only hook ─────
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// ─── Mock admin sub-components ───────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable' and '../../components/PageHeader'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the stub
// testids were never in the DOM. A function DECLARATION, not a const: vi.mock
// calls are hoisted above the module body, so a const factory is still
// uninitialised when they run.
async function adminComponentsMock(importOriginal: <T>() => Promise<T>) {
  const { PageHeader: RealPageHeader } = await importOriginal<typeof import('../../components')>();
  return {
    PageHeader: RealPageHeader,
    DataTable: ({
      data,
      isLoading,
      onRefresh,
      emptyContent,
    }: {
      data: unknown[];
      isLoading?: boolean;
      onRefresh?: () => void;
      emptyContent?: React.ReactNode;
    }) => {
      if (isLoading) {
        return (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading"
            data-testid="table-loading"
          />
        );
      }
      if (data.length === 0) {
        return <div data-testid="empty-content">{emptyContent}</div>;
      }
      return (
        <div data-testid="data-table">
          <span data-testid="row-count">{data.length}</span>
          {onRefresh && <button onClick={onRefresh}>Refresh</button>}
        </div>
      );
    },
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

// Need React imported for JSX in mock above
import React from 'react';
import { OrgWallets } from './OrgWallets';

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    org_id: 10,
    org_name: 'Green Helpers',
    balance: 120,
    total_in: 200,
    total_out: 80,
    member_count: 15,
    created_at: '2025-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('OrgWallets — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state (DataTable isLoading) while fetching', () => {
    mockGetOrgWallets.mockReturnValue(new Promise(() => {}));
    render(<OrgWallets />);
    const spinner = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });
});

describe('OrgWallets — populated state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders DataTable with wallet rows when API returns an array', async () => {
    mockGetOrgWallets.mockResolvedValue({
      success: true,
      data: [makeWallet(), makeWallet({ id: 2, org_name: 'Blue Brigade' })],
    });

    render(<OrgWallets />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('row-count').textContent).toBe('2');
  });

  it('renders DataTable when API returns nested { data: [...] } shape', async () => {
    mockGetOrgWallets.mockResolvedValue({
      success: true,
      data: {
        data: [makeWallet(), makeWallet({ id: 2 }), makeWallet({ id: 3 })],
      },
    });

    render(<OrgWallets />);

    await waitFor(() => {
      expect(screen.getByTestId('row-count').textContent).toBe('3');
    });
  });

  it('loading spinner disappears after data arrives', async () => {
    mockGetOrgWallets.mockResolvedValue({
      success: true,
      data: [makeWallet()],
    });

    render(<OrgWallets />);

    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
  });
});

describe('OrgWallets — empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows emptyContent when the wallet list is empty', async () => {
    mockGetOrgWallets.mockResolvedValue({ success: true, data: [] });

    render(<OrgWallets />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-content')).toBeInTheDocument();
    });
  });

  it('does not render data table when list is empty', async () => {
    mockGetOrgWallets.mockResolvedValue({ success: true, data: [] });

    render(<OrgWallets />);

    await waitFor(() => {
      expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
    });
  });
});

describe('OrgWallets — error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls toast.error when API throws', async () => {
    mockGetOrgWallets.mockRejectedValue(new Error('timeout'));

    render(<OrgWallets />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});

describe('OrgWallets — refresh action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-fetches on DataTable refresh', async () => {
    mockGetOrgWallets.mockResolvedValue({
      success: true,
      data: [makeWallet()],
    });

    render(<OrgWallets />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });

    screen.getByRole('button', { name: /refresh/i }).click();

    await waitFor(() => {
      expect(mockGetOrgWallets).toHaveBeenCalledTimes(2);
    });
  });
});
