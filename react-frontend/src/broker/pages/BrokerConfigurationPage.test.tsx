// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi (default+named same object via vi.hoisted) ─────────────────
const { mockAdminBroker, mockConfirm } = vi.hoisted(() => ({
  mockAdminBroker: {
    getConfiguration: vi.fn(),
    saveConfiguration: vi.fn(),
  },
  mockConfirm: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: mockAdminBroker,
  default: { adminBroker: mockAdminBroker },
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub HeroUI Switch/Tooltip to avoid potential jsdom infinite loops; the
// shared confirm dialog needs its provider, so the page gets the answer directly.
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Switch: ({ isSelected, onValueChange, isDisabled, ...rest }: {
      isSelected?: boolean; onValueChange?: (v: boolean) => void; isDisabled?: boolean; [k: string]: unknown;
    }) => (
      <input
        type="checkbox"
        role="switch"
        aria-checked={Boolean(isSelected)}
        checked={!!isSelected}
        disabled={isDisabled}
        onChange={(e) => onValueChange?.(e.target.checked)}
        {...(typeof rest['aria-label'] === 'string' ? { 'aria-label': rest['aria-label'] as string } : {})}
      />
    ),
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useConfirm: () => mockConfirm,
  };
});

// ─── Toast and contexts ────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

const mockNavigate = vi.fn();

// Mutable role so individual tests can exercise the broker (non-admin) path.
let mockRole = 'admin';

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 1, name: 'Admin User', role: mockRole },
      isAuthenticated: true,
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

// ─── Fixture config ────────────────────────────────────────────────────────────
const defaultConfig = {
  broker_messaging_enabled: true,
  broker_copy_all_messages: false,
  broker_copy_threshold_hours: 5,
  new_member_monitoring_days: 30,
  require_exchange_for_listings: false,
  risk_tagging_enabled: true,
  auto_flag_high_risk: true,
  require_approval_high_risk: false,
  notify_on_high_risk_match: true,
  broker_approval_required: true,
  auto_approve_low_risk: false,
  exchange_timeout_days: 7,
  max_hours_without_approval: 5,
  confirmation_deadline_hours: 48,
  allow_hour_adjustment: false,
  max_hour_variance_percent: 20,
  expiry_hours: 168,
  broker_visible_to_members: false,
  show_broker_name: false,
  broker_contact_email: '',
  copy_first_contact: true,
  copy_new_member_messages: true,
  copy_high_risk_listing_messages: true,
  random_sample_percentage: 0,
  retention_days: 90,
  insurance_enabled: false,
  enforce_insurance_on_exchanges: false,
  insurance_expiry_warning_days: 30,
};

const FIRST_CONTACT = 'Copy first contact between members';

function findSaveButton() {
  return screen.getAllByRole('button').find((b) =>
    b.textContent?.toLowerCase().includes('save')
  );
}

function isButtonDisabled(button: HTMLElement | undefined): boolean {
  if (!button) return false;
  return (
    button.hasAttribute('disabled') ||
    button.getAttribute('data-disabled') === 'true' ||
    button.getAttribute('aria-disabled') === 'true'
  );
}

async function renderLoaded() {
  const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
  render(<BrokerConfigurationPage />);
  await waitFor(() => {
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('BrokerConfigurationPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRole = 'admin';
    mockAdminBroker.getConfiguration.mockResolvedValue({ success: true, data: { ...defaultConfig } });
    mockAdminBroker.saveConfiguration.mockResolvedValue({ success: true, data: { ...defaultConfig } });
    mockConfirm.mockResolvedValue(true);
  });

  it('shows a skeleton loading state initially', async () => {
    mockAdminBroker.getConfiguration.mockImplementationOnce(() => new Promise(() => {}));
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders the page shell and grouped section cards after load', async () => {
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Broker Configuration' })
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Messaging' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Risk Tagging' })).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Compliance & Safeguarding' })
      ).toBeInTheDocument();
    });

    // Each section carries a one-line description
    expect(
      screen.getByText('How members reach brokers and which conversations enter the review queue.')
    ).toBeInTheDocument();
  });

  it('renders configuration sections after load', async () => {
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    await waitFor(() => {
      expect(findSaveButton()).toBeDefined();
    });
  });

  it('shows error toast when config load fails', async () => {
    mockAdminBroker.getConfiguration.mockRejectedValue(new Error('network'));
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders an honest error state with a retry button when the load fails', async () => {
    mockAdminBroker.getConfiguration.mockRejectedValue(new Error('network'));
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load broker configuration")).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockAdminBroker.getConfiguration).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Save bar ──────────────────────────────────────────────────────────────

  it('Save and Discard are disabled while nothing has changed', async () => {
    await renderLoaded();

    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(isButtonDisabled(findSaveButton())).toBe(true);
    expect(isButtonDisabled(screen.getByRole('button', { name: 'Discard' }))).toBe(true);
  });

  it('calls saveConfiguration when Save Changes is clicked after an edit', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    const saveBtn = findSaveButton();
    expect(isButtonDisabled(saveBtn)).toBe(false);
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminBroker.saveConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({ broker_messaging_enabled: true, copy_first_contact: false })
      );
    });
  });

  it('shows success toast after save succeeds', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    const saveBtn = findSaveButton();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when save fails', async () => {
    mockAdminBroker.saveConfiguration.mockResolvedValue({ success: false, error: 'Oops' });
    await renderLoaded();

    fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    const saveBtn = findSaveButton();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('Discard puts the loaded values back and the page is clean again', async () => {
    await renderLoaded();

    const toggle = screen.getByRole('switch', { name: FIRST_CONTACT });
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('switch', { name: FIRST_CONTACT })).toBeChecked();
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(isButtonDisabled(findSaveButton())).toBe(true);
    expect(mockAdminBroker.saveConfiguration).not.toHaveBeenCalled();
  });

  it('toggling a switch back makes the page clean again (dirty is a comparison, not a flag)', async () => {
    await renderLoaded();

    const toggle = screen.getByRole('switch', { name: FIRST_CONTACT });
    fireEvent.click(toggle);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('renders switch toggles for boolean settings', async () => {
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    await waitFor(() => {
      const switches = screen.getAllByRole('switch');
      expect(switches.length).toBeGreaterThan(0);
    });
  });

  it('shows an unsaved-changes chip after editing and clears it on save', async () => {
    await renderLoaded();
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    const saveBtn = findSaveButton();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
      expect(screen.queryByText('Unsaved changes')).toBeNull();
    });
  });

  // ─── Number fields ─────────────────────────────────────────────────────────

  it('renders number fields with their unit for time-based settings', async () => {
    await renderLoaded();

    const field = screen.getByRole('textbox', { name: 'New-member monitoring window in days' });
    expect(field).toHaveValue('30 days');
    expect(screen.getByRole('textbox', { name: 'Broker copy threshold in hours' })).toHaveValue('5 hours');
    expect(screen.getByRole('textbox', { name: 'Random sample percentage' })).toHaveValue('0%');
  });

  it('keeps a cleared number empty instead of snapping to a default, and blocks the save until it is filled', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    const field = screen.getByRole('textbox', { name: 'New-member monitoring window in days' });
    await user.clear(field);
    await user.tab();
    expect(field).toHaveValue('');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    const saveBtn = findSaveButton();
    if (saveBtn) await user.click(saveBtn);
    expect(mockToast.error).toHaveBeenCalledWith('Enter a number for New-member monitoring window (days).');
    expect(mockAdminBroker.saveConfiguration).not.toHaveBeenCalled();

    await user.type(field, '45');
    await user.tab();
    expect(field).toHaveValue('45 days');
    if (saveBtn) await user.click(saveBtn);
    await waitFor(() => {
      expect(mockAdminBroker.saveConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({ new_member_monitoring_days: 45 })
      );
    });
  });

  // ─── Leaving with unsaved changes ──────────────────────────────────────────

  it('asks before following a link while there are unsaved changes, and navigates when agreed', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    const helpLink = screen.getByRole('link', { name: /How this page works/ });
    fireEvent.click(helpLink);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Leave without saving?' }));
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/test/broker/help/broker_role/broker_configuration');
    });
  });

  it('stays put when the broker declines to leave', async () => {
    mockConfirm.mockResolvedValue(false);
    await renderLoaded();

    fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    fireEvent.click(screen.getByRole('link', { name: /How this page works/ }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // ─── Jump links ────────────────────────────────────────────────────────────

  it('offers section jump links that target the section cards', async () => {
    await renderLoaded();

    const nav = screen.getByRole('navigation', { name: 'Jump to section' });
    const link = within(nav).getByRole('link', { name: 'Messaging' });
    expect(link).toHaveAttribute('href', '#config-section-messaging');
    expect(document.getElementById('config-section-messaging')).not.toBeNull();
    expect(within(nav).getByRole('link', { name: 'Exchange Workflow' })).toBeInTheDocument();
  });

  // ─── Access ────────────────────────────────────────────────────────────────

  it('does not show limited access warning or admin-only chips for admin user', async () => {
    await renderLoaded();

    expect(screen.queryByText('Some settings can only be changed by an admin')).toBeNull();
    expect(screen.queryByText('Admin only')).toBeNull();
  });

  it('surfaces admin-only settings with a lock chip and disabled control for brokers', async () => {
    mockRole = 'user';
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    await waitFor(() => {
      expect(screen.getByText('Some settings can only be changed by an admin')).toBeInTheDocument();
    });

    // Every admin-only row carries the lock chip — twelve of them, the F-547 set…
    expect(screen.getAllByText('Admin only')).toHaveLength(12);
    // …and its control is disabled.
    expect(screen.getByRole('switch', { name: 'Broker messaging enabled' })).toBeDisabled();
    // Broker-editable settings stay enabled.
    expect(
      screen.getByRole('switch', { name: FIRST_CONTACT })
    ).not.toBeDisabled();
  });

  // F-547: a broker's save sends only the settings the broker changed. The
  // server refuses the WHOLE save (403) when a non-admin sends any admin-only
  // key, even with its value unchanged — and the GET returns keys the page
  // never shows (exchange_workflow_enabled), so echoing the loaded config back
  // meant no broker could ever save this page.
  async function brokerSaveAfter(loaded: Record<string, unknown>, edit?: () => void) {
    mockRole = 'broker';
    mockAdminBroker.getConfiguration.mockResolvedValue({ success: true, data: loaded });
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    await waitFor(() => {
      expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
    });
    edit?.();

    const saveBtn = findSaveButton();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminBroker.saveConfiguration).toHaveBeenCalled();
    });
    return mockAdminBroker.saveConfiguration.mock.calls[0][0] as Record<string, unknown>;
  }

  it('sends a broker only the settings they changed', async () => {
    const payload = await brokerSaveAfter({ ...defaultConfig }, () => {
      fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    });

    expect(payload).toEqual({ copy_first_contact: false });
  });

  it('never sends a broker an admin-only key the page does not show (F-547)', async () => {
    const payload = await brokerSaveAfter(
      { ...defaultConfig, exchange_workflow_enabled: true, require_broker_approval: true },
      () => {
        fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
      },
    );

    expect(payload).not.toHaveProperty('exchange_workflow_enabled');
    expect(payload).not.toHaveProperty('require_broker_approval');
    expect(payload).not.toHaveProperty('broker_messaging_enabled');
  });

  it("does not send back a sample rate an admin set at the blanket-copy level (F-547)", async () => {
    // At 100 the server treats the rate as the admin-only "copy all" policy (F-242)
    // and refuses a broker's save that contains it.
    const payload = await brokerSaveAfter({ ...defaultConfig, random_sample_percentage: 100 }, () => {
      fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    });

    expect(payload).not.toHaveProperty('random_sample_percentage');
  });

  it('still sends an admin the whole configuration, including keys the page does not show', async () => {
    mockAdminBroker.getConfiguration.mockResolvedValue({
      success: true,
      data: { ...defaultConfig, exchange_workflow_enabled: true },
    });
    await renderLoaded();

    fireEvent.click(screen.getByRole('switch', { name: FIRST_CONTACT }));
    const saveBtn = findSaveButton();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminBroker.saveConfiguration).toHaveBeenCalledWith({
        ...defaultConfig,
        copy_first_contact: false,
        exchange_workflow_enabled: true,
      });
    });
  });

  it('shows back button linking to broker dashboard', async () => {
    const { default: BrokerConfigurationPage } = await import('./BrokerConfigurationPage');
    render(<BrokerConfigurationPage />);

    await waitFor(() => {
      const backBtn = screen.getAllByRole('link').find((el) =>
        el.getAttribute('href')?.includes('/broker') || el.textContent?.toLowerCase().includes('back')
      );
      expect(backBtn).toBeDefined();
    });
  });
});
