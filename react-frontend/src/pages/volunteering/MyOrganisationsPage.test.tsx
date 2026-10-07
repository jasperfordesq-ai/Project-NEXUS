// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
      const { initial: _initial, animate: _animate, transition: _transition, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (path: string) => `/test${path}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }),
  useNotifications: () => ({ unreadCount: 0, counts: {} }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => <span key={item.label}>{item.label}</span>)}
    </nav>
  ),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
// PageMeta pulls useTenant straight from '@/contexts/TenantContext' (bypassing
// the '@/contexts' barrel mock), so stub it out like the other page tests do.
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

const translations: Record<string, string> = {
  my_organisations_open_dashboard: 'Open dashboard',
  breadcrumb_volunteering: 'Volunteering',
  my_organisations: 'My Organisations',
  my_organisations_title: 'My Organisations',
  my_organisations_subtitle: 'Manage your volunteer organisations.',
  register_organisation: 'Register Organisation',
  loading: 'Loading',
  status_active: 'Active',
  member_roles: 'Member Roles',
  'member_roles.owner': 'Owner',
  'member_roles.admin': 'Admin',
  'member_roles.member': 'Member',
  hours_abbrev: '{{hours}}h',
  wallet: 'Wallet',
  manage: 'Manage',
  my_organisations_none: 'No Organisations Yet',
  my_organisations_load_error: 'Unable to load your organisations. Please try again.',
  try_again: 'Try Again',
  status_declined: 'Declined',
  my_organisations_declined: 'Declined',
  my_organisations_declined_desc: "This application wasn't approved. Contact your community administrator for details.",
  'common:footer.contact_us': 'Contact Us',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let value = translations[key] ?? key;
      Object.entries(options ?? {}).forEach(([optionKey, optionValue]) => {
        value = value.replace(`{{${optionKey}}}`, String(optionValue));
      });
      return value;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import MyOrganisationsPage from './MyOrganisationsPage';
import { api } from '@/lib/api';

describe('MyOrganisationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 7,
          name: 'Community Helpers',
          description: 'Local volunteering team',
          status: 'active',
          member_role: 'owner',
          contact_email: 'helpers@example.com',
          website: null,
          balance: 12,
        },
      ],
      meta: { cursor: null, has_more: false },
    });
  });

  it('renders translated manager roles instead of raw backend role values', async () => {
    render(<MyOrganisationsPage />);

    await waitFor(() => expect(screen.getByText('Community Helpers')).toBeInTheDocument());

    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.queryByText('owner')).not.toBeInTheDocument();
  });

  // Gap A7 (6 Oct 2026): a pending organisation's dashboard already works, but the
  // pending row was plain text, so its owner could not reach it.
  it('links a pending organisation to its dashboard', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        { id: 12, name: 'Waiting Org', description: null, status: 'pending', member_role: 'owner', contact_email: null, website: null },
      ],
      meta: { cursor: null, has_more: false, per_page: 20 },
    });

    render(<MyOrganisationsPage />);

    expect(await screen.findByTestId('pending-org-open-12')).toHaveAttribute('href', '/test/volunteering/org/12/dashboard');
    expect(screen.getByTestId('pending-org-open-12')).toHaveTextContent('Open dashboard');
  });

  // Fix 13: an org whose only status is 'declined' previously rendered blank
  // (it matched neither the pending section nor the active-status filter).
  it('renders a declined organisation with a status chip and explanation', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 9,
          name: 'Rejected Org',
          description: null,
          status: 'declined',
          member_role: 'owner',
          contact_email: null,
          website: null,
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    render(<MyOrganisationsPage />);

    await waitFor(() => expect(screen.getByText('Rejected Org')).toBeInTheDocument());

    // The declined explanation renders, and it is NOT the "no organisations" empty state.
    expect(
      screen.getByText("This application wasn't approved. Contact your community administrator for details."),
    ).toBeInTheDocument();
    expect(screen.queryByText('No Organisations Yet')).not.toBeInTheDocument();
    // Gap C6: the explanation says to contact the community; it now links to how.
    expect(screen.getByRole('link', { name: /Contact Us/ }).getAttribute('href')).toMatch(/\/contact$/);
  });

  it('shows a retryable error instead of the empty state when the fetch fails', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: false,
      error: 'boom',
      code: 'NETWORK_ERROR',
    });

    render(<MyOrganisationsPage />);

    await waitFor(() =>
      expect(screen.getByText('Unable to load your organisations. Please try again.')).toBeInTheDocument(),
    );

    // A failed request must NOT masquerade as "no organisations".
    expect(screen.queryByText('No Organisations Yet')).not.toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });
});
