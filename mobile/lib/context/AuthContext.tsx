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
  useRef,
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

import { listTenants } from '@/lib/api/tenant';
import { useOptionalTenantContext } from '@/lib/context/TenantContext';
import { adoptSignInTenant, isCrossCommunityAdmin } from '@/lib/tenancy/signInTenant';
import { sessionNoticeStore } from '@/lib/notices/sessionNoticeStore';
import { purgeAllMobileOfflineCheckinData } from '@/lib/eventOfflineCheckinStore';
import { clearApiSession, installApiSession, registerUnauthorizedCallback } from '@/lib/api/client';
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
  /**
   * A stored token exists but could not be checked because the server was unreachable.
   * The member is not signed in and not signed out — offer them a retry, not a login form.
   */
  sessionRestoreFailed: boolean;
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
  /** Try a failed start-up validation again, once the member has a connection. */
  retrySessionRestore: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Did the SERVER refuse these credentials, or could we simply not reach it?
 *
 * 🔴 Only a 401 answers "refused". A timeout, a dropped connection, a 5xx or a DNS
 * failure prove nothing about the token, and treating them as a refusal is how a member
 * gets signed out for being on a train (audit 2026-09-06, F09).
 */
function isCredentialRejection(error: unknown): boolean {
  const status = (error as { status?: number })?.status
    ?? (error as { response?: { status?: number } })?.response?.status;
  return status === 401;
}

/**
 * Write the profile to the local cache. Best effort on purpose: a full disk or a
 * storage fault is not the server rejecting the session, and must not end it.
 */
async function cacheUserBestEffort(profile: AnyUser): Promise<void> {
  try {
    await storage.setJson(STORAGE_KEYS.USER_DATA, profile);
  } catch {
    /* the session is valid either way; the next launch simply re-fetches */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation(['common']);
  const [user, setUser] = useState<AnyUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /**
   * True when a stored token could not be validated because the SERVER could not be
   * reached — not because it refused the token. The credentials are still on the device
   * and a retry may well succeed (audit 2026-09-06, F09).
   */
  const [sessionRestoreFailed, setSessionRestoreFailed] = useState(false);
  const isMountedRef = useRef(true);
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
    clearApiSession();
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

  /*
    The community the app is currently showing. Read through the non-throwing reader so
    this provider still renders on its own — the real tree puts `TenantProvider` directly
    above it (app/_layout.tsx), which is what makes the switch below possible at all.
  */
  const tenantContext = useOptionalTenantContext();
  const currentTenantId = tenantContext?.tenant?.id ?? null;
  const currentSlug = tenantContext?.tenantSlug ?? '';
  const switchCommunity = tenantContext?.setTenantSlug;

  /**
   * Put the app in the community this session was actually issued for.
   *
   * 🔴 A member of a sub-community signs in at their hub, because that is where the
   * sign-in screen is — sub-communities have no address of their own. The server accepts
   * them and issues a token for THEIR community while the app carries on asking about the
   * hub, and `App\Core\TenantContext` then answers 403 to every request they make. Seen
   * in the wild on 2026-09-09: signed in, and nothing loaded.
   *
   * Silent by design. They did nothing wrong and there is nothing to ask — an account
   * belongs to one community, so the app already knows the only right answer. The reasoning
   * and every edge lives in lib/tenancy/signInTenant.ts.
   */
  const adoptSignInCommunity = useCallback(async (signedInUser: LoginUser) => {
    if (!switchCommunity) return;
    await adoptSignInTenant({
      input: {
        userTenantId: signedInUser.tenant_id,
        currentTenantId,
        currentSlug,
        isCrossCommunityAdmin: isCrossCommunityAdmin(signedInUser),
      },
      listTenants,
      setTenantSlug: switchCommunity,
    });
  }, [currentSlug, currentTenantId, switchCommunity]);

  /** Throw the session away. Only ever correct when the server REFUSED the credentials. */
  const discardStoredSession = useCallback(async () => {
    await Promise.all([
      storage.remove(STORAGE_KEYS.AUTH_TOKEN),
      storage.remove(STORAGE_KEYS.REFRESH_TOKEN),
      storage.remove(STORAGE_KEYS.USER_DATA),
      purgeAllMobileOfflineCheckinData(),
    ]);
    clearApiSession();
    if (!isMountedRef.current) return;
    setToken(null);
    setUser(null);
  }, []);

  /**
   * On app start: restore the cached user immediately, then re-validate in the background,
   * so the app renders from cache rather than blocking on the network.
   *
   * 🔴 The two branches below must agree about one thing (audit 2026-09-06, F09): a server
   * that REFUSES the token ends the session; a server that cannot be REACHED does not. The
   * cached-user branch already did that. The no-cache branch wrapped everything in one
   * `catch` and signed the member out for any failure at all — including a flat network on
   * a launch where the cached profile happened to be missing, which is an ordinary thing
   * for a phone to do to an app cache. The member was then asked to sign in again with no
   * connection to sign in over, and the offline check-in queue was purged with it.
   */
  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const storedToken = await storage.get(STORAGE_KEYS.AUTH_TOKEN);
      if (!storedToken) {
        // Nothing to restore, so nothing can have failed. Without this a member who signed
        // out FROM the "could not check your session" screen stayed on it for ever (audit
        // 2026-09-07, A/F-01).
        setSessionRestoreFailed(false);
        return;
      }

      const cachedUser = await storage.getJson<AnyUser>(STORAGE_KEYS.USER_DATA);
      if (cachedUser) {
        if (!isMountedRef.current) return;
        setToken(storedToken);
        setUser(cachedUser);
        setSessionRestoreFailed(false);
        setIsLoading(false);
        registerPushBestEffort();

        try {
          const response = await getMe();
          if (!isMountedRef.current) return;
          setUser(response.data);
          await cacheUserBestEffort(response.data);
        } catch (err: unknown) {
          if (!isMountedRef.current) return;
          // Refused, not unreachable. Anything else keeps the cached user so the app
          // stays usable offline.
          if (isCredentialRejection(err)) await discardStoredSession();
        }
        return;
      }

      // No cached user: there is no profile to render, so this call has to succeed
      // before the app can treat the member as signed in.
      try {
        const response = await getMe();
        if (!isMountedRef.current) return;
        setToken(storedToken);
        setUser(response.data);
        setSessionRestoreFailed(false);
        await cacheUserBestEffort(response.data);
        registerPushBestEffort();
      } catch (err: unknown) {
        if (isCredentialRejection(err)) {
          await discardStoredSession();
          if (isMountedRef.current) setSessionRestoreFailed(false);
          return;
        }
        // Unreachable, timed out, or a server fault. The credentials stay on the device
        // and `retrySessionRestore` can pick them up again.
        if (isMountedRef.current) setSessionRestoreFailed(true);
      }
    } catch {
      // Reading local storage failed. Nothing has been proven about the token, so
      // nothing is thrown away.
      if (isMountedRef.current) setSessionRestoreFailed(true);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [discardStoredSession, registerPushBestEffort]);

  /** Offered to the member when start-up could not reach the server. */
  const retrySessionRestore = useCallback(async () => {
    await restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    isMountedRef.current = true;
    void restoreSession();
    return () => {
      isMountedRef.current = false;
    };
  }, [restoreSession]);

  const login = useCallback(async (payload: LoginPayload) => {
    const response = await apiLogin(payload);
    const bearerToken = extractToken(response);

    await Promise.all([
      storage.set(STORAGE_KEYS.AUTH_TOKEN, bearerToken),
      storage.set(STORAGE_KEYS.REFRESH_TOKEN, response.refresh_token),
      storage.setJson<LoginUser>(STORAGE_KEYS.USER_DATA, response.user),
    ]);

    installApiSession(bearerToken);
    setToken(bearerToken);
    setUser(response.user);

    // 🔴 Before navigating, not after. The first screen fires its own requests
    // immediately, and on the mismatch path every one of them is refused — so a switch
    // that happened afterwards would arrive to a screen already full of errors.
    // `adoptSignInTenant` never throws: the sign-in has already succeeded by this line
    // and must not be undone by a failure to tidy up which community is showing.
    await adoptSignInCommunity(response.user);

    router.replace(response.user.onboarding_completed === false
      ? '/(modals)/onboarding'
      : '/(tabs)/home');

    // Register device for push notifications (non-blocking, best-effort)
    registerPushBestEffort();
  }, [adoptSignInCommunity, registerPushBestEffort]);

  /**
   * Adopt a session established outside `login()` — registration is the caller that
   * matters.
   *
   * 🔴 It used to set React state only. The API client keeps its own in-memory bearer
   * that WINS over the stored one, so a registration following a failed sign-out sent the
   * previous account's token while showing the new account's screens. Installing the
   * bearer here is what makes "the session the app displays" and "the session the app
   * sends" the same thing.
   */
  const setSession = useCallback((newToken: string, newUser: AnyUser) => {
    installApiSession(newToken);
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

    // 🔴 Unconditional, and NOT reliant on the server logout above having succeeded.
    // The `catch` on `apiLogout()` means this function completes a sign-out even when the
    // request never reached the server — and before this line, that path left the API
    // client still holding the bearer it had cached, so the app kept making requests as
    // the member who had just signed out.
    clearApiSession();

    setToken(null);
    setUser(null);
    // The session-restore failure screen renders INSTEAD of the navigator, so a sign-out
    // from it must clear the flag or the screen stays and `router.replace` below has no
    // navigator to act on (audit 2026-09-07, A/F-01).
    setSessionRestoreFailed(false);
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
      sessionRestoreFailed,
      login,
      logout,
      setSession,
      refreshUser,
      displayName,
      retrySessionRestore,
    }),
    [
      user, token, isLoading, sessionRestoreFailed, login, logout, setSession,
      refreshUser, displayName, retrySessionRestore,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>');
  return ctx;
}
