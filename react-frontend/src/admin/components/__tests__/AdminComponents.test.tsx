// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Admin components:
 * - AdminBreadcrumbs, AdminHeader, AdminSidebar, ConfirmModal,
 *   DataTable, EmptyState, PageHeader, RichTextEditor, StatCard
 *
 * Smoke tests — verify each component renders without crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Common mocks ────────────────────────────────────────────────────────────

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Admin', last_name: 'User', name: 'Admin User', role: 'admin', is_super_admin: true, tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    ChevronRight: () => <span data-testid="chevron-right" />,
    LayoutDashboard: () => <span data-testid="layout-dashboard" />,
    Users: () => <span data-testid="users" />,
    Search: () => <span data-testid="search" />,
    RefreshCw: () => <span data-testid="refresh" />,
    Inbox: () => <span data-testid="inbox" />,
    TrendingUp: () => <span data-testid="trending-up" />,
    TrendingDown: () => <span data-testid="trending-down" />,
    AlertTriangle: () => <span data-testid="alert-triangle" />,
    ArrowLeft: () => <span data-testid="arrow-left" />,
    UserCheck: () => <span data-testid="user-check" />,
  };
});

// Mock Lexical editor
const mockEditor = {
  registerUpdateListener: vi.fn(() => vi.fn()),
  update: vi.fn(),
  getEditorState: vi.fn(),
  setEditable: vi.fn(),
};

vi.mock('@lexical/react/LexicalComposer', () => ({
  LexicalComposer: ({ children }: { children: React.ReactNode }) => <div data-testid="lexical-composer">{children}</div>,
}));
vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}));
vi.mock('@lexical/react/LexicalContentEditable', () => ({
  ContentEditable: () => <div data-testid="lexical-editable" />,
  default: () => <div data-testid="lexical-editable" />,
}));
vi.mock('@lexical/react/LexicalRichTextPlugin', () => ({
  RichTextPlugin: () => <div data-testid="rich-text-plugin" />,
}));
vi.mock('@lexical/react/LexicalOnChangePlugin', () => ({
  OnChangePlugin: () => null,
}));
vi.mock('@lexical/react/LexicalHistoryPlugin', () => ({
  HistoryPlugin: () => null,
}));
vi.mock('@lexical/react/LexicalListPlugin', () => ({
  ListPlugin: () => null,
}));
vi.mock('@lexical/react/LexicalLinkPlugin', () => ({
  LinkPlugin: () => null,
}));

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test/admin/users']}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ─── AdminBreadcrumbs ────────────────────────────────────────────────────────

import { AdminBreadcrumbs } from '../AdminBreadcrumbs';

describe('AdminBreadcrumbs', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><AdminBreadcrumbs /></W>);
    expect(container.querySelector('nav')).toBeTruthy();
  });

  it('renders with custom items', () => {
    const items = [
      { label: 'Dashboard', href: '/admin' },
      { label: 'Users' },
    ];
    render(<W><AdminBreadcrumbs items={items} /></W>);
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Users')).toBeTruthy();
  });
});

// ─── AdminHeader ─────────────────────────────────────────────────────────────

import { AdminHeader } from '../AdminHeader';

describe('AdminHeader', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><AdminHeader /></W>);
    expect(container.querySelector('header')).toBeTruthy();
  });
});

// ─── AdminSidebar ────────────────────────────────────────────────────────────

import { AdminSidebar } from '../AdminSidebar';

describe('AdminSidebar', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><AdminSidebar /></W>);
    expect(container.querySelector('aside')).toBeTruthy();
  });
});

// ─── ConfirmModal ────────────────────────────────────────────────────────────

import { ConfirmModal } from '../ConfirmModal';

describe('ConfirmModal', () => {
  it('renders when open', () => {
    render(
      <W>
        <ConfirmModal
          isOpen={true}
          title="Confirm Delete"
          message="Are you sure?"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </W>
    );
    expect(screen.getByText('Confirm Delete')).toBeTruthy();
    expect(screen.getByText('Are you sure?')).toBeTruthy();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <W>
        <ConfirmModal
          isOpen={false}
          title="Confirm Delete"
          message="Are you sure?"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </W>
    );
    expect(container.textContent).not.toContain('Confirm Delete');
  });
});

// ─── DataTable ───────────────────────────────────────────────────────────────

import { DataTable } from '../DataTable';

describe('DataTable', () => {
  const columns = [
    { key: 'id', label: 'ID', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'email', label: 'Email' },
  ];

  const data = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ];

  it('renders without crashing', () => {
    const { container } = render(<W><DataTable columns={columns} data={data} /></W>);
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('displays data rows', () => {
    render(<W><DataTable columns={columns} data={data} /></W>);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('shows empty state when no data', () => {
    render(<W><DataTable columns={columns} data={[]} /></W>);
    expect(screen.getByText('No data')).toBeTruthy();
  });
});

// ─── EmptyState ──────────────────────────────────────────────────────────────

import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders without crashing', () => {
    render(<W><EmptyState title="No items" /></W>);
    expect(screen.getByText('No items')).toBeTruthy();
  });

  it('displays description and action button', () => {
    const onAction = vi.fn();
    render(
      <W>
        <EmptyState
          title="No items"
          description="Create your first item"
          actionLabel="Create Item"
          onAction={onAction}
        />
      </W>
    );
    expect(screen.getByText('No items')).toBeTruthy();
    expect(screen.getByText('Create your first item')).toBeTruthy();
    expect(screen.getByText('Create Item')).toBeTruthy();
  });
});

// ─── PageHeader ──────────────────────────────────────────────────────────────

import { PageHeader } from '../PageHeader';

describe('PageHeader', () => {
  it('renders without crashing', () => {
    render(<W><PageHeader title="Admin Dashboard" /></W>);
    expect(screen.getByText('Admin Dashboard')).toBeTruthy();
  });

  it('displays description and actions', () => {
    render(
      <W>
        <PageHeader
          title="Admin Dashboard"
          description="Manage your community"
          actions={<button>New User</button>}
        />
      </W>
    );
    expect(screen.getByText('Admin Dashboard')).toBeTruthy();
    expect(screen.getByText('Manage your community')).toBeTruthy();
    expect(screen.getByText('New User')).toBeTruthy();
  });
});

// ─── RichTextEditor ──────────────────────────────────────────────────────────

import { RichTextEditor } from '../RichTextEditor';

describe('RichTextEditor', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><RichTextEditor value="" onChange={vi.fn()} /></W>);
    expect(container.querySelector('[data-testid="lexical-composer"]')).toBeTruthy();
  });
});

// ─── StatCard ────────────────────────────────────────────────────────────────

import { StatCard } from '../StatCard';
import Users from 'lucide-react/icons/users';

describe('StatCard', () => {
  it('renders without crashing', () => {
    render(<W><StatCard label="Total Users" value={150} icon={Users} /></W>);
    expect(screen.getByText('Total Users')).toBeTruthy();
    expect(screen.getByText('150')).toBeTruthy();
  });

  it('displays trend indicator', () => {
    render(<W><StatCard label="Total Users" value={150} icon={Users} trend={15} trendLabel="vs last month" /></W>);
    expect(screen.getByText('+15%')).toBeTruthy();
    expect(screen.getByText('vs last month')).toBeTruthy();
  });

  it('shows loading state', () => {
    const { container } = render(<W><StatCard label="Total Users" value={150} icon={Users} loading /></W>);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('becomes a link when given a destination', () => {
    render(<W><StatCard label="Total Users" value={150} icon={Users} to="/admin/users" /></W>);
    expect(screen.getByRole('link', { name: 'Total Users' })).toHaveAttribute('href', '/admin/users');
  });

  it('shows a dash and a chip instead of the value when the figure failed to load', () => {
    render(<W><StatCard label="Total Users" value={150} icon={Users} trend={12} failed failedLabel="Could not load" /></W>);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Could not load')).toBeTruthy();
    expect(screen.queryByText('150')).toBeNull();
    expect(screen.queryByText('+12%')).toBeNull();
  });

  it('hides the trend row when the delta is null', () => {
    render(<W><StatCard label="Total Users" value={150} icon={Users} trend={null} trendLabel="vs last month" /></W>);
    expect(screen.queryByText('vs last month')).toBeNull();
  });
});
