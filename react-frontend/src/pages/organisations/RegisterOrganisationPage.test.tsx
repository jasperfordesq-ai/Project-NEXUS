// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  const React = await import('react');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: String(to), ...rest }, children),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// 🔴 The barrel mock below is not enough on its own. Breadcrumbs — rendered by
// this page — imports useTenant from '@/contexts/TenantContext', the context's
// OWN path, and Vitest keys its mock registry per specifier. So the real hook
// loaded, threw "useTenant must be used within a TenantProvider", and took down
// all eight tests before any assertion ran. A total factory (rather than
// spreading importOriginal) on purpose: the real module imports '@/i18n', which
// re-inits i18next with an HTTP backend at module scope and would clobber the
// English resources src/test/setup.ts loads synchronously.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: () => true,
    hasModule: () => true,
  }),
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
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
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import RegisterOrganisationPage from './RegisterOrganisationPage';

describe('RegisterOrganisationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the registration form with all required fields', () => {
    render(<RegisterOrganisationPage />);
    expect(screen.getByText('organisations.register_heading')).toBeInTheDocument();
    expect(screen.getByText('organisations.form_name_label')).toBeInTheDocument();
    expect(screen.getByText('organisations.form_description_label')).toBeInTheDocument();
    expect(screen.getByText('organisations.form_email_label')).toBeInTheDocument();
    expect(screen.getByText('organisations.form_website_label')).toBeInTheDocument();
  });

  it('shows terms section and pending approval notice', () => {
    render(<RegisterOrganisationPage />);
    expect(screen.getByText('organisations.terms_heading')).toBeInTheDocument();
    expect(screen.getByText('organisations.pending_approval_notice')).toBeInTheDocument();
    expect(screen.getByText('organisations.terms_agreement')).toBeInTheDocument();
  });

  it('shows submit and cancel buttons', () => {
    render(<RegisterOrganisationPage />);
    expect(screen.getByText('organisations.form_submit')).toBeInTheDocument();
    expect(screen.getByText('organisations.form_cancel')).toBeInTheDocument();
  });

  it('shows validation errors when submitting empty form', async () => {
    render(<RegisterOrganisationPage />);
    fireEvent.click(screen.getByText('organisations.form_submit'));
    await waitFor(() => {
      expect(screen.getByText('organisations.form_name_required')).toBeInTheDocument();
    });
    expect(screen.getByText('organisations.form_description_required')).toBeInTheDocument();
    expect(screen.getByText('organisations.form_email_required')).toBeInTheDocument();
    expect(screen.getByText('organisations.terms_required')).toBeInTheDocument();
  });

  it('submits form and navigates on success', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 55 } });
    render(<RegisterOrganisationPage />);

    // Fill in name
    const nameInput = document.querySelector('input[aria-label], input') as HTMLInputElement;
    // Use label-based queries instead
    const inputs = document.querySelectorAll('input');
    // Fill name (first text input)
    fireEvent.change(inputs[0], { target: { value: 'My Green Organisation' } });
    // Fill email
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'org@example.com' } });

    // Fill description via textarea
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'We are a community organisation focused on sustainability and local action.' } });

    // Check terms agreement checkbox
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByText('organisations.form_submit'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/volunteering/organisations',
        expect.objectContaining({ name: 'My Green Organisation' }),
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/test/volunteering/my-organisations');
  });

  it('does not register twice on a rapid double-submit', async () => {
    // Regression: the form submits on Enter (bypassing the disabled button) and had
    // no synchronous re-entry guard, so a double-Enter / fast double-click fired
    // api.post twice and registered two organisations. A submittingRef now blocks the
    // second in-flight submit. Verified live (double requestSubmit -> 1 POST).
    let pendingResolved = false;
    vi.mocked(api.post).mockImplementation(
      () => new Promise(() => { pendingResolved = true; }), // stays in-flight
    );
    render(<RegisterOrganisationPage />);

    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'My Green Organisation' } });
    fireEvent.change(document.querySelector('input[type="email"]') as HTMLInputElement, { target: { value: 'org@example.com' } });
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'We are a community organisation focused on sustainability and local action.' } });
    fireEvent.click(document.querySelector('input[type="checkbox"]') as HTMLInputElement);

    const form = document.querySelector('form') as HTMLFormElement;
    // Two rapid submits straight at the form (as Enter would), bypassing the button.
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(pendingResolved).toBe(true); // sanity: the first submit actually fired
  });

  it('shows error toast when API call fails', async () => {
    const mockToastError = vi.fn();
    const { useToast } = await import('@/contexts');
    vi.mocked(useToast).mockReturnValue({
      success: vi.fn(),
      error: mockToastError,
      info: vi.fn(),
      warning: vi.fn(),
    });

    vi.mocked(api.post).mockRejectedValue(new Error('Server error'));
    render(<RegisterOrganisationPage />);

    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'My Green Organisation' } });
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'org@example.com' } });
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'We are a community organisation focused on sustainability and local action.' } });
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByText('organisations.form_submit'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it('renders breadcrumbs linking back to organisations list', () => {
    render(<RegisterOrganisationPage />);
    const orgLink = screen.getByRole('link', { name: 'organisations.heading' });
    expect(orgLink).toBeInTheDocument();
  });
});
