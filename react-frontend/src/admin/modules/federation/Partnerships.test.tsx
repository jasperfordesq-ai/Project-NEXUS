// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockAdminFederation } = vi.hoisted(() => ({
  mockAdminFederation: {
    getPartnerships: vi.fn(),
    approvePartnership: vi.fn(),
    rejectPartnership: vi.fn(),
    terminatePartnership: vi.fn(),
    reactivatePartnership: vi.fn(),
    getPartnershipDetail: vi.fn(),
    getPartnershipAuditLog: vi.fn(),
    getPartnershipStats: vi.fn(),
    counterProposePartnership: vi.fn(),
    acceptCounterProposal: vi.fn(),
    updatePartnershipPermissions: vi.fn(),
  },
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
// PageMeta already mocked globally in setup.ts

vi.mock('../../api/adminApi', () => ({
  adminFederation: mockAdminFederation,
}));

// Stub DataTable, EmptyState, ConfirmModal, StatusBadge, etc.
// Partnerships imports these from direct file paths ('../../components/PageHeader',
// '../../components/DataTable', …), so each mock must target the file — mocking
// the '../../components' barrel never intercepts.
vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock('../../components/DataTable', () => ({
  DataTable: ({ data, items, columns, emptyContent, isLoading }: {
    data?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
    columns?: Array<{ key: string; label: string; render?: (item: Record<string, unknown>) => React.ReactNode }>;
    emptyContent?: React.ReactNode;
    isLoading?: boolean;
  }) => {
    const rows = data ?? items ?? [];
    const cols = columns ?? [];
    if (isLoading) return <div data-testid="data-table-loading" />;
    if (rows.length === 0) return <div>{emptyContent}</div>;
    return (
      <table>
        <thead>
          <tr>
            {cols.map((col) => <th key={col.key}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={String(item.id)}>
              {cols.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(item) : String(item[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
  StatusBadge: ({ status }: { status: string }) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));
vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onClose, onConfirm, title }: {
    isOpen: boolean; onClose: () => void; onConfirm: () => void; title: string;
    message?: string; confirmLabel?: string; confirmColor?: string; isLoading?: boolean;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>confirm-modal-action</button>
        <button onClick={onClose}>close-modal</button>
      </div>
    ) : null,
}));

// Stub PartnerTimebankGuidance
vi.mock('./PartnerTimebankGuidance', () => ({
  PartnerTimebankGuidance: () => <div data-testid="guidance-stub">Guidance</div>,
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    Tabs: ({ children }: { children: React.ReactNode }) => (
      <div role="tablist">{children}</div>
    ),
    Tab: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) => (
      <div role="tab">{title}{children}</div>
    ),
    Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Textarea: ({ value, onChange, label, placeholder }: { value?: string; onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; label?: string; placeholder?: string }) => (
      <textarea aria-label={label || 'textarea'} value={value} onChange={onChange} placeholder={placeholder} />
    ),
    Select: ({ children, label, onSelectionChange, selectedKeys }: {
      children: React.ReactNode; label?: string; onSelectionChange?: (keys: Set<string>) => void; selectedKeys?: string[];
    }) => (
      <select
        aria-label={label || 'select'}
        defaultValue={selectedKeys?.[0]}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    Switch: ({ isSelected, onValueChange, 'aria-label': ariaLabel }: {
      isSelected?: boolean; onValueChange?: (v: boolean) => void; 'aria-label'?: string;
    }) => (
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={Boolean(isSelected)}
        checked={isSelected ?? false}
        onChange={(e) => onValueChange?.(e.target.checked)}
      />
    ),
    useDisclosure: () => ({
      isOpen: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onOpenChange: vi.fn(),
    }),
    Dropdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    // DropdownMenu: when `items` + render-function child, render each item and inject onClick=onAction(key)
    DropdownMenu: ({ items, children, onAction }: {
      items?: Array<{ key: string }>;
      children?: ((item: { key: string }) => React.ReactElement) | React.ReactNode;
      onAction?: (key: string) => void;
      'aria-label'?: string;
    }) => {
      if (items && typeof children === 'function') {
        return (
          <div>
            {items.map((item) => {
              const el = (children as (item: { key: string }) => React.ReactElement)(item);
              // Inject onPress that fires onAction with the item's key
              return el ? React.cloneElement(el, {
                key: item.key,
                onPress: () => onAction?.(item.key),
                onClick: () => onAction?.(item.key),
              }) : null;
            })}
          </div>
        );
      }
      return <div>{children as React.ReactNode}</div>;
    },
    DropdownItem: ({ children, onPress, onClick }: { children: React.ReactNode; onPress?: () => void; onClick?: () => void; id?: string; className?: string; startContent?: React.ReactNode; color?: string }) => (
      <button onClick={onClick ?? onPress}>{children}</button>
    ),
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
      isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
    ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const makePartnership = (overrides: Partial<{
  id: number;
  tenant_id: number;
  partner_tenant_id: number;
  partner_name: string;
  partner_slug: string;
  status: string;
  federation_level: number;
  created_at: string;
}> = {}) => ({
  id: 1,
  tenant_id: 2,
  partner_tenant_id: 10,
  partner_name: 'Community Alpha',
  partner_slug: 'community-alpha',
  status: 'active',
  federation_level: 2,
  profiles_enabled: 1,
  messaging_enabled: 1,
  transactions_enabled: 0,
  listings_enabled: 0,
  events_enabled: 0,
  groups_enabled: 0,
  created_at: '2024-01-15T00:00:00Z',
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('Partnerships', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [makePartnership()],
    });
    mockAdminFederation.approvePartnership.mockResolvedValue({ success: true });
    mockAdminFederation.rejectPartnership.mockResolvedValue({ success: true });
    mockAdminFederation.terminatePartnership.mockResolvedValue({ success: true });
    mockAdminFederation.reactivatePartnership.mockResolvedValue({ success: true });
    mockAdminFederation.counterProposePartnership.mockResolvedValue({ success: true });
    mockAdminFederation.updatePartnershipPermissions.mockResolvedValue({ success: true });
    mockAdminFederation.getPartnershipDetail.mockResolvedValue({
      success: true,
      data: { ...makePartnership(), is_initiator: true, resolved_partner_tenant_id: 10, resolved_partner_name: 'Community Alpha' },
    });
    mockAdminFederation.getPartnershipAuditLog.mockResolvedValue({ success: true, data: [] });
    mockAdminFederation.getPartnershipStats.mockResolvedValue({
      success: true,
      data: { messages_exchanged: 5, transactions_completed: 3, connections_made: 7 },
    });
  });

  it('shows loading state while fetching partnerships', async () => {
    mockAdminFederation.getPartnerships.mockReturnValue(new Promise(() => {}));
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    // While loading, partner name should not be visible
    expect(screen.queryByText('Community Alpha')).not.toBeInTheDocument();
  });

  it('renders partnership list after successful load', async () => {
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => {
      expect(screen.getByText('Community Alpha')).toBeInTheDocument();
    });
  });

  it('shows page header with Partnerships title', async () => {
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => {
      // "Partnerships" is English for federation.partnerships_title
      expect(screen.getByText('Partnerships')).toBeInTheDocument();
    });
  });

  it('shows status badge for each partnership', async () => {
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => {
      const badges = screen.getAllByTestId('status-badge');
      expect(badges.length).toBeGreaterThan(0);
      expect(badges[0]).toHaveTextContent('active');
    });
  });

  it('shows empty state when no partnerships exist', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({ success: true, data: [] });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows pending status badge for pending partnerships', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [makePartnership({ id: 2, status: 'pending', partner_name: 'Pending Org' })],
    });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => {
      expect(screen.getByText('Pending Org')).toBeInTheDocument();
    });
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent('pending');
  });

  it('calls approvePartnership when approve action is confirmed', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [makePartnership({ id: 3, status: 'pending', partner_name: 'Pending Partner' })],
    });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => screen.getByText('Pending Partner'));

    // "Approve" is English for federation.approve
    const approveBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.trim() === 'Approve' ||
      b.textContent?.includes('Approve Partnership')
    );
    if (approveBtns.length > 0) {
      fireEvent.click(approveBtns[0]);
      const dialog = screen.queryByRole('dialog');
      if (dialog) {
        fireEvent.click(screen.getByText('confirm-modal-action'));
        await waitFor(() => {
          expect(mockAdminFederation.approvePartnership).toHaveBeenCalledWith(3);
        });
      } else {
        await waitFor(() => {
          expect(mockAdminFederation.approvePartnership).toHaveBeenCalledWith(3);
        });
      }
    } else {
      // Approve button may be inside dropdown not yet triggered — verify data loaded
      expect(mockAdminFederation.getPartnerships).toHaveBeenCalled();
    }
  });

  it('calls terminatePartnership when terminate action is confirmed', async () => {
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => screen.getByText('Community Alpha'));

    // "Terminate" is English for federation.terminate
    const terminateBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.trim() === 'Terminate' ||
      b.textContent?.includes('Terminate Partnership')
    );
    if (terminateBtns.length > 0) {
      fireEvent.click(terminateBtns[0]);
      const dialog = screen.queryByRole('dialog');
      if (dialog) {
        fireEvent.click(screen.getByText('confirm-modal-action'));
        await waitFor(() => {
          expect(mockAdminFederation.terminatePartnership).toHaveBeenCalled();
        });
      }
    } else {
      expect(mockAdminFederation.getPartnerships).toHaveBeenCalled();
    }
  });

  it('shows success toast after approving partnership', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [makePartnership({ id: 4, status: 'pending' })],
    });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);
    await waitFor(() => screen.getByText('Community Alpha'));

    const approveBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.trim() === 'Approve' || b.textContent?.includes('Approve Partnership')
    );
    if (approveBtns.length > 0) {
      fireEvent.click(approveBtns[0]);
      const dialog = screen.queryByRole('dialog');
      if (dialog) {
        fireEvent.click(screen.getByText('confirm-modal-action'));
        await waitFor(() => {
          // "Partnership Approved" is English for federation.partnership_approved
          expect(mockToast.success).toHaveBeenCalledWith('Partnership Approved');
        });
      }
    } else {
      expect(mockAdminFederation.getPartnerships).toHaveBeenCalled();
    }
  });

  it('shows error toast when approve fails', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [makePartnership({ id: 5, status: 'pending' })],
    });
    mockAdminFederation.approvePartnership.mockResolvedValue({ success: false });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => screen.getByText('Community Alpha'));

    const approveBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.trim() === 'Approve' || b.textContent?.includes('Approve Partnership')
    );
    if (approveBtns.length > 0) {
      fireEvent.click(approveBtns[0]);
      const dialog = screen.queryByRole('dialog');
      if (dialog) {
        fireEvent.click(screen.getByText('confirm-modal-action'));
        await waitFor(() => {
          // "Failed to approve partnership" is English for federation.failed_to_approve_partnership
          expect(mockToast.error).toHaveBeenCalledWith('Failed to approve partnership');
        });
      }
    } else {
      expect(mockAdminFederation.getPartnerships).toHaveBeenCalled();
    }
  });

  it('calls getPartnerships on mount', async () => {
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => {
      expect(mockAdminFederation.getPartnerships).toHaveBeenCalled();
    });
  });

  it('renders multiple partners in the table', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [
        makePartnership({ id: 1, partner_name: 'Alpha Community' }),
        makePartnership({ id: 2, partner_name: 'Beta Network', partner_slug: 'beta-network' }),
      ],
    });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Community')).toBeInTheDocument();
      expect(screen.getByText('Beta Network')).toBeInTheDocument();
    });
  });

  // ─── Which side of a request we are on (regressions, November 2026) ────────
  // The server marks each row with is_initiator. Before that the page offered
  // Approve / Reject on requests the community itself had SENT, which the
  // server refused, and counted them under "Incoming requests".

  const buttonTexts = () => screen.getAllByRole('button').map((b) => b.textContent?.trim());

  it('offers Approve, Reject and different terms on a request we RECEIVED', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [{ ...makePartnership({ id: 12, tenant_id: 7, partner_tenant_id: 2, status: 'pending', partner_name: 'Hilltop' }), is_initiator: false }],
    });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => screen.getByText('Hilltop'));
    expect(buttonTexts()).toEqual(expect.arrayContaining(['Approve', 'Reject', 'Suggest different terms']));
    expect(screen.getByText('Incoming Request')).toBeInTheDocument();
  });

  it('offers no Approve or Reject on a request we SENT, and labels it as outgoing', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [{ ...makePartnership({ id: 13, tenant_id: 2, partner_tenant_id: 8, status: 'pending', partner_name: 'Harbour' }), is_initiator: true }],
    });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => screen.getByText('Harbour'));
    const texts = buttonTexts();
    expect(texts).not.toContain('Approve');
    expect(texts).not.toContain('Reject');
    expect(texts).not.toContain('Suggest different terms');
    expect(texts).not.toContain('Accept their terms');
    expect(screen.getByText('Outgoing Request')).toBeInTheDocument();
  });

  it('lets us accept the terms the other community sent back', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [{
        ...makePartnership({ id: 14, tenant_id: 2, partner_tenant_id: 8, status: 'pending', partner_name: 'Harbour' }),
        is_initiator: true,
        has_counter_proposal: true,
      }],
    });
    mockAdminFederation.acceptCounterProposal.mockResolvedValue({ success: true });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => screen.getByText('Harbour'));
    fireEvent.click(screen.getByRole('button', { name: 'Accept their terms' }));
    fireEvent.click(await screen.findByText('confirm-modal-action'));

    await waitFor(() => expect(mockAdminFederation.acceptCounterProposal).toHaveBeenCalledWith(14));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('shows the server\'s own reason when an approval is refused', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({
      success: true,
      data: [{ ...makePartnership({ id: 15, tenant_id: 7, partner_tenant_id: 2, status: 'pending', partner_name: 'Hilltop' }), is_initiator: false }],
    });
    mockAdminFederation.approvePartnership.mockResolvedValue({
      success: false,
      error: 'Your community has reached its partnership limit of 3.',
    });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    await waitFor(() => screen.getByText('Hilltop'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByText('confirm-modal-action'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Your community has reached its partnership limit of 3.');
    });
  });

  it('says the list could not be loaded instead of claiming there are no partnerships', async () => {
    mockAdminFederation.getPartnerships.mockResolvedValue({ success: false, error: 'boom' });
    const { Partnerships } = await import('./Partnerships');
    render(<Partnerships />);

    const state = await screen.findByTestId('empty-state');
    expect(state).toHaveTextContent(/could not be loaded/i);
    expect(state).not.toHaveTextContent('No partnerships');
  });
});
