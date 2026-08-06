// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NEXUS Authentication Context
 *
 * Provides:
 * - Login with email/password
 * - 2FA verification flow
 * - Token refresh
 * - Session management
 * - Logout
 */

import {
  createContext,
  use,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { api, tokenManager, isImpersonatedTab, SESSION_EXPIRED_EVENT, SESSION_EXPIRING_EVENT } from '@/lib/api';
import { logError, logWarn } from '@/lib/logger';
import i18n from '@/i18n';
import { validateResponseIfPresent } from '@/lib/api-validation';
import { loginResponseSchema, userSchema } from '@/lib/api-schemas';
import { queueSentryAuthEvent, queueSentryUser } from '@/lib/telemetryQueue';
import { purgeAllOfflineCheckinData } from '@/lib/event-offline-checkin-store';
import type {
  User,
  LoginRequest,
  LoginSuccessResponse,
  TwoFactorRequiredResponse,
  TwoFactorVerifyRequest,
  RegisterRequest,
} from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AuthStatus =
  | 'idle'           // Not logged in, no action
  | 'loading'        // Auth operation in progress
  | 'requires_2fa'   // Login succeeded, awaiting 2FA
  | 'authenticated'  // Fully authenticated
  | 'error';         // Auth error occurred

interface AuthState {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  twoFactorToken: string | null;  // Store in memory only!
  twoFactorMethods: string[];
  twoFactorTrustDeviceAllowed?: boolean;
  twoFactorTrustedDeviceDays?: number;
}

export interface RegisterResult {
  success: boolean;
  requiresVerification?: boolean;
  requiresApproval?: boolean;
  requiresWaitlist?: boolean;
  waitlistPosition?: number;
  nextSteps?: string[];
  message?: string;
  error?: string;
  /** Backend error code (TURNSTILE_FAILED, VALIDATION_DUPLICATE, REGISTRATION_FAILED, etc.) */
  errorCode?: string;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<LoginResult>;
  loginWithBiometric: (email?: string, abortSignal?: AbortSignal) => Promise<LoginResult>;
  verify2FA: (request: TwoFactorVerifyRequest) => Promise<boolean>;
  register: (data: RegisterRequest) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
  cancel2FA: () => void;
  /** WCAG 2.2.1 — reschedule the session-expiry warning after a silent token refresh */
  scheduleSessionWarning: (expiresInSeconds: number) => void;
}

interface LoginResult {
  success: boolean;
  requires2FA: boolean;
  requires2FASetup?: boolean;
  error?: string;
  errorCode?: string;
  retryAfter?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

function setTelemetryUser(user: User | null): void {
  queueSentryUser(user);
}

function captureTelemetryAuthEvent(
  event: string,
  userId?: number,
  context?: Record<string, unknown>,
): void {
  queueSentryAuthEvent(event, userId, context);
}

const INVALID_SESSION_CODES = new Set([
  'SESSION_EXPIRED',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_MISSING',
  'AUTH_ACCOUNT_SUSPENDED',
  'INVALID_TOKEN',
  'UNAUTHENTICATED',
  'AUTH_UNAUTHENTICATED',
  'HTTP_401',
]);

function isInvalidSessionCode(code: string | undefined): boolean {
  return Boolean(code && INVALID_SESSION_CODES.has(code));
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    status: 'loading',  // Start loading to check existing token
    error: null,
    twoFactorToken: null,
    twoFactorMethods: [],
  });

  // Track whether user was ever authenticated (prevents false "session expired" on first visit)
  const wasAuthenticated = useRef(false);

  // Prevent concurrent logout calls (e.g., triggered by 401 loop while logout is in flight)
  const isLoggingOutRef = useRef(false);

  // WCAG 2.2.1 — session expiry warning timer.
  // Fires SESSION_EXPIRING_EVENT 30 seconds before the access token expires,
  // giving the user a chance to extend their session before being logged out.
  const sessionWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSessionWarningTimer = useCallback(() => {
    if (sessionWarningTimerRef.current !== null) {
      clearTimeout(sessionWarningTimerRef.current);
      sessionWarningTimerRef.current = null;
    }
  }, []);

  const scheduleSessionWarning = useCallback((expiresInSeconds: number) => {
    clearSessionWarningTimer();
    // Warn at 30 s before expiry; skip if the token has fewer than 35 s left
    // (the warning + 5 s buffer would overlap with actual expiry).
    const warnAfterMs = (expiresInSeconds - 30) * 1000;
    if (warnAfterMs < 5000) return;
    sessionWarningTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRING_EVENT));
    }, warnAfterMs);
  }, [clearSessionWarningTimer]);

  // ─────────────────────────────────────────────────────────────────────────
  // User Refresh
  // ─────────────────────────────────────────────────────────────────────────

  const refreshUser = useCallback(async () => {
    if (!tokenManager.hasAccessToken()) {
      setState((prev) => ({
        ...prev,
        status: 'idle',
        user: null,
      }));
      return;
    }

    try {
      const response = await api.get<User>('/v2/users/me');

      if (response.success && response.data) {
        // Dev-only: validate user profile shape
        validateResponseIfPresent(userSchema, response.data, 'GET /v2/users/me');

        // Only set tenant ID from user data if no tenant was pre-selected
        // This allows super admins to access any tenant they selected at login
        if (response.data.tenant_id && !tokenManager.getTenantId()) {
          tokenManager.setTenantId(response.data.tenant_id);
        }

        // Set Sentry user context
        setTelemetryUser(response.data);

        // Apply user's server-side language preference (overrides browser detection)
        if (response.data.preferred_language) {
          i18n.changeLanguage(response.data.preferred_language);
        }

        wasAuthenticated.current = true;
        setState({
          user: response.data,
          status: 'authenticated',
          error: null,
          twoFactorToken: null,
          twoFactorMethods: [],
        });
      } else if (isInvalidSessionCode(response.code)) {
        // Only an explicit authentication-invalid response may destroy a
        // persisted session. The API client resolves transport failures rather
        // than throwing, so generic success:false is not proof of invalidity.
        tokenManager.clearTokens();
        setTelemetryUser(null);
        setState({
          user: null,
          status: 'idle',
          error: null,
          twoFactorToken: null,
          twoFactorMethods: [],
        });
      } else if (tokenManager.hasAccessToken()) {
        // Preserve the authenticated shell when it already has user data. On a
        // cold start, remain in the recoverable auth-check state so protected
        // routes do not redirect merely because the network is unavailable.
        setState((prev) => ({
          ...prev,
          status: prev.user ? 'authenticated' : 'loading',
          error: null,
        }));
      } else {
        // The access token disappeared independently (for example, an explicit
        // logout in another tab). Reflect the local state without deleting a
        // refresh-only credential solely because this request was transient.
        setState({
          user: null,
          status: 'idle',
          error: null,
          twoFactorToken: null,
          twoFactorMethods: [],
        });
      }
    } catch (err) {
      // Defensive fallback for unexpected throws. Production transport errors
      // normally arrive as resolved failure envelopes.
      logError('refreshUser failed', err);
      setState((prev) => ({
        ...prev,
        status: prev.user
          ? 'authenticated'
          : tokenManager.hasAccessToken() ? 'loading' : 'idle',
        error: null,
      }));
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Login
  // ─────────────────────────────────────────────────────────────────────────

  /*
   * 🔴 The login and 2FA responses carry a MINIMAL user record. Fields the server
   * DERIVES rather than stores are computed only by GET /v2/users/me, so they are
   * absent from it.
   *
   * `super_panel_level` is the one that bit: `superPanelLevel()` treats an absent
   * field as a pre-field payload and falls back to the platform flags, which
   * resolves the super-admin of a branch community to 'none'. The super-panel
   * entry was therefore missing for the whole session and only appeared after a
   * full page load, because that re-runs checkAuth() against /me. Reported
   * 2026-08-05: "every time I log in fresh the link is not in the sidebar, only
   * after a page refresh it appears."
   *
   * So hydrate from /me here, exactly as the biometric path already does, and
   * fall back to the minimal record if the call fails — a working session with a
   * thinner user object beats no session. api.ts does not throw, so a failed
   * fetch surfaces as `success: false` rather than as an exception.
   */
  const hydrateUserProfile = useCallback(async (fallback: User): Promise<User> => {
    const profileRes = await api.get<User>('/v2/users/me');
    return profileRes?.success && profileRes.data ? profileRes.data : fallback;
  }, []);

  const login = useCallback(async (credentials: LoginRequest): Promise<LoginResult> => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    const response = await api.post<LoginSuccessResponse | TwoFactorRequiredResponse>(
      '/auth/login',
      credentials,
      { skipAuth: true }
    );

    if (!response.success) {
      const loginError = i18n.t('auth:login.failed');
      captureTelemetryAuthEvent('failed_login', undefined, {
        error: response.error,
        code: response.code,
      });
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: loginError,
      }));
      return { success: false, requires2FA: false, error: loginError, errorCode: response.code };
    }

    const data = response.data;

    // Dev-only: validate login response shape
    validateResponseIfPresent(loginResponseSchema, data, 'POST /auth/login');

    // Check if 2FA is required
    if (data && 'requires_2fa' in data && data.requires_2fa) {
      const twoFAData = data as TwoFactorRequiredResponse;
      setState((prev) => ({
        ...prev,
        status: 'requires_2fa',
        error: null,
        twoFactorToken: twoFAData.two_factor_token,
        twoFactorMethods: twoFAData.methods || ['totp'],
        twoFactorTrustDeviceAllowed: twoFAData.allow_trusted_device !== false,
        twoFactorTrustedDeviceDays: twoFAData.trusted_device_days ?? 30,
      }));
      return { success: true, requires2FA: true };
    }

    // Admin without 2FA — store the setup-scoped token as the active
    // access token so the existing /settings/security UI works for the
    // first-time setup flow.
    if (data && 'requires_2fa_setup' in data && (data as { requires_2fa_setup?: boolean }).requires_2fa_setup) {
      const setupResp = data as { setup_token?: string; two_factor_token?: string };
      const setupToken = setupResp.setup_token || setupResp.two_factor_token;
      if (setupToken) {
        tokenManager.setAccessToken(setupToken);
      }
      setState((prev) => ({ ...prev, status: 'idle', error: null }));
      return {
        success: false,
        requires2FA: false,
        requires2FASetup: true,
        error: i18n.t('auth:login.admin_twofa_required'),
      };
    }

    // Login successful without 2FA
    const loginData = data as LoginSuccessResponse;

    if (loginData.access_token || loginData.token) {
      tokenManager.setAccessToken(loginData.access_token || loginData.token);
    }
    if (loginData.refresh_token) {
      tokenManager.setRefreshToken(loginData.refresh_token);
    }
    // Only set tenant ID from user data if no tenant was pre-selected at login
    // This allows super admins to access any tenant they selected
    if (loginData.user?.tenant_id && !tokenManager.getTenantId()) {
      tokenManager.setTenantId(loginData.user.tenant_id);
    }

    // Set Sentry user context and capture login event
    setTelemetryUser(loginData.user);
    captureTelemetryAuthEvent('login', loginData.user.id);

    // Apply user's server-side language preference (overrides browser detection)
    if (loginData.user?.preferred_language) {
      i18n.changeLanguage(loginData.user.preferred_language);
    }

    // WCAG 2.2.1 — schedule a warning 30 s before the access token expires
    if (loginData.expires_in) {
      scheduleSessionWarning(loginData.expires_in);
    }

    wasAuthenticated.current = true;
    setState({
      user: await hydrateUserProfile(loginData.user),
      status: 'authenticated',
      error: null,
      twoFactorToken: null,
      twoFactorMethods: [],
    });

    return { success: true, requires2FA: false };
  }, [scheduleSessionWarning, hydrateUserProfile]);

  // ─────────────────────────────────────────────────────────────────────────
  // Biometric / WebAuthn Login
  // ─────────────────────────────────────────────────────────────────────────

  const loginWithBiometric = useCallback(async (_email?: string, abortSignal?: AbortSignal): Promise<LoginResult> => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    try {
      const { authenticateWithBiometric } = await import('@/lib/webauthn');
      // Signed-out WebAuthn is deliberately username-less/discoverable. Keep
      // the legacy positional parameter for caller compatibility, but never
      // forward account identity to the public challenge endpoint.
      const result = await authenticateWithBiometric(undefined, abortSignal);

      if (!result.success || !result.data) {
        // All ceremony failures return to idle; the login page maps stable error codes.
        setState((prev) => ({
          ...prev,
          status: 'idle',
          error: null,
        }));
        return {
          success: false,
          requires2FA: false,
          // admin-i18n-ignore: logging-only diagnostic; LoginPage localizes the stable errorCode
          error: result.errorCode === 'cancelled' ? undefined : result.error,
          errorCode: result.errorCode,
        };
      }

      if (abortSignal?.aborted) {
        setState((prev) => ({ ...prev, status: 'idle', error: null }));
        return { success: false, requires2FA: false, errorCode: 'cancelled' };
      }

      const { user, access_token, refresh_token, expires_in } = result.data;

      tokenManager.setAccessToken(access_token);
      tokenManager.setRefreshToken(refresh_token);

      if (abortSignal?.aborted) {
        tokenManager.clearTokens();
        setState((prev) => ({ ...prev, status: 'idle', error: null }));
        return { success: false, requires2FA: false, errorCode: 'cancelled' };
      }

      // Fetch full user profile (biometric auth response has minimal user data)
      try {
        const profileRes = await api.get<User>('/v2/users/me');
        if (abortSignal?.aborted) {
          tokenManager.clearTokens();
          setState((prev) => ({ ...prev, status: 'idle', error: null }));
          return { success: false, requires2FA: false, errorCode: 'cancelled' };
        }
        if (profileRes.success && profileRes.data) {
          if (profileRes.data.preferred_language) {
            i18n.changeLanguage(profileRes.data.preferred_language);
          }
          setState({
            user: profileRes.data,
            status: 'authenticated',
            error: null,
            twoFactorToken: null,
            twoFactorMethods: [],
          });
        } else {
          // Token works but profile fetch failed; use the minimal user data.
          setState({
            user: user satisfies User,
            status: 'authenticated',
            error: null,
            twoFactorToken: null,
            twoFactorMethods: [],
          });
        }
      } catch (err) {
        if (abortSignal?.aborted) {
          tokenManager.clearTokens();
          setState((prev) => ({ ...prev, status: 'idle', error: null }));
          return { success: false, requires2FA: false, errorCode: 'cancelled' };
        }
        logWarn('Passkey login profile fetch failed; using minimal profile', err);
        setState({
          user: user satisfies User,
          status: 'authenticated',
          error: null,
          twoFactorToken: null,
          twoFactorMethods: [],
        });
      }

      if (abortSignal?.aborted) {
        tokenManager.clearTokens();
        setState((prev) => ({ ...prev, status: 'idle', error: null }));
        return { success: false, requires2FA: false, errorCode: 'cancelled' };
      }

      if (Number.isFinite(expires_in) && expires_in > 0) {
        scheduleSessionWarning(expires_in);
      }
      setTelemetryUser(user satisfies User);
      captureTelemetryAuthEvent('biometric_login', user.id);
      wasAuthenticated.current = true;

      return { success: true, requires2FA: false };
    } catch (err) {
      const cancelled = abortSignal?.aborted === true;
      if (!cancelled) {
        logError('Passkey login failed before completion', err);
      }
      setState((prev) => ({ ...prev, status: 'idle', error: null }));
      return {
        success: false,
        requires2FA: false,
        errorCode: cancelled ? 'cancelled' : 'unknown',
      };
    }
  }, [scheduleSessionWarning]);

  // ─────────────────────────────────────────────────────────────────────────
  // 2FA Verification
  // ─────────────────────────────────────────────────────────────────────────

  const verify2FA = useCallback(async (request: TwoFactorVerifyRequest): Promise<boolean> => {
    if (!state.twoFactorToken) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: i18n.t('auth:login.twofa_no_session'),
      }));
      return false;
    }

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    const response = await api.post<LoginSuccessResponse>(
      '/totp/verify',
      {
        two_factor_token: state.twoFactorToken,
        code: request.code,
        use_backup_code: request.use_backup_code,
        trust_device: request.trust_device,
      },
      { skipAuth: true }
    );

    if (!response.success) {
      // Check if we need to restart login
      if (response.code === 'AUTH_2FA_TOKEN_EXPIRED' || response.code === 'AUTH_2FA_MAX_ATTEMPTS') {
        setState({
          user: null,
          status: 'idle',
          error: i18n.t('auth:login.twofa_session_expired'),
          twoFactorToken: null,
          twoFactorMethods: [],
        });
      } else {
        setState((prev) => ({
          ...prev,
          status: 'requires_2fa',
          error: i18n.t('auth:login.twofa_invalid_code'),
        }));
      }
      return false;
    }

    const data = response.data!;

    if (data.access_token || data.token) {
      tokenManager.setAccessToken(data.access_token || data.token);
    }
    if (data.refresh_token) {
      tokenManager.setRefreshToken(data.refresh_token);
    }
    // Only set tenant ID from user data if no tenant was pre-selected at login
    // This allows super admins to access any tenant they selected
    if (data.user?.tenant_id && !tokenManager.getTenantId()) {
      tokenManager.setTenantId(data.user.tenant_id);
    }

    // WCAG 2.2.1 — schedule warning 30 s before the new access token expires
    if (data.expires_in) {
      scheduleSessionWarning(data.expires_in);
    }

    wasAuthenticated.current = true;
    setState({
      user: await hydrateUserProfile(data.user),
      status: 'authenticated',
      error: null,
      twoFactorToken: null,
      twoFactorMethods: [],
    });

    return true;
  }, [state.twoFactorToken, scheduleSessionWarning, hydrateUserProfile]);

  // ─────────────────────────────────────────────────────────────────────────
  // Cancel 2FA (go back to login)
  // ─────────────────────────────────────────────────────────────────────────

  const cancel2FA = useCallback(() => {
    setState({
      user: null,
      status: 'idle',
      error: null,
      twoFactorToken: null,
      twoFactorMethods: [],
    });
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Register
  // ─────────────────────────────────────────────────────────────────────────

  const register = useCallback(async (data: RegisterRequest): Promise<RegisterResult> => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    // Use a generic type since the response shape varies based on whether tokens are issued
    const response = await api.post<Record<string, unknown>>(
      '/v2/auth/register',
      data,
      { skipAuth: true }
    );

    if (!response.success) {
      const registrationError = i18n.t('auth:register.failed');
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: registrationError,
      }));
      return {
        success: false,
        error: registrationError,
        errorCode: response.code,
      };
    }

    const responseData = response.data as Record<string, unknown>;

    // Check if verification, approval, or waitlist is required (no tokens issued)
    const requiresVerification = responseData.requires_verification === true;
    const requiresApproval = responseData.requires_approval === true;
    const requiresWaitlist = responseData.requires_waitlist === true;

    if (requiresVerification || requiresApproval || requiresWaitlist) {
      // Registration succeeded but user cannot log in yet.
      // Reset to idle state — do NOT store any tokens.
      setState((prev) => ({
        ...prev,
        status: 'idle',
        error: null,
      }));
      return {
        success: true,
        requiresVerification,
        requiresApproval,
        requiresWaitlist,
        waitlistPosition: typeof responseData.waitlist_position === 'number' ? responseData.waitlist_position : undefined,
        nextSteps: (responseData.next_steps as string[]) ?? [],
        message: (responseData.message as string) ?? 'Registration successful!',
      };
    }

    // No gates — tokens were issued, authenticate immediately
    const accessToken = (responseData.access_token || responseData.token) as string | undefined;
    const refreshToken = responseData.refresh_token as string | undefined;
    const user = responseData.user as User | undefined;

    if (accessToken) {
      tokenManager.setAccessToken(accessToken);
    }
    if (refreshToken) {
      tokenManager.setRefreshToken(refreshToken);
    }
    if (user?.tenant_id && !tokenManager.getTenantId()) {
      tokenManager.setTenantId(user.tenant_id);
    }

    wasAuthenticated.current = true;
    setState({
      user: user ?? null,
      status: 'authenticated',
      error: null,
      twoFactorToken: null,
      twoFactorMethods: [],
    });

    return { success: true };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Logout
  // ─────────────────────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    // Guard against re-entrant logout calls (e.g., a 401 firing while logout is in flight)
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;
    clearSessionWarningTimer();

    const userId = state.user?.id;
    const refreshToken = tokenManager.getRefreshToken();

    try {
      // Call logout endpoint to invalidate tokens server-side
      // We verify the response but still proceed with local logout regardless
      try {
        const response = await api.logoutSession(refreshToken);

        // Log if server-side logout failed (for audit purposes)
        if (!response.success) {
          logWarn('Server-side logout failed', {
            code: response.code,
            error: response.error
          });
        }
      } catch {
        // Log network errors but proceed with local logout
        logWarn('Logout request failed - proceeding with local logout');
      }

      // Clear auth tokens AND tenant identity. Tenant slug/id used to be
      // preserved across logout as a UX nicety, but that caused cross-tenant
      // login bugs: visiting app.project-nexus.ie/ after logout would still
      // boot into the previous tenant via the storedSlug fallback, hiding the
      // community chooser on the login page and letting users authenticate
      // against the wrong community. Clear everything; the next visit starts
      // from a clean platform state and the user explicitly picks a community.
      // Logout preserves trusted device token by design.
      // Call tokenManager.clearTrustedDeviceToken() for an explicit "forget this device" flow.
      await purgeAllOfflineCheckinData().catch(() => {
        logWarn('Offline event check-in data purge failed during logout');
      });
      tokenManager.clearTokens();
      localStorage.removeItem('nexus_tenant_id');
      localStorage.removeItem('nexus_tenant_slug');

      // Clear Sentry user context and capture logout event
      captureTelemetryAuthEvent('logout', userId);
      setTelemetryUser(null);

      setState({
        user: null,
        status: 'idle',
        error: null,
        twoFactorToken: null,
        twoFactorMethods: [],
      });
    } finally {
      isLoggingOutRef.current = false;
    }
  }, [state.user?.id, clearSessionWarningTimer]);

  // ─────────────────────────────────────────────────────────────────────────
  // Clear Error
  // ─────────────────────────────────────────────────────────────────────────

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Session Expiration Handler
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleSessionExpired = () => {
      void purgeAllOfflineCheckinData();
      // Cancel any pending warning timer — the session is already gone
      clearSessionWarningTimer();
      // Only set error message if user had an active session — stale tokens
      // on first visit should silently clear without showing "session expired"
      if (wasAuthenticated.current) {
        setState({
          user: null,
          status: 'idle',
          error: i18n.t('errors:session_expired_message'),
          twoFactorToken: null,
          twoFactorMethods: [],
        });
      } else {
        // Stale tokens from a previous session — just silently clear
        setState({
          user: null,
          status: 'idle',
          error: null,
          twoFactorToken: null,
          twoFactorMethods: [],
        });
      }
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [clearSessionWarningTimer]);

  // ─────────────────────────────────────────────────────────────────────────
  // Cross-Tab Logout — sync auth state when tokens are cleared in another tab
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      // An impersonated tab keeps its session in sessionStorage and must not
      // follow the admin tab's localStorage logout — otherwise the admin signing
      // out (or their token rotating) tears down the impersonated session too.
      if (isImpersonatedTab()) return;
      // localStorage 'storage' event only fires in OTHER tabs (not the one that made the change).
      // When access token is removed (logout in another tab), clear state here too.
      if (event.key === 'nexus_access_token' && event.newValue === null && state.status === 'authenticated') {
        void purgeAllOfflineCheckinData();
        tokenManager.clearTokens();
        // Also clear tenant context so the next login gets a fresh tenant bootstrap.
        // Without this, a stale tenant slug from the previous session could cause
        // the wrong community's branding to appear on the login page in this tab.
        localStorage.removeItem('nexus_tenant_id');
        localStorage.removeItem('nexus_tenant_slug');
        setState({
          user: null,
          status: 'idle',
          error: null,
          twoFactorToken: null,
          twoFactorMethods: [],
        });
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [state.status]);

  // ─────────────────────────────────────────────────────────────────────────
  // Initial Auth Check
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // A cold-start session check that failed offline remains recoverable instead
  // of redirecting to login. Retry automatically when connectivity returns.
  useEffect(() => {
    const retrySessionCheck = () => {
      if (state.status === 'loading' && tokenManager.hasAccessToken()) {
        void refreshUser();
      }
    };

    window.addEventListener('online', retrySessionCheck);
    return () => window.removeEventListener('online', retrySessionCheck);
  }, [refreshUser, state.status]);

  // ─────────────────────────────────────────────────────────────────────────
  // Context Value
  // ─────────────────────────────────────────────────────────────────────────

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: state.status === 'authenticated',
      isLoading: state.status === 'loading',
      login,
      loginWithBiometric,
      verify2FA,
      register,
      logout,
      refreshUser,
      clearError,
      cancel2FA,
      scheduleSessionWarning,
    }),
    [state, login, loginWithBiometric, verify2FA, register, logout, refreshUser, clearError, cancel2FA, scheduleSessionWarning]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

/**
 * Non-throwing variant of {@link useAuth}. Returns `null` when there is no
 * `AuthProvider` ancestor instead of throwing.
 *
 * Use this ONLY in components that can legitimately render outside the provider
 * tree — most importantly error-boundary fallbacks. In NEXUS the top-level
 * `ErrorBoundary` (App.tsx) sits *above* `AuthProvider` (which is provided
 * per-route inside `TenantShell`), so any fallback it renders has no auth
 * context. A hard-throwing `useAuth()` there re-crashes the fallback and
 * escalates to the bare root boundary — defeating the recovery UI exactly when
 * it is needed. Regular feature code should keep using `useAuth()`.
 */
export function useAuthOptional(): AuthContextValue | null {
  return use(AuthContext);
}

export default AuthContext;
