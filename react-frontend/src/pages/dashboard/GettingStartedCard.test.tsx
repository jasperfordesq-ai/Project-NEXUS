// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const DAY = 86_400_000;
const { authState, tenantState } = vi.hoisted(() => ({
  authState: { user: null as Record<string, unknown> | null },
  tenantState: { settings: {} as Record<string, unknown> },
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
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test', settings: tenantState.settings },
    branding: { name: 'Hour Timebank' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { GettingStartedCard, hasOwnPhoto } from './GettingStartedCard';

const newcomer = () => ({
  id: 7,
  name: 'Maeve Byrne',
  avatar: null,
  avatar_url: null,
  onboarding_completed: true,
  created_at: new Date(Date.now() - 3 * DAY).toISOString(),
});

describe('hasOwnPhoto', () => {
  it('does not count the stock silhouette as a photo', () => {
    expect(hasOwnPhoto({ avatar_url: 'https://api.example/assets/img/defaults/default_avatar.png' })).toBe(false);
    expect(hasOwnPhoto({ avatar: null, avatar_url: null })).toBe(false);
    expect(hasOwnPhoto({ avatar_url: '/uploads/tenants/2/avatars/7.jpg' })).toBe(true);
  });
});

describe('GettingStartedCard', () => {
  beforeEach(() => {
    localStorage.clear();
    authState.user = newcomer();
    tenantState.settings = {};
  });

  it('gives a newcomer one short list: what is done, and what is left with a link to do it', () => {
    render(<GettingStartedCard hasListing={false} listingsOn />);

    expect(screen.getByRole('heading', { name: 'Getting started in Hour Timebank' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
    // The welcome steps are finished, so that line is ticked and is not a link.
    expect(screen.getByText('Finish the welcome steps').closest('li')).toHaveAttribute('data-done', 'true');
    expect(screen.queryByRole('link', { name: /Finish the welcome steps/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Add a photo of yourself/ })).toHaveAttribute('href', '/test/settings');
    expect(screen.getByRole('link', { name: /Post an offer or request/ })).toHaveAttribute('href', '/test/listings/create');
  });

  it('sends a member who has not finished the welcome steps back to them', () => {
    authState.user = { ...newcomer(), onboarding_completed: false };
    render(<GettingStartedCard hasListing={false} listingsOn />);
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Finish the welcome steps/ })).toHaveAttribute('href', '/test/onboarding');
  });

  it('leaves the welcome steps out when the community has switched them off', () => {
    authState.user = { ...newcomer(), onboarding_completed: false };
    tenantState.settings = { onboarding_enabled: false };
    render(<GettingStartedCard hasListing={false} listingsOn />);
    expect(screen.queryByText('Finish the welcome steps')).toBeNull();
    expect(screen.getByText('0 of 2 done')).toBeInTheDocument();
  });

  it('leaves offers and requests out when the community does not use them', () => {
    render(<GettingStartedCard hasListing={false} listingsOn={false} />);
    expect(screen.queryByText('Post an offer or request')).toBeNull();
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
  });

  it('says nothing once everything is done', () => {
    authState.user = { ...newcomer(), avatar_url: '/uploads/tenants/2/avatars/7.jpg' };
    render(<GettingStartedCard hasListing listingsOn />);
    expect(screen.queryByTestId('getting-started')).toBeNull();
  });

  it('waits until it knows whether the member has an offer or request', () => {
    render(<GettingStartedCard hasListing={null} listingsOn />);
    expect(screen.queryByTestId('getting-started')).toBeNull();
  });

  it('uses a plainer heading for a member who is not new', () => {
    authState.user = { ...newcomer(), created_at: new Date(Date.now() - 200 * DAY).toISOString() };
    render(<GettingStartedCard hasListing listingsOn />);
    expect(screen.getByRole('heading', { name: 'A few things still to do' })).toBeInTheDocument();
    expect(screen.getByText('2 of 3 done')).toBeInTheDocument();
  });

  it('can be put away, and stays away on the next visit', () => {
    const first = render(<GettingStartedCard hasListing={false} listingsOn />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('getting-started')).toBeNull();
    first.unmount();

    render(<GettingStartedCard hasListing={false} listingsOn />);
    expect(screen.queryByTestId('getting-started')).toBeNull();
  });

  it('comes back once 30 days have passed', () => {
    localStorage.setItem('nexus_getting_started_closed_7', String(Date.now() - 31 * DAY));
    render(<GettingStartedCard hasListing={false} listingsOn />);
    expect(screen.getByTestId('getting-started')).toBeInTheDocument();
  });

  it('stays quiet for a member who put the old photo prompt away in the last 30 days', () => {
    localStorage.setItem('nexus_photo_prompt_closed_7', String(Date.now() - 2 * DAY));
    render(<GettingStartedCard hasListing={false} listingsOn />);
    expect(screen.queryByTestId('getting-started')).toBeNull();
  });
});
