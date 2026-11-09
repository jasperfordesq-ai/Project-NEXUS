// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { branding } = vi.hoisted(() => ({
  branding: { name: 'Hour Timebank', communityPhoto: null as string | null },
}));

vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    branding,
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { CommunityPhoto } from './CommunityPhoto';

describe('CommunityPhoto', () => {
  beforeEach(() => {
    branding.communityPhoto = '/uploads/tenants/hour/community-photos/us.webp';
  });

  it("shows the community's photo as decoration, with no alt text to read out", () => {
    render(<CommunityPhoto data-testid="photo" />);
    const img = screen.getByTestId('photo');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toContain('/uploads/tenants/hour/community-photos/us.webp');
    expect(img).toHaveAttribute('alt', '');
  });

  it('shows the fallback when the community has no photo', () => {
    branding.communityPhoto = null;
    render(<CommunityPhoto data-testid="photo" fallback={<span data-testid="fallback" />} />);
    expect(screen.queryByTestId('photo')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('shows the fallback instead of a broken picture when the photo fails to load', () => {
    render(<CommunityPhoto data-testid="photo" fallback={<span data-testid="fallback" />} />);
    fireEvent.error(screen.getByTestId('photo'));
    expect(screen.queryByTestId('photo')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });
});
