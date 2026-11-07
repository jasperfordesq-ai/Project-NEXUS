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

const { mockApiPost } = vi.hoisted(() => ({ mockApiPost: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: null }), post: mockApiPost },
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

const APP_STORE_URL = 'https://apps.apple.com/app/timebank-global/id6823712395';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=ie.project.nexus';

describe('InstallAppPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseInstallPrompt.mockReturnValue(promptState());
    mockAuth.isAuthenticated = false;
  });

  it('links both official store badges to the real store pages', () => {
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Get the app' })).toBeInTheDocument();
    expect(screen.getByText('Now on the App Store and Google Play')).toBeInTheDocument();

    // Assert the real URLs, not just that a badge exists: a badge pointing
    // nowhere would still satisfy a name-only assertion.
    const apple = screen.getByTestId('install-badge-apple');
    expect(apple).toHaveAttribute('href', APP_STORE_URL);
    expect(apple).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getAllByRole('img', { name: 'Download on the App Store' })[0]).toHaveAttribute(
      'src',
      '/images/store-badges/app-store-en.svg',
    );

    const google = screen.getByTestId('install-badge-google');
    expect(google).toHaveAttribute('href', PLAY_STORE_URL);
    expect(google).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getAllByRole('img', { name: 'Get it on Google Play' })[0]).toHaveAttribute(
      'src',
      '/images/store-badges/google-play-en.png',
    );

    expect(screen.getByText('iPhone: iOS 15.1 or later (also runs on iPad)')).toBeInTheDocument();
    expect(screen.getByText('Android 7.0 or later')).toBeInTheDocument();
  });

  it('keeps the early-release notice above the store badges', () => {
    render(<InstallAppPage />);

    expect(screen.getByText('Early release — still in development')).toBeInTheDocument();
    expect(screen.getByText(/These are early versions of the app/)).toBeInTheDocument();
    // The owner asked for the notice to stay while these are early versions.
    // It must come BEFORE the badges in reading order, so it cannot be skipped
    // on the way to a store link.
    const notice = screen.getByTestId('install-early-notice');
    for (const badge of [screen.getByTestId('install-badge-apple'), screen.getByTestId('install-badge-google')]) {
      expect(notice.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('puts the App Store first for iPhone visitors and Google Play first for Android visitors', () => {
    mockUseInstallPrompt.mockReturnValue(promptState({ isIos: true, isIosSafari: true, browser: 'ios-safari' }));
    const { unmount } = render(<InstallAppPage />);
    let links = screen.getByTestId('install-store-badges').querySelectorAll('a');
    expect(links[0]).toHaveAttribute('href', APP_STORE_URL);
    unmount();

    mockUseInstallPrompt.mockReturnValue(promptState({ browser: 'chrome-android' }));
    render(<InstallAppPage />);
    links = screen.getByTestId('install-store-badges').querySelectorAll('a');
    expect(links[0]).toHaveAttribute('href', PLAY_STORE_URL);
  });

  it('offers a QR code for each store, for visitors on a computer', () => {
    render(<InstallAppPage />);

    // QrCodeImage renders an aria-labelled placeholder until its generator
    // chunk resolves, so the accessible name is present either way.
    expect(
      screen.getByRole('img', { name: 'QR code that opens the App Store page for the app' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'QR code that opens the Google Play page for the app' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('install-qr-badge-apple')).toHaveAttribute('href', APP_STORE_URL);
    expect(screen.getByTestId('install-qr-badge-google')).toHaveAttribute('href', PLAY_STORE_URL);
  });

  it('prints each store link as text, so nobody has to scan a code', () => {
    render(<InstallAppPage />);

    // AWID accessibility report, Oct 2026, point 15: a blind member cannot
    // scan a QR code. The link itself must be on the page as readable text.
    expect(screen.getByTestId('install-qr-link-apple')).toHaveTextContent(APP_STORE_URL);
    expect(screen.getByTestId('install-qr-link-google')).toHaveTextContent(PLAY_STORE_URL);
    // Only a signed-in member can have them emailed (to their own address).
    expect(screen.queryByTestId('install-email-links')).toBeNull();
  });

  it('emails a signed-in member the links and says so', async () => {
    mockAuth.isAuthenticated = true;
    mockApiPost.mockResolvedValueOnce({ success: true, data: { sent: true } });
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<InstallAppPage />);

    await userEvent.click(screen.getByTestId('install-email-links'));

    expect(mockApiPost).toHaveBeenCalledWith('/v2/app-links/email', {});
    expect(await screen.findByText('The links are on their way to your email address.')).toBeInTheDocument();
  });

  it('says plainly when the email could not be sent', async () => {
    mockAuth.isAuthenticated = true;
    mockApiPost.mockResolvedValueOnce({ success: false, error: 'nope' });
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<InstallAppPage />);

    await userEvent.click(screen.getByTestId('install-email-links'));

    expect(await screen.findByText('We could not send the email. Please try again later.')).toBeInTheDocument();
  });

  it('no longer says the iPhone app is still to come', () => {
    render(<InstallAppPage />);

    // Guards the specific regression this rewrite replaced: the page said the
    // iPhone version was "very nearly ready" after it had shipped.
    expect(screen.queryByText(/very nearly ready/)).not.toBeInTheDocument();
    expect(screen.queryByText(/We will add a link here/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not working properly yet/)).not.toBeInTheDocument();
  });

  it('invites early feedback through the tenant contact page', () => {
    render(<InstallAppPage />);

    expect(screen.getByText(/Be one of the first/)).toBeInTheDocument();
    expect(screen.getByTestId('install-feedback-cta')).toHaveAttribute('href', '/test/contact');
  });

  it('answers the common questions, naming the app as published', () => {
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Common questions' })).toBeInTheDocument();
    expect(screen.getByText('Does the app cost anything?')).toBeInTheDocument();
    expect(screen.getByText('Do I need a new account?')).toBeInTheDocument();
    // The store name is a brand and must reach the reader intact.
    expect(screen.getByText('Why is the app called Timebank Global?')).toBeInTheDocument();
    expect(screen.getByText('What does "early release" mean?')).toBeInTheDocument();
  });

  it('recommends the website as the most stable way to use the platform', () => {
    render(<InstallAppPage />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'The website: the most stable way to use Test Community',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Most stable')).toBeInTheDocument();
    expect(screen.getByText(/On iPhone and iPad that is not reliable/)).toBeInTheDocument();
    // With no browser prompt available, the section still gives an action.
    expect(screen.getByTestId('install-web-stable-steps')).toHaveAttribute('href', '#install-steps');
  });

  it('puts the one-tap install button inside the most-stable section', () => {
    mockUseInstallPrompt.mockReturnValue(promptState({ canPrompt: true }));
    render(<InstallAppPage />);

    const section = screen.getByTestId('install-web-stable');
    expect(section).toContainElement(screen.getByTestId('install-app-prompt'));
    expect(screen.queryByTestId('install-web-stable-steps')).toBeNull();
  });

  it('interpolates the tenant brand name instead of leaving the placeholder', () => {
    render(<InstallAppPage />);

    expect(screen.getByText(/the account you already use for Test Community/)).toBeInTheDocument();
    expect(screen.queryByText(/\{\{name\}\}/)).toBeNull();
    expect(screen.queryByText(/\{\{app\}\}/)).toBeNull();
  });

  it('shows the trademark attribution the store badge guidelines require', () => {
    render(<InstallAppPage />);

    expect(screen.getByTestId('install-trademarks')).toHaveTextContent(/App Store is a service mark of Apple Inc\./);
    expect(screen.getByTestId('install-trademarks')).toHaveTextContent(/Google Play and the Google Play logo are trademarks of Google LLC\./);
  });

  it('opens on the Windows steps for a desktop Chrome visitor', () => {
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 3, name: 'Windows computer' })).toBeInTheDocument();
    expect(screen.getByText('Open this page in Chrome or Edge.')).toBeInTheDocument();
  });

  it('opens on the iPhone steps and points Apple users at the App Store app', () => {
    mockUseInstallPrompt.mockReturnValue(
      promptState({ isIos: true, isIosSafari: true, browser: 'ios-safari' }),
    );
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 3, name: 'iPhone or iPad' })).toBeInTheDocument();
    expect(screen.getByText(/we recommend the app from the App Store instead/)).toBeInTheDocument();
  });

  it('still renders on Chrome for iOS, where saving the website is impossible', () => {
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
