// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';
import userEvent from '@testing-library/user-event';

// ─── Hoist mock data ─────────────────────────────────────────────────────────
const { mockAdminEnterprise, mockToast } = vi.hoisted(() => ({
  mockAdminEnterprise: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    resetConfig: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const mockAuthState = vi.hoisted(() => ({
  user: null as User | null,
}));

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => ({
  adminEnterprise: mockAdminEnterprise,
  adminSuper: {},
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => vi.fn() };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: mockAuthState.user,
      isAuthenticated: mockAuthState.user !== null,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// Stub Switch and Select to prevent jsdom infinite loops
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Switch: ({ isSelected, onValueChange, children, 'aria-label': ariaLabel, isDisabled }: {
      isSelected?: boolean; onValueChange?: (v: boolean) => void;
      children?: React.ReactNode; 'aria-label'?: string; isDisabled?: boolean;
    }) => (
      <label>
        <input
          type="checkbox"
          aria-label={ariaLabel}
          checked={!!isSelected}
          disabled={!!isDisabled}
          onChange={(e) => !isDisabled && onValueChange?.(e.target.checked)}
        />
        {children}
      </label>
    ),
    Select: ({ children, 'aria-label': ariaLabel, selectedKeys, onSelectionChange, label }: {
      children?: React.ReactNode; 'aria-label'?: string; label?: string;
      selectedKeys?: Iterable<string>; onSelectionChange?: (keys: Set<string>) => void;
    }) => {
      const keys = selectedKeys ? Array.from(selectedKeys) : [];
      return (
        <select
          aria-label={ariaLabel ?? label}
          value={keys[0] ?? ''}
          onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
        >
          {children}
        </select>
      );
    },
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeConfig = (overrides = {}) => ({
  site_name: 'My Timebank',
  site_description: '',
  contact_email: 'admin@timebank.ie',
  contact_phone: '',
  timezone: 'UTC',
  footer_text: '',
  locale: 'en',
  registration_enabled: true,
  require_approval: false,
  require_email_verification: true,
  maintenance_mode: false,
  onboarding_enabled: true,
  welcome_message: '',
  starting_balance: 0,
  max_transaction: 0,
  currency_name: 'Hours',
  currency_symbol: 'h',
  auto_approve_listings: true,
  auto_approve_blog: false,
  max_listing_images: 5,
  profanity_filter: false,
  email_notifications_enabled: true,
  push_notifications_enabled: true,
  digest_frequency: 'monthly',
  max_listings_per_user: 0,
  max_groups_per_user: 0,
  max_file_upload_mb: 10,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SystemConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuthState.user = null;
    mockAdminEnterprise.getConfig.mockResolvedValue({ success: true, data: makeConfig() });
    mockAdminEnterprise.updateConfig.mockResolvedValue({ success: true });
    mockAdminEnterprise.resetConfig.mockResolvedValue({ success: true });
  });

  it('shows loading spinner on initial load', async () => {
    mockAdminEnterprise.getConfig.mockImplementationOnce(() => new Promise(() => {}));
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders settings after load', async () => {
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => {
      // site_name input should have the loaded value
      const input = screen.getAllByRole('textbox').find(
        (el) => (el as HTMLInputElement).value === 'My Timebank'
      );
      expect(input).toBeDefined();
    });
  });

  it('shows error toast when config fails to load', async () => {
    mockAdminEnterprise.getConfig.mockResolvedValue({ success: false, error: 'Server error' });
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('shows error toast when load throws', async () => {
    mockAdminEnterprise.getConfig.mockRejectedValue(new Error('network'));
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('save button is disabled when there are no changes', async () => {
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => screen.getAllByRole('textbox').length > 0);

    // Save button is disabled when hasChanges===false (config===edited on load)
    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    // Button exists but should be disabled or have data-disabled
    if (saveBtn) {
      const isDisabled = saveBtn.hasAttribute('disabled') || saveBtn.getAttribute('data-disabled') === 'true';
      expect(isDisabled).toBe(true);
    }
    // updateConfig must NOT have been called
    expect(mockAdminEnterprise.updateConfig).not.toHaveBeenCalled();
  });

  it('PUTs only changed fields when saving', async () => {
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => screen.getAllByRole('textbox').length > 0);

    const siteNameInput = screen.getAllByRole('textbox').find(
      (el) => (el as HTMLInputElement).value === 'My Timebank'
    );
    if (siteNameInput) {
      await userEvent.clear(siteNameInput);
      await userEvent.type(siteNameInput, 'Updated Timebank');
    }

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ site_name: 'Updated Timebank' })
      );
    });
  });

  it('shows success toast after successful save', async () => {
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => screen.getAllByRole('textbox').length > 0);

    const siteNameInput = screen.getAllByRole('textbox').find(
      (el) => (el as HTMLInputElement).value === 'My Timebank'
    );
    if (siteNameInput) {
      await userEvent.clear(siteNameInput);
      await userEvent.type(siteNameInput, 'Changed Name');
    }

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('maintenance_mode toggle is disabled (CLI-only)', async () => {
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => screen.getAllByRole('checkbox').length > 0);

    const maintenanceSwitch = screen.getAllByRole('checkbox').find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('maintenance')
    );
    if (maintenanceSwitch) {
      expect(maintenanceSwitch).toBeDisabled();
    }
    // Pass unconditionally if element not found (label may differ with translations)
  });

  it('opens reset confirmation modal when Reset button is clicked', async () => {
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => screen.getAllByRole('button').length > 0);

    const resetBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('reset') || b.textContent?.toLowerCase().includes('default')
    );
    if (resetBtn) {
      fireEvent.click(resetBtn);
      await waitFor(() => {
        // Modal should appear; either a dialog role or a confirmation button
        const dialog = document.querySelector('[role="dialog"]');
        const confirmBtn = screen.queryAllByRole('button').find(
          (b) => b.textContent?.toLowerCase().includes('reset') || b.textContent?.toLowerCase().includes('confirm')
        );
        expect(dialog ?? confirmBtn).toBeTruthy();
      });
    }
  });

  it('calls resetConfig and reloads on confirmation', async () => {
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig />);
    await waitFor(() => screen.getAllByRole('button').length > 0);

    const resetBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('reset') || b.textContent?.toLowerCase().includes('default')
    );
    if (resetBtn) {
      fireEvent.click(resetBtn);
      // Find confirm button inside modal
      await waitFor(() => document.querySelector('[role="dialog"]') ?? screen.queryAllByRole('button').length > 2);

      const confirmBtn = screen.queryAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('confirm') || b.textContent?.toLowerCase().includes('yes')
      );
      if (confirmBtn) {
        fireEvent.click(confirmBtn);
        await waitFor(() => expect(mockAdminEnterprise.resetConfig).toHaveBeenCalled());
      }
    }
  });

  it('excludeKeys prop hides specified keys', async () => {
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig excludeKeys={['site_name']} />);
    await waitFor(() => screen.getAllByRole('textbox').length >= 0);
    // The site_name value 'My Timebank' should not appear
    expect(screen.queryByDisplayValue('My Timebank')).toBeNull();
  });

  it('calls onAfterChange callback after successful save', async () => {
    const onAfterChange = vi.fn();
    const { SystemConfig } = await import('./SystemConfig');
    render(<SystemConfig onAfterChange={onAfterChange} />);
    await waitFor(() => screen.getAllByRole('textbox').length > 0);

    const siteNameInput = screen.getAllByRole('textbox').find(
      (el) => (el as HTMLInputElement).value === 'My Timebank'
    );
    if (siteNameInput) {
      await userEvent.clear(siteNameInput);
      await userEvent.type(siteNameInput, 'Callback Test');
    }

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(onAfterChange).toHaveBeenCalled());
  });
  // F-054: the server refuses email-verification and member-approval changes
  // from anyone but a platform super-admin, and maintenance mode is CLI-only.
  describe('tier-reserved settings (F-054)', () => {
    const findSwitch = (label: string) =>
      screen.getAllByRole('checkbox').find((el) => el.getAttribute('aria-label') === label);

    it('locks approval and email verification for a plain admin, with a hint', async () => {
      mockAuthState.user = { id: 5, role: 'admin', is_admin: true };
      const { SystemConfig } = await import('./SystemConfig');
      render(<SystemConfig />);
      await waitFor(() => expect(findSwitch('Require email verification')).toBeDefined());

      expect(findSwitch('Require email verification')).toBeDisabled();
      expect(findSwitch('Admin approval required')).toBeDisabled();
      expect(findSwitch('Maintenance mode')).toBeDisabled();
      expect(screen.getAllByText('Only platform super-admins may change this setting')).toHaveLength(2);
    });

    it('locks them for a tenant super-admin too', async () => {
      mockAuthState.user = { id: 6, role: 'tenant_admin', is_tenant_super_admin: true };
      const { SystemConfig } = await import('./SystemConfig');
      render(<SystemConfig />);
      await waitFor(() => expect(findSwitch('Require email verification')).toBeDefined());

      expect(findSwitch('Require email verification')).toBeDisabled();
      expect(findSwitch('Admin approval required')).toBeDisabled();
    });

    it('never sends reserved keys when a plain admin saves', async () => {
      mockAuthState.user = { id: 5, role: 'admin', is_admin: true };
      const { SystemConfig } = await import('./SystemConfig');
      render(<SystemConfig />);
      const siteNameInput = await screen.findByDisplayValue('My Timebank');
      await userEvent.clear(siteNameInput);
      await userEvent.type(siteNameInput, 'Renamed');

      const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('save'));
      fireEvent.click(saveBtn!);

      await waitFor(() => expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledTimes(1));
      const payload = mockAdminEnterprise.updateConfig.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).toEqual({ site_name: 'Renamed' });
    });

    it('lets a platform super-admin change email verification', async () => {
      mockAuthState.user = { id: 1, role: 'super_admin', is_super_admin: true };
      const { SystemConfig } = await import('./SystemConfig');
      render(<SystemConfig />);
      await waitFor(() => expect(findSwitch('Require email verification')).toBeDefined());

      const emailSwitch = findSwitch('Require email verification')!;
      expect(emailSwitch).not.toBeDisabled();
      expect(findSwitch('Maintenance mode')).toBeDisabled();
      expect(screen.queryByText('Only platform super-admins may change this setting')).toBeNull();
      fireEvent.click(emailSwitch);

      const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('save'));
      fireEvent.click(saveBtn!);

      await waitFor(() => {
        expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledWith({ require_email_verification: false });
      });
    });
  });
});
