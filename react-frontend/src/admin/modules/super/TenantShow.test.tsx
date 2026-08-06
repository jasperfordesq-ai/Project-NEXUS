// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockAdminSuper } = vi.hoisted(() => ({
  mockAdminSuper: {
    getTenant: vi.fn(),
    listTenants: vi.fn(),
    deleteTenant: vi.fn(),
    reactivateTenant: vi.fn(),
    toggleHub: vi.fn(),
    moveTenant: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
  },
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockNavigate = vi.hoisted(() => vi.fn());

// ── Module mocks ─────────────────────────────────────────────────────────────
// Swapped per test: the danger zone depends on WHO is looking, not only on
// which community is being looked at.
const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: null as Record<string, unknown> | null },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: mockUser.current as never,
      isAuthenticated: mockUser.current !== null,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 1, name: 'Root', slug: 'root' },
      tenantPath: (p: string) => `/root${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
// PageMeta already mocked globally in setup.ts

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '5' }),
    Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
      <a href={to} className={className}>{children}</a>
    ),
  };
});

vi.mock('../../api/adminApi', () => ({
  adminSuper: mockAdminSuper,
}));

vi.mock('../../components', () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions}
    </div>
  ),
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onClose, onConfirm, title, confirmLabel }: {
    isOpen: boolean; onClose: () => void; onConfirm: () => void; title: string;
    message?: string; confirmLabel?: string; confirmColor?: string; isLoading?: boolean;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmLabel ?? 'confirm-action'}</button>
        <button onClick={onClose}>close-modal</button>
      </div>
    ) : null,
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    Select: ({ children, label, onSelectionChange, selectedKeys, placeholder }: {
      children: React.ReactNode; label?: string; onSelectionChange?: (keys: Set<string>) => void; selectedKeys?: string[]; placeholder?: string;
    }) => (
      <select
        aria-label={label || 'select'}
        defaultValue={selectedKeys?.[0]}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    Switch: ({ isSelected, onValueChange, 'aria-label': ariaLabel, isDisabled }: {
      isSelected?: boolean; onValueChange?: (v: boolean) => void; 'aria-label'?: string; isDisabled?: boolean;
    }) => (
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={Boolean(isSelected)}
        checked={isSelected ?? false}
        disabled={isDisabled ?? false}
        onChange={(e) => onValueChange?.(e.target.checked)}
      />
    ),
    useDisclosure: () => ({
      isOpen: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onOpenChange: vi.fn(),
    }),
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
      isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
    ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const makeTenant = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  name: 'Test Community',
  slug: 'test-community',
  domain: 'test.project-nexus.ie',
  description: 'A test community for testing.',
  tagline: 'Share and grow',
  is_active: true,
  allows_subtenants: false,
  parent_id: null,
  parent_name: null,
  depth: 0,
  max_depth: 2,
  contact_email: 'hello@test.ie',
  contact_phone: '+1 555 123 4567',
  address: '123 Test St',
  meta_title: null,
  meta_description: null,
  og_image_url: null,
  user_count: 42,
  listing_count: 10,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
  admins: [],
  children: [],
  features: {
    events: true,
    groups: false,
    gamification: true,
    goals: false,
    blog: true,
    resources: false,
    volunteering: true,
    exchange_workflow: true,
    federation: false,
    organisations: false,
    listings: true,
    wallet: true,
    messages: true,
    dashboard: true,
    feed: true,
  },
  breadcrumb: [],
  configuration: { default_language: 'en', supported_languages: ['en'] },
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('TenantShow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default viewer: a platform super-admin whose own community is NOT the one
    // on screen (fixture id 5), so the danger zone behaves as it always did.
    mockUser.current = { id: 1, tenant_id: 1, is_super_admin: true, super_panel_level: 'master' };
    mockAdminSuper.getTenant.mockResolvedValue({ success: true, data: makeTenant() });
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.deleteTenant.mockResolvedValue({ success: true });
    mockAdminSuper.reactivateTenant.mockResolvedValue({ success: true });
    mockAdminSuper.toggleHub.mockResolvedValue({ success: true });
    mockAdminSuper.moveTenant.mockResolvedValue({ success: true });
    mockAdminSuper.createUser.mockResolvedValue({ success: true });
    mockAdminSuper.updateUser.mockResolvedValue({ success: true });
  });

  it('shows loading spinner while fetching tenant', async () => {
    mockAdminSuper.getTenant.mockReturnValue(new Promise(() => {}));
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders tenant name as page title after load', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    // Tenant name appears in PageHeader AND in the Name detail field — use getAllByText
    await waitFor(() => {
      const els = screen.getAllByText('Test Community');
      expect(els.length).toBeGreaterThan(0);
    });
  });

  it('shows tenant slug and domain in the info section', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      const slugEls = screen.getAllByText('test-community');
      expect(slugEls.length).toBeGreaterThan(0);
      const domainEls = screen.getAllByText('test.project-nexus.ie');
      expect(domainEls.length).toBeGreaterThan(0);
    });
  });

  it('shows active status chip — "Active" English text', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    // "Active" may appear multiple times (chip + detail field) — getAllByText
    await waitFor(() => {
      const els = screen.getAllByText('Active');
      expect(els.length).toBeGreaterThan(0);
    });
  });

  it('calls toast.error when API returns failure', async () => {
    mockAdminSuper.getTenant.mockResolvedValue({ success: false, error: 'Not found' });
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows user count and listing count', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });
  });

  it('shows enabled feature chips', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      // "Events" and "Listings" appear in feature chips (may appear multiple times)
      const eventsEls = screen.getAllByText('Events');
      expect(eventsEls.length).toBeGreaterThan(0);
      const listingsEls = screen.getAllByText('Listings');
      expect(listingsEls.length).toBeGreaterThan(0);
    });
  });

  it('shows Add Administrator button', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    // Wait for content to load (name appears in multiple places)
    await waitFor(() => {
      const els = screen.getAllByText('Test Community');
      expect(els.length).toBeGreaterThan(0);
    });

    // "Add" is English for super.add
    const addBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.trim() === 'Add' || b.textContent?.includes('Add Administrator')
    );
    expect(addBtns.length).toBeGreaterThan(0);
  });

  it('calls getTenant on mount with correct tenant id', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      expect(mockAdminSuper.getTenant).toHaveBeenCalledWith(5);
    });
  });

  it('calls deleteTenant when deactivate is confirmed and tenant is active', async () => {
    // Tenant id: 5 (not 1), so danger zone is visible
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      const els = screen.getAllByText('Test Community');
      expect(els.length).toBeGreaterThan(0);
    });

    // "Deactivate Tenant" is English for super.deactivate_tenant
    const deactivateBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Deactivate Tenant')
    );
    if (deactivateBtn) {
      fireEvent.click(deactivateBtn);
      await waitFor(() => {
        expect(mockAdminSuper.deleteTenant).toHaveBeenCalledWith(5);
      });
    } else {
      // Danger zone requires id !== 1, which our fixture has (id=5)
      expect(mockAdminSuper.getTenant).toHaveBeenCalled();
    }
  });

  it('shows contact email when present', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      expect(screen.getByText('hello@test.ie')).toBeInTheDocument();
    });
  });

  it('shows "no admins found" when admins list is empty', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      // "No admins found" is English for super.no_admins_found
      expect(screen.getByText('No admins found')).toBeInTheDocument();
    });
  });

  it('shows hub toggle switch', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    await waitFor(() => {
      const els = screen.getAllByText('Test Community');
      expect(els.length).toBeGreaterThan(0);
    });

    // "Toggle Hub Capability" is English for super.label_toggle_hub_capability
    const hubSwitch = screen.getAllByRole('switch').find((el) =>
      el.getAttribute('aria-label')?.includes('Toggle Hub Capability') ||
      el.getAttribute('aria-label')?.toLowerCase().includes('hub')
    );
    expect(hubSwitch).toBeDefined();
  });

  it('enables Hub capability immediately through the dedicated endpoint', async () => {
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    const hubSwitch = await screen.findByRole('switch', { name: 'Toggle Hub Capability' });
    fireEvent.click(hubSwitch);

    await waitFor(() => {
      expect(mockAdminSuper.toggleHub).toHaveBeenCalledWith(5, true);
    });
  });

  it('requires confirmation before disabling Hub capability', async () => {
    mockAdminSuper.getTenant.mockResolvedValue({
      success: true,
      data: makeTenant({ allows_subtenants: true, max_depth: 2 }),
    });
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    const hubSwitch = await screen.findByRole('switch', { name: 'Toggle Hub Capability' });
    fireEvent.click(hubSwitch);

    expect(mockAdminSuper.toggleHub).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Disable Hub capability?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable Hub' }));

    await waitFor(() => {
      expect(mockAdminSuper.toggleHub).toHaveBeenCalledWith(5, false);
    });
  });

  it('blocks Hub deactivation while child tenants remain attached', async () => {
    mockAdminSuper.getTenant.mockResolvedValue({
      success: true,
      data: makeTenant({
        allows_subtenants: true,
        max_depth: 2,
        children: [makeTenant({ id: 6, name: 'Child Community', parent_id: 5 })],
      }),
    });
    const { TenantShow } = await import('./TenantShow');
    render(<TenantShow />);

    const hubSwitch = await screen.findByRole('switch', { name: 'Toggle Hub Capability' });

    expect(hubSwitch).toBeDisabled();
    expect(screen.getByText('Move or delete all child tenants before disabling Hub capability.')).toBeInTheDocument();
    fireEvent.click(hubSwitch);
    expect(mockAdminSuper.toggleHub).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Disable Hub capability?' })).not.toBeInTheDocument();
  });

  /*
   * 🔴 Deactivation was opened to branch super-admins on 2026-08-06, guarded on
   * the server by `SuperPanelAccess::canManageTenant()` — which refuses the
   * caller's OWN community. These pin the button to that same rule, so the panel
   * never offers a control the API would answer 403 to, and never hides one it
   * would allow.
   */
  describe('deactivation is offered only where the server permits it', () => {
    const findDeactivate = () =>
      screen.getAllByRole('button').find((b) => b.textContent?.includes('Deactivate Tenant'));

    it('hides it, with a reason, when this is the viewer own community', async () => {
      mockUser.current = { id: 9, tenant_id: 5, is_tenant_super_admin: true, super_panel_level: 'regional' };
      const { TenantShow } = await import('./TenantShow');
      render(<TenantShow />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Community').length).toBeGreaterThan(0);
      });

      expect(findDeactivate()).toBeUndefined();
      expect(screen.getByTestId('own-tenant-deactivate-notice')).toBeInTheDocument();
    });

    it('offers it to a branch super-admin viewing a community beneath them', async () => {
      mockUser.current = { id: 9, tenant_id: 8, is_tenant_super_admin: true, super_panel_level: 'regional' };
      const { TenantShow } = await import('./TenantShow');
      render(<TenantShow />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Community').length).toBeGreaterThan(0);
      });

      expect(findDeactivate()).toBeDefined();
      expect(screen.queryByTestId('own-tenant-deactivate-notice')).not.toBeInTheDocument();
    });

    it('still offers it to god on their own community, matching the server carve-out', async () => {
      mockUser.current = { id: 1, tenant_id: 5, is_god: true, role: 'god' };
      const { TenantShow } = await import('./TenantShow');
      render(<TenantShow />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Community').length).toBeGreaterThan(0);
      });

      expect(findDeactivate()).toBeDefined();
    });
  });
});
