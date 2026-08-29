// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { router } from 'expo-router';

import {
  login as apiLogin,
  logout as apiLogout,
  getMe,
  extractToken,
  buildDisplayName,
  type User,
  type LoginUser,
  type LoginPayload,
} from '@/lib/api/auth';
import { useTranslation } from 'react-i18next';

import { sessionNoticeStore } from '@/lib/notices/sessionNoticeStore';
import { purgeAllMobileOfflineCheckinData } from '@/lib/eventOfflineCheckinStore';
import { registerUnauthorizedCallback } from '@/lib/api/client';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import {
  registerForPushNotifications,
  unregisterPushNotifications,
} from '@/lib/notifications';

/**
 * The app uses two user shapes:
 * - LoginUser: embedded in login/register response (slim, no balance)
 * - User: from GET /users/me (full profile with balance)
 *
 * After login we store the LoginUser immediately so the app is usable,
 * then silently upgrade to the full User in the background.
 */
type AnyUser = User | LoginUser;

interface AuthState {
  user: AnyUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  /** Set the in-memory auth state directly (e.g. after registration saves tokens to storage). */
  setSession: (token: string, user: AnyUser) => void;
  /** Patch the in-memory user after a profile update (avoids a full re-fetch). */
  refreshUser: (updated: AnyUser) => void;
  /** Display-ready name for the current user */
  displayName: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation(['common']);
  const [user, setUser] = useState<AnyUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /** Track whether push notifications were successfully registered */

  /**
   * Called by the API client when a session has genuinely ENDED.
   *
   * 🔴 "Genuinely" is the whole point. The client used to invoke this whenever a token
   * refresh failed for any reason, including a dropped connection — so a member on a bad
   * connection was signed out, and the purge below destroyed any offline event check-ins
   * they were holding. An organiser could lose a hall's worth of attendance with no
   * explanation. `attemptTokenRefresh` now distinguishes a refused refresh token from an
   * unreachable server and only the former reaches here; see `TokenRefreshResult` in
   * lib/api/client.ts.
   *
   * The purge is still right for a real sign-out: the queue holds a roster of members'
   * names, encrypted under a key tied to this session.
   */
  const handleUnauthorized = useCallback(() => {
    void purgeAllMobileOfflineCheckinData();
    setUser(null);
    setToken(null);
    // Say what happened. Being returned to the login screen with no message is
    // indistinguishable from a crash or an unrequested logout, which is exactly how
    // members describe it when they report it.
    //
    // Published rather than shown: this provider must not depend on a ToastProvider
    // being above it. `SessionNoticeHost`, mounted inside the provider tree, does the
    // showing. See lib/notices/sessionNoticeStore.ts for why the two earlier attempts
    // at this (a direct hook call, then a try/catch hook) were both wrong.
    sessionNoticeStore.publish({
      title: t('common:errors.sessionEndedTitle'),
      description: t('common:errors.unauthorized'),
      variant: 'warning',
    });
    router.replace('/(auth)/login');
  }, [t]);

  useEffect(() => {
    registerUnauthorizedCallback(handleUnauthorized);
  }, [handleUnauthorized]);

  const registerPushBestEffort = useCallback(() => {
    registerForPushNotifications()
      .catch(() => { /* best-effort */ });
  }, []);

  // On app start: restore cached user immediately, then re-validate in background.
  // This avoids blocking the UI on a slow network — the app renders from cache first.
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      if (!isMounted) return;
      setIsLoading(true);
      try {
        const storedToken = await storage.get(STORAGE_KEYS.AUTH_TOKEN);
        if (!storedToken) return;

        // Show cached user data immediately so the app doesn't block on network
        const cachedUser = await storage.getJson<AnyUser>(STORAGE_KEYS.USER_DATA);
        if (cachedUser) {
          if (!isMounted) return;
          setToken(storedToken);
          setUser(cachedUser);
          setIsLoading(false);
          registerPushBestEffort();

          // Re-validate token with /users/me in the background
          try {
            const response = await getMe();
            if (!isMounted) return;
            setUser(response.data);
            await storage.setJson(STORAGE_KEYS.USER_DATA, response.data);
          } catch (err: unknown) {
            if (!isMounted) return;
            // Only clear session on 401 (token revoked). For network errors,
            // timeouts, or any other failure, keep the cached user so the app
            // remains usable offline.
            const status = (err as { status?: number })?.status
              ?? (err as { response?: { status?: number } })?.response?.status;
            if (status === 401) {
              await Promise.all([
                storage.remove(STORAGE_KEYS.AUTH_TOKEN),
                storage.remove(STORAGE_KEYS.REFRESH_TOKEN),
                storage.remove(STORAGE_KEYS.USER_DATA),
                purgeAllMobileOfflineCheckinData(),
              ]);
              if (!isMounted) return;
              setToken(null);
              setUser(null);
            }
            // Non-401 errors (network down, timeout, etc.) — keep cached user
          }
          return;
        }

        // No cached user — must validate with network before proceeding
        const response = await getMe();
        if (!isMounted) return;
        setToken(storedToken);
        setUser(response.data);
        await storage.setJson(STORAGE_KEYS.USER_DATA, response.data);
        registerPushBestEffort();
      } catch {
        if (!isMounted) return;
        // Token invalid and no cache — clear everything
        await Promise.all([
          storage.remove(STORAGE_KEYS.AUTH_TOKEN),
          storage.remove(STORAGE_KEYS.REFRESH_TOKEN),
          storage.remove(STORAGE_KEYS.USER_DATA),
          purgeAllMobileOfflineCheckinData(),
        ]);
        if (!isMounted) return;
        setToken(null);
        setUser(null);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, [registerPushBestEffort]);

  const login = useCallback(async (payload: LoginPayload) => {
    const response = await apiLogin(payload);
    const bearerToken = extractToken(response);

    await Promise.all([
      storage.set(STORAGE_KEYS.AUTH_TOKEN, bearerToken),
      storage.set(STORAGE_KEYS.REFRESH_TOKEN, response.refresh_token),
      storage.setJson<LoginUser>(STORAGE_KEYS.USER_DATA, response.user),
    ]);

    setToken(bearerToken);
    setUser(response.user);

    router.replace(response.user.onboarding_completed === false
      ? '/(modals)/onboarding'
      : '/(tabs)/home');

    // Register device for push notifications (non-blocking, best-effort)
    registerPushBestEffort();
  }, [registerPushBestEffort]);

  const setSession = useCallback((newToken: string, newUser: AnyUser) => {
    setToken(newToken);
    setUser(newUser);
  }, []);

  const refreshUser = useCallback((updated: AnyUser) => {
    setUser(updated);
  }, []);

  const logout = useCallback(async () => {
    // Unregister push token BEFORE server logout — the server call invalidates the
    // auth token, so push unregister must happen first to avoid a silent 401 failure.
    try {
      await unregisterPushNotifications();
    } catch {
      // Best-effort — continue with logout even if push unregister fails
    }

    try {
      await apiLogout();
    } catch {
      // Continue with local cleanup even if server call fails
    }

    await Promise.all([
      storage.remove(STORAGE_KEYS.AUTH_TOKEN),
      storage.remove(STORAGE_KEYS.REFRESH_TOKEN),
      storage.remove(STORAGE_KEYS.USER_DATA),
      purgeAllMobileOfflineCheckinData(),
    ]);

    setToken(null);
    setUser(null);
    router.replace('/(auth)/login');
  }, []);

  const displayName = useMemo(
    () => (user ? buildDisplayName(user as LoginUser) : ''),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!token && !!user,
      login,
      logout,
      setSession,
      refreshUser,
      displayName,
    }),
    [user, token, isLoading, login, logout, setSession, refreshUser, displayName],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>');
  return ctx;
}
