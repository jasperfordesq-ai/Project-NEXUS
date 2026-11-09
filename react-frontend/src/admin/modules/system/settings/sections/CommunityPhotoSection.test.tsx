// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

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
  });

  it('offers an upload, and says where the photo will appear', () => {
    render(<CommunityPhotoSection state={stateWith()} />);
    expect(screen.getByRole('heading', { name: 'Community photo' })).toBeInTheDocument();
    expect(screen.getByText(/sign-in and join pages, on the dashboard and on the feed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument();
  });

  it('asks the admin to use a photo everyone in it has agreed to share', () => {
    render(<CommunityPhotoSection state={stateWith()} />);
    expect(screen.getByText(/everyone in it has agreed to share/i)).toBeInTheDocument();
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

  it('previews the current photo as a cover, and can remove it', () => {
    branding.communityPhoto = '/uploads/tenants/test/community-photos/us.webp';
    const remove = vi.fn();
    render(<CommunityPhotoSection state={stateWith({ remove })} />);

    const preview = screen.getByTestId('logo-preview-community-photo');
    expect(preview.getAttribute('src')).toContain('community-photos/us.webp');
    expect(preview.className).toContain('object-cover');

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(remove).toHaveBeenCalledWith('community_photo');
  });
});
