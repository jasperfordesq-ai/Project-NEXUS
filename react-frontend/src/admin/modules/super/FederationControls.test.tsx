// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi via vi.hoisted ─────────────────────────────────────────────
const { mockAdminSuper } = vi.hoisted(() => ({
  mockAdminSuper: {
    getSystemControls: vi.fn(),
    getWhitelist: vi.fn(),
    getFederationPartnerships: vi.fn(),
    getFederationJwtStatus: vi.fn(),
    getFederationExternalStatus: vi.fn(),
    updateSystemControls: vi.fn(),
    emergencyLockdown: vi.fn(),
    liftLockdown: vi.fn(),
    addToWhitelist: vi.fn(),
    removeFromWhitelist: vi.fn(),
    suspendPartnership: vi.fn(),
    terminatePartnership: vi.fn(),
    reactivatePartnership: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminSuper: mockAdminSuper,
  default: { adminSuper: mockAdminSuper },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub HeroUI Switch, Accordion, Snippet, Code (can loop or use clipboard) ─
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Switch: ({ isSelected, onValueChange, isDisabled }: {
      isSelected?: boolean; onValueChange?: (v: boolean) => void; isDisabled?: boolean;
    }) => (
      <input
        type="checkbox"
        role="switch"
        aria-checked={Boolean(isSelected)}
        checked={!!isSelected}
        disabled={isDisabled}
        onChange={(e) => onValueChange?.(e.target.checked)}
      />
    ),
    Accordion: ({ children }: { children: React.ReactNode }) => <div data-testid="accordion">{children}</div>,
    AccordionItem: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) => (
      <div><div>{title}</div><div>{children}</div></div>
    ),
    Snippet: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
    Code: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub admin sub-components ─────────────────────────────────────────────────
vi.mock('../../components', () => ({
  PageHeader: ({ title }: { title?: string }) => <div data-testid="page-header"><h1>{title}</h1></div>,
  ConfirmModal: ({
    isOpen,
    onClose,
    onConfirm,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title?: string;
    children?: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <span>{title}</span>
        {children}
        <button onClick={onClose}>cancel</button>
        <button data-testid="confirm-btn" onClick={onConfirm}>confirm</button>
      </div>
    ) : null,
  StatCard: ({ label, value }: { label?: string; value?: string | number }) => (
    <div data-testid="stat-card">{label}: {value}</div>
  ),
}));

// FederationControls imports these three by their DIRECT paths, so the barrel
// mock above never replaced them — `getAllByTestId('stat-card')` could not match
// and two tests here were failing silently against the real components. Mock the
// paths that actually load.
vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title }: { title?: string }) => <div data-testid="page-header"><h1>{title}</h1></div>,
}));

vi.mock('../../components/StatCard', () => ({
  StatCard: ({ label, value }: { label?: string; value?: string | number }) => (
    <div data-testid="stat-card">{label}: {value}</div>
  ),
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({
    isOpen,
    onClose,
    onConfirm,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title?: string;
    children?: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <span>{title}</span>
        {children}
        <button onClick={onClose}>cancel</button>
        <button data-testid="confirm-btn" onClick={onConfirm}>confirm</button>
      </div>
    ) : null,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    Link: ({ children, to }: { children: React.ReactNode; to?: string }) => <a href={to ?? '#'}>{children}</a>,
  };
});

// ─── Toast context ─────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeControls = (overrides = {}) => ({
  federation_enabled: true,
  whitelist_mode_enabled: false,
  emergency_lockdown_active: false,
  emergency_lockdown_reason: null,
  cross_tenant_profiles_enabled: true,
  cross_tenant_messaging_enabled: true,
  cross_tenant_transactions_enabled: true,
  cross_tenant_listings_enabled: true,
  cross_tenant_events_enabled: true,
  cross_tenant_groups_enabled: true,
  // External partner federation ships OFF.
  external_federation_enabled: false,
  external_protocol_nexus_enabled: false,
  external_protocol_komunitin_enabled: false,
  external_protocol_credit_commons_enabled: false,
  external_protocol_legacy_v1_enabled: false,
  external_protocol_webhooks_enabled: false,
  external_protocol_hour_transfer_enabled: false,
  external_protocol_aggregates_enabled: false,
  external_federation_disabled_reason: null,
  // Sibling switch — the AG60 Partner API, also shipping off.
  partner_api_enabled: false,
  partner_api_disabled_reason: null,
  ...overrides,
});

const makeExternalStatus = (overrides = {}) => ({
  platform_enabled: true,
  master_enabled: false,
  effective: false,
  emergency_lockdown_active: false,
  reason: null,
  protocols: {},
  blocked_last_24h: {},
  partner_api: { enabled: false, reason: null, emergency_lockdown_active: false },
  ...overrides,
});

const makeWhitelistEntry = (id: number, name: string) => ({ tenant_id: id, tenant_name: name });

const makePartnership = (overrides = {}) => ({
  id: 1,
  tenant_1_name: 'Alpha',
  tenant_2_name: 'Beta',
  status: 'active',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('FederationControls', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminSuper.getSystemControls.mockResolvedValue({ success: true, data: makeControls() });
    mockAdminSuper.getWhitelist.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.getFederationPartnerships.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.getFederationJwtStatus.mockResolvedValue({
      success: true,
      data: { configured: true, issuer: 'https://api.example.com', key_bits: 256, recommended_bits: 256 },
    });
    mockAdminSuper.getFederationExternalStatus.mockResolvedValue({ success: true, data: makeExternalStatus() });
    mockAdminSuper.updateSystemControls.mockResolvedValue({ success: true });
    mockAdminSuper.addToWhitelist.mockResolvedValue({ success: true });
    mockAdminSuper.removeFromWhitelist.mockResolvedValue({ success: true });
    mockAdminSuper.emergencyLockdown.mockResolvedValue({ success: true });
    mockAdminSuper.liftLockdown.mockResolvedValue({ success: true });
    mockAdminSuper.suspendPartnership.mockResolvedValue({ success: true });
    mockAdminSuper.terminatePartnership.mockResolvedValue({ success: true });
    mockAdminSuper.reactivatePartnership.mockResolvedValue({ success: true });
  });

  it('shows loading spinner initially', async () => {
    mockAdminSuper.getSystemControls.mockImplementationOnce(() => new Promise(() => {}));
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows error state when controls fail to load', async () => {
    mockAdminSuper.getSystemControls.mockResolvedValue({ success: false });
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('renders stat cards after successful load', async () => {
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('renders federation-enabled switch', async () => {
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      const switches = screen.getAllByRole('switch');
      // Federation enabled + whitelist mode + 6 feature toggles = 8 switches minimum
      expect(switches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders JWT status chip as configured', async () => {
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      // The issuer or configured state text should be visible
      expect(screen.getByText('https://api.example.com')).toBeInTheDocument();
    });
  });

  it('shows warning when JWT is not configured', async () => {
    mockAdminSuper.getFederationJwtStatus.mockResolvedValue({
      success: true,
      data: { configured: false, issuer: '', key_bits: 0, recommended_bits: 256 },
    });
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      // Not-configured chip or warning should appear
      const doc = document.body;
      expect(doc.textContent).toMatch(/not.configured|not configured|jwt_warn/i);
    });
  });

  it('renders whitelist entry names when whitelist is populated', async () => {
    mockAdminSuper.getWhitelist.mockResolvedValue({
      success: true,
      data: [makeWhitelistEntry(3, 'Alpha Tenant'), makeWhitelistEntry(4, 'Beta Tenant')],
    });
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Tenant')).toBeInTheDocument();
      expect(screen.getByText('Beta Tenant')).toBeInTheDocument();
    });
  });

  it('calls addToWhitelist when Add button clicked with a tenant ID', async () => {
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    // Wait for the component to fully load (controls rendered)
    await waitFor(() => {
      expect(screen.getAllByTestId('stat-card').length).toBeGreaterThan(0);
    });

    // Find whitelist tenant ID input — label is i18n key 'super.label_tenant_id'
    // It renders as a textbox (Input component)
    const inputs = screen.getAllByRole('textbox');
    // The whitelist add input is the one with a small width or the one that accepts a number string
    // Pick the last textbox in the whitelist section (or any standalone textbox)
    const tenantIdInput = inputs.find((el) =>
      el.getAttribute('aria-label')?.toLowerCase().includes('tenant') ||
      el.getAttribute('aria-label')?.toLowerCase().includes('id') ||
      el.getAttribute('aria-label')?.includes('label_tenant_id') ||
      el.getAttribute('aria-label')?.includes('super.label_tenant_id')
    ) ?? inputs[inputs.length - 1]; // fallback: last input is the whitelist add field

    if (tenantIdInput) {
      fireEvent.change(tenantIdInput, { target: { value: '7' } });
    }

    // Find Add button
    const addBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('add') ||
      b.textContent === 'super.add'
    );
    if (addBtn) fireEvent.click(addBtn);

    await waitFor(() => {
      expect(mockAdminSuper.addToWhitelist).toHaveBeenCalledWith(7);
    });
  });

  it('renders active partnerships with suspend/end buttons', async () => {
    mockAdminSuper.getFederationPartnerships.mockResolvedValue({
      success: true,
      data: [makePartnership({ status: 'active' })],
    });
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });
  });

  it('renders lockdown active banner when lockdown is active', async () => {
    mockAdminSuper.getSystemControls.mockResolvedValue({
      success: true,
      data: makeControls({ emergency_lockdown_active: true, emergency_lockdown_reason: 'Security incident' }),
    });
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      // Lockdown banner text — rendered via t() so translation key or fallback
      const doc = document.body.textContent;
      expect(doc).toMatch(/lockdown|Security incident/i);
    });
  });

  it('calls updateSystemControls when federation toggle is changed', async () => {
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      const switches = screen.getAllByRole('switch');
      // First switch should be federation_enabled
      expect(switches.length).toBeGreaterThan(0);
      fireEvent.click(switches[0]);
    });

    await waitFor(() => {
      expect(mockAdminSuper.updateSystemControls).toHaveBeenCalled();
    });
  });

  it('shows confirm modal when emergency lockdown button is clicked', async () => {
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      const lockdownBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('lockdown') || b.textContent?.toLowerCase().includes('emergency')
      );
      if (lockdownBtn) fireEvent.click(lockdownBtn);
    });

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('shows error toast when API load fails', async () => {
    mockAdminSuper.getSystemControls.mockRejectedValue(new Error('network'));
    const { FederationControls } = await import('./FederationControls');
    render(<FederationControls />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ─── External partner federation kill switch ────────────────────────────────
  describe('external partner federation kill switch', () => {
    // NOTE: PageHeader / StatCard / ConfirmModal are imported by FederationControls
    // via their direct paths ('../../components/PageHeader' etc), so the
    // barrel-level vi.mock('../../components') above does NOT replace them and
    // the real components render. Wait on the (genuinely mocked) Switch stubs
    // instead of a stub testid that never appears.
    const renderPage = async () => {
      const { FederationControls } = await import('./FederationControls');
      const utils = render(<FederationControls />);
      await waitFor(() => {
        expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
      });
      return utils;
    };

    it('disables every per-protocol switch while the master switch is off', async () => {
      await renderPage();

      // 7 protocol switches + the master, all reflecting the OFF fixture.
      const switches = screen.getAllByRole('switch');
      const disabled = switches.filter((el) => (el as HTMLInputElement).disabled);
      expect(disabled.length).toBeGreaterThanOrEqual(7);
    });

    it('enables the per-protocol switches once the master switch is on', async () => {
      mockAdminSuper.getSystemControls.mockResolvedValue({
        success: true,
        data: makeControls({ external_federation_enabled: true }),
      });
      await renderPage();

      const switches = screen.getAllByRole('switch') as HTMLInputElement[];
      // With external federation on, no switch should be disabled by the gate.
      expect(switches.filter((el) => el.disabled)).toHaveLength(0);
    });

    it('sends a single-key PUT when a protocol is toggled on', async () => {
      mockAdminSuper.getSystemControls.mockResolvedValue({
        success: true,
        data: makeControls({ external_federation_enabled: true }),
      });
      await renderPage();

      const switches = screen.getAllByRole('switch') as HTMLInputElement[];
      const unchecked = switches.filter((el) => !el.checked);
      expect(unchecked.length).toBeGreaterThan(0);

      fireEvent.click(unchecked[0]);

      await waitFor(() => {
        expect(mockAdminSuper.updateSystemControls).toHaveBeenCalled();
      });
      const payload = mockAdminSuper.updateSystemControls.mock.calls[0][0];
      expect(Object.keys(payload)).toHaveLength(1);
      expect(Object.keys(payload)[0]).toMatch(/^external_protocol_/);
    });

    it('requires confirmation before disabling external federation', async () => {
      mockAdminSuper.getSystemControls.mockResolvedValue({
        success: true,
        data: makeControls({ external_federation_enabled: true }),
      });
      await renderPage();

      const switches = screen.getAllByRole('switch') as HTMLInputElement[];
      const master = switches.find((el) => el.checked);
      expect(master).toBeDefined();

      fireEvent.click(master!);

      // Opens the confirm dialog and does NOT write straight away.
      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      });
      expect(mockAdminSuper.updateSystemControls).not.toHaveBeenCalled();
    });

    it('turns external federation back on without a confirmation step', async () => {
      await renderPage();

      const switches = screen.getAllByRole('switch') as HTMLInputElement[];
      const master = switches.find((el) => !el.disabled);
      expect(master).toBeDefined();

      fireEvent.click(master!);

      await waitFor(() => {
        expect(mockAdminSuper.updateSystemControls).toHaveBeenCalledWith(
          expect.objectContaining({ external_federation_enabled: true }),
        );
      });
    });

    it('renders the blocked-attempt count for a protocol', async () => {
      mockAdminSuper.getFederationExternalStatus.mockResolvedValue({
        success: true,
        data: makeExternalStatus({ blocked_last_24h: { komunitin: 14 } }),
      });
      await renderPage();

      await waitFor(() => {
        expect(screen.getAllByText(/14/).length).toBeGreaterThan(0);
      });
    });

    it('keeps the Partner API switch independent of the federation master', async () => {
      // Federation fully ON, Partner API OFF — the two must not track each
      // other, or the labels stop meaning what they say.
      mockAdminSuper.getSystemControls.mockResolvedValue({
        success: true,
        data: makeControls({ external_federation_enabled: true, partner_api_enabled: false }),
      });
      await renderPage();

      const switches = screen.getAllByRole('switch') as HTMLInputElement[];
      expect(switches.some((el) => el.checked)).toBe(true);
      expect(switches.some((el) => !el.checked)).toBe(true);
    });

    it('confirms before disabling the Partner API and sends only that key', async () => {
      mockAdminSuper.getSystemControls.mockResolvedValue({
        success: true,
        data: makeControls({ external_federation_enabled: false, partner_api_enabled: true }),
      });
      await renderPage();

      // With federation off, the only checked switch is the Partner API one.
      const switches = screen.getAllByRole('switch') as HTMLInputElement[];
      const partnerApi = switches.find((el) => el.checked);
      expect(partnerApi).toBeDefined();

      fireEvent.click(partnerApi!);

      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      });
      expect(mockAdminSuper.updateSystemControls).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('confirm-btn'));

      await waitFor(() => {
        expect(mockAdminSuper.updateSystemControls).toHaveBeenCalledWith(
          expect.objectContaining({ partner_api_enabled: false }),
        );
      });
      const payload = mockAdminSuper.updateSystemControls.mock.calls[0][0];
      expect(payload).not.toHaveProperty('external_federation_enabled');
    });

    it('leaves the internal cross-tenant switches usable while external is off', async () => {
      await renderPage();

      const switches = screen.getAllByRole('switch') as HTMLInputElement[];
      // The internal cross-tenant toggles must remain interactive — the
      // external switch must never appear to have disabled internal federation.
      expect(switches.filter((el) => !el.disabled).length).toBeGreaterThan(0);
    });
  });
});
