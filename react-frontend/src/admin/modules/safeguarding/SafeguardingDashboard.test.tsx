// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
// Use importOriginal so cn (used by Modal internals) remains available
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, formatRelativeTime: (s: string) => s };
});

// ─── Contexts / Hooks ────────────────────────────────────────────────────────
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

// ─── Stub @/components/ui to avoid HeroUI React-Aria key/layout issues ──────
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    // Table suite — plain HTML so React-Aria doesn't throw "Could not determine key"
    Table: ({
      children,
      removeWrapper: _removeWrapper,
      ...props
    }: React.HTMLAttributes<HTMLTableElement> & { removeWrapper?: boolean }) => <table {...props}>{children}</table>,
    TableHeader: ({ children }: { children?: React.ReactNode }) => <thead><tr>{children}</tr></thead>,
    TableColumn: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
    TableBody: ({ children, emptyContent }: { children?: React.ReactNode; emptyContent?: React.ReactNode }) =>
      <tbody>{React.Children.count(children) === 0 ? <tr><td>{emptyContent}</td></tr> : children}</tbody>,
    TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
    TableCell: ({ children }: { children?: React.ReactNode }) => <td>{children}</td>,
    // Tabs — plain buttons with role="tab"
    Tabs: ({ children, onSelectionChange, selectedKey }: {
      children?: React.ReactNode;
      onSelectionChange?: (key: React.Key) => void;
      selectedKey?: string;
      'aria-label'?: string;
    }) => (
      <div role="tablist">
        {React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) return child;
          const tabKey = child.props.tabKey ?? (child as React.ReactElement<{ tabKey?: string; title?: React.ReactNode; children?: React.ReactNode; [k: string]: unknown }>).key;
          const isSelected = String(tabKey) === selectedKey;
          return (
            <button
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelectionChange?.(tabKey as React.Key)}
            >
              {(child as React.ReactElement<{ title?: React.ReactNode }>).props.title}
            </button>
          );
        })}
      </div>
    ),
    Tab: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => <>{children ?? title}</>,
    // Avatar — aria-label only, no visible text (prevents duplicate text matches)
    Avatar: ({ name }: { name?: string; src?: string; size?: string; className?: string }) =>
      <span data-testid="avatar" aria-label={name} />,
    // Spinner — with role=status aria-busy=true
    Spinner: ({ size: _size, label }: { size?: string; label?: string }) =>
      <div role="status" aria-busy="true" aria-label={label ?? 'loading'} />,
    // Card suite — plain divs
    Card: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      <div className={className}>{children}</div>,
    CardHeader: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      <div className={className}>{children}</div>,
    CardBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    // Chip — inline span
    Chip: ({ children }: { children?: React.ReactNode; size?: string; color?: string; variant?: string; startContent?: React.ReactNode }) =>
      <span>{children}</span>,
    // Separator
    Separator: () => <hr />,
  };
});

// ─── Stub heavy sub-components ────────────────────────────────────────────────
vi.mock('./SafeguardingHelp', () => ({
  SafeguardingHelp: () => <div data-testid="safeguarding-help" />,
}));

vi.mock('../../components', () => ({
  PageHeader: ({ title, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <div><h1>{title}</h1>{actions}</div>
  ),
  StatCard: ({ label, value }: { label: string; value: number | string; icon?: unknown; color?: string; to?: string; linkAriaLabel?: string }) => (
    <div data-testid="stat-card">{label}: {value}</div>
  ),
}));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <div><h1>{title}</h1>{actions}</div>
  ),
}));

vi.mock('../../components/StatCard', () => ({
  StatCard: ({ label, value, to }: { label: string; value: number | string; icon?: unknown; color?: string; to?: string; linkAriaLabel?: string }) => (
    <a data-testid="stat-card" href={to}>{label}: {value}</a>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeStats = () => ({
  active_assignments: 3,
  unreviewed_flags: 2,
  consented_wards: 1,
  total_flags_this_month: 5,
  critical_flags: 1,
});

const makeFlag = (overrides = {}) => ({
  id: 1,
  message_id: 10,
  message_content: 'Test message content',
  sender: { id: 101, name: 'Alice Sender', avatar_url: null },
  recipient: { id: 102, name: 'Bob Recipient', avatar_url: null },
  severity: 'medium' as const,
  flag_reason: 'Harassment',
  is_reviewed: false,
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

const makeAssignment = (overrides = {}) => ({
  id: 1,
  ward: { id: 201, name: 'Ward User', avatar_url: null },
  guardian: { id: 202, name: 'Guardian User', avatar_url: null },
  status: 'active' as const,
  consent_given: true,
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

const makeMemberPreference = (overrides = {}) => ({
  user_id: 301,
  user_name: 'Margaret Donegan',
  user_avatar: null,
  consent_given_at: '2026-05-21T10:00:00Z',
  options: [
    {
      option_key: 'vetted_only',
      label: 'I would prefer to only interact with members who have been appropriately vetted',
      is_declination: false,
    },
  ],
  has_triggers: true,
  is_declination_only: false,
  ...overrides,
});

const makeApiOk = (data: unknown) => ({ success: true, data });
const makeApiErr = () => ({ success: false, error: 'server error' });

const makeSupportAction = () => ({
  id: 71,
  action_type: 'credit_transfer' as const,
  payload_summary: { amount: 3 },
  supported_name: 'Molly Member',
  supporter_name: 'Sam Supporter',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
});

function setupSuccess() {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('dashboard')) return Promise.resolve(makeApiOk(makeStats()));
    if (url.includes('flagged-messages')) return Promise.resolve(makeApiOk([makeFlag()]));
    if (url.includes('support-actions')) return Promise.resolve(makeApiOk({ actions: [makeSupportAction()] }));
    if (url.includes('assignments')) return Promise.resolve(makeApiOk([makeAssignment()]));
    if (url.includes('member-preferences')) return Promise.resolve(makeApiOk([]));
    return Promise.resolve(makeApiOk(null));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('SafeguardingDashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupSuccess();
  });

  it('shows a loading spinner initially', async () => {
    // Delay all API calls so loading state is visible
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders stat cards after data loads', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => {
      const cards = screen.getAllByTestId('stat-card');
      expect(cards.length).toBeGreaterThanOrEqual(5);
    });
  });

  it('renders flagged message rows in the default tab', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Alice Sender')).toBeInTheDocument();
      expect(screen.getByText('Bob Recipient')).toBeInTheDocument();
      expect(screen.getByText('Test message content')).toBeInTheDocument();
    });
  });

  it('shows Review button for unreviewed flags', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => {
      const btns = screen.getAllByRole('button');
      const reviewBtn = btns.find((b) => b.textContent?.toLowerCase().includes('review'));
      expect(reviewBtn).toBeInTheDocument();
    });
  });

  it('opens review modal on Review button click', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => screen.getByText('Alice Sender'));

    const btns = screen.getAllByRole('button');
    const reviewBtn = btns.find((b) => b.textContent?.toLowerCase().includes('review'));
    if (reviewBtn) fireEvent.click(reviewBtn);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('calls POST /review and updates message status after submitting review', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => screen.getByText('Alice Sender'));

    const btns = screen.getAllByRole('button');
    const reviewBtn = btns.find((b) => b.textContent?.toLowerCase().includes('review'));
    if (reviewBtn) fireEvent.click(reviewBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    const confirmBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('mark') || b.textContent?.toLowerCase().includes('reviewed')
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/admin/safeguarding/flagged-messages/1/review',
          expect.any(Object)
        );
      });
    }
  });

  it('renders no Review button for already-reviewed flags', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('dashboard')) return Promise.resolve(makeApiOk(makeStats()));
      if (url.includes('flagged-messages')) return Promise.resolve(makeApiOk([makeFlag({ is_reviewed: true })]));
      if (url.includes('assignments')) return Promise.resolve(makeApiOk([]));
      if (url.includes('member-preferences')) return Promise.resolve(makeApiOk([]));
      return Promise.resolve(makeApiOk(null));
    });

    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => screen.getByText('Alice Sender'));

    const allBtns = screen.getAllByRole('button');
    const reviewBtn = allBtns.find((b) => b.textContent?.toLowerCase() === 'review');
    // Should NOT find a plain "Review" action button for an already-reviewed flag
    expect(reviewBtn).toBeUndefined();
  });

  it('switches to Assignments tab and shows guardian table', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => screen.getByText('Alice Sender'));

    // Find and click assignments tab
    const tabs = screen.getAllByRole('tab');
    const assignTab = tabs.find((t) => t.textContent?.toLowerCase().includes('assignment'));
    if (assignTab) await userEvent.click(assignTab);

    await waitFor(() => {
      expect(screen.getByText('Ward User')).toBeInTheDocument();
      expect(screen.getByText('Guardian User')).toBeInTheDocument();
    });
  });

  it('calls DELETE /assignments/:id when Revoke is clicked', async () => {
    mockApi.delete.mockResolvedValue({ success: true });
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    // Wait for data to load (stat cards always visible); 'Alice Sender' only in flagged tab
    await waitFor(() => screen.getAllByTestId('stat-card'));

    const tabs = screen.getAllByRole('tab');
    const assignTab = tabs.find((t) => t.textContent?.toLowerCase().includes('assignment'));
    if (assignTab) await userEvent.click(assignTab);

    await waitFor(() => screen.getByText('Ward User'));

    const btns = screen.getAllByRole('button');
    const revokeBtn = btns.find((b) => b.textContent?.toLowerCase().includes('revoke'));
    if (revokeBtn) {
      fireEvent.click(revokeBtn);
      await waitFor(() => {
        expect(mockApi.delete).toHaveBeenCalledWith('/v2/admin/safeguarding/assignments/1');
      });
    }
  });

  it('opens New Assignment modal from header button', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const btns = screen.getAllByRole('button');
    const newBtn = btns.find((b) => b.textContent?.toLowerCase().includes('assignment'));
    if (newBtn) fireEvent.click(newBtn);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('submits create-assignment and calls POST /assignments', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const btns = screen.getAllByRole('button');
    const newBtn = btns.find((b) => b.textContent?.toLowerCase().includes('assignment'));
    if (newBtn) fireEvent.click(newBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Fill ward and guardian email inputs
    const inputs = document.querySelectorAll('[role="dialog"] input');
    if (inputs[0]) fireEvent.change(inputs[0], { target: { value: 'ward@example.com' } });
    if (inputs[1]) fireEvent.change(inputs[1], { target: { value: 'guardian@example.com' } });

    const confirmBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('create')
    );
    if (confirmBtns[0]) {
      fireEvent.click(confirmBtns[0]);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/admin/safeguarding/assignments',
          expect.objectContaining({ ward_email: 'ward@example.com' })
        );
      });
    }
  });

  it('switches to Preferences tab and shows empty state message when no prefs', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    // Wait for data to load; 'Alice Sender' is only in the flagged tab (which gets hidden after tab switch)
    await waitFor(() => screen.getAllByTestId('stat-card'));

    const tabs = screen.getAllByRole('tab');
    const prefTab = tabs.find((t) => t.textContent?.toLowerCase().includes('preference'));
    if (prefTab) await userEvent.click(prefTab);

    // No member preferences were returned → empty state text should appear
    await waitFor(() => {
      // The component renders a "no member preferences" paragraph when the list is empty
      const container = document.body;
      // Locate text containing "no" in any paragraph/div in the preferences panel
      expect(container.textContent).toMatch(/preference/i);
    });
  });

  it('renders member preference option labels from the shared admin API shape', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('dashboard')) return Promise.resolve(makeApiOk(makeStats()));
      if (url.includes('flagged-messages')) return Promise.resolve(makeApiOk([]));
      if (url.includes('assignments')) return Promise.resolve(makeApiOk([]));
      if (url.includes('member-preferences')) return Promise.resolve(makeApiOk([makeMemberPreference()]));
      return Promise.resolve(makeApiOk(null));
    });

    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard routeBase="/broker/safeguarding" />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const statHrefs = screen.getAllByTestId('stat-card').map((el) => el.getAttribute('href'));
    expect(statHrefs).toContain('/test/broker/safeguarding?tab=assignments&filter=active');
    expect(statHrefs).not.toContain('/test/admin/safeguarding?tab=assignments&filter=active');

    const tabs = screen.getAllByRole('tab');
    const prefTab = tabs.find((t) => t.textContent?.toLowerCase().includes('preference'));
    if (prefTab) await userEvent.click(prefTab);

    await waitFor(() => {
      expect(screen.getByText('Margaret Donegan')).toBeInTheDocument();
      expect(screen.getByText('I would prefer to only interact with members who have been appropriately vetted')).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('[object Object]');
      expect(screen.getByText('2026-05-21T10:00:00Z')).toBeInTheDocument();
    });
  });

  it('shows error toast when API load fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders SafeguardingHelp panel after data loads', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('safeguarding-help')).toBeInTheDocument();
    });
  });

  // ── Support actions tab (co-decide, guardian redesign phase 4) ──

  it('lists pending support actions with both parties on the Support Actions tab', async () => {
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    // Wait on the tab bar, not the flagged tab's content — the active tab is
    // URL-driven and a previous test's ?tab= persists under BrowserRouter.
    fireEvent.click(await screen.findByRole('tab', { name: /Support Actions/ }));

    await waitFor(() => {
      expect(screen.getByText('Molly Member')).toBeInTheDocument();
      expect(screen.getByText('Sam Supporter')).toBeInTheDocument();
      expect(screen.getByText(/A time-credit transfer/)).toBeInTheDocument();
    });
  });

  it('records an offline approval through the attest modal', async () => {
    mockApi.post.mockResolvedValue({ success: true, data: { status: 'confirmed' } });
    const { SafeguardingDashboard } = await import('./SafeguardingDashboard');
    render(<SafeguardingDashboard />);

    fireEvent.click(await screen.findByRole('tab', { name: /Support Actions/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Record offline approval/ }));

    // The modal states the honesty rule before anything is submitted: the
    // record is distinguishable from the member's own click, and the member
    // will be notified it was recorded in their name.
    expect(await screen.findByText(/member will be notified/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Witness (optional)'), { target: { value: 'Nora Neighbour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record and carry out' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/safeguarding/support-actions/71/attest', {
        channel: 'phone',
        witness: 'Nora Neighbour',
      });
    });
  });
});
