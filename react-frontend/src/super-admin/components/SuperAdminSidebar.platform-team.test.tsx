// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The super admin menu's link into the Platform team panel (15 Nov 2026).
 * Separate from SuperAdminSidebar.test.tsx, whose signed-in account is fixed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const authState = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
    }),
    useAuth: () => ({ user: authState.user } as never),
  })
);

import { SuperAdminSidebar } from './SuperAdminSidebar';

function panelLinks(): string[] {
  return screen
    .getAllByRole('link')
    .map((a) => a.getAttribute('href') ?? '')
    .filter((h) => h.includes('/platform-team'));
}

describe('SuperAdminSidebar — the way into the Platform team panel', () => {
  beforeEach(() => {
    authState.user = {};
  });

  it('links the platform team to their panel', () => {
    authState.user = { role: 'super_admin', is_god: true, is_super_admin: true, super_panel_level: 'master' };
    render(<SuperAdminSidebar collapsed={false} onToggle={() => {}} />);

    expect(panelLinks()).toEqual(['/test/platform-team']);
  });

  it('keeps the link when the menu is collapsed to icons', () => {
    authState.user = { role: 'super_admin', is_god: true, is_super_admin: true, super_panel_level: 'master' };
    render(<SuperAdminSidebar collapsed onToggle={() => {}} />);

    expect(panelLinks()).toEqual(['/test/platform-team']);
  });

  it.each([
    ['a global super admin who is not on the platform team', { role: 'super_admin', is_super_admin: true, super_panel_level: 'master' }],
    ['a tenant super admin', { role: 'admin', is_tenant_super_admin: true, super_panel_level: 'regional' }],
    ['an account with is_god but not super admin', { role: 'admin', is_god: true, super_panel_level: 'master' }],
  ])('does not show the link to %s', (_who, user) => {
    authState.user = user;
    render(<SuperAdminSidebar collapsed={false} onToggle={() => {}} />);

    expect(panelLinks()).toEqual([]);
  });
});
