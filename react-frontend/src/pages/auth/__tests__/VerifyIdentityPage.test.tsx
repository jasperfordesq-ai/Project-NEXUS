// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VerifyIdentityPage
 *
 * Tests:
 * - Renders loading state initially
 * - Shows verification start button when status is 'start'
 * - Shows "Passed" state when verification is complete
 * - Shows "Failed" state with retry button
 * - Handles API error gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Common mocks ────────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', last_name: 'User', name: 'Test User', role: 'member', tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() })),
  useNotifications: vi.fn(() => ({ counts: { messages: 0, notifications: 0 } })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', last_name: 'User', name: 'Test User', role: 'member', tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(["variants", "initial", "animate", "transition", "whileInView", "viewport", "layout", "exit", "whileHover", "whileTap"]);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children as React.ReactNode}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <>
      <MemoryRouter>{ui}</MemoryRouter>
    </>
  );
}

const mockStatusPendingVerification = {
  status: 'pending_verification',
  email_verified: true,
  is_approved: false,
  verification_status: 'none',
  verification_provider: 'mock',
  registration_mode: 'verified_identity',
  latest_session: null,
};

const mockStatusPassed = {
  status: 'pending_admin_review',
  email_verified: true,
  is_approved: false,
  verification_status: 'passed',
  verification_provider: 'mock',
  registration_mode: 'verified_identity',
  latest_session: {
    id: 1,
    status: 'completed',
    provider: 'mock',
    created_at: '2026-03-07T10:00:00Z',
    completed_at: '2026-03-07T10:05:00Z',
    failure_reason: null,
  },
};

const mockStatusFailed = {
  status: 'verification_failed',
  email_verified: true,
  is_approved: false,
  verification_status: 'failed',
  verification_provider: 'mock',
  registration_mode: 'verified_identity',
  latest_session: {
    id: 2,
    status: 'failed',
    provider: 'mock',
    created_at: '2026-03-07T10:00:00Z',
    completed_at: '2026-03-07T10:05:00Z',
    failure_reason: 'Document could not be verified',
  },
};

const mockStatusActive = {
  status: 'active',
  email_verified: true,
  is_approved: true,
  verification_status: 'passed',
  verification_provider: 'mock',
  registration_mode: 'verified_identity',
  latest_session: null,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VerifyIdentityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders loading state initially', async () => {
    // Never resolve so it stays in loading
    mockGet.mockReturnValue(new Promise(() => {}));

    const { default: VerifyIdentityPage } = await import('../VerifyIdentityPage');
    renderWithProviders(<VerifyIdentityPage />);

    expect(screen.getByText('Checking verification status...')).toBeTruthy();
  });

  it('shows start verification button when status is pending_verification', async () => {
    mockGet.mockResolvedValue({ success: true, data: mockStatusPendingVerification });

    const { default: VerifyIdentityPage } = await import('../VerifyIdentityPage');
    renderWithProviders(<VerifyIdentityPage />);

    await waitFor(() => {
      expect(screen.getByText('Verify your identity')).toBeTruthy();
    });

    expect(screen.getByText('Start verification')).toBeTruthy();
    expect(screen.getByText(/valid government-issued photo ID/)).toBeTruthy();
  });

  it('shows passed state when verification is complete', async () => {
    mockGet.mockResolvedValue({ success: true, data: mockStatusPassed });

    const { default: VerifyIdentityPage } = await import('../VerifyIdentityPage');
    renderWithProviders(<VerifyIdentityPage />);

    await waitFor(() => {
      expect(screen.getByText('Identity verified')).toBeTruthy();
    });

    expect(screen.getByText(/identity has been successfully verified/)).toBeTruthy();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText(/A coordinator for this community still needs to approve your account/)).toBeTruthy();
  });

  it('shows failed state with retry button', async () => {
    mockGet.mockResolvedValue({ success: true, data: mockStatusFailed });

    const { default: VerifyIdentityPage } = await import('../VerifyIdentityPage');
    renderWithProviders(<VerifyIdentityPage />);

    await waitFor(() => {
      expect(screen.getByText("We couldn't verify your identity")).toBeTruthy();
    });

    expect(screen.getByText(/That check didn't go through/)).toBeTruthy();
    expect(screen.getByText('Document could not be verified')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('shows active state when account is already verified', async () => {
    mockGet.mockResolvedValue({ success: true, data: mockStatusActive });

    const { default: VerifyIdentityPage } = await import('../VerifyIdentityPage');
    renderWithProviders(<VerifyIdentityPage />);

    await waitFor(() => {
      expect(screen.getByText('Account verified')).toBeTruthy();
    });

    expect(screen.getByText(/fully verified and active/)).toBeTruthy();
    expect(screen.getByText('Go to Dashboard')).toBeTruthy();
  });

  it('handles API error gracefully', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));

    const { default: VerifyIdentityPage } = await import('../VerifyIdentityPage');
    renderWithProviders(<VerifyIdentityPage />);

    await waitFor(() => {
      expect(screen.getByText(/That didn't work/)).toBeTruthy();
    });

    expect(screen.getByText(/We couldn't see how your verification is going/)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('displays community branding name', async () => {
    mockGet.mockResolvedValue({ success: true, data: mockStatusPassed });

    const { default: VerifyIdentityPage } = await import('../VerifyIdentityPage');
    renderWithProviders(<VerifyIdentityPage />);

    await waitFor(() => {
      expect(screen.getByText('Test Community')).toBeTruthy();
    });
  });

  it('shows login prompt when not authenticated', async () => {
    // Override useAuth to return unauthenticated
    const { useAuth } = await import('@/contexts/AuthContext');
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      logout: vi.fn(),
    } as ReturnType<typeof useAuth>);

    const { default: VerifyIdentityPage } = await import('../VerifyIdentityPage');
    renderWithProviders(<VerifyIdentityPage />);

    expect(screen.getByText('Sign in to verify your identity.')).toBeTruthy();
    expect(screen.getByText('Go to sign in')).toBeTruthy();
  });
});
