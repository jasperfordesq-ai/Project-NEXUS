// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const { authState } = vi.hoisted(() => ({
  authState: { user: { id: 7, name: 'Maeve Byrne', avatar: null, avatar_url: null } as Record<string, unknown> | null },
}));

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({
    user: authState.user as unknown as User,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    branding: { name: 'Hour Timebank' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { PhotoPrompt, hasOwnPhoto } from './PhotoPrompt';

describe('hasOwnPhoto', () => {
  it('does not count the stock silhouette as a photo', () => {
    expect(hasOwnPhoto({ avatar_url: 'https://api.example/assets/img/defaults/default_avatar.png' })).toBe(false);
    expect(hasOwnPhoto({ avatar: null, avatar_url: null })).toBe(false);
    expect(hasOwnPhoto({ avatar_url: '/uploads/tenants/2/avatars/7.jpg' })).toBe(true);
  });
});

describe('PhotoPrompt', () => {
  beforeEach(() => {
    localStorage.clear();
    authState.user = { id: 7, name: 'Maeve Byrne', avatar: null, avatar_url: null };
  });

  it('invites a member without a photo to add one, with a link to where that is done', () => {
    render(<PhotoPrompt />);
    expect(screen.getByTestId('photo-prompt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a photo' })).toHaveAttribute('href', '/test/settings');
  });

  it('says nothing to a member who already has a photo', () => {
    authState.user = { id: 7, name: 'Maeve Byrne', avatar_url: '/uploads/tenants/2/avatars/7.jpg' };
    render(<PhotoPrompt />);
    expect(screen.queryByTestId('photo-prompt')).toBeNull();
  });

  it('can be put away, and stays away on the next visit', () => {
    const first = render(<PhotoPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('photo-prompt')).toBeNull();
    first.unmount();

    render(<PhotoPrompt />);
    expect(screen.queryByTestId('photo-prompt')).toBeNull();
  });

  it('asks again once 30 days have passed', () => {
    localStorage.setItem('nexus_photo_prompt_closed_7', String(Date.now() - 31 * 86_400_000));
    render(<PhotoPrompt />);
    expect(screen.getByTestId('photo-prompt')).toBeInTheDocument();
  });
});
