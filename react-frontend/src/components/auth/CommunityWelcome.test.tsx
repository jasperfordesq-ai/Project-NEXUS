// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { SiteAccentContext } from '@/contexts/SiteAccentContext';
import { paletteFor } from '@/lib/categoryColours';

const { branding } = vi.hoisted(() => ({
  branding: {
    name: 'Hour Timebank',
    tagline: 'Neighbours helping neighbours' as string | undefined,
    communityPhoto: null as string | null,
  },
}));

const tenantValue = () => ({
  tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
  branding,
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn((_key: string) => true),
  hasModule: vi.fn((_key: string) => true),
});
// CommunityWelcome is on the sign-in startup path, so it reads the tenant from
// its own module (check-bundle-budget); CommunityPhoto inside it uses the barrel.
vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: () => tenantValue(),
}));
vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => tenantValue(),
}));

import { CommunityWelcome } from './CommunityWelcome';

describe('CommunityWelcome', () => {
  beforeEach(() => {
    branding.tagline = 'Neighbours helping neighbours';
    branding.communityPhoto = null;
  });

  it("opens with the community's own photo when it has one", () => {
    branding.communityPhoto = '/uploads/tenants/hour/community-photos/us.webp';
    render(<CommunityWelcome />);
    expect(screen.getByTestId('community-welcome-photo').getAttribute('src')).toContain('community-photos/us.webp');
    expect(screen.queryByTestId('community-welcome-cover')).not.toBeInTheDocument();
    // The logo still sits on top of the photo.
    expect(screen.getByTestId('community-welcome-logo')).toBeInTheDocument();
  });

  it("opens with a cover in the community's own colour", () => {
    render(
      <SiteAccentContext.Provider value="#a3195b">
        <CommunityWelcome />
      </SiteAccentContext.Provider>,
    );
    const cover = screen.getByTestId('community-welcome-cover');
    expect(cover).toHaveAttribute('data-colour', paletteFor('#a3195b')[0]);
    expect(cover).toHaveAttribute('aria-hidden', 'true');
  });

  it("shows the community's own tagline", () => {
    render(<CommunityWelcome />);
    expect(screen.getByText('Neighbours helping neighbours')).toBeInTheDocument();
  });

  it('falls back to the standard tagline when the community has none', () => {
    branding.tagline = undefined;
    render(<CommunityWelcome />);
    expect(screen.getByTestId('community-welcome-tagline').textContent?.trim()).not.toBe('');
  });

  it("shows the community's logo (or its initials) on the cover", () => {
    render(<CommunityWelcome />);
    expect(screen.getByTestId('community-welcome-logo')).toBeInTheDocument();
  });
});
