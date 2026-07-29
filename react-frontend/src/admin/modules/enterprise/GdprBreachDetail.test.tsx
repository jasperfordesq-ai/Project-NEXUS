// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminEnterprise } = vi.hoisted(() => ({
  mockAdminEnterprise: {
    getGdprBreach: vi.fn(),
    updateGdprBreach: vi.fn(),
    notifyDpa: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: mockAdminEnterprise,
}));

// ─── Mock AdminMetaContext ────────────────────────────────────────────────────
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// ─── Router: preserve hooks but override useParams / useNavigate ──────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useParams: () => ({ id: '42' }),
    useNavigate: () => mockNavigate,
  };
});

// ─── Toast / Tenant ───────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub admin components ────────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader' and '../../components/DataTable'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the stub
// data-testids were never in the DOM.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <span>{title}</span>
        {actions}
      </div>
    ),
    StatusBadge: ({ status }: { status: string }) => (
      <span data-testid="status-badge">{status}</span>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeBreach = (overrides = {}) => ({
  id: 42,
  title: 'Test Breach',
  description: 'Unauthorised access to member data.',
  severity: 'high',
  status: 'open',
  detected_at: '2025-01-01T10:00:00Z',
  occurred_at: '2025-01-01T08:00:00Z',
  reported_at: null,
  contained_at: null,
  resolved_at: null,
  dpa_notified_at: null,
  authority_reference: null,
  number_of_records_affected: 100,
  number_of_users_affected: 50,
  data_categories_affected: ['email', 'name'],
  root_cause: '',
  remediation_actions: '',
  lessons_learned: '',
  prevention_measures: '',
  escalated_at: null,
  ...overrides,
});

const breachRes = (data = makeBreach()) => ({ success: true, data });

// ─────────────────────────────────────────────────────────────────────────────
describe('GdprBreachDetail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminEnterprise.getGdprBreach.mockResolvedValue(breachRes());
    mockAdminEnterprise.updateGdprBreach.mockResolvedValue({ success: true });
    mockAdminEnterprise.notifyDpa.mockResolvedValue({ success: true });
  });

  it('shows loading spinner while breach is fetching', async () => {
    mockAdminEnterprise.getGdprBreach.mockImplementationOnce(() => new Promise(() => {}));
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows not-found message when breach data is null after load', async () => {
    mockAdminEnterprise.getGdprBreach.mockResolvedValueOnce({ success: true, data: null });
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      // "not found" text
      const el = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('back')
      );
      expect(el).toBeDefined();
    });
  });

  it('renders breach description after load', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      expect(screen.getByText('Unauthorised access to member data.')).toBeInTheDocument();
    });
  });

  it('shows status badge', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      expect(screen.getByTestId('status-badge')).toHaveTextContent('open');
    });
  });

  // Asserted by testid and data attribute, not by the chip's visible text: each
  // label comes from t(`enterprise.gdpr_data_category_${cat}`) and no i18n
  // resources load under test, so the rendered text is i18next's missing-key
  // output — which is not the same in an interactive dev session as in CI. The
  // data attribute carries the category the component was actually given.
  it('renders data categories as chips', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    const chips = await waitFor(() => {
      const found = screen.getAllByTestId('data-category-chip');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });

    expect(chips.map((chip) => chip.getAttribute('data-category'))).toEqual(['email', 'name']);
  });

  it('renders records affected and users affected', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
    });
  });

  it('shows "Mark Investigating" button for open breaches', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      const btns = screen.getAllByRole('button');
      const btn = btns.find((b) =>
        b.textContent?.toLowerCase().includes('investigat')
      );
      expect(btn).toBeDefined();
    });
  });

  it('calls updateGdprBreach with investigating status when Mark Investigating clicked', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => screen.getByText('Unauthorised access to member data.'));

    const investigateBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('investigat')
    );
    fireEvent.click(investigateBtn!);

    await waitFor(() => {
      expect(mockAdminEnterprise.updateGdprBreach).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ status: 'investigating' })
      );
    });
  });

  it('shows "Mark Resolved" for non-resolved breaches', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('resolv')
      );
      expect(btn).toBeDefined();
    });
  });

  it('does not show "Mark Resolved" when breach is already resolved', async () => {
    mockAdminEnterprise.getGdprBreach.mockResolvedValueOnce(
      breachRes(makeBreach({ status: 'resolved', resolved_at: '2025-01-02T00:00:00Z' }))
    );
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => screen.getByText('Unauthorised access to member data.'));

    const resolveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().trim() === 'mark resolved' ||
             (b.textContent?.toLowerCase().includes('resolv') && !b.textContent?.toLowerCase().includes('back'))
    );
    // Should not appear since status === 'resolved'
    expect(resolveBtn).toBeUndefined();
  });

  it('shows Notify DPA button when DPA not notified', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('dpa') ||
        b.textContent?.toLowerCase().includes('notify')
      );
      expect(btn).toBeDefined();
    });
  });

  it('calls notifyDpa when Notify DPA is clicked', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => screen.getByText('Unauthorised access to member data.'));

    const notifyBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('notify') ||
      b.textContent?.toLowerCase().includes('dpa')
    );
    fireEvent.click(notifyBtn!);

    await waitFor(() => {
      expect(mockAdminEnterprise.notifyDpa).toHaveBeenCalledWith(42);
    });
  });

  it('shows success toast after DPA notification', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => screen.getByText('Unauthorised access to member data.'));

    const notifyBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('notify') ||
      b.textContent?.toLowerCase().includes('dpa')
    );
    fireEvent.click(notifyBtn!);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('saves response analysis fields via Save button', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => screen.getByText('Unauthorised access to member data.'));

    // Find Save button in response card
    const saveBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtns.length).toBeGreaterThan(0);
    fireEvent.click(saveBtns[0]);

    await waitFor(() => {
      expect(mockAdminEnterprise.updateGdprBreach).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ root_cause: null })
      );
    });
  });

  it('shows error toast when loading breach fails', async () => {
    mockAdminEnterprise.getGdprBreach.mockRejectedValueOnce(new Error('network'));
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('navigates back when Back button is clicked', async () => {
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => screen.getByTestId('page-header'));

    const backBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('back')
    );
    expect(backBtn).toBeDefined();
    fireEvent.click(backBtn!);

    expect(mockNavigate).toHaveBeenCalledWith('/test/admin/enterprise/gdpr/breaches');
  });

  it('shows DPA notified state when dpa_notified_at is set', async () => {
    mockAdminEnterprise.getGdprBreach.mockResolvedValueOnce(
      breachRes(makeBreach({ dpa_notified_at: '2025-01-01T12:00:00Z' }))
    );
    const { GdprBreachDetail } = await import('./GdprBreachDetail');
    render(<GdprBreachDetail />);

    await waitFor(() => {
      // "Notify DPA" button should NOT be present when already notified
      const notifyBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('notify') ||
        b.textContent?.toLowerCase().includes('dpa')
      );
      expect(notifyBtn).toBeUndefined();
    });
  });
});
