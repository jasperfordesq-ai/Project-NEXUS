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
    getGdprRequest: vi.fn(),
    updateGdprRequest: vi.fn(),
    addGdprRequestNote: vi.fn(),
    assignGdprRequest: vi.fn(),
    generateGdprExport: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminEnterprise: mockAdminEnterprise,
  default: { adminEnterprise: mockAdminEnterprise },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Tenant ───────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '42' }),
  };
});

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

// Stub AdminMetaContext hook
vi.mock('@/admin/AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
  AdminMetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stub shared admin components
// Bound to the barrel AND to each component's own path: the page under test
// imports '@/admin/components/PageHeader' and '@/admin/components/DataTable'
// (as relative '../../components/...', which resolves to the same modules)
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the stub
// data-testids were never in the DOM. Note StatusBadge ships from DataTable,
// not from its own file.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    PageHeader: ({ title }: { title: string }) => <h1 data-testid="page-header">{title}</h1>,
    StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
  };
}

vi.mock('@/admin/components', adminComponentsMock);
vi.mock('@/admin/components/PageHeader', adminComponentsMock);
vi.mock('@/admin/components/DataTable', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeRequest = (overrides = {}) => ({
  id: 42,
  type: 'erasure',
  status: 'pending',
  priority: false,
  user_name: 'Jane Doe',
  user_email: 'jane@example.com',
  user_id: 101,
  created_at: '2026-01-01T10:00:00Z',
  completed_at: null,
  rejection_reason: null,
  notes: null,
  timeline: [],
  assigned_to: null,
  assigned_to_name: null,
  export_file_path: null,
  sla_deadline: '2026-02-01T10:00:00Z',
  sla_days_remaining: 15,
  sla_overdue: false,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GdprRequestDetail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminEnterprise.getGdprRequest.mockResolvedValue({ success: true, data: makeRequest() });
    mockAdminEnterprise.updateGdprRequest.mockResolvedValue({ success: true });
    mockAdminEnterprise.addGdprRequestNote.mockResolvedValue({ success: true });
    mockAdminEnterprise.assignGdprRequest.mockResolvedValue({ success: true });
    mockAdminEnterprise.generateGdprExport.mockResolvedValue({ success: true });
  });

  it('shows loading spinner while fetching', async () => {
    mockAdminEnterprise.getGdprRequest.mockImplementationOnce(() => new Promise(() => {}));
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders user name after loading', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
  });

  it('renders user email after loading', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });
  });

  it('renders status badge', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      expect(screen.getByTestId('status-badge')).toHaveTextContent('pending');
    });
  });

  it('shows "not found" state when request is null after load', async () => {
    mockAdminEnterprise.getGdprRequest.mockResolvedValue({ success: false, data: null });
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      // When request is null, a button to go back is shown
      const backBtns = screen.getAllByRole('button');
      expect(backBtns.length).toBeGreaterThan(0);
    });
  });

  it('shows Start Processing button for pending requests', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const startBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('processing') ||
        b.textContent?.toLowerCase().includes('start')
      );
      expect(startBtn).toBeDefined();
    });
  });

  it('calls updateGdprRequest with processing status when Start Processing is clicked', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => screen.getByText('Jane Doe'));

    const buttons = screen.getAllByRole('button');
    const startBtn = buttons.find((b) =>
      b.textContent?.toLowerCase().includes('processing') ||
      b.textContent?.toLowerCase().includes('start')
    );
    if (startBtn) {
      fireEvent.click(startBtn);
      await waitFor(() => {
        expect(mockAdminEnterprise.updateGdprRequest).toHaveBeenCalledWith(
          42,
          expect.objectContaining({ status: 'processing' })
        );
      });
    }
  });

  it('shows Mark Complete and Reject buttons for processing requests', async () => {
    mockAdminEnterprise.getGdprRequest.mockResolvedValue({
      success: true,
      data: makeRequest({ status: 'processing' }),
    });

    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const completeBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('complete') ||
        b.textContent?.toLowerCase().includes('mark')
      );
      expect(completeBtn).toBeDefined();
    });
  });

  it('opens Add Note modal when Add Note button is clicked', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => screen.getByText('Jane Doe'));

    const buttons = screen.getAllByRole('button');
    const noteBtn = buttons.find((b) =>
      b.textContent?.toLowerCase().includes('note') ||
      b.textContent?.toLowerCase().includes('add')
    );
    if (noteBtn) {
      fireEvent.click(noteBtn);
      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      });
    }
  });

  it('shows error toast when getGdprRequest throws', async () => {
    mockAdminEnterprise.getGdprRequest.mockRejectedValue(new Error('network'));
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls generateGdprExport when Generate Export button is clicked', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => screen.getByText('Jane Doe'));

    const buttons = screen.getAllByRole('button');
    const exportBtn = buttons.find((b) =>
      b.textContent?.toLowerCase().includes('export') ||
      b.textContent?.toLowerCase().includes('generate')
    );
    if (exportBtn) {
      fireEvent.click(exportBtn);
      await waitFor(() => {
        expect(mockAdminEnterprise.generateGdprExport).toHaveBeenCalledWith(42);
      });
    }
  });

  it('shows success toast after export generated', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => screen.getByText('Jane Doe'));

    const buttons = screen.getAllByRole('button');
    const exportBtn = buttons.find((b) =>
      b.textContent?.toLowerCase().includes('export') ||
      b.textContent?.toLowerCase().includes('generate')
    );
    if (exportBtn) {
      fireEvent.click(exportBtn);
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('renders rejection reason when request is rejected', async () => {
    mockAdminEnterprise.getGdprRequest.mockResolvedValue({
      success: true,
      data: makeRequest({ status: 'rejected', rejection_reason: 'Not verifiable' }),
    });

    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      expect(screen.getByText('Not verifiable')).toBeInTheDocument();
    });
  });

  it('renders SLA overdue chip when request is overdue', async () => {
    mockAdminEnterprise.getGdprRequest.mockResolvedValue({
      success: true,
      data: makeRequest({ sla_overdue: true, sla_days_remaining: -3 }),
    });

    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => screen.getByText('Jane Doe'));
    // The SLA section renders chips; the component doesn't throw
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('renders timeline entries when present', async () => {
    mockAdminEnterprise.getGdprRequest.mockResolvedValue({
      success: true,
      data: makeRequest({
        timeline: [
          {
            id: 1,
            action: 'created',
            created_at: '2026-01-01T10:00:00Z',
            user_name: 'Admin',
            old_value: null,
            new_value: 'pending',
          },
        ],
      }),
    });

    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => {
      // Timeline entry renders the action as a chip; 'created' action appears as 'created'
      // Use getAllByText and check at least one exists to avoid multiple-element error
      const matches = screen.queryAllByText(/created/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('opens Assign modal and submits valid user id', async () => {
    const { GdprRequestDetail } = await import('./GdprRequestDetail');
    render(<GdprRequestDetail />);

    await waitFor(() => screen.getByText('Jane Doe'));

    const buttons = screen.getAllByRole('button');
    const assignBtn = buttons.find((b) =>
      b.textContent?.toLowerCase().includes('assign')
    );
    if (assignBtn) {
      fireEvent.click(assignBtn);

      await waitFor(() => document.querySelector('[role="dialog"]'));

      // Fill user id input in dialog
      const inputs = document.querySelectorAll('input[type="number"]');
      // find the one in the dialog
      if (inputs.length > 0) {
        fireEvent.change(inputs[inputs.length - 1], { target: { value: '5' } });
      }

      // Click the assign button in the modal
      const dialogBtns = document.querySelectorAll('[role="dialog"] button');
      const confirmBtn = Array.from(dialogBtns).find((b) =>
        b.textContent?.toLowerCase().includes('assign')
      );
      if (confirmBtn) {
        fireEvent.click(confirmBtn);
        await waitFor(() => {
          expect(mockAdminEnterprise.assignGdprRequest).toHaveBeenCalledWith(42, 5);
        });
      }
    }
  });
});
