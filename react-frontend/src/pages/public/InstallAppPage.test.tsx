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
    expect(screen.getByText('Available now')).toBeInTheDocument();
    expect(screen.getByText('Android phones and tablets, using Chrome')).toBeInTheDocument();
    expect(screen.getByText('Windows computers, using Chrome or Edge')).toBeInTheDocument();
    // The Apple caveat is the whole reason the banner was withdrawn — it must
    // be on the page, not buried.
    expect(screen.getByText('Known problem')).toBeInTheDocument();
    expect(screen.getByText(/Adding the app to an Apple device does not work properly/)).toBeInTheDocument();
    expect(screen.getByText(/We will keep this page up to date/)).toBeInTheDocument();
  });

  it('explains all four kinds of app in plain English', () => {
    render(<InstallAppPage />);

    expect(screen.getByRole('heading', { level: 3, name: 'Just use your browser' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Add it to your home screen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Our own Android app' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Google Play and the Apple App Store' })).toBeInTheDocument();
    // Jargon is named but immediately defined.
    expect(screen.getByText(/short for Progressive Web App/)).toBeInTheDocument();
    expect(screen.getByText(/Developers call this a Capacitor app/)).toBeInTheDocument();
    // The unreleased Android build must not be advertised as a download.
    expect(screen.getByText(/built but not released/)).toBeInTheDocument();
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
