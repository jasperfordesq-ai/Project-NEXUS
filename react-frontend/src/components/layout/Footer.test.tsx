// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for Footer component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

// --- Mocks ---

const mockUseTenant = vi.fn();
const mockUseFeature = vi.fn();

vi.mock('@/contexts', () => ({
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
  useFeature: (...args: unknown[]) => mockUseFeature(...args),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
  useFeature: (...args: unknown[]) => mockUseFeature(...args),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/contexts/CookieConsentContext', () => ({
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
}));

import { Footer, FooterLink } from './Footer';
import { PROJECT_NEXUS_REPO_URL } from './SourceRepositoryLink';
import { PROJECT_NEXUS_DOCS_URL } from '@/config/externalLinks';

const getSourceRepoLinks = () => screen.getAllByRole('link', {
  name: 'Open the Project NEXUS GitHub repository',
});

function setupDefaultMocks(overrides: {
  tenant?: Record<string, unknown>;
  connectionsEnabled?: boolean;
  eventsEnabled?: boolean;
  blogEnabled?: boolean;
} = {}) {
  mockUseTenant.mockReturnValue({
    tenant: {
      id: 2,
      name: 'Test Tenant',
      slug: 'test-tenant',
      config: {},
      contact: null,
      ...overrides.tenant,
    },
    branding: {
      name: 'Test Community',
      logo: null,
      tagline: 'Building stronger communities',
    },
    tenantPath: (p: string) => p,
    ...overrides.tenant,
  });
  // useFeature is called twice: once for 'events', once for 'blog'
  mockUseFeature.mockImplementation((feature: string) => {
    if (feature === 'connections') return overrides.connectionsEnabled ?? false;
    if (feature === 'events') return overrides.eventsEnabled ?? false;
    if (feature === 'blog') return overrides.blogEnabled ?? false;
    return false;
  });
}

describe('Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('is a desktop-only surface so mobile uses the app navigation instead', () => {
    const { container } = render(<Footer />);
    expect(container.querySelector('footer')).toHaveClass('hidden', 'md:block');
  });

  describe('Copyright / Footer text', () => {
    it('renders default copyright text with tenant branding name', () => {
      render(<Footer />);
      const year = new Date().getFullYear();
      expect(screen.getByText(`Test Community \u2014 AGPL-3.0 \u2014 Copyright \u00A9 2024\u2013${year} Jasper Ford`)).toBeInTheDocument();
    });

    it('renders custom footer_text when set in tenant config', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'Test', slug: 'test', config: { footer_text: 'Custom Footer Text' }, contact: null },
        },
      });
      render(<Footer />);
      expect(screen.getByText('Custom Footer Text')).toBeInTheDocument();
    });

    it('renders copyright prop when passed', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'Test', slug: 'test', config: {}, contact: null },
        },
      });
      render(<Footer copyright="My Custom Copyright" />);
      expect(screen.getByText('My Custom Copyright')).toBeInTheDocument();
    });
  });

  describe('AGPL attribution', () => {
    it('renders Project NEXUS attribution link', () => {
      render(<Footer />);
      expect(screen.getAllByText('Project NEXUS').length).toBeGreaterThan(0);
      expect(screen.getAllByText('GitHub repo').length).toBeGreaterThan(0);
    });

    it('attribution links to the GitHub repository', () => {
      render(<Footer />);
      const links = getSourceRepoLinks();
      expect(links.length).toBeGreaterThan(0);
      links.forEach((link) => {
        expect(link).toHaveAttribute('href', PROJECT_NEXUS_REPO_URL);
      });
    });

    it('attribution opens in new tab with security attributes', () => {
      render(<Footer />);
      getSourceRepoLinks().forEach((link) => {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      });
    });

    it('links to the documentation site, in a new tab, from the release strip', () => {
      render(<Footer />);
      const link = screen.getByRole('link', { name: 'Documentation (opens in a new tab)' });
      // The docs site is on its own domain on purpose — a URL derived from the
      // GitHub repository name broke with no redirect when the repo was renamed.
      expect(link).toHaveAttribute('href', PROJECT_NEXUS_DOCS_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders the full AGPL attribution notice', () => {
      render(<Footer />);
      const year = new Date().getFullYear();
      const notice = `AGPL-3.0 \u2014 Copyright \u00A9 2024\u2013${year} Jasper Ford`;
      expect(screen.getAllByText(notice).length).toBeGreaterThan(0);
    });
  });

  describe('Brand section', () => {
    it('renders the tenant brand name', () => {
      render(<Footer />);
      expect(screen.getByText('Test Community')).toBeInTheDocument();
    });

    it('renders brand logo when set', () => {
      setupDefaultMocks({
        tenant: {
          branding: { name: 'Logo Tenant', logo: '/logo.png', tagline: 'Test' },
          tenant: { id: 2, name: 'Test', slug: 'test', config: {}, contact: null },
        },
      });
      render(<Footer />);
      const images = screen.getAllByAltText('Logo Tenant');
      expect(images.length).toBeGreaterThan(0);
      images.forEach((img) => expect(img.getAttribute('src')).toMatch(/\/logo\.png$/));
    });

    it('renders tagline', () => {
      render(<Footer />);
      expect(screen.getByText('Building stronger communities')).toBeInTheDocument();
    });

    it('renders default tagline when branding tagline is empty', () => {
      setupDefaultMocks({
        tenant: {
          branding: { name: 'Test', logo: null, tagline: '' },
          tenant: { id: 2, name: 'Test', slug: 'test', config: {}, contact: null },
        },
      });
      render(<Footer />);
      expect(screen.getByText('Building stronger communities through the exchange of time.')).toBeInTheDocument();
    });
  });

  describe('Partner logo label', () => {
    it('uses the custom partner logo label in the footer and image alternative text', () => {
      setupDefaultMocks({
        tenant: {
          tenant: {
            id: 2,
            name: 'Test',
            slug: 'test',
            contact: null,
            config: {
              partner_logo_url: '/partner.png',
              partner_logo_label: 'Local partner',
            },
          },
        },
      });

      render(<Footer />);

      expect(screen.getByText('Local partner')).toBeInTheDocument();
      const images = screen.getAllByRole('img', { name: 'Local partner' });
      expect(images.length).toBeGreaterThan(0);
      images.forEach((img) => expect(img.getAttribute('src')).toMatch(/\/partner\.png$/));
    });

    it('uses direct PNG assets for the default powered-by image', () => {
      render(<Footer />);

      const images = screen.getAllByRole('img', { name: 'Powered by' });
      expect(images.length).toBeGreaterThan(0);
      images.forEach((img) => {
        expect(img.getAttribute('src')).toBe('/images/powered-by-nexus-light.png');
      });
    });
  });

  describe('Legal links', () => {
    it('renders Terms of Service link', () => {
      render(<Footer />);
      expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    });

    it('renders Privacy Policy link', () => {
      render(<Footer />);
      expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    });

    it('renders Accessibility link', () => {
      render(<Footer />);
      expect(screen.getByText('Accessibility')).toBeInTheDocument();
    });

    it('renders Legal Hub link', () => {
      render(<Footer />);
      expect(screen.getByText('Legal Hub')).toBeInTheDocument();
    });
  });

  describe('Platform links', () => {
    it('renders Listings link', () => {
      render(<Footer />);
      expect(screen.getByText('Listings')).toBeInTheDocument();
    });

    it('renders Members link', () => {
      setupDefaultMocks({ connectionsEnabled: true });
      render(<Footer />);
      expect(screen.getByText('Members')).toBeInTheDocument();
    });

    it('does NOT render Members link when connections feature is disabled', () => {
      setupDefaultMocks({ connectionsEnabled: false });
      render(<Footer />);
      expect(screen.queryByText('Members')).not.toBeInTheDocument();
    });

    it('renders Events link when events feature is enabled', () => {
      setupDefaultMocks({ eventsEnabled: true });
      render(<Footer />);
      expect(screen.getByText('Events')).toBeInTheDocument();
    });

    it('does NOT render Events link when events feature is disabled', () => {
      setupDefaultMocks({ eventsEnabled: false });
      render(<Footer />);
      // Only "Events" in Platform section — not present
      expect(screen.queryByText('Events')).not.toBeInTheDocument();
    });

    it('renders Blog link when blog feature is enabled', () => {
      setupDefaultMocks({ blogEnabled: true });
      render(<Footer />);
      expect(screen.getByText('Blog')).toBeInTheDocument();
    });

    it('does NOT render Blog link when blog feature is disabled', () => {
      setupDefaultMocks({ blogEnabled: false });
      render(<Footer />);
      expect(screen.queryByText('Blog')).not.toBeInTheDocument();
    });
  });

  describe('Support links', () => {
    it('renders Help Center link', () => {
      render(<Footer />);
      expect(screen.getByText('Help Center')).toBeInTheDocument();
    });

    it('renders Contact Us link', () => {
      render(<Footer />);
      expect(screen.getByText('Contact Us')).toBeInTheDocument();
    });

    it('renders About link', () => {
      render(<Footer />);
      expect(screen.getByText('About')).toBeInTheDocument();
    });
  });

  describe('Contact info', () => {
    it('renders email when tenant contact has email', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'Test', slug: 'test', config: {}, contact: { email: 'info@test.com' } },
        },
      });
      render(<Footer />);
      expect(screen.getByText('info@test.com')).toBeInTheDocument();
    });

    it('renders phone when tenant contact has phone', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'Test', slug: 'test', config: {}, contact: { phone: '+1234567890' } },
        },
      });
      render(<Footer />);
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });

    it('renders location when tenant contact has location', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'Test', slug: 'test', config: {}, contact: { location: 'Dublin, Ireland' } },
        },
      });
      render(<Footer />);
      expect(screen.getByText('Dublin, Ireland')).toBeInTheDocument();
    });
  });

  describe('Custom children', () => {
    it('renders custom children instead of default footer content', () => {
      render(<Footer><div>Custom Footer Content</div></Footer>);
      expect(screen.getByText('Custom Footer Content')).toBeInTheDocument();
      // Default Platform section heading should not appear
      expect(screen.queryByText('Platform')).not.toBeInTheDocument();
    });
  });
});

describe('FooterLink', () => {
  it('renders a link with correct href', () => {
    render(<FooterLink href="/test-link">Test Link</FooterLink>);
    const link = screen.getByText('Test Link');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/test-link');
  });
});
