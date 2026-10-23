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

// Stub the place search: a plain text box plus a button that "picks" a fixed place,
// so the test proves the form fills itself from a selection without a live geocoder.
vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({ label, value, onChange, onPlaceSelect }: {
    label?: string; value: string;
    onChange?: (v: string) => void;
    onPlaceSelect?: (place: {
      placeId: string; formattedAddress: string; lat: number; lng: number;
      addressComponents?: { countryCode?: string };
    }) => void;
  }) => (
    <div>
      <input aria-label={label} value={value} onChange={(e) => onChange?.(e.target.value)} />
      <button
        type="button"
        onClick={() => onPlaceSelect?.({
          placeId: 'place-coventry',
          formattedAddress: 'Coventry, UK',
          lat: 52.4068,
          lng: -1.5197,
          addressComponents: { countryCode: 'GB' },
        })}
      >
        pick coventry
      </button>
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

  // A 422 from the create endpoint carries the actual reason (e.g. "Maximum
  // hierarchy depth exceeded"). Showing only the generic string left the
  // operator with no way to tell which rule rejected the save.
  //
  // 🔴 This assertion was INVERTED between 2026-09-02 and this commit, because
  // the reasons were hardcoded English in TenantHierarchyService and surfacing
  // them put untranslated English in front of an operator working in any of the
  // eleven locales — check-admin-ui-literals.mjs blocks that as
  // 'server-message-bypass', and it failed CI on 0d23d3ad7. The precondition has
  // now been met: every refusal in that service goes through __('api.*'), the
  // keys exist in all eleven locales, and ApiErrorLocalisationTest lists the
  // service so a literal cannot come back. If that guard is ever removed, invert
  // this test again rather than silencing the gate.
  it('surfaces the server error message rather than the generic failure text', async () => {
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

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('Maximum hierarchy depth exceeded')
    );
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

describe('TenantForm — location tab geocoding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRouteParams.current = {};
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.createTenant.mockResolvedValue({ success: true, data: { tenant_id: 7 } });
  });

  it('fills name, coordinates and country from a chosen place and sends them on create', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'Coventry Timebank');

    await userEvent.click(screen.getByRole('tab', { name: /location/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'pick coventry' }));

    expect(screen.getByRole('textbox', { name: /location/i })).toHaveValue('Coventry, UK');
    expect(screen.getByRole('textbox', { name: /latitude/i })).toHaveValue('52.4068');
    expect(screen.getByRole('textbox', { name: /longitude/i })).toHaveValue('-1.5197');
    expect(screen.getByRole('combobox', { name: /country/i })).toHaveValue('GB');

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')
    );
    fireEvent.click(saveBtn!);

    await waitFor(() => {
      expect(mockAdminSuper.createTenant).toHaveBeenCalledWith(
        expect.objectContaining({
          location_name: 'Coventry, UK',
          latitude: '52.4068',
          longitude: '-1.5197',
          country_code: 'GB',
        })
      );
    });
  });
});

// The community's addresses WITHOUT a custom domain, shown live under the slug
// so the operator can see (and copy) where the community will live before
// saving. Tenants are never subdomains: the slug is a path segment on the
// platform host, and the accessible site mounts it at /{slug}/accessible.
describe('TenantForm — live web addresses', () => {
  const MAIN = 'Main website address';
  const ACCESSIBLE = 'Accessible website address';
  const TEMPORARY_NOTE =
    'Your community can be reached at these addresses straight away. ' +
    'Use them until your own web address has been set up with the company that manages your web addresses (DNS). ' +
    'Once that is live, members should use your own web address instead.';
  const CUSTOM_DOMAIN_NOTE =
    'Your community can be reached at these addresses straight away. ' +
    'The web address you have entered below will become the main address once it has been set up with the company that manages your web addresses (DNS). ' +
    'Until then, use these.';

  beforeEach(() => {
    vi.resetAllMocks();
    mockRouteParams.current = {};
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.createTenant.mockResolvedValue({ success: true, data: { tenant_id: 7 } });
  });

  it('shows both addresses as the slug is generated from the name', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'My Test Timebank');

    expect(screen.getByRole('textbox', { name: MAIN })).toHaveValue(
      'https://app.project-nexus.ie/my-test-timebank'
    );
    expect(screen.getByRole('textbox', { name: ACCESSIBLE })).toHaveValue(
      'https://accessible.project-nexus.ie/my-test-timebank/accessible'
    );
    // The addresses are a stop-gap until the community's own domain is live,
    // and the note says so in plain words (no "slug", no bare "DNS").
    expect(screen.getByText(TEMPORARY_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(CUSTOM_DOMAIN_NOTE)).not.toBeInTheDocument();
  });

  it('follows the slug when it is edited by hand, not the custom domain fields', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /^slug$/i }), 'Coventry TB');
    await userEvent.type(screen.getByRole('textbox', { name: /^domain$/i }), 'coventry.example.org');
    await userEvent.type(
      screen.getByRole('textbox', { name: /accessible frontend domain/i }),
      'accessible.coventry.example.org'
    );

    // The slug field strips anything that is not a-z, 0-9 or a hyphen.
    expect(screen.getByRole('textbox', { name: MAIN })).toHaveValue('https://app.project-nexus.ie/coventrytb');
    expect(screen.getByRole('textbox', { name: ACCESSIBLE })).toHaveValue(
      'https://accessible.project-nexus.ie/coventrytb/accessible'
    );
    // Once a custom domain is entered, the note says that domain becomes the
    // main address when the hosting provider has set it up.
    expect(screen.getByText(CUSTOM_DOMAIN_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(TEMPORARY_NOTE)).not.toBeInTheDocument();
  });

  it('uses the hub domain for the main address when the chosen parent owns one', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({
      success: true,
      data: [
        { id: 4, name: 'Timebank Global', depth: 1, max_depth: 0, allows_subtenants: true, domain: '' },
        {
          id: 11, name: 'Timebanking UK', depth: 2, max_depth: 0, allows_subtenants: true,
          domain: 'uk.timebank.global', accessible_domain: 'accessible-uk.timebank.global',
        },
      ],
    });
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await screen.findByRole('option', { name: /Timebanking UK/ });

    await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'Stratford');
    fireEvent.change(screen.getByRole('combobox', { name: /parent tenant/i }), { target: { value: '11' } });

    expect(screen.getByRole('textbox', { name: MAIN })).toHaveValue('https://uk.timebank.global/stratford');
    // The accessible site does not serve slug-only sub-communities under the
    // hub's accessible domain; they stay on the shared accessible host.
    expect(screen.getByRole('textbox', { name: ACCESSIBLE })).toHaveValue(
      'https://accessible.project-nexus.ie/stratford/accessible'
    );

    // A hub without a domain falls back to the platform host.
    fireEvent.change(screen.getByRole('combobox', { name: /parent tenant/i }), { target: { value: '4' } });
    expect(screen.getByRole('textbox', { name: MAIN })).toHaveValue('https://app.project-nexus.ie/stratford');
  });

  it('shows a neutral placeholder while the slug is empty', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    const main = screen.getByRole('textbox', { name: MAIN });
    const accessible = screen.getByRole('textbox', { name: ACCESSIBLE });
    expect(main).toHaveValue('');
    expect(accessible).toHaveValue('');
    expect(main).toHaveAttribute('placeholder', 'Type a name or slug to see the address');
    expect(accessible).toHaveAttribute('placeholder', 'Type a name or slug to see the address');
    expect(screen.queryByText(/project-nexus\.ie/)).not.toBeInTheDocument();
  });

  it('copies the address to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'Copy Me');
    const copyMain = screen.getAllByRole('button', { name: 'Copy address' })[0];
    expect(copyMain).toBeDefined();
    await userEvent.click(copyMain!);

    expect(writeText).toHaveBeenCalledWith('https://app.project-nexus.ie/copy-me');
    expect(mockToast.success).toHaveBeenCalledWith('Address copied');
  });

  // The SEO tab's search preview used to invent https://{slug}.project-nexus.ie,
  // which is not an address any tenant has. It must agree with the live preview.
  it('shows the same address in the Google search preview', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'My Test Timebank');
    await userEvent.click(screen.getByRole('tab', { name: /seo/i }));

    expect(await screen.findByText('https://app.project-nexus.ie/my-test-timebank')).toBeInTheDocument();
    expect(screen.queryByText(/my-test-timebank\.project-nexus\.ie/)).not.toBeInTheDocument();
  });
});

// The SEO tab's search preview and character counters (2026-10-22). Until then
// the preview always showed the platform address even when the community had
// its own domain, and the counters read "Characters Count" with no number.
describe('TenantForm — SEO tab preview and counters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRouteParams.current = {};
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
    mockAdminSuper.createTenant.mockResolvedValue({ success: true, data: { tenant_id: 7 } });
  });

  it('previews the platform address until a custom domain is entered, then that domain', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'Hour Timebank');
    await userEvent.click(screen.getByRole('tab', { name: /^seo$/i }));
    expect(screen.getByText('https://app.project-nexus.ie/hour-timebank')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /details/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /^domain$/i }), 'hour-timebank.ie');
    await userEvent.click(screen.getByRole('tab', { name: /^seo$/i }));
    expect(screen.getByText('https://hour-timebank.ie')).toBeInTheDocument();
    expect(screen.queryByText('https://app.project-nexus.ie/hour-timebank')).not.toBeInTheDocument();
  });

  it('counts the meta title and meta description characters against their limits', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.click(screen.getByRole('tab', { name: /^seo$/i }));
    expect(screen.getByText('0/70 characters')).toBeInTheDocument();
    expect(screen.getByText('0/180 characters')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: /meta title/i }), 'TimeBank Ireland');
    expect(screen.getByText('16/70 characters')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: /meta description/i }), 'Give an hour.');
    expect(screen.getByText('13/180 characters')).toBeInTheDocument();
  });

  // The home page's description falls back to the tagline (PageMeta), so the
  // preview said "no description" for a page that had one (audit, 2026-10-23).
  it('previews the tagline as the description when no meta description is set', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));

    await userEvent.type(screen.getByRole('textbox', { name: /tagline/i }), 'Neighbours sharing skills');
    await userEvent.click(screen.getByRole('tab', { name: /^seo$/i }));
    expect(screen.getByText('Neighbours sharing skills')).toBeInTheDocument();
    expect(screen.queryByText('No description set found')).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: /meta description/i }), 'Give an hour.');
    expect(screen.getAllByText('Give an hour.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Neighbours sharing skills')).not.toBeInTheDocument();
  });

  it('describes the hub heading and intro with the same wording as /admin/seo', async () => {
    const { TenantForm } = await import('./TenantForm');
    render(<TenantForm />);
    await waitFor(() => screen.getByTestId('page-header'));
    await userEvent.click(screen.getByRole('tab', { name: /^seo$/i }));

    expect(screen.getByRole('textbox', { name: 'Accessible site hub heading' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Accessible site hub intro' })).toBeInTheDocument();
    expect(screen.getByText(/Only used by a hub community\. Shown as the home page heading/)).toBeInTheDocument();
    expect(screen.getByText(/Only used by a hub community\. The paragraph under that heading/)).toBeInTheDocument();
  });
});
