// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminFederation } = vi.hoisted(() => ({
  mockAdminFederation: { getSettings: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminFederation: mockAdminFederation,
  default: { adminFederation: mockAdminFederation },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

const settings = (external: Record<string, unknown> | undefined) => ({
  success: true,
  data: { external_federation: external },
});

const OFF = { effective: false, master_enabled: false, emergency_lockdown_active: false, reason: null, protocols: {} };
const LOCKDOWN = { ...OFF, emergency_lockdown_active: true };

/** test-utils renders inside a BrowserRouter, so the address bar is the route. */
function goTo(path: string) {
  window.history.pushState({}, '', path);
}

const NOT_AFFECTED = 'Partnerships with other communities on this platform are not affected.';

describe('ExternalFederationBanner', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    goTo('/test/partner-timebanks/external-partners');
    // The hook shares one in-flight request across consumers; drop it so each
    // test observes its own fixture rather than the previous test's.
    const { resetExternalFederationStatusCache } = await import('./useExternalFederationStatus');
    resetExternalFederationStatusCache();
  });

  it('says so, calmly, on a page that talks to other platforms', async () => {
    mockAdminFederation.getSettings.mockResolvedValue(settings(OFF));
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('Links to other platforms are switched off');
    // Load-bearing: without it an operator may think same-platform partnerships broke too.
    expect(note).toHaveTextContent(NOT_AFFECTED);
    // Not an alarm, and no protocol jargon.
    expect(note.className).not.toContain('danger');
    expect(note).not.toHaveTextContent('503');
  });

  it.each([
    '/test/partner-timebanks/external-partners',
    '/test/partner-timebanks/credit-commons',
    '/test/partner-timebanks/inbound-api',
    '/test/partner-timebanks/api-keys',
    '/test/partner-timebanks/api-keys/create',
    '/test/partner-timebanks/webhooks',
    '/test/partner-timebanks/api-docs',
  ])('is shown on %s', async (path) => {
    goTo(path);
    mockAdminFederation.getSettings.mockResolvedValue(settings(OFF));
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('is shown when the router has stripped the community slug from the address', async () => {
    // TenantShell renders routes with the slug stripped on shared hosts, so
    // the pathname the component sees has no slug while tenantPath() adds one.
    goTo('/partner-timebanks/webhooks');
    mockAdminFederation.getSettings.mockResolvedValue(settings(OFF));
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it.each([
    '/test/partner-timebanks',
    '/partner-timebanks/partnerships',
    '/test/partner-timebanks/partnerships',
    '/test/partner-timebanks/directory',
    '/test/partner-timebanks/credit-agreements',
    '/test/partner-timebanks/settings',
    '/test/partner-timebanks/activity',
  ])('is NOT shown on %s, which is about communities on this platform', async (path) => {
    // Until November 2026 a red banner sat on every page of the panel —
    // permanently, since external federation has been off since 2026-07-27.
    goTo(path);
    mockAdminFederation.getSettings.mockResolvedValue(settings(OFF));
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    await waitFor(() => expect(mockAdminFederation.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('an emergency lockdown is shown in red on EVERY page, without the "not affected" line', async () => {
    // A lockdown stops same-platform partnering too, so the reassurance would be false.
    goTo('/test/partner-timebanks/partnerships');
    mockAdminFederation.getSettings.mockResolvedValue(settings(LOCKDOWN));
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    const alarm = await screen.findByRole('status');
    expect(alarm).toHaveTextContent('Federation emergency lockdown is active');
    expect(alarm.className).toContain('danger');
    expect(alarm).not.toHaveTextContent(NOT_AFFECTED);
  });

  it('stays silent when external federation is live', async () => {
    mockAdminFederation.getSettings.mockResolvedValue(
      settings({ effective: true, master_enabled: true, emergency_lockdown_active: false, reason: null, protocols: {} })
    );
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    await waitFor(() => expect(mockAdminFederation.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('surfaces the operator-supplied reason', async () => {
    mockAdminFederation.getSettings.mockResolvedValue(settings({ ...OFF, reason: 'Pending security audit' }));
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    await waitFor(() => {
      expect(screen.getByText('Pending security audit')).toBeInTheDocument();
    });
  });

  /** A failed/absent read must not imply "disabled" and spam a false alarm. */
  it('stays silent when the status cannot be read', async () => {
    mockAdminFederation.getSettings.mockRejectedValue(new Error('network'));
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    await waitFor(() => expect(mockAdminFederation.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
