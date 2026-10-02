// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

const { mockSafeguardingDashboard, mockVolunteerSafeguarding, mockHasFeature } = vi.hoisted(() => ({
  mockSafeguardingDashboard: vi.fn(),
  mockVolunteerSafeguarding: vi.fn(({ canAssignDlp }: { canAssignDlp?: boolean }) => (
    <div data-testid="volunteering-incidents" data-can-assign-dlp={String(canAssignDlp)} />
  )),
  mockHasFeature: vi.fn((feature: string) => feature === 'volunteering'),
}));

// The stand-in dashboard reports whether it was rendered inside the
// AdminEmbed provider — that flag is what collapses its own PageHeader.
vi.mock('@/admin/modules/safeguarding/SafeguardingDashboard', async () => {
  const { useAdminEmbedded } = await import('@/admin/components/AdminEmbedContext');
  return {
    SafeguardingDashboard: (props: { routeBase?: string }) => {
      mockSafeguardingDashboard(props);
      return (
        <div
          data-testid="shared-safeguarding-dashboard"
          data-route-base={props.routeBase}
          data-embedded={String(useAdminEmbedded())}
        />
      );
    },
  };
});

vi.mock('@/admin/modules/volunteering/VolunteerSafeguarding', () => ({
  VolunteerSafeguarding: mockVolunteerSafeguarding,
}));

vi.mock('@/contexts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts')>()),
  useTenant: () => ({ hasFeature: mockHasFeature, tenantPath: (p: string) => `/test${p}` }),
}));

describe('SafeguardingPage (broker)', () => {
  it('reuses the full admin safeguarding dashboard with broker-scoped links', async () => {
    const mod = await import('./SafeguardingPage');
    const Component = mod.default;

    render(<Component />);

    expect(screen.getByTestId('shared-safeguarding-dashboard')).toHaveAttribute(
      'data-route-base',
      '/broker/safeguarding',
    );
    expect(mockSafeguardingDashboard).toHaveBeenCalledTimes(1);
  });

  it('frames the shared dashboard in the broker shell with broker-namespace copy', async () => {
    const mod = await import('./SafeguardingPage');
    const Component = mod.default;

    render(<Component />);

    // Broker-branded header from BrokerPageShell (danger domain, shield icon)
    expect(screen.getByRole('heading', { level: 1, name: 'Safeguarding' })).toBeInTheDocument();
    expect(
      screen.getByText('Monitor safeguarding alerts, guardian assignments, and member preferences.')
    ).toBeInTheDocument();
  });

  it('renders the shared dashboard inside the AdminEmbed provider so its own header collapses', async () => {
    const mod = await import('./SafeguardingPage');
    const Component = mod.default;

    render(<Component />);

    expect(screen.getByTestId('shared-safeguarding-dashboard')).toHaveAttribute('data-embedded', 'true');
  });

  // F-536: volunteering incidents alert brokers and coordinators and link here.
  it('shows volunteering incidents for brokers, without DLP assignment, when volunteering is on', async () => {
    mockHasFeature.mockImplementation((feature: string) => feature === 'volunteering');
    const mod = await import('./SafeguardingPage');
    const Component = mod.default;

    render(<Component />);

    expect(screen.getByRole('heading', { level: 2, name: 'Volunteering incidents' })).toBeInTheDocument();
    expect(screen.getByTestId('volunteering-incidents')).toHaveAttribute('data-can-assign-dlp', 'false');
  });

  it('leaves volunteering incidents out when volunteering is switched off', async () => {
    mockHasFeature.mockImplementation(() => false);
    const mod = await import('./SafeguardingPage');
    const Component = mod.default;

    render(<Component />);

    expect(screen.queryByTestId('volunteering-incidents')).not.toBeInTheDocument();
    expect(screen.getByTestId('shared-safeguarding-dashboard')).toBeInTheDocument();
  });
});
