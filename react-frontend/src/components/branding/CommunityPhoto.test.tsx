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

  // 13 Nov 2026: on the feed and Explore the photo was a fixed-height strip
  // across the whole page width — up to eight times wider than tall, so only a
  // fifth of the picture showed. A framed photo keeps one shape at any width.
  it('keeps one shape, two wide to one tall, when it is framed as a picture', () => {
    render(<CommunityPhoto framed data-testid="photo" className="w-full max-w-md" />);
    const img = screen.getByTestId('photo');
    expect(img.className).toContain('aspect-[2/1]');
    expect(img.className).toContain('object-cover');
    expect(img.className).toContain('max-w-md');
    // The shape comes from the ratio, never from a fixed height.
    expect(img.className).not.toMatch(/(^|\s)(sm:|md:|lg:)?h-\d/);
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
