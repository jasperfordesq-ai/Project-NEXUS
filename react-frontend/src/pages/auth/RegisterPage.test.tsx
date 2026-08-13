// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for RegisterPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import i18n from 'i18next';
import { render, screen, waitFor } from '@/test/test-utils';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: apiMocks.get,
    post: apiMocks.post,
  },
  // 🔴 API_BASE is required even though this file never uses it.
  //
  // The sign-up page renders OAuthButtons and SsoButtons, which import API_BASE
  // from '@/lib/api'. Vitest throws when a mocked module omits an export that
  // something in the tree imports, and that throw took down the WHOLE render — the
  // container came back empty, so any assertion needing the full form failed while
  // step-1-only assertions passed. That is why this suite sat in
  // src/test/failing-suites.baseline.json rather than for any product reason.
  API_BASE: '/api',
  tokenManager: {
    getTenantId: vi.fn(),
    clearTokens: vi.fn(),
    setTenantId: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: null,
    status: 'idle',
    error: null,
    isAuthenticated: false,
    isLoading: false,
    register: vi.fn(),
    clearError: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community', logo_url: null },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    isLoading: false,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: null,
    status: 'idle',
    error: null,
    isAuthenticated: false,
    isLoading: false,
    register: vi.fn(),
    clearError: vi.fn(),
  })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community', logo_url: null },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    isLoading: false,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,      form: ({ children, ...props }: Record<string, unknown>) => <form {...filterMotion(props)}>{children}</form>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { RegisterPage } from './RegisterPage';

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/v2/auth/registration-info') {
        return Promise.resolve({
          success: true,
          data: {
            registration_mode: 'open',
            requires_invite_code: false,
            is_closed: false,
            can_register: true,
          },
        });
      }

      return Promise.resolve({
        success: true,
        data: [{ id: 2, name: 'Test Tenant', slug: 'test' }],
      });
    });
    apiMocks.post.mockResolvedValue({ success: true });
  });

  it('renders without crashing', async () => {
    render(<RegisterPage />);
    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('shows link to login page', () => {
    render(<RegisterPage />);
    expect(screen.getByText(/already have an account/i)).toBeInTheDocument();
  });

  it('marks phone and location as required without initial phone error styling', async () => {
    render(<RegisterPage />);

    const locationInput = await screen.findByLabelText(/location/i);
    const phoneInput = await screen.findByLabelText(/phone number/i);

    expect(locationInput).toBeRequired();
    expect(phoneInput).toBeRequired();
    expect(phoneInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('shows closed registration instructions and hides the registration submit button', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/v2/auth/registration-info') {
        return Promise.resolve({
          success: true,
          data: {
            registration_mode: 'closed',
            requires_invite_code: false,
            is_closed: true,
            can_register: false,
          },
        });
      }

      return Promise.resolve({
        success: true,
        data: [{ id: 2, name: 'Test Tenant', slug: 'test' }],
      });
    });

    render(<RegisterPage />);

    expect(await screen.findByText(/registration is closed/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /registration is closed/i })).toBeInTheDocument();
    expect(screen.getByText(/not accepting new registrations/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });

  it('withholds the registration form when registration status cannot be checked', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/v2/auth/registration-info') {
        return Promise.reject(new Error('registration policy unavailable'));
      }

      return Promise.resolve({
        success: true,
        data: [{ id: 2, name: 'Test Tenant', slug: 'test' }],
      });
    });

    render(<RegisterPage />);

    expect(await screen.findByText(/registration status unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });

  it('prominently reminds new registrants to check junk or spam for the verification email', () => {
    const message = i18n.t('register.verify_email_body', {
      ns: 'auth',
      email: 'sam@example.org',
    });

    expect(message).toContain('<strong>Please check your Junk or spam folder');
    expect(message).toContain('Please check your Junk or spam folder');
    expect(message).toContain("if you can't see this email in your inbox");
  });

  /**
   * 🔴 Regression guard for the two faults a coordinator reported doing a real
   * sign-up (Minehead & Coast, 2026-08-12), fixed in 0e01d325f. Until this suite was
   * un-quarantined on 2026-08-13 the fix had NO coverage at all.
   *
   * 1. The consent tickbox rendered at 12px (`size="sm"` -> `size-3` in our wrapper)
   *    and was reported as "almost invisible" on desktop and iOS. A control carrying
   *    legal weight must not be the smallest thing on the page.
   * 2. Opening Terms or Privacy in the same tab wiped the whole four-step form,
   *    because every answer lives in component state. They must open in a new tab.
   *    Deliberately NOT solved by persisting the form: this step holds the password.
   */
  it('keeps the consent tickbox legible and opens the policy links in a new tab', async () => {
    const { container } = render(<RegisterPage />);

    // Our Checkbox wrapper maps size -> a Tailwind class on the control element:
    // sm => size-3 (12px), lg => size-5 (20px). Assert on the rendered markup,
    // because that is the only thing that proves what a member actually sees.
    await waitFor(() => {
      expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    });
    expect(container.innerHTML).toContain('size-5');
    expect(container.innerHTML).not.toContain('size-3');

    // Every policy link on this page opens in a new tab, with the safe rel.
    const policyLinks = Array.from(container.querySelectorAll('a'))
      .filter((a) => /\/(terms|privacy)$/.test(a.getAttribute('href') ?? ''));
    expect(policyLinks.length).toBeGreaterThan(0);
    for (const link of policyLinks) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel') ?? '').toContain('noopener');
    }
  });
});
