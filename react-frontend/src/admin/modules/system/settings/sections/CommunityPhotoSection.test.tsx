// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { LandingPageConfig } from '@/types';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

const { branding, landing } = vi.hoisted(() => ({
  branding: { name: 'Hour Timebank', communityPhoto: null as string | null },
  // undefined = the community never edited its home page, so it has the default one.
  landing: { config: undefined as LandingPageConfig | undefined },
}));

vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    branding,
    landingPageConfig: landing.config,
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { CommunityPhotoSection } from './CommunityPhotoSection';

function stateWith(overrides: Partial<AdminSettingsFormState> = {}): AdminSettingsFormState {
  return {
    uploading: { community_photo: false },
    upload: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  } as unknown as AdminSettingsFormState;
}

describe('CommunityPhotoSection', () => {
  beforeEach(() => {
    branding.communityPhoto = null;
    landing.config = undefined;
  });

  it('offers an upload, and says where the photo will appear', () => {
    render(<CommunityPhotoSection state={stateWith()} />);
    expect(screen.getByRole('heading', { name: 'Community photo' })).toBeInTheDocument();
    expect(screen.getByText(/it appears on your home page\./i)).toBeInTheDocument();
    // It came off the dashboard on 13 Nov 2026; the admin must not be told otherwise.
    expect(screen.queryByText(/dashboard/i)).toBeNull();
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument();
  });

  it('asks the admin to use a photo everyone in it has agreed to share', () => {
    render(<CommunityPhotoSection state={stateWith()} />);
    expect(screen.getByText(/everyone in it has agreed to share/i)).toBeInTheDocument();
    // The photo is no longer on the sign-in form (13 Nov 2026); the public
    // page it is on is the home page.
    expect(screen.getByText(/anyone can see your home page, not just members/i)).toBeInTheDocument();
    expect(screen.queryByText(/sign-in/i)).toBeNull();
    // Nor on the join page or the welcome step (same day).
    expect(screen.queryByText(/join page/i)).toBeNull();
    // Nor on the feed or Explore: "in too many places" (same day).
    expect(screen.queryByText(/the feed|Explore/)).toBeNull();
  });

  it('accepts photos only, not SVG drawings', () => {
    render(<CommunityPhotoSection state={stateWith()} />);
    const input = screen.getByTestId('logo-input-community-photo') as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
  });

  it('sends a chosen photo to the community photo slot', () => {
    const upload = vi.fn();
    render(<CommunityPhotoSection state={stateWith({ upload })} />);
    const file = new File(['x'], 'us.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('logo-input-community-photo'), { target: { files: [file] } });
    expect(upload).toHaveBeenCalledWith('community_photo', file);
  });

  it('can remove the current photo', () => {
    branding.communityPhoto = '/uploads/tenants/test/community-photos/us.webp';
    const remove = vi.fn();
    render(<CommunityPhotoSection state={stateWith({ remove })} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(remove).toHaveBeenCalledWith('community_photo');
  });

  // Owner, 13 Nov 2026: "it should have a preview so people can see what's
  // going to appear on the home page."
  describe('the home page preview', () => {
    it('is not there until the community has a photo', () => {
      render(<CommunityPhotoSection state={stateWith()} />);
      expect(screen.queryByTestId('community-photo-home-preview')).toBeNull();
    });

    it('shows the real top of the home page, with the photo in the shape visitors see', () => {
      branding.communityPhoto = '/uploads/tenants/test/community-photos/us.webp';
      render(<CommunityPhotoSection state={stateWith()} />);

      const preview = screen.getByTestId('community-photo-home-preview');
      expect(within(preview).getByText('How it looks on your home page')).toBeInTheDocument();

      // The home page's own opening block, not a second copy of its design.
      const photo = within(preview).getByTestId('landing-hero-photo');
      expect(photo.getAttribute('src')).toContain('community-photos/us.webp');
      expect(photo.className).toContain('aspect-[2/1]');
      expect(within(preview).getByText('Build Community')).toBeInTheDocument();

      // A picture of the page: nothing in it can be clicked or tabbed to.
      expect(photo.closest('[inert]')).not.toBeNull();

      // One picture of the photo, not two: the plain one gives way to the preview.
      expect(screen.queryByTestId('logo-preview-community-photo')).toBeNull();
    });

    it("uses the community's own headline when it has rewritten its home page", () => {
      branding.communityPhoto = '/uploads/tenants/test/community-photos/us.webp';
      landing.config = {
        sections: [
          { id: 'hero', type: 'hero', enabled: true, order: 0, content: { headline_1: 'Neighbours helping', headline_2: 'neighbours' } },
        ],
      };
      render(<CommunityPhotoSection state={stateWith()} />);

      const preview = screen.getByTestId('community-photo-home-preview');
      expect(within(preview).getByText('Neighbours helping')).toBeInTheDocument();
      expect(within(preview).queryByText('Build Community')).toBeNull();
    });

    it('says so, and shows the plain picture, when the welcome banner is switched off', () => {
      branding.communityPhoto = '/uploads/tenants/test/community-photos/us.webp';
      landing.config = { sections: [{ id: 'hero', type: 'hero', enabled: false, order: 0 }] };
      render(<CommunityPhotoSection state={stateWith()} />);

      const preview = screen.getByTestId('community-photo-home-preview');
      expect(within(preview).getByText(/welcome banner on your home page is switched off/i)).toBeInTheDocument();
      expect(within(preview).getByText(/does not appear anywhere on your site/i)).toBeInTheDocument();
      expect(within(preview).getByRole('link', { name: /home page editor/i })).toHaveAttribute('href', '/test/admin/landing-page');
      expect(within(preview).queryByTestId('landing-hero-photo')).toBeNull();

      // Still a picture of the photo, in the shape the other pages use.
      const plain = screen.getByTestId('logo-preview-community-photo');
      expect(plain.getAttribute('src')).toContain('community-photos/us.webp');
      expect(plain.className).toContain('aspect-[2/1]');
    });
  });
});
