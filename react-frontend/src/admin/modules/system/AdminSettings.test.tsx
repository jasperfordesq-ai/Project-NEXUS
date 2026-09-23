// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockAdminSettings } = vi.hoisted(() => ({
  mockAdminSettings: {
    get: vi.fn(),
    update: vi.fn(),
    uploadPartnerLogo: vi.fn(),
    uploadPoweredByImageLight: vi.fn(),
    uploadPoweredByImageDark: vi.fn(),
    uploadHeaderLogo: vi.fn(),
    uploadHeaderLogoDark: vi.fn(),
    removeHeaderLogo: vi.fn(),
    removeHeaderLogoDark: vi.fn(),
    saveHeaderColors: vi.fn(),
  },
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockRefreshTenant = vi.hoisted(() => vi.fn());

const DEFAULT_TEST_USER = { id: 1, name: 'Admin', role: 'god', is_super_admin: true, is_god: false };
const mockAuthState = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
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
      refreshTenant: mockRefreshTenant,
      branding: { logo: null, logoDark: null },
    }),
    useAuth: () => ({
      user: mockAuthState.user,
      isAuthenticated: true,
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
// PageMeta already mocked globally in setup.ts

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => vi.fn() };
});

vi.mock('../../api/adminApi', () => ({
  adminSettings: mockAdminSettings,
}));

// Stub SystemConfig — it makes its own API calls we don't want to intercept
vi.mock('../enterprise/SystemConfig', () => ({
  SystemConfig: () => <div data-testid="system-config-stub">SystemConfig</div>,
  default: () => <div data-testid="system-config-stub">SystemConfig</div>,
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('../../components', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAssetUrl: (url: string) => url,
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
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
    // Keep Card, CardBody, CardHeader, Input, Button, Textarea, Spinner etc. from real HeroUI
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const makeSettingsData = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    tenant: {
      name: 'Test Tenant',
      description: 'A test tenant',
      contact_email: 'admin@test.ie',
      contact_phone: '+1 555 123 4567',
    },
    settings: {
      registration_mode: 'open',
      email_verification: 'true',
      admin_approval: 'false',
      maintenance_mode: 'false',
      footer_text: 'Charity No. 12345',
      partner_logo_url: '',
      partner_logo_label: '',
      partner_logo_link_url: '',
      powered_by_label: '',
      powered_by_image_light: '',
      powered_by_image_dark: '',
      powered_by_url: '',
      default_currency: 'eur',
      inactivity_timeout_minutes: '0',
      header_bg_color: '',
      header_accent_color: '',
      ...overrides,
    },
  },
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('AdminSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.user = { ...DEFAULT_TEST_USER };
    mockAdminSettings.get.mockResolvedValue(makeSettingsData());
    mockAdminSettings.update.mockResolvedValue({ success: true });
    mockAdminSettings.saveHeaderColors.mockResolvedValue({ success: true });
    mockRefreshTenant.mockResolvedValue(undefined);
  });

  it('shows loading spinner while fetching settings', async () => {
    mockAdminSettings.get.mockReturnValue(new Promise(() => {}));
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders settings page title after successful load', async () => {
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => {
      // "Admin Settings" is the actual English text for system.admin_settings_title
      expect(screen.getByText('Admin Settings')).toBeInTheDocument();
    });
  });

  it('renders SystemConfig stub after load', async () => {
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('system-config-stub')).toBeInTheDocument();
    });
  });

  it('shows error toast when settings API fails', async () => {
    mockAdminSettings.get.mockRejectedValue(new Error('network'));
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load settings');
    });
  });

  it('shows "no changes" info when saving without modifying anything', async () => {
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => screen.getByText('Admin Settings'));

    // Find the save button — "Save settings" in English
    const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === 'Save settings'
    );
    if (saveBtn) {
      await userEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('No changes to save');
      });
    } else {
      // Save button may have an icon child — check loosely
      const btns = screen.getAllByRole('button');
      const saveBtnLoose = btns.find((b) => b.textContent?.includes('Save settings'));
      expect(saveBtnLoose).toBeDefined();
    }
  });

  it('shows registration section with switches', async () => {
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => {
      // "Registration & Access" is the English text for system.section_registration_access
      expect(screen.getByText('Registration & Access')).toBeInTheDocument();
    });
    // Open registration switch
    expect(screen.getByText('Open Registration')).toBeInTheDocument();
  });

  it('shows maintenance mode read-only switch as disabled', async () => {
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => screen.getByText('Admin Settings'));

    // Find switch whose aria-label contains "Maintenance Mode"
    const maintenanceSwitch = screen.getAllByRole('switch').find((el) =>
      el.getAttribute('aria-label')?.includes('Maintenance Mode') ||
      el.getAttribute('aria-label')?.includes('maintenance')
    );
    if (maintenanceSwitch) {
      expect(maintenanceSwitch).toBeDisabled();
    } else {
      // Maintenance mode section may render as text only (read-only note)
      expect(screen.getByText('Maintenance mode (read only)')).toBeInTheDocument();
    }
  });

  it('shows branding and legal section', async () => {
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => {
      // "Branding & Legal" is the English for system.section_branding_legal
      expect(screen.getByText('Branding & Legal')).toBeInTheDocument();
    });
  });

  it('loads and saves the partner logo label', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({
      partner_logo_label: 'Community sponsor',
    }));

    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    const labelInput = await screen.findByDisplayValue('Community sponsor');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Local partner');

    const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Save settings'));
    expect(saveBtn).toBeDefined();
    await userEvent.click(saveBtn!);

    await waitFor(() => {
      expect(mockAdminSettings.update).toHaveBeenCalledWith({ partner_logo_label: 'Local partner' });
    });
  });

  it('does NOT show god-only Powered By section for non-god user', async () => {
    // Default user has is_god: false
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => screen.getByText('Admin Settings'));

    // "Powered By Branding" section (system.powered_by_branding_section) should not appear
    expect(screen.queryByText('Powered By Branding')).not.toBeInTheDocument();
  });

  it('calls get API on mount', async () => {
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => {
      expect(mockAdminSettings.get).toHaveBeenCalled();
    });
  });

  it('shows the save settings button after load', async () => {
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => screen.getByText('Admin Settings'));

    const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save settings')
    );
    expect(saveBtn).toBeDefined();
  });
  // F-054: email verification and member approval are platform-super-admin-only
  // on the server; a plain admin's save must not carry them or it 403s.
  describe('platform-super-admin-only registration settings (F-054)', () => {
    const findSwitch = (label: string) =>
      screen.getAllByRole('switch').find((el) => el.getAttribute('aria-label') === label);

    it('locks email verification and admin approval for a plain admin', async () => {
      mockAuthState.user = { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true };
      const { AdminSettings } = await import('./AdminSettings');
      render(<AdminSettings />);

      await waitFor(() => screen.getByText('Admin Settings'));
      expect(findSwitch('Email Verification')).toBeDisabled();
      expect(findSwitch('Admin Approval')).toBeDisabled();
      expect(screen.getAllByText('Super admin only').length).toBeGreaterThanOrEqual(2);
    });

    it('locks them for a tenant super-admin too (platform tier only)', async () => {
      mockAuthState.user = { id: 6, name: 'Tenant Super', role: 'tenant_admin', is_tenant_super_admin: true };
      const { AdminSettings } = await import('./AdminSettings');
      render(<AdminSettings />);

      await waitFor(() => screen.getByText('Admin Settings'));
      expect(findSwitch('Email Verification')).toBeDisabled();
      expect(findSwitch('Admin Approval')).toBeDisabled();
    });

    it('omits the reserved keys when a plain admin saves other fields', async () => {
      mockAuthState.user = { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true };
      mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Sponsor' }));
      const { AdminSettings } = await import('./AdminSettings');
      render(<AdminSettings />);

      const labelInput = await screen.findByDisplayValue('Sponsor');
      await userEvent.clear(labelInput);
      await userEvent.type(labelInput, 'Partner');
      const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Save settings'));
      await userEvent.click(saveBtn!);

      await waitFor(() => expect(mockAdminSettings.update).toHaveBeenCalledTimes(1));
      const payload = mockAdminSettings.update.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).toEqual({ partner_logo_label: 'Partner' });
      expect(payload).not.toHaveProperty('email_verification');
      expect(payload).not.toHaveProperty('admin_approval');
      expect(payload).not.toHaveProperty('maintenance_mode');
    });

    it('lets a platform super-admin change email verification', async () => {
      mockAuthState.user = { id: 1, name: 'Platform', role: 'admin', is_god: true };
      const { AdminSettings } = await import('./AdminSettings');
      render(<AdminSettings />);

      await waitFor(() => screen.getByText('Admin Settings'));
      const emailSwitch = findSwitch('Email Verification')!;
      expect(emailSwitch).not.toBeDisabled();
      expect(findSwitch('Admin Approval')).not.toBeDisabled();
      await userEvent.click(emailSwitch);

      const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Save settings'));
      await userEvent.click(saveBtn!);

      await waitFor(() => {
        expect(mockAdminSettings.update).toHaveBeenCalledWith({ email_verification: 'false' });
      });
    });
  });
});
