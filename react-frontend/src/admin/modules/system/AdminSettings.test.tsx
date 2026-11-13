// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
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
  },
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockRefreshTenant = vi.hoisted(() => vi.fn());

// The Joining box also shows the sign-up pause panel and, for Invite only, the
// invite codes; both read /v2/admin/* through the plain API client.
const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
const BREAKER_HEALTHY = { tripped: false, count_in_current_hour: 3, threshold: 20, auto_resume_in_seconds: null };
const INVITE_CODES = {
  items: [{ id: 7, code: 'RIVER-123', max_uses: 5, uses_count: 1, note: 'Coffee morning', is_active: 1, expires_at: null, created_at: '2026-11-01', creator_name: 'Sam' }],
  total: 1,
};
// The page asks before leaving with unsaved changes (useUnsavedChangesGuard).
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
    // The time zone picker, as a plain select the tests can drive.
    ComboBox: ({ items, children, selectedKey, onSelectionChange, 'aria-label': ariaLabel }: {
      items?: Array<{ id: string; label: string }>; children: (item: { id: string; label: string }) => React.ReactNode;
      selectedKey?: string; onSelectionChange?: (key: string) => void; 'aria-label'?: string;
    }) => (
      <select aria-label={ariaLabel} value={selectedKey ?? ''} onChange={(e) => onSelectionChange?.(e.target.value)}>
        {(items ?? []).map((item) => <React.Fragment key={item.id}>{children(item)}</React.Fragment>)}
      </select>
    ),
    ComboBoxItem: ({ children, id }: { children: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
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

// What the endpoint really answers: every key it knows, including the ones this
// page no longer offers.
const makeEnterpriseConfig = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    timezone: 'UTC',
    locale: 'en',
    onboarding_enabled: true,
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

const getStartingBalance = () => screen.getByRole('spinbutton', { name: 'Starting balance (hours)' });

async function renderPage() {
  const { AdminSettings } = await import('./AdminSettings');
  render(<AdminSettings />);
  await waitFor(() => expect(screen.getByText('Community settings')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Joining and signing in' })).toBeInTheDocument());
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
    mockRefreshTenant.mockResolvedValue(undefined);
    mockApi.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/registration/breaker')
          ? { success: true, data: BREAKER_HEALTHY }
          : url.includes('/invite-codes')
            ? { success: true, data: INVITE_CODES }
            : { success: true, data: null },
      ),
    );
  });

  it('shows a busy skeleton while fetching settings', async () => {
    mockAdminSettings.get.mockReturnValue(new Promise(() => {}));
    mockAdminEnterprise.getConfig.mockReturnValue(new Promise(() => {}));
    const { AdminSettings } = await import('./AdminSettings');
    render(<AdminSettings />);

    const statusEls = screen.getAllByRole('status');
    expect(statusEls.find((el) => el.getAttribute('aria-busy') === 'true')).toBeDefined();
  });

  // Owner, 13 Nov 2026: what lives on "Make it yours" must not also be here.
  it('does not repeat the logo, the colours or the community photo, and says where they are', async () => {
    await renderPage();

    for (const name of ['Header Logo', 'Community colour', 'Community photo', 'Accessible header colour']) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    const nav = screen.getByRole('navigation', { name: 'Jump to section' });
    for (const anchor of ['header-logo', 'community-colour', 'community-photo', 'header-colours']) {
      expect(nav.querySelector(`a[href="#settings-section-${anchor}"]`)).toBeNull();
    }
    expect(screen.queryByTestId('community-colour-preview')).toBeNull();
    expect(screen.queryByTestId('header-colour-preview')).toBeNull();
    expect(screen.getByTestId('settings-moved-notice')).toHaveTextContent("your accessible site's header colour");

    const notice = screen.getByTestId('settings-moved-notice');
    expect(notice).toHaveTextContent('Looking for your logo, colours or community photo?');
    const link = notice.querySelector('a');
    expect(link).toHaveTextContent('Open Make it yours');
    expect(link?.getAttribute('href')).toMatch(/\/admin\/make-it-yours$/);
  });

  it('groups the page by what an admin comes to do, with a jump link for each group', async () => {
    mockAuthState.user = { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true };
    await renderPage();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((el) => el.textContent);
    expect(headings).toEqual([
      'Looking for your logo, colours or community photo?',
      'About your community',
      'Joining and signing in',
      'Time credits',
      'Dates, times and money',
      'Footer',
      'More settings on other pages',
    ]);

    const nav = screen.getByRole('navigation', { name: 'Jump to section' });
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
      '#settings-section-about',
      '#settings-section-joining',
      '#settings-section-time-credits',
      '#settings-section-dates-money',
      '#settings-section-footer',
      '#settings-section-related',
    ]);
  });

  // Owner, 13 Nov 2026. Ten of these saved to keys nothing reads, so changing
  // them did nothing; the last three work but belong to another admin page
  // (Onboarding settings, Module Configuration).
  it('does not offer the settings that did nothing or that another page owns', async () => {
    await renderPage();

    for (const label of [
      /default locale/i, /currency name/i, /currency symbol/i,
      /auto-approve listings/i, /auto-approve blog/i,
      /email notifications enabled/i, /push notifications enabled/i, /digest frequency/i,
      /max groups per member/i, /max upload size/i,
      /show onboarding flow/i, /max listings per member/i, /max images per listing/i,
    ]) {
      expect(screen.queryByText(label)).toBeNull();
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    expect(screen.queryByRole('heading', { name: 'Additional configuration' })).toBeNull();
    // Three settings are left on the second endpoint; the money currency and
    // the date format are the main form's.
    expect(getStartingBalance()).toHaveValue(0);
    expect(screen.getByRole('spinbutton', { name: 'Largest single transfer (hours)' })).toHaveValue(0);
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveValue('UTC');
  });

  it('says where the settings that live elsewhere are', async () => {
    await renderPage();
    const related = document.getElementById('settings-section-related')!;
    const hrefs = Array.from(related.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/test/admin/onboarding-settings');
    expect(hrefs).toContain('/test/admin/module-configuration');
    expect(related).toHaveTextContent('including your languages and the limits on offers and requests');
  });

  // No colour is edited on this page any more, so no save from it may touch
  // the colours endpoint (which writes the community colour as well).
  it('never calls the colours endpoint, whatever is saved', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ footer_text: 'Old', header_bg_color: '#424285' }));
    await renderPage();

    const footer = await screen.findByDisplayValue('Old');
    await userEvent.clear(footer);
    await userEvent.type(footer, 'New');
    fireEvent.change(getStartingBalance(), { target: { value: '2' } });
    await userEvent.click(getSaveButton());

    await waitFor(() => expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledWith({ starting_balance: 2 }));
    expect(mockAdminSettings.update).toHaveBeenCalledWith({ footer_text: 'New' });
    expect(mockAdminSettings.saveHeaderColors).not.toHaveBeenCalled();
  });

  it('offers no reset or reload action beside Save', async () => {
    await renderPage();
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reload/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
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
    expect(dirtyPills[0]).toHaveAttribute('href', '#settings-section-footer');
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

    fireEvent.change(getStartingBalance(), { target: { value: '5' } });

    await userEvent.click(getSaveButton());

    await waitFor(() => expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledWith({ starting_balance: 5 }));
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
    fireEvent.change(getStartingBalance(), { target: { value: '5' } });

    await userEvent.click(getSaveButton());

    await waitFor(() => expect(mockToast.warning).toHaveBeenCalledTimes(1));
    expect(String(mockToast.warning.mock.calls[0]?.[0])).toContain('time zone and time credits');
    // That half did not reload, so it is still dirty.
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('Discard restores both halves', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Sponsor' }));
    await renderPage();

    const labelInput = await screen.findByDisplayValue('Sponsor');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Partner');
    fireEvent.change(getStartingBalance(), { target: { value: '5' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await userEvent.click(getDiscardButton());

    expect(screen.getByDisplayValue('Sponsor')).toBeInTheDocument();
    expect(getStartingBalance()).toHaveValue(0);
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('saves the time zone through the second endpoint and marks its own section', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Time zone' }), { target: { value: 'Europe/London' } });

    const nav = screen.getByRole('navigation', { name: 'Jump to section' });
    const dirtyPills = nav.querySelectorAll('a[data-dirty="true"]');
    expect(dirtyPills).toHaveLength(1);
    expect(dirtyPills[0]).toHaveAttribute('href', '#settings-section-dates-money');

    await userEvent.click(getSaveButton());
    await waitFor(() => expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledWith({ timezone: 'Europe/London' }));
    expect(mockAdminSettings.update).not.toHaveBeenCalled();
  });

  it('still shows a saved time zone this browser does not list', async () => {
    mockAdminEnterprise.getConfig.mockResolvedValue(makeEnterpriseConfig({ timezone: 'Mars/Olympus_Mons' }));
    await renderPage();
    const picker = screen.getByRole('combobox', { name: 'Time zone' });
    expect(picker).toHaveValue('Mars/Olympus_Mons');
    expect(picker).toHaveDisplayValue('Mars/Olympus Mons');
  });

  // WalletService clamps a community's limit to 1,000 hours, so a larger
  // number would save and then silently not apply.
  it('refuses a transfer limit above the platform ceiling before anything is sent', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Largest single transfer (hours)' }), { target: { value: '5000' } });

    expect(screen.getByText('Fix the highlighted fields before saving')).toBeInTheDocument();
    expect(isDisabled(getSaveButton())).toBe(true);
    expect(mockAdminEnterprise.updateConfig).not.toHaveBeenCalled();
  });

  it('keeps the rest of the page working when the second endpoint cannot be read', async () => {
    mockAdminEnterprise.getConfig.mockResolvedValue({ success: false, error: 'boom' });
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ partner_logo_label: 'Sponsor' }));
    await renderPage();

    expect(screen.getByTestId('settings-config-load-error')).toHaveTextContent(
      "We couldn't load the time zone and time credit settings.",
    );
    // No default is offered in place of the real value.
    expect(screen.queryByRole('combobox', { name: 'Time zone' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Time credits' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Date and number format' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sponsor')).toBeInTheDocument();
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

  // Bridgwater, 2026-10-15: a coordinator asked to tailor the approval email.
  describe('welcome text for the approval email', () => {
    it('shows the saved text, limits it to 1,000 characters and saves only that field', async () => {
      mockAdminSettings.get.mockResolvedValue(makeSettingsData({ approval_email_message: 'Hello from Bridgwater' }));
      await renderPage();

      const box = await screen.findByLabelText('Welcome text for the approval email');
      expect(box).toHaveValue('Hello from Bridgwater');
      expect(box).toHaveAttribute('maxlength', '1000');
      expect(screen.getByText('21 / 1000 characters')).toBeInTheDocument();

      await userEvent.clear(box);
      await userEvent.type(box, 'Coffee morning on Tuesdays');

      const nav = screen.getByRole('navigation', { name: 'Jump to section' });
      const dirtyPills = nav.querySelectorAll('a[data-dirty="true"]');
      expect(dirtyPills).toHaveLength(1);
      expect(dirtyPills[0]).toHaveAttribute('href', '#settings-section-joining');

      await userEvent.click(getSaveButton());
      await waitFor(() => {
        expect(mockAdminSettings.update).toHaveBeenCalledWith({ approval_email_message: 'Coffee morning on Tuesdays' });
      });
    });

    it('is open to a plain community admin, not only super admins', async () => {
      mockAuthState.user = { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true };
      await renderPage();

      const box = await screen.findByLabelText('Welcome text for the approval email');
      expect(box).not.toBeDisabled();
      expect(box).toHaveValue('');
    });
  });

  // Owner report, 13 Nov 2026: these two drew OFF while the platform held every
  // new member for both. With nothing stored the gates are ON; so is the page.
  it('shows email confirmation and approval ON when nothing has been saved for them', async () => {
    const data = makeSettingsData();
    delete (data.data.settings as Record<string, unknown>).email_verification;
    delete (data.data.settings as Record<string, unknown>).admin_approval;
    mockAdminSettings.get.mockResolvedValue(data);
    await renderPage();

    expect(findSwitch('New members confirm their email address')).toBeChecked();
    expect(findSwitch('New members wait for approval')).toBeChecked();
  });

  it('shows a switch OFF only when the server plainly says off', async () => {
    mockAdminSettings.get.mockResolvedValue(makeSettingsData({ email_verification: 'false', admin_approval: 'false' }));
    await renderPage();

    expect(findSwitch('New members confirm their email address')).not.toBeChecked();
    expect(findSwitch('New members wait for approval')).not.toBeChecked();
  });

  // Registration policy is god-only (owner, 13 Nov 2026); what a community
  // admin needs from it is in the Joining box instead.
  describe('joining rules for a community admin who is not god', () => {
    beforeEach(() => {
      mockAuthState.user = { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true };
    });

    it('has no way to the Registration policy page', async () => {
      await renderPage();
      expect(screen.queryByRole('link', { name: /more joining rules/i })).toBeNull();
      const related = document.getElementById('settings-section-related')!;
      const hrefs = Array.from(related.querySelectorAll('a')).map((a) => a.getAttribute('href'));
      expect(hrefs).not.toContain('/test/admin/settings/registration-policy');
      // Control: the list itself is there.
      expect(hrefs).toContain('/test/admin/module-configuration');
      expect(screen.getByText(/Invite codes appear just below when you choose Invite only\.$/)).toBeInTheDocument();
    });

    it('shows the invite codes once Invite only is chosen, and not before', async () => {
      await renderPage();
      expect(screen.queryByTestId('invite-codes-panel')).toBeNull();

      fireEvent.click(screen.getByRole('radio', { name: /invite only/i }));

      const panel = await screen.findByTestId('invite-codes-panel');
      expect(await within(panel).findByText('RIVER-123')).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: /generate codes/i })).toBeInTheDocument();
    });

    it('shows whether sign-ups are open', async () => {
      await renderPage();
      const panel = await screen.findByTestId('registration-breaker');
      expect(panel).toHaveTextContent('Sign-ups open');
      expect(panel).toHaveTextContent('3 of 20 new accounts this hour');
    });
  });

  it('gives a god account the way to the Registration policy page', async () => {
    mockAuthState.user = { id: 1, name: 'Platform', role: 'admin', is_god: true, is_super_admin: true };
    await renderPage();
    expect(screen.getByRole('link', { name: /more joining rules/i })).toHaveAttribute('href', '/test/admin/settings/registration-policy');
  });

  // Maintenance mode is switched on the server. Only the platform's own
  // administrators can act on that, so only they are shown the row.
  it('shows maintenance mode, read only, to a platform super-admin', async () => {
    await renderPage();
    expect(findSwitch('Maintenance Mode')).toBeDisabled();
    expect(screen.getByText('Maintenance mode (read only)')).toBeInTheDocument();
  });

  it.each([
    ['a community admin', { id: 5, name: 'Plain Admin', role: 'admin', is_admin: true }],
    ['a tenant super-admin', { id: 6, name: 'Tenant Super', role: 'tenant_admin', is_tenant_super_admin: true }],
  ])('does not show maintenance mode to %s', async (_who, user) => {
    mockAuthState.user = user;
    await renderPage();
    expect(findSwitch('Maintenance Mode')).toBeUndefined();
    expect(screen.queryByText('Maintenance mode (read only)')).toBeNull();
    expect(screen.queryByText(/maintenance\.sh/)).toBeNull();
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
      expect(findSwitch('New members confirm their email address')).toBeDisabled();
      expect(findSwitch('New members wait for approval')).toBeDisabled();
      expect(screen.getAllByText('Set by the platform team')).toHaveLength(2);
    });

    it('locks them for a tenant super-admin too (platform tier only)', async () => {
      mockAuthState.user = { id: 6, name: 'Tenant Super', role: 'tenant_admin', is_tenant_super_admin: true };
      await renderPage();
      expect(findSwitch('New members confirm their email address')).toBeDisabled();
      expect(findSwitch('New members wait for approval')).toBeDisabled();
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
      const emailSwitch = findSwitch('New members confirm their email address')!;
      expect(emailSwitch).not.toBeDisabled();
      expect(findSwitch('New members wait for approval')).not.toBeDisabled();
      await userEvent.click(emailSwitch);
      await userEvent.click(getSaveButton());

      await waitFor(() => {
        expect(mockAdminSettings.update).toHaveBeenCalledWith({ email_verification: 'false' });
      });
    });
  });
});
