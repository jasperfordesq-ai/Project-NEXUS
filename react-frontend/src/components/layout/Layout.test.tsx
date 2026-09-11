// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for Layout and AuthLayout components
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

// Mock child components to isolate Layout logic
const mockUseAuth = vi.fn();
const mockUseTenant = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
}));
vi.mock('./Navbar', () => ({
  Navbar: ({ onMobileMenuOpen: _onMobileMenuOpen }: Record<string, unknown>) => (
    <nav data-testid="navbar">Navbar Mock</nav>
  ),
}));
vi.mock('./MobileDrawer', () => ({
  MobileDrawer: ({ isOpen }: { isOpen?: boolean }) => (
    isOpen ? <div data-testid="mobile-drawer">MobileDrawer Mock</div> : null
  ),
}));
vi.mock('./MobileTabBar', () => ({
  MobileTabBar: () => <div data-testid="mobile-tab-bar">MobileTabBar Mock</div>,
}));
vi.mock('./Footer', () => ({
  Footer: () => <footer data-testid="footer">Footer Mock</footer>,
}));
vi.mock('@/components/feedback/FloatingReportProblemButton', () => ({
  default: () => <button type="button">Report a problem</button>,
  FloatingReportProblemButton: () => <button type="button">Report a problem</button>,
}));
vi.mock('@/components/ui/BackToTop', () => ({
  BackToTop: () => <div data-testid="back-to-top">BackToTop Mock</div>,
}));
vi.mock('@/components/feedback/OfflineIndicator', () => ({
  OfflineIndicator: () => <div data-testid="offline-indicator">Offline Mock</div>,
}));
vi.mock('@/components/feedback', () => ({
  SessionExpiredModal: () => <div data-testid="session-modal">SessionExpired Mock</div>,
}));
vi.mock('@/components/feedback/SessionExpiredModal', () => ({
  SessionExpiredModal: () => <div data-testid="session-modal">SessionExpired Mock</div>,
}));
vi.mock('@/components/pwa/InstallBanner', () => ({
  InstallBanner: () => null,
}));
vi.mock('@/components/pwa/InstallModalHost', () => ({
  InstallModalHost: () => null,
}));
vi.mock('@/components/seo/SeoHead', () => ({
  SeoHead: () => null,
}));
vi.mock('@/components/caring-community/EmergencyAlertBanner', () => ({
  default: () => null,
}));
vi.mock('@/components/legal/FadpConsentBanner', () => ({
  FadpConsentBanner: () => null,
}));
vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));
vi.mock('@/hooks', () => ({
  useApiErrorHandler: vi.fn(),
  useHeaderScroll: vi.fn(() => ({ isScrolled: false, isUtilityBarVisible: true })),
}));
vi.mock('@/hooks/useHeaderScroll', () => ({
  useHeaderScroll: vi.fn(() => ({ isScrolled: false, isUtilityBarVisible: true })),
}));

// Mock react-router-dom Outlet to render test content
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet">Page Content</div>,
  };
});

import { Layout, AuthLayout } from './Layout';
import { PROJECT_NEXUS_REPO_URL } from './SourceRepositoryLink';

describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: true,
    });
    mockUseTenant.mockReturnValue({
      tenantPath: (path: string) => path,
      branding: { logoShape: 'wide' },
      hasFeature: () => false,
    });
  });

  it('renders children via Outlet', () => {
    render(<Layout />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.getByText('Page Content')).toBeInTheDocument();
  });

  it('renders the Navbar by default', () => {
    render(<Layout />);
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });

  it('renders the Footer by default', () => {
    render(<Layout />);
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });

  it('renders MobileTabBar by default', () => {
    render(<Layout />);
    expect(screen.getByTestId('mobile-tab-bar')).toBeInTheDocument();
  });

  it('renders a floating report problem action on normal app pages', () => {
    render(<Layout />);
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument();
  });

  it('renders BackToTop', () => {
    render(<Layout />);
    expect(screen.getByTestId('back-to-top')).toBeInTheDocument();
  });

  it('renders OfflineIndicator', () => {
    render(<Layout />);
    expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
  });

  it('renders SessionExpiredModal', () => {
    render(<Layout />);
    expect(screen.getByTestId('session-modal')).toBeInTheDocument();
  });

  it('hides Navbar when showNavbar is false', () => {
    render(<Layout showNavbar={false} />);
    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
  });

  it('hides Footer when showFooter is false', () => {
    render(<Layout showFooter={false} />);
    expect(screen.queryByTestId('footer')).not.toBeInTheDocument();
  });

  it('hides MobileTabBar when showNavbar is false', () => {
    render(<Layout showNavbar={false} />);
    expect(screen.queryByTestId('mobile-tab-bar')).not.toBeInTheDocument();
  });

  it('hides floating report problem action when navigation is hidden', () => {
    render(<Layout showNavbar={false} />);
    expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument();
  });

  it('adds padding class when showNavbar and withNavbarPadding are true', () => {
    const { container } = render(<Layout showNavbar={true} withNavbarPadding={true} />);
    const main = container.querySelector('main');
    expect(main?.className).toContain('pt-[calc(var(--safe-area-top)+3.5rem)]');
  });

  it('does not add padding class when withNavbarPadding is false', () => {
    const { container } = render(<Layout showNavbar={true} withNavbarPadding={false} />);
    const main = container.querySelector('main');
    expect(main?.className).not.toContain('pt-20');
  });

  it('exposes the main landmark as a programmatic route-focus target', () => {
    const { container } = render(<Layout />);
    const main = container.querySelector('#main-content');

    expect(main).toBeInstanceOf(HTMLElement);
    expect(main).toHaveAttribute('tabindex', '-1');
  });
});

describe('AuthLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children via Outlet', () => {
    render(<AuthLayout />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.getByText('Page Content')).toBeInTheDocument();
  });

  it('does NOT render Navbar', () => {
    render(<AuthLayout />);
    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
  });

  it('does NOT render Footer component', () => {
    render(<AuthLayout />);
    expect(screen.queryByTestId('footer')).not.toBeInTheDocument();
  });

  it('does NOT render MobileTabBar', () => {
    render(<AuthLayout />);
    expect(screen.queryByTestId('mobile-tab-bar')).not.toBeInTheDocument();
  });

  it('renders AGPL attribution link', () => {
    render(<AuthLayout />);
    const link = screen.getByRole('link', { name: 'Open the Project NEXUS GitHub repository' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      'href',
      PROJECT_NEXUS_REPO_URL,
    );
    const year = new Date().getFullYear();
    expect(screen.getByText(`AGPL-3.0 \u2014 Copyright \u00A9 2024\u2013${year} Jasper Ford`)).toBeInTheDocument();
  });

  it('attribution link opens in new tab', () => {
    render(<AuthLayout />);
    const link = screen.getByRole('link', { name: 'Open the Project NEXUS GitHub repository' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
