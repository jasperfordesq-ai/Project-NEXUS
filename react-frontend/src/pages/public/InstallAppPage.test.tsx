// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for InstallAppPage.
 *
 * Mocking notes follow the same pattern as the other public pages: mock
 * '@/contexts/TenantContext' on its DIRECT path (the '@/contexts' barrel
 * re-exports it, and PageMeta imports the direct path), and stub '@/lib/motion'
 * so the animation wrapper renders plain elements.
 *
 * '@/lib/installPrompt' is mocked because the real module attaches window
 * listeners at import time and derives its state from the user agent — the point
 * of these tests is that the page adapts to that state, so it has to be
 * injectable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: null }) },
  tokenManager: { getTenantId: vi.fn(), getToken: vi.fn() },
}));

const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community', logo_url: null, tagline: 'A test community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: () => true,
  hasModule: () => true,
  isLoading: false,
  error: null,
};

const mockAuth = { user: null, isAuthenticated: false };

vi.mock('@/contexts/TenantContext', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
  useTenant: () => mockTenant,
  useFeature: () => true,
  useModule: () => true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuth,
  useAuthOptional: () => mockAuth,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/lib/motion', () => {
  const ANIMATION_PROPS = [
    'variants', 'initial', 'animate', 'exit', 'transition',
    'whileHover', 'whileTap', 'whileInView', 'layout', 'viewport',
  ];
  const proxy = new Proxy({}, {
    get: (_t: object, prop: string | symbol) => {
      return ({
        children,
        ref,
        ...rest
      }: {
        children?: React.ReactNode;
        ref?: React.Ref<HTMLElement>;
      } & Record<string, unknown>) => {
        const domProps: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rest)) {
          if (!ANIMATION_PROPS.includes(key)) domProps[key] = value;
        }
        return React.createElement(
          typeof prop === 'string' ? prop : 'div',
          { ...domProps, ref } as React.Attributes,
          children,
        );
      };
    },
  });
  return { motion: proxy, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});

const { mockPromptInstall, mockUseInstallPrompt } = vi.hoisted(() => ({
  mockPromptInstall: vi.fn().mockResolvedValue('accepted'),
  mockUseInstallPrompt: vi.fn(),
}));

vi.mock('@/lib/installPrompt', () => ({
  useInstallPrompt: mockUseInstallPrompt,
}));

function promptState(overrides: Record<string, unknown> = {}) {
  return {
    canPrompt: false,
    isIos: false,
    isInstalled: false,
    isIosSafari: false,
    browser: 'chrome-desktop' as const,
    promptInstall: mockPromptInstall,
    ...overrides,
  };
}

import { InstallAppPage } from './InstallAppPage';

describe('InstallAppPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseInstallPrompt.mockReturnValue(promptState());
  });

  it('renders the heading and the honest device-support status', () => {
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Get the app' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Where things stand right now' })).toBeInTheDocument();
    // "Available now" is deliberately used twice — as the status label here and
    // as the chip on the home-screen card, so the two agree.
    expect(screen.getAllByText('Available now')).toHaveLength(2);
    expect(screen.getByText('Android phones and tablets, using Chrome')).toBeInTheDocument();
    expect(screen.getByText('Windows computers, using Chrome or Edge')).toBeInTheDocument();
    // The Apple caveat is the whole reason the banner was withdrawn — it must
    // be on the page, not buried.
    expect(screen.getByText('Not working properly yet')).toBeInTheDocument();
    expect(screen.getByText(/Saving Test Community to an Apple device does not work properly/)).toBeInTheDocument();
    expect(screen.getByText(/We will keep this page up to date/)).toBeInTheDocument();
  });

  it('offers the live Google Play release with a working link, a QR code and an early-release warning', () => {
    render(<InstallAppPage />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'The Android app is live on Google Play' }),
    ).toBeInTheDocument();

    // The link is the point of the section: assert the real store URL rather
    // than just that a button exists, because a button pointing nowhere would
    // still satisfy a name-only assertion.
    const cta = screen.getByTestId('install-play-cta');
    expect(cta).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=ie.project.nexus');
    expect(cta).toHaveAttribute('rel', expect.stringContaining('noopener'));

    // QrCodeImage renders an aria-labelled placeholder until its generator
    // chunk resolves, so the accessible name is present either way.
    expect(
      screen.getByRole('img', { name: 'QR code that opens the Google Play page for the app' }),
    ).toBeInTheDocument();

    // Early-release honesty and the invitation to give feedback both have to
    // survive: they are the reason this is framed as an early release at all.
    expect(screen.getByText(/This is an early release, and we are still working on it/)).toBeInTheDocument();
    expect(screen.getByText(/first public release and the app is still being built/)).toBeInTheDocument();
    expect(screen.getByText(/Be one of the first/)).toBeInTheDocument();
    expect(screen.getByTestId('install-play-feedback-cta')).toHaveAttribute('href', '/test/contact');

    // iPhone/iPad is stated as nearly ready but deliberately without a date.
    expect(screen.getByText(/An iPhone and iPad version is built from the same app/)).toBeInTheDocument();
  });

  it('no longer claims there is no download link, now that Android has shipped', () => {
    render(<InstallAppPage />);

    // Guards the specific regression this section replaced: the native-app card
    // used to end with "There is no download link here yet", which contradicted
    // the store link above it the moment Android went live.
    expect(screen.queryByText(/no download link here yet/)).not.toBeInTheDocument();
    expect(screen.getByText(/Android is live, and the download link and QR code are at the top/)).toBeInTheDocument();
  });

  it('explains why Apple devices are the awkward ones, in Apple-rule terms', () => {
    render(<InstallAppPage />);

    expect(
      screen.getByRole('heading', { level: 2, name: /Why is it harder on Apple devices/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/There is no one-tap install/)).toBeInTheDocument();
    expect(screen.getByText(/only works in Safari/)).toBeInTheDocument();
    expect(screen.getByText(/opens logged out and you have to sign in again/)).toBeInTheDocument();
    // The reader is pointed at the option that does work on Apple.
    expect(screen.getByText(/None of that applies to the proper app/)).toBeInTheDocument();
  });

  it('distinguishes the home-screen version from a proper native app', () => {
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 3, name: 'Just use your browser' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'The website saved to your home screen' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'The proper app, from the app store' }),
    ).toBeInTheDocument();
    // Both bits of jargon are named and then defined in the same sentence.
    expect(screen.getByText(/short for Progressive Web App/)).toBeInTheDocument();
    expect(screen.getByText(/Developers call this a native app/)).toBeInTheDocument();
    // One app covers both platforms, and the ordering is stated honestly.
    // 🔴 This used to assert "Android is closest" and "no download link here
    // yet". Android shipped on 2026-08-26, so both sentences became false and
    // the second one contradicted the store link now at the top of the page.
    // The assertions moved with the copy rather than being deleted.
    expect(screen.getByText('One app for both Android and iPhone or iPad')).toBeInTheDocument();
    expect(screen.getByText(/Android is live/)).toBeInTheDocument();
    expect(screen.getByText(/We will add a link here the moment it is available/)).toBeInTheDocument();
    // The Capacitor wrapper stays off the page while its future is undecided.
    expect(screen.queryByText(/Capacitor/)).toBeNull();
  });

  it('interpolates the tenant brand name instead of leaving the placeholder', () => {
    render(<InstallAppPage />);

    expect(screen.getByText(/You can use Test Community in any web browser/)).toBeInTheDocument();
    expect(screen.queryByText(/\{\{name\}\}/)).toBeNull();
  });

  it('opens on the Windows steps for a desktop Chrome visitor', () => {
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 3, name: 'Windows computer' })).toBeInTheDocument();
    expect(screen.getByText('Open this page in Chrome or Edge.')).toBeInTheDocument();
  });

  it('opens on the iPhone steps and shows the Apple warning on iOS Safari', () => {
    mockUseInstallPrompt.mockReturnValue(
      promptState({ isIos: true, isIosSafari: true, browser: 'ios-safari' }),
    );
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 3, name: 'iPhone or iPad' })).toBeInTheDocument();
    expect(screen.getByText(/unreliable on Apple devices at the moment/)).toBeInTheDocument();
  });

  it('still renders on Chrome for iOS, where installing is impossible', () => {
    // The old menu gate hid the install entry entirely for these users. They
    // are exactly the people who need telling that Apple only allows it in
    // Safari.
    mockUseInstallPrompt.mockReturnValue(
      promptState({ isIos: true, browser: 'ios-other' }),
    );
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Get the app' })).toBeInTheDocument();
    expect(screen.getByText(/Apple only allows it in Safari/)).toBeInTheDocument();
  });

  it('hides the one-tap install button when the browser has not offered a prompt', () => {
    render(<InstallAppPage />);
    expect(screen.queryByTestId('install-app-prompt')).toBeNull();
  });

  it('offers the one-tap install button when a native prompt is available', async () => {
    mockUseInstallPrompt.mockReturnValue(promptState({ canPrompt: true }));
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<InstallAppPage />);

    const button = screen.getByTestId('install-app-prompt');
    expect(button).toBeInTheDocument();

    await userEvent.click(button);
    expect(mockPromptInstall).toHaveBeenCalledTimes(1);
  });

  it('tells an already-installed visitor there is nothing to do here', () => {
    mockUseInstallPrompt.mockReturnValue(promptState({ isInstalled: true }));
    render(<InstallAppPage />);

    expect(screen.getByText('You are already using the installed app')).toBeInTheDocument();
    expect(screen.queryByTestId('install-app-prompt')).toBeNull();
  });

  it('links to the tenant-scoped help routes', () => {
    render(<InstallAppPage />);

    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/test/contact');
    expect(screen.getByRole('link', { name: 'Visit the help centre' })).toHaveAttribute('href', '/test/help');
  });
});
