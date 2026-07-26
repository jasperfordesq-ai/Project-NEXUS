// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AuthContext
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import { tokenManager, SESSION_EXPIRED_EVENT } from '@/lib/api';
// The i18next singleton src/test/setup.ts initialises from public/locales/en. AuthContext replaces
// raw API error strings with localized ones, so the assertions below resolve their expected text
// through the same keys the provider uses rather than hard-coding English. Four tests here pinned
// the old raw-API wording and broke when the provider started localizing.
import i18next from 'i18next';

// Mock the api module
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      logoutSession: vi.fn(),
    },
    tokenManager: {
      getAccessToken: vi.fn(),
      setAccessToken: vi.fn(),
      getRefreshToken: vi.fn(),
      setRefreshToken: vi.fn(),
      getTenantId: vi.fn(),
      setTenantId: vi.fn(),
      hasAccessToken: vi.fn(),
      hasRefreshToken: vi.fn(),
      clearTokens: vi.fn(),
      clearAll: vi.fn(),
    },
  };
});

// Import api after mocking
import { api } from '@/lib/api';

// Test component that displays auth state
function TestAuthDisplay() {
  const {
    user,
    status,
    error,
    isAuthenticated,
    isLoading,
  } = useAuth();

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="is-authenticated">{isAuthenticated ? 'yes' : 'no'}</div>
      <div data-testid="is-loading">{isLoading ? 'yes' : 'no'}</div>
      <div data-testid="user">{user ? user.first_name : 'none'}</div>
      <div data-testid="error">{error || 'none'}</div>
    </div>
  );
}

// Test component for auth actions
function TestAuthActions() {
  const { login, logout, verify2FA, register, cancel2FA, clearError, status, error } = useAuth();

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="error">{error || 'none'}</div>
      <button
        onClick={() => login({ email: 'test@example.com', password: 'password' })}
      >
        Login
      </button>
      <button onClick={logout}>Logout</button>
      <button onClick={() => verify2FA({ code: '123456' })}>Verify 2FA</button>
      <button
        onClick={() =>
          register({
            email: 'new@example.com',
            password: 'password',
            password_confirmation: 'password',
            first_name: 'Test',
            last_name: 'User',
            tenant_id: 1,
            phone: '+15551234567',
            terms_accepted: true,
          })
        }
      >
        Register
      </button>
      <button onClick={cancel2FA}>Cancel 2FA</button>
      <button onClick={clearError}>Clear Error</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default mock implementations
    vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
    vi.mocked(tokenManager.getTenantId).mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Provider initialization', () => {
    it('starts in loading state and checks for existing token', async () => {
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);

      render(
        <AuthProvider>
          <TestAuthDisplay />
        </AuthProvider>
      );

      // Should quickly transition to idle when no token exists
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });
    });

    it('fetches user when access token exists', async () => {
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(true);
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: { id: 1, first_name: 'John', last_name: 'Doe', tenant_id: 1 },
      });

      render(
        <AuthProvider>
          <TestAuthDisplay />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('user')).toHaveTextContent('John');
      });

      expect(api.get).toHaveBeenCalledWith('/v2/users/me');
    });

    it('clears tokens and goes to idle when user fetch proves the session invalid', async () => {
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(true);
      vi.mocked(api.get).mockResolvedValueOnce({
        success: false,
        error: 'Token expired',
        code: 'AUTH_TOKEN_EXPIRED',
      });

      render(
        <AuthProvider>
          <TestAuthDisplay />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
        expect(screen.getByTestId('user')).toHaveTextContent('none');
      });

      expect(tokenManager.clearTokens).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('handles successful login without 2FA', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
      vi.mocked(api.post).mockResolvedValueOnce({
        success: true,
        data: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          user: { id: 1, first_name: 'John', last_name: 'Doe', tenant_id: 1 },
        },
      });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      await user.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      expect(tokenManager.setAccessToken).toHaveBeenCalledWith('access-token');
      expect(tokenManager.setRefreshToken).toHaveBeenCalledWith('refresh-token');
    });

    it('handles login requiring 2FA', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
      vi.mocked(api.post).mockResolvedValueOnce({
        success: true,
        data: {
          requires_2fa: true,
          two_factor_token: '2fa-token',
          methods: ['totp'],
        },
      });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      await user.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('requires_2fa');
      });

      // Tokens should NOT be set yet
      expect(tokenManager.setAccessToken).not.toHaveBeenCalled();
    });

    it('handles login failure', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
      vi.mocked(api.post).mockResolvedValueOnce({
        success: false,
        error: 'Invalid credentials',
      });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      await user.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('error');
        // Not the API's raw "Invalid credentials" — the provider substitutes a generic localized
        // message so a failed sign-in cannot be used to probe which accounts exist.
        expect(screen.getByTestId('error')).toHaveTextContent(i18next.t('auth:login.failed'));
      });
    });
  });

  describe('2FA verification', () => {
    it('completes authentication after successful 2FA', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);

      // First, login to get to 2FA state
      vi.mocked(api.post)
        .mockResolvedValueOnce({
          success: true,
          data: {
            requires_2fa: true,
            two_factor_token: '2fa-token',
            methods: ['totp'],
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            user: { id: 1, first_name: 'John', last_name: 'Doe', tenant_id: 1 },
          },
        });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      // Login
      await user.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('requires_2fa');
      });

      // Verify 2FA
      await user.click(screen.getByRole('button', { name: 'Verify 2FA' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      expect(api.post).toHaveBeenLastCalledWith(
        '/totp/verify',
        expect.objectContaining({
          two_factor_token: '2fa-token',
          code: '123456',
        }),
        { skipAuth: true }
      );
    });

    it('handles 2FA verification failure', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);

      // Login then fail 2FA
      vi.mocked(api.post)
        .mockResolvedValueOnce({
          success: true,
          data: {
            requires_2fa: true,
            two_factor_token: '2fa-token',
            methods: ['totp'],
          },
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'Invalid code',
        });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      await user.click(screen.getByRole('button', { name: 'Login' }));
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('requires_2fa');
      });

      await user.click(screen.getByRole('button', { name: 'Verify 2FA' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('requires_2fa');
        expect(screen.getByTestId('error')).toHaveTextContent(i18next.t('auth:login.twofa_invalid_code'));
      });
    });

    it('allows canceling 2FA', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
      vi.mocked(api.post).mockResolvedValueOnce({
        success: true,
        data: {
          requires_2fa: true,
          two_factor_token: '2fa-token',
          methods: ['totp'],
        },
      });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      await user.click(screen.getByRole('button', { name: 'Login' }));
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('requires_2fa');
      });

      await user.click(screen.getByRole('button', { name: 'Cancel 2FA' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });
    });
  });

  describe('logout', () => {
    it('clears all tokens and resets state', async () => {
      const user = userEvent.setup();

      // Start authenticated
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(true);
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: { id: 1, first_name: 'John', last_name: 'Doe', tenant_id: 1 },
      });
      vi.mocked(api.logoutSession).mockResolvedValueOnce({ success: true });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      await user.click(screen.getByRole('button', { name: 'Logout' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      // clearTokens (not clearAll) — tenant slug/ID are preserved on logout
      // so the user stays on the same community's login page. Stale slugs are
      // harmless because TenantShell and TenantProvider only use them when
      // auth tokens exist.
      expect(tokenManager.clearTokens).toHaveBeenCalled();
      expect(api.logoutSession).toHaveBeenCalledTimes(1);
    });

    it('proceeds with local logout even if server logout fails', async () => {
      const user = userEvent.setup();

      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(true);
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: { id: 1, first_name: 'John', last_name: 'Doe', tenant_id: 1 },
      });
      vi.mocked(api.logoutSession).mockRejectedValueOnce(new Error('Network error'));

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      await user.click(screen.getByRole('button', { name: 'Logout' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      // Should still clear tokens even on network error
      expect(tokenManager.clearTokens).toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('handles successful registration', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
      vi.mocked(api.post).mockResolvedValueOnce({
        success: true,
        data: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          user: { id: 1, first_name: 'Test', last_name: 'User', tenant_id: 1 },
        },
      });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      await user.click(screen.getByRole('button', { name: 'Register' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      expect(api.post).toHaveBeenCalledWith(
        '/v2/auth/register',
        expect.objectContaining({
          email: 'new@example.com',
          first_name: 'Test',
          last_name: 'User',
        }),
        { skipAuth: true }
      );
    });

    it('handles registration failure', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
      vi.mocked(api.post).mockResolvedValueOnce({
        success: false,
        error: 'Email already registered',
      });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      await user.click(screen.getByRole('button', { name: 'Register' }));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('error');
        expect(screen.getByTestId('error')).toHaveTextContent(i18next.t('auth:register.failed'));
      });
    });
  });

  describe('session expiration', () => {
    it('handles session expired event', async () => {
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(true);
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: { id: 1, first_name: 'John', last_name: 'Doe', tenant_id: 1 },
      });

      render(
        <AuthProvider>
          <TestAuthDisplay />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      // Dispatch session expired event
      act(() => {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      });

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
        expect(screen.getByTestId('error')).toHaveTextContent('session has expired');
      });
    });
  });

  describe('clearError', () => {
    it('clears the error state', async () => {
      const user = userEvent.setup();
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
      vi.mocked(api.post).mockResolvedValueOnce({
        success: false,
        error: 'Some error',
      });

      render(
        <AuthProvider>
          <TestAuthActions />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('idle');
      });

      // Cause an error
      await user.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent(i18next.t('auth:login.failed'));
      });

      // Clear the error
      await user.click(screen.getByRole('button', { name: 'Clear Error' }));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('none');
      });
    });
  });

  describe('useAuth hook', () => {
    it('throws error when used outside provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestAuthDisplay />);
      }).toThrow('useAuth must be used within an AuthProvider');

      spy.mockRestore();
    });
  });
});
