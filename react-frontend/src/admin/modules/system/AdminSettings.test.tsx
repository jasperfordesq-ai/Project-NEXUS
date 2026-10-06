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
const { mockAdminSettings, mockAdminEnterprise } = vi.hoisted(() => ({
  mockAdminSettings: {
    get: vi.fn(),
    update: vi.fn(),
    uploadPartnerLogo: vi.fn(),
    uploadPoweredByImageLight: vi.fn(),
    uploadPoweredByImageDark: vi.fn(),
    uploadNetworkPoweredByImageLight: vi.fn(),
    uploadNetworkPoweredByImageDark: vi.fn(),
    uploadHeaderLogo: vi.fn(),
    uploadHeaderLogoDark: vi.fn(),
    removeHeaderLogo: vi.fn(),
    removeHeaderLogoDark: vi.fn(),
    saveHeaderColors: vi.fn(),
  },
  mockAdminEnterprise: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    resetConfig: vi.fn(),
  },
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockRefreshTenant = vi.hoisted(() => vi.fn());
const mockConfirm = vi.hoisted(() => vi.fn());

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

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => vi.fn() };
});

vi.mock('../../api/adminApi', () => ({
  adminSettings: mockAdminSettings,
  adminEnterprise: mockAdminEnterprise,
}));
vi.mock('@/admin/api/adminApi', () => ({
  adminSettings: mockAdminSettings,
  adminEnterprise: mockAdminEnterprise,
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('../../components/PageHeader', () => ({
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
    useConfirm: () => mockConfirm,
    Select: ({ children, label, 'aria-label': ariaLabel, onSelectionChange, selectedKeys }: {
      children: React.ReactNode; label?: string; 'aria-label'?: string;
      onSelectionChange?: (keys: Set<string>) => void; selectedKeys?: string[];
    }) => (
      <select
        aria-label={label || ariaLabel || 'select'}
        value={selectedKeys?.[0] ?? ''}
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
    // The three-way registration control, as a radio group the tests can drive.
    ToggleButtonGroup: ({ children, selectedKeys, onSelectionChange, 'aria-label': ariaLabel }: {
      children: React.ReactNode; selectedKeys?: Set<string>; onSelectionChange?: (keys: Set<string>) => void; 'aria-label'?: string;
    }) => (
      <div role="radiogroup" aria-label={ariaLabel} data-selected={Array.from(selectedKeys ?? []).join(',')}>
        {React.Children.map(children, (child) =>
          React.isValidElement<{ id: string; children: React.ReactNode }>(child)
            ? React.cloneElement(child, {
                // @ts-expect-error — test-only props understood by the ToggleButton stub below
                selected: selectedKeys?.has(child.props.id),
                onSelect: () => onSelectionChange?.(new Set([child.props.id])),
              })
            : child,
        )}
      </div>
    ),
    ToggleButton: ({ id, children, selected, onSelect }: {
      id: string; children: React.ReactNode; selected?: boolean; onSelect?: () => void;
    }) => (
      <button type="button" role="radio" aria-checked={Boolean(selected)} data-id={id} onClick={onSelect}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Dropdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DropdownTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    DropdownMenu: ({ children, onAction }: { children?: React.ReactNode; onAction?: (key: string) => void }) => (
      <div data-testid="more-menu">
        {React.Children.map(children, (child) =>
          React.isValidElement<{ id: string; children: React.ReactNode }>(child) ? (
            <button type="button" onClick={() => onAction?.(child.props.id)}>{child.props.children}</button>
          ) : child,
        )}
      </div>
    ),
    DropdownItem: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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
      region: 'IE',
      inactivity_timeout_minutes: '0',
      header_bg_color: '',
      header_accent_color: '',
      ...overrides,
    },
  },
});

const makeEnterpriseConfig = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    timezone: 'UTC',
    locale: 'en',
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
  },
});

const isDisabled = (el: HTMLElement) =>
  el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('data-disabled') === 'true';

const getSaveButton = () => screen.getByRole('button', { name: /save all changes/i });
const getDiscardButton = () => screen.getByRole('button', { name: /^discard$/i });
const findSwitch = (label: string) =>
  screen.getAllByRole('switch').find((el) => el.getAttribute('aria-label') === label);

async function renderPage() {
  const { AdminSettings } = await import('./AdminSettings');
  render(<AdminSettings />);
  await waitFor(() => expect(screen.getByText('Admin Settings')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Registration & Access' })).toBeInTheDocument());
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('AdminSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.user = { ...DEFAULT_TEST_USER };
    mockAdminSettings.get.mockResolvedValue(makeSettingsData());
    mockAdminSettings.update.mockResolvedValue({ success: true });
    mockAdminSettings.saveHeaderColors.mockResolvedValue({ success: true });
    mockAdminEnterprise.getConfig.mockResolvedValue(makeEnterpriseConfig());
    mockAdminEnterprise.updateConfig.mockResolvedValue({ success: true });
    mockAdminEnterprise.resetConfig.mockResolvedValue({ success: true });
    mockRefreshTenant.mockResolvedValue(undefined);
    mockConfirm.mockResolvedValue(true);
  });

  it('shows a busy skeleton while fetching settings', async () => {
    mockAdminSettings.get.mockReturnValue(new Promise(() => {}));
    mockAdminEnterprise.getConfig.mockReturnValue(new Promise(() => {}));
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    const statusEls = screen.getAllByRole('status');
    expect(statusEls.find((el) => el.getAttribute('aria-busy') === 'true')).toBeDefined();
  });

  it('renders the title, every section and the jump links after load', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Branding & Legal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Header Logo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Accessible header colour' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wallet & credits' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Related admin pages' })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Jump to section' });
    expect(nav.querySelectorAll('a[href^="#settings-section-"]').length).toBeGreaterThanOrEqual(10);
  });

  it('calls both GET APIs on mount and shows an error toast when settings fail', async () => {
    mockAdminSettings.get.mockRejectedValue(new Error('network'));
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to load settings'));
    expect(mockAdminSettings.get).toHaveBeenCalled();
    expect(mockAdminEnterprise.getConfig).toHaveBeenCalled();
  });

  it('keeps Save disabled and reads "All changes saved" when nothing changed', async () => {
    await renderPage();
    expect(screen.getByRole('region', { name: 'Save or discard changes' })).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(isDisabled(getSaveButton())).toBe(true);
    expect(isDisabled(getDiscardButton())).toBe(true);
    expect(mockAdminSettings.update).not.toHaveBeenCalled();
  });

  it('shows the unsaved chip and a dot on the edited section only', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Community sponsor' }));
    await renderPage();

    const labelInput = await screen.findByDisplayValue('Community sponsor');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Local partner');

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Jump to section' });
    const dirtyPills = nav.querySelectorAll('a[data-dirty="true"]');
    expect(dirtyPills).toHaveLength(1);
    expect(dirtyPills[0]).toHaveAttribute('href', '#settings-section-branding');
  });

  it('saves only the changed main-form field and refreshes the tenant', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Community sponsor' }));
    await renderPage();

    const labelInput = await screen.findByDisplayValue('Community sponsor');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Local partner');
    await userEvent.click(getSaveButton());

    await waitFor(() => {
      expect(mockAdminSettings.update).toHaveBeenCalledWith({ partner_logo_label: 'Local partner' });
    });
    expect(mockAdminSettings.saveHeaderColors).not.toHaveBeenCalled();
    expect(mockAdminEnterprise.updateConfig).not.toHaveBeenCalled();
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Settings Saved'));
    expect(mockRefreshTenant).toHaveBeenCalled();
  });

  it('one Save writes both halves, main form first, with a single success toast', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Sponsor' }));
    await renderPage();

    const labelInput = await screen.findByDisplayValue('Sponsor');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Partner');

    const currencyName = screen.getByRole('textbox', { name: /currency name/i });
    await userEvent.clear(currencyName);
    await userEvent.type(currencyName, 'Credits');

    await userEvent.click(getSaveButton());

    await waitFor(() => expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledWith({ currency_name: 'Credits' }));
    expect(mockAdminSettings.update).toHaveBeenCalledWith({ partner_logo_label: 'Partner' });
    expect(mockAdminSettings.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockAdminEnterprise.updateConfig.mock.invocationCallOrder[0]!,
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledTimes(1));
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('reports a partial failure and keeps the failed half dirty', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Sponsor' }));
    mockAdminEnterprise.updateConfig.mockResolvedValue({ success: false, error: 'nope' });
    await renderPage();

    const labelInput = await screen.findByDisplayValue('Sponsor');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Partner');
    const currencyName = screen.getByRole('textbox', { name: /currency name/i });
    await userEvent.clear(currencyName);
    await userEvent.type(currencyName, 'Credits');

    await userEvent.click(getSaveButton());

    await waitFor(() => expect(mockToast.warning).toHaveBeenCalledTimes(1));
    expect(String(mockToast.warning.mock.calls[0]?.[0])).toContain('additional configuration');
    // The additional-configuration half did not reload, so it is still dirty.
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('Discard restores both halves', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Sponsor' }));
    await renderPage();

    const labelInput = await screen.findByDisplayValue('Sponsor');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Partner');
    const currencyName = screen.getByRole('textbox', { name: /currency name/i });
    await userEvent.clear(currencyName);
    await userEvent.type(currencyName, 'Credits');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await userEvent.click(getDiscardButton());

    expect(screen.getByDisplayValue('Sponsor')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hours')).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('Reset in the more-menu asks first, then resets and reloads both halves', async () => {
    await renderPage();
    const getCalls = mockAdminSettings.get.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Reset additional configuration to defaults' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockConfirm.mock.calls[0]?.[0]).toMatchObject({ status: 'danger' });
    await waitFor(() => expect(mockAdminEnterprise.resetConfig).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockAdminSettings.get.mock.calls.length).toBeGreaterThan(getCalls));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Additional configuration reset to defaults'));
  });

  it('does not reset when the admin cancels the confirmation', async () => {
    mockConfirm.mockResolvedValue(false);
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Reset additional configuration to defaults' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockAdminEnterprise.resetConfig).not.toHaveBeenCalled();
  });

  it('sends the region when it changes', async () => {
    await renderPage();
    const regionSelect = screen.getByRole('combobox', { name: 'Date and number format' });
    fireEvent.change(regionSelect, { target: { value: 'GB' } });
    await userEvent.click(getSaveButton());
    await waitFor(() => expect(mockAdminSettings.update).toHaveBeenCalledWith({ region: 'GB' }));
  });

  describe('registration mode (three-way)', () => {
    const getRadio = (name: RegExp) => screen.getByRole('radio', { name });

    it('shows the loaded mode and sends invite_only when chosen', async () => {
      await renderPage();
      expect(getRadio(/^open$/i)).toHaveAttribute('aria-checked', 'true');
      expect(getRadio(/invite only/i)).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(getRadio(/invite only/i));
      expect(screen.getByText(/Only people with an invitation code or link/)).toBeInTheDocument();
      await userEvent.click(getSaveButton());
      await waitFor(() => expect(mockAdminSettings.update).toHaveBeenCalledWith({ registration_mode: 'invite_only' }));
    });

    it('loads the legacy "invite" alias as Invite only and does not downgrade it', async () => {
      mockAdminSettings.get.mockResolvedValue(makeSettingsData({ registration_mode: 'invite' }));
      await renderPage();
      expect(getRadio(/invite only/i)).toHaveAttribute('aria-checked', 'true');
      expect(isDisabled(getSaveButton())).toBe(true);
    });
  });

  it('shows the maintenance mode switch as read only', async () => {
    await renderPage();
    expect(findSwitch('Maintenance Mode')).toBeDisabled();
    expect(screen.getByText('Maintenance mode (read only)')).toBeInTheDocument();
  });

  it('does NOT show the god-only Powered-by section for a non-god user', async () => {
    await renderPage();
    expect(screen.queryByText('Powered-by branding')).not.toBeInTheDocument();
    expect(screen.queryByText('Powered By Branding')).not.toBeInTheDocument();
  });

  it('shows the Powered-by section for a platform god', async () => {
    mockAuthState.user = { id: 1, name: 'Platform', role: 'admin', is_god: true };
    await renderPage();
    expect(screen.getByText('God only')).toBeInTheDocument();
  });

  // The network badge is what a hub (e.g. Timebanking UK) hands down to every
  // community under it; its own footer keeps the separate badge above.
  it('lets a platform god set the badge for communities under this one', async () => {
    mockAuthState.user = { id: 1, name: 'Platform', role: 'admin', is_god: true };
    await renderPage();

    expect(screen.getByText("This community's badge")).toBeInTheDocument();
    expect(screen.getByText('Badge for communities under this one')).toBeInTheDocument();

    // Two wording choices: this community's own, then the network badge.
    const [, networkWording] = screen.getAllByRole('combobox', { name: 'Wording' });
    fireEvent.change(networkWording!, { target: { value: 'provided_by' } });
    await userEvent.click(getSaveButton());

    // The translated choice is stored as a key, never as English text.
    await waitFor(() => {
      expect(mockAdminSettings.update).toHaveBeenCalledWith({ network_powered_by_wording: 'provided_by' });
    });
  });

  it('treats a label saved before the wording choice as custom text, and clears it on switching', async () => {
    mockAuthState.user = { id: 1, name: 'Platform', role: 'admin', is_god: true };
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ powered_by_label: 'Provided By' }));
    await renderPage();

    const [ownWording] = screen.getAllByRole('combobox', { name: 'Wording' });
    expect(ownWording).toHaveValue('custom');
    expect(screen.getByDisplayValue('Provided By')).toBeInTheDocument();

    fireEvent.change(ownWording!, { target: { value: 'provided_by' } });
    expect(screen.queryByDisplayValue('Provided By')).not.toBeInTheDocument();
    await userEvent.click(getSaveButton());

    await waitFor(() => {
      expect(mockAdminSettings.update).toHaveBeenCalledWith({ powered_by_wording: 'provided_by', powered_by_label: '' });
    });
  });

  it('stores the default "Powered by" choice as an empty value', async () => {
    mockAuthState.user = { id: 1, name: 'Platform', role: 'admin', is_god: true };
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ network_powered_by_wording: 'provided_by' }));
    await renderPage();

    const [, networkWording] = screen.getAllByRole('combobox', { name: 'Wording' });
    expect(networkWording).toHaveValue('provided_by');
    fireEvent.change(networkWording!, { target: { value: 'powered_by' } });
    await userEvent.click(getSaveButton());

    await waitFor(() => {
      expect(mockAdminSettings.update).toHaveBeenCalledWith({ network_powered_by_wording: '' });
    });
  });

  it('never sends network badge settings for a non-god admin', async () => {
    mockAuthState.user = { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true };
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Sponsor', network_powered_by_label: 'X' }));
    await renderPage();

    expect(screen.queryByText('Badge for communities under this one')).not.toBeInTheDocument();
    const labelInput = await screen.findByDisplayValue('Sponsor');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Partner');
    await userEvent.click(getSaveButton());

    await waitFor(() => expect(mockAdminSettings.update).toHaveBeenCalledTimes(1));
    expect(mockAdminSettings.update.mock.calls[0]?.[0]).toEqual({ partner_logo_label: 'Partner' });
  });

  // F-054: email verification and member approval are platform-super-admin-only
  // on the server; a plain admin's save must not carry them or it 403s.
  describe('platform-super-admin-only registration settings (F-054)', () => {
    it('locks email verification and admin approval for a plain admin', async () => {
      mockAuthState.user = { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true };
      await renderPage();
      expect(findSwitch('Email Verification')).toBeDisabled();
      expect(findSwitch('Admin Approval')).toBeDisabled();
      expect(screen.getAllByText('Super admin only').length).toBeGreaterThanOrEqual(2);
    });

    it('locks them for a tenant super-admin too (platform tier only)', async () => {
      mockAuthState.user = { id: 6, name: 'Tenant Super', role: 'tenant_admin', is_tenant_super_admin: true };
      await renderPage();
      expect(findSwitch('Email Verification')).toBeDisabled();
      expect(findSwitch('Admin Approval')).toBeDisabled();
    });

    it('omits the reserved keys when a plain admin saves other fields', async () => {
      mockAuthState.user = { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true };
      mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Sponsor' }));
      await renderPage();

      const labelInput = await screen.findByDisplayValue('Sponsor');
      await userEvent.clear(labelInput);
      await userEvent.type(labelInput, 'Partner');
      await userEvent.click(getSaveButton());

      await waitFor(() => expect(mockAdminSettings.update).toHaveBeenCalledTimes(1));
      const payload = mockAdminSettings.update.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).toEqual({ partner_logo_label: 'Partner' });
      expect(payload).not.toHaveProperty('email_verification');
      expect(payload).not.toHaveProperty('admin_approval');
      expect(payload).not.toHaveProperty('maintenance_mode');
    });

    it('lets a platform super-admin change email verification', async () => {
      mockAuthState.user = { id: 1, name: 'Platform', role: 'admin', is_god: true };
      await renderPage();
      const emailSwitch = findSwitch('Email Verification')!;
      expect(emailSwitch).not.toBeDisabled();
      expect(findSwitch('Admin Approval')).not.toBeDisabled();
      await userEvent.click(emailSwitch);
      await userEvent.click(getSaveButton());

      await waitFor(() => {
        expect(mockAdminSettings.update).toHaveBeenCalledWith({ email_verification: 'false' });
      });
    });
  });
});
