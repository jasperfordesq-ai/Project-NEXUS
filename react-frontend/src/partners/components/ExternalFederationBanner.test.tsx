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

describe('ExternalFederationBanner', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    // The hook shares one in-flight request across consumers; drop it so each
    // test observes its own fixture rather than the previous test's.
    const { resetExternalFederationStatusCache } = await import('./useExternalFederationStatus');
    resetExternalFederationStatusCache();
  });

  it('warns when external federation is switched off', async () => {
    mockAdminFederation.getSettings.mockResolvedValue(
      settings({ effective: false, master_enabled: false, emergency_lockdown_active: false, reason: null, protocols: {} })
    );
    const { ExternalFederationBanner } = await import('./ExternalFederationBanner');
    render(<ExternalFederationBanner />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
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
    mockAdminFederation.getSettings.mockResolvedValue(
      settings({
        effective: false,
        master_enabled: false,
        emergency_lockdown_active: false,
        reason: 'Pending security audit',
        protocols: {},
      })
    );
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
