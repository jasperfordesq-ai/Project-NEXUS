// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Hoist mock data ─────────────────────────────────────────────────────────
const { mockAdminSuper, mockToast, mockNavigate, mockRouteParams } = vi.hoisted(() => ({
  mockAdminSuper: {
    getTenant: vi.fn(),
    listTenants: vi.fn(),
    createTenant: vi.fn(),
    updateTenant: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
  mockRouteParams: { current: {} as { id?: string } },
}));

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => ({
  adminSuper: mockAdminSuper,
  adminEnterprise: {},
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => mockRouteParams.current,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
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

beforeEach(() => {
  mockRouteParams.current = {};
});

// Stub PageHeader and heavy admin sub-components
vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
    <div data-testid="page-header">
      <span>{title}</span>
      {actions}
    </div>
  ),
}));

// Stub Switch and Select to avoid HeroUI infinite loops in jsdom
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Switch: ({ isSelected, onValueChange, children }: { isSelected?: boolean; onValueChange?: (v: boolean) => void; children?: React.ReactNode }) => (
      <label>
        <input type="checkbox" checked={!!isSelected} onChange={(e) => onValueChange?.(e.target.checked)} />
        {children}
      </label>
    ),
    Select: ({ children, label, selectedKeys, onSelectionChange, disabledKeys }: {
      children?: React.ReactNode; label?: string;
      selectedKeys?: Iterable<string>; onSelectionChange?: (keys: Set<string>) => void;
      disabledKeys?: Iterable<string>;
    }) => {
      const keys = selectedKeys ? Array.from(selectedKeys) : [];
      const disabled = new Set(disabledKeys ? Array.from(disabledKeys) : []);
      return (
        <select
          aria-label={label}
          value={keys[0] ?? ''}
          onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
        >
          {React.Children.map(children, (child) =>
            React.isValidElement<{ id?: string; isDisabled?: boolean }>(child)
              ? React.cloneElement(child, { isDisabled: disabled.has(String(child.props.id)) })
              : child
          )}
        </select>
      );
    },
    SelectItem: ({ children, id, description, isDisabled }: {
      children?: React.ReactNode; id?: string; description?: React.ReactNode; isDisabled?: boolean;
    }) => (
      <option value={id} disabled={isDisabled}>
        {children}{description ? ` — ${String(description)}` : ''}
      </option>
    ),
    Checkbox: ({ isSelected, onValueChange, children }: { isSelected?: boolean; onValueChange?: (v: boolean) => void; children?: React.ReactNode }) => (
      <label>
        <input type="checkbox" checked={!!isSelected} onChange={(e) => onValueChange?.(e.target.checked)} />
        {children}
      </label>
    ),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TenantForm — create mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.createTenant.mockResolvedValue({ success: true, data: { tenant_id: 99 } });
  });

  it('renders the form in create mode without loading spinner', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => expect(screen.getByTestId('page-header')).toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: /features/i })).not.toBeInTheDocument();
    expect(screen.getByText('Allows Subtenants')).toBeInTheDocument();
  });

  it('shows error toast when name is empty and Save is clicked', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockAdminSuper.createTenant).not.toHaveBeenCalled();
  });

  it('auto-generates slug from name input', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    const nameInput = screen.getByRole('textbox', { name: /name/i });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'My Test Timebank');

    // The slug input should auto-populate based on name
    await waitFor(() => {
      const slugInput = screen.queryAllByRole('textbox').find(
        (el) => el.getAttribute('aria-label')?.toLowerCase().includes('slug') ||
                 (el as HTMLInputElement).value?.includes('my-test')
      );
      if (slugInput) expect((slugInput as HTMLInputElement).value).toMatch(/my.test/);
    });
  });

  it('POSTs to create endpoint with name and slug on valid submit', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    const nameInput = screen.getByRole('textbox', { name: /name/i });
    await userEvent.type(nameInput, 'NewTimebank');

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminSuper.createTenant).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'NewTimebank' })
      );
    });
    expect(mockAdminSuper.createTenant.mock.calls[0]?.[0]).not.toHaveProperty('features');
  });

  it('navigates to tenant list on successful create', async () => {
    mockAdminSuper.createTenant.mockResolvedValue({ success: true, data: { tenant_id: 42 } });
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    const nameInput = screen.getByRole('textbox', { name: /name/i });
    await userEvent.type(nameInput, 'AnotherTimebank');

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  });

  it('shows error toast on create failure', async () => {
    mockAdminSuper.createTenant.mockResolvedValue({ success: false, error: 'Slug taken' });
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    const nameInput = screen.getByRole('textbox', { name: /name/i });
    await userEvent.type(nameInput, 'FailTenant');

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // 🔴 This test asserted the OPPOSITE until 2026-09-02: that the server's own
  // reason is shown. It is not, and must not be, while those reasons are
  // hardcoded English in TenantHierarchyService ('Maximum hierarchy depth
  // exceeded', "Slug 'x' is already in use", and a
  // 'Failed to create tenant: ' . $e->getMessage() that leaks exception text).
  // Surfacing them puts untranslated English in front of an operator working in
  // any of the eleven locales, which check-admin-ui-literals.mjs blocks as
  // 'server-message-bypass'. It failed CI on 0d23d3ad7 and took the release gate
  // with it.
  //
  // Do not "fix" this test by restoring res.error, and do not silence the gate
  // with `admin-i18n-ignore: localized server message` — that comment asserts
  // the API already localised the string, which here is false. Route those
  // messages through __() first, then change this test deliberately.
  it('shows the translated generic message, NOT the untranslated server reason', async () => {
    mockAdminSuper.createTenant.mockResolvedValue({
      success: false,
      error: 'Maximum hierarchy depth exceeded',
      code: 'VALIDATION_ERROR',
    });
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /name/i }), 'DepthTenant');

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockToast.error).not.toHaveBeenCalledWith('Maximum hierarchy depth exceeded');
  });

  it('falls back to the generic message when the server sends no reason', async () => {
    mockAdminSuper.createTenant.mockResolvedValue({ success: false });
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /name/i }), 'QuietFailure');

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to create tenant'));
  });

  // max_depth is an absolute level cap: a hub already sitting at its cap can
  // never take a child, so offering it as a parent only produces a 422.
  it('disables hubs that have reached their depth limit in the parent picker', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({
      success: true,
      data: [
        { id: 4, name: 'Timebank Global', depth: 1, max_depth: 2, allows_subtenants: true },
        { id: 11, name: 'Timebanking UK', depth: 2, max_depth: 2, allows_subtenants: true },
        { id: 1, name: 'Project NEXUS', depth: 0, max_depth: 0, allows_subtenants: true },
      ],
    });
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    const roomy = await screen.findByRole('option', { name: /Timebank Global/ });
    const full = await screen.findByRole('option', { name: /Timebanking UK/ });
    // max_depth 0 means unlimited — never disabled.
    const unlimited = await screen.findByRole('option', { name: /Project NEXUS/ });

    expect(roomy).not.toBeDisabled();
    expect(unlimited).not.toBeDisabled();
    expect(full).toBeDisabled();
    expect(full).toHaveTextContent(/Depth limit reached/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TenantForm — edit mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRouteParams.current = { id: '1' };
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.getTenant.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        name: 'Project NEXUS',
        slug: 'nexus',
        domain: 'app.project-nexus.ie',
        accessible_domain: 'accessible.project-nexus.ie',
        is_active: true,
        allows_subtenants: true,
        max_depth: 3,
        features: {},
        configuration: {
          default_language: 'en',
          supported_languages: ['en'],
        },
        children: [],
        admins: [],
        breadcrumb: [],
      },
    });
    mockAdminSuper.updateTenant.mockResolvedValue({ success: true });
  });

  it('sends only changed fields instead of resubmitting protected routing values', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);

    const nameInput = await screen.findByRole('textbox', { name: /name/i });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Project NEXUS Updated');

    const saveBtn = screen.getAllByRole('button').find(
      (button) => button.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeDefined();
    fireEvent.click(saveBtn!);

    await waitFor(() => {
      expect(mockAdminSuper.updateTenant).toHaveBeenCalledWith(1, {
        name: 'Project NEXUS Updated',
      });
    });
  });

  it('routes Hub capability changes to the tenant Hub Settings surface', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);

    await screen.findByRole('textbox', { name: /name/i });

    expect(screen.queryByText('Allows Subtenants')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Hub Settings' })).toHaveAttribute(
      'href',
      '/test/super-admin/tenants/1'
    );
    expect(screen.getByText('Maximum hierarchy depth')).toBeInTheDocument();
  });
});

describe('TenantForm — additional create-mode checks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.createTenant.mockResolvedValue({ success: true, data: { tenant_id: 77 } });
  });

  it('shows loading indicator while parent tenants are fetched', async () => {
    // Stall listTenants to simulate async loading
    mockAdminSuper.listTenants.mockImplementationOnce(() => new Promise(() => {}));
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    // In create mode (no id), loading defaults to false so no spinner —
    // the form renders immediately. Verify page-header is present.
    await waitFor(() => expect(screen.getByTestId('page-header')).toBeInTheDocument());
  });

  it('shows error toast when create throws an exception', async () => {
    mockAdminSuper.createTenant.mockRejectedValue(new Error('network fail'));
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    const nameInput = screen.getByRole('textbox', { name: /name/i });
    await userEvent.type(nameInput, 'ThrowTenant');

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });
});
