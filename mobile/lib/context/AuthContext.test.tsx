// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';

// --- Mocks (hoisted before imports) ---

jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: {
    AUTH_TOKEN: 'auth_token',
    REFRESH_TOKEN: 'refresh_token',
    TENANT_SLUG: 'tenant_slug',
    USER_DATA: 'user_data',
  },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn().mockResolvedValue(undefined);
const mockStorageRemove = jest.fn().mockResolvedValue(undefined);
const mockStorageGetJson = jest.fn();
const mockStorageSetJson = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/storage', () => ({
  storage: {
    get: (...args: unknown[]) => mockStorageGet(...args),
    set: (...args: unknown[]) => mockStorageSet(...args),
    remove: (...args: unknown[]) => mockStorageRemove(...args),
    getJson: (...args: unknown[]) => mockStorageGetJson(...args),
    setJson: (...args: unknown[]) => mockStorageSetJson(...args),
  },
}));

const mockApiLogin = jest.fn();
const mockApiLogout = jest.fn();
const mockGetMe = jest.fn();
const mockPurgeOfflineCheckin = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/eventOfflineCheckinStore', () => ({
  purgeAllMobileOfflineCheckinData: () => mockPurgeOfflineCheckin(),
}));

jest.mock('@/lib/api/auth', () => ({
  login: (...args: unknown[]) => mockApiLogin(...args),
  logout: (...args: unknown[]) => mockApiLogout(...args),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  extractToken: jest.fn((r: { access_token?: string }) => r.access_token ?? ''),
  buildDisplayName: jest.fn((u: { first_name?: string | null }) => u.first_name ?? 'Member'),
}));

const mockClearApiSession = jest.fn();
const mockInstallApiSession = jest.fn();

jest.mock('@/lib/api/client', () => ({
  registerUnauthorizedCallback: jest.fn(),
  clearApiSession: (...args: unknown[]) => mockClearApiSession(...args),
  installApiSession: (...args: unknown[]) => mockInstallApiSession(...args),
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
}));

/*
  The community the app is showing, and the public community list. Both are mocked because
  this suite renders `AuthProvider` on its own — the real tree puts `TenantProvider`
  directly above it, and `useOptionalTenantContext` is how the provider reads it without
  requiring one. See lib/tenancy/signInTenant.ts for what these are used to decide.
*/
const mockListTenants = jest.fn();

jest.mock('@/lib/api/tenant', () => ({
  listTenants: (...args: unknown[]) => mockListTenants(...args),
}));

const mockSetTenantSlug = jest.fn();
let mockTenantContext: unknown = null;

jest.mock('@/lib/context/TenantContext', () => ({
  useOptionalTenantContext: () => mockTenantContext,
}));

const mockRegisterForPushNotifications = jest.fn().mockResolvedValue('registered');
const mockUnregisterPushNotifications = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/notifications', () => ({
  registerForPushNotifications: (...args: unknown[]) => mockRegisterForPushNotifications(...args),
  unregisterPushNotifications: (...args: unknown[]) => mockUnregisterPushNotifications(...args),
}));

// --- Tests ---

import { router } from 'expo-router';

import { communityRepairStore } from '@/lib/tenancy/communityRepairStore';

import { AuthProvider, useAuthContext } from './AuthContext';

/** The hub a sub-community's members must use to sign in, and the sub-community itself. */
const HUB = { id: 7, slug: 'uk-timebank', name: 'UK Timebank', logo_url: null };
const SUB = { id: 42, slug: 'stratford', name: 'Stratford', logo_url: null };

function showingCommunity(community: { id: number; slug: string }) {
  return {
    tenant: { id: community.id, slug: community.slug },
    tenantSlug: community.slug,
    isLoading: false,
    setTenantSlug: mockSetTenantSlug,
  };
}

/** The community's configuration has not loaded yet — the state every launch starts in. */
const stillLoadingCommunity = {
  tenant: null,
  tenantSlug: HUB.slug,
  isLoading: true,
  setTenantSlug: mockSetTenantSlug,
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

const mockUser = {
  id: 1,
  first_name: 'Jane',
  last_name: 'Smith',
  email: 'jane@example.com',
  avatar_url: null,
  tenant_id: 1,
  role: 'member',
  is_admin: false,
  onboarding_completed: true,
};

const mockFullUser = {
  ...mockUser,
  name: 'Jane Smith',
  bio: null,
  location: null,
  phone: null,
  balance: 10,
  created_at: null,
};

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    mockStorageGetJson.mockResolvedValue(null);
    mockApiLogout.mockResolvedValue(undefined);
    mockSetTenantSlug.mockResolvedValue(undefined);
    mockListTenants.mockResolvedValue({ data: [HUB, SUB] });
    mockTenantContext = showingCommunity(HUB);
    (router.replace as jest.Mock).mockClear();
    communityRepairStore.__resetForTests();
  });

  it('starts in loading state', () => {
    // storage.get hangs — isLoading stays true
    mockStorageGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuthContext(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('becomes unauthenticated when no token is stored', async () => {
    mockStorageGet.mockResolvedValue(null);
    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('restores session when token and getMe both succeed', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(mockUser);
    mockGetMe.mockResolvedValue({ data: mockFullUser });

    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe('stored-token');
  });

  it('registers push notifications when restoring a cached session', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(mockUser);
    mockGetMe.mockResolvedValue({ data: mockFullUser });

    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await waitFor(() => expect(mockRegisterForPushNotifications).toHaveBeenCalledTimes(1));
  });

  it('clears session when the stored token is rejected and there is no cache', async () => {
    mockStorageGet.mockResolvedValue('bad-token');
    mockStorageGetJson.mockResolvedValue(null);
    mockGetMe.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));

    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(mockStorageRemove).toHaveBeenCalled();
    expect(mockPurgeOfflineCheckin).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 Audit 2026-09-06, F09. The cached-user branch already told a revoked token apart
   * from a flat network; the no-cache branch did not, and signed the member out for any
   * error at all. Cached user data can be missing for ordinary reasons — a cleared app
   * cache, an eviction — so an offline launch could throw away a perfectly good session
   * and make the member sign in again with no connection to do it on.
   */
  it.each([
    ['a network failure', new Error('Network request failed')],
    ['a timeout', Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })],
    ['a server outage', Object.assign(new Error('Service Unavailable'), { status: 503 })],
  ])('keeps a stored token through %s when nothing is cached', async (_label, error) => {
    mockStorageGet.mockResolvedValue('good-token');
    mockStorageGetJson.mockResolvedValue(null);
    mockGetMe.mockRejectedValue(error);

    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockPurgeOfflineCheckin).not.toHaveBeenCalled();
    // Not signed in — there is no profile to work with — but not signed OUT either.
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.sessionRestoreFailed).toBe(true);
  });

  it('recovers the session when the member retries after the network returns', async () => {
    mockStorageGet.mockResolvedValue('good-token');
    mockStorageGetJson.mockResolvedValue(null);
    mockGetMe.mockRejectedValue(new Error('Network request failed'));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.sessionRestoreFailed).toBe(true));

    mockGetMe.mockResolvedValue({ data: mockFullUser });
    await act(async () => { await result.current.retrySessionRestore(); });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.sessionRestoreFailed).toBe(false);
    expect(result.current.token).toBe('good-token');
  });

  /** Failing to WRITE the cache is not the server rejecting the token. */
  it('keeps the restored session when caching the fetched user fails', async () => {
    mockStorageGet.mockResolvedValue('good-token');
    mockStorageGetJson.mockResolvedValue(null);
    mockGetMe.mockResolvedValue({ data: mockFullUser });
    mockStorageSetJson.mockRejectedValueOnce(new Error('disk full'));

    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  it('login() sets user and token', async () => {
    mockStorageGet.mockResolvedValue(null);
    mockApiLogin.mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'ref-token',
      user: mockUser,
    });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'jane@example.com', password: 'secret' });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(mockStorageSet).toHaveBeenCalledWith('auth_token', 'new-token');
    expect(mockStorageSet).toHaveBeenCalledWith('refresh_token', 'ref-token');
  });

  /*
    Signing in from a hub as a member of one of its sub-communities.

    THE FAILURE, seen in the wild on 2026-09-09, release 1.4.0+7. A sub-community has no
    address of its own, so its members sign in at their hub — and the server lets them,
    deliberately. But it issues a token for THEIR community while the app carries on asking
    about the hub, and the server then answers 403 to every request. The member was signed
    in, receiving no notifications, and told nothing at all.

    The decision itself, and every case where the app must NOT move, live in
    lib/tenancy/signInTenant.ts. These four are about the wiring: that this provider asks
    at all, asks with the community it is actually showing, does it before it navigates,
    and cannot break a sign-in by failing.
  */
  const signInAs = (user: Record<string, unknown>) => ({
    access_token: 'new-token',
    refresh_token: 'ref-token',
    user: { ...mockUser, ...user },
  });

  it('moves the app to the community the session was issued for', async () => {
    mockStorageGet.mockResolvedValue(null);
    mockApiLogin.mockResolvedValue(signInAs({ tenant_id: SUB.id }));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'jane@example.com', password: 'secret' });
    });

    expect(mockSetTenantSlug).toHaveBeenCalledWith('stratford');
    expect(result.current.isAuthenticated).toBe(true);
  });

  /*
    🔴 Before navigating, not after. The first screen fires its own requests the moment it
    mounts, and on this path every one of them is refused — so a switch that happened
    afterwards would arrive at a screen already full of errors.
  */
  it('switches community before it sends the member to a screen', async () => {
    mockStorageGet.mockResolvedValue(null);
    mockApiLogin.mockResolvedValue(signInAs({ tenant_id: SUB.id }));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'jane@example.com', password: 'secret' });
    });

    const switched = mockSetTenantSlug.mock.invocationCallOrder[0];
    const navigated = (router.replace as jest.Mock).mock.invocationCallOrder[0];
    expect(switched).toBeLessThan(navigated);
  });

  it('leaves the community alone when the member signed in to the one on screen', async () => {
    mockStorageGet.mockResolvedValue(null);
    mockApiLogin.mockResolvedValue(signInAs({ tenant_id: HUB.id }));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'jane@example.com', password: 'secret' });
    });

    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockSetTenantSlug).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalled();
  });

  /*
    🔴 The sign-in has already succeeded by the time the switch runs. Tidying up which
    community is showing must never be able to undo it.
  */
  it('still signs the member in when the community switch fails', async () => {
    mockStorageGet.mockResolvedValue(null);
    mockApiLogin.mockResolvedValue(signInAs({ tenant_id: SUB.id }));
    mockSetTenantSlug.mockRejectedValue(new Error('Unable to load community'));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'jane@example.com', password: 'secret' });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(router.replace).toHaveBeenCalled();
  });

  it('logout() clears user and token', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(mockUser);
    mockGetMe.mockResolvedValue({ data: mockFullUser });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(mockStorageRemove).toHaveBeenCalled();
    expect(mockPurgeOfflineCheckin).toHaveBeenCalledTimes(1);
  });

  /*
    \u{1F534} Whose session the app SENDS, not just the one it shows.

    The API client keeps an in-memory bearer that beats the stored one, so clearing storage
    is not a sign-out on its own. `logout()` deliberately continues to local cleanup when
    the server request fails - and that path used to leave the cached bearer in place. The
    member saw the login screen while the app carried on making requests as them, and a
    registration performed next sent the OLD account's token under the NEW account's
    screens. Asserting that the API layer is told, because nothing else can tell it.
  */
  it('clears the API session even when the server logout request fails', async () => {
    mockStorageGet.mockResolvedValue('token-abc');
    mockStorageGetJson.mockResolvedValue({ id: 1, first_name: 'Ada' });
    mockGetMe.mockResolvedValue({ data: { id: 1, first_name: 'Ada' } });
    mockApiLogout.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    mockClearApiSession.mockClear();
    await act(async () => { await result.current.logout(); });

    expect(mockClearApiSession).toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('installs the API session for a registration that did not go through login()', async () => {
    // Registration writes its own tokens to storage and calls setSession. Without this the
    // client's cached bearer - possibly a previous account's - would win over the new one.
    mockStorageGet.mockResolvedValue(null);

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockInstallApiSession.mockClear();
    act(() => { result.current.setSession('new-account-token', { id: 2, first_name: 'Bea' } as never); });

    expect(mockInstallApiSession).toHaveBeenCalledWith('new-account-token');
    expect(result.current.token).toBe('new-account-token');
  });

  /*
    LAUNCHING WHILE ALREADY IN THE WRONG COMMUNITY.

    Fixing this at sign-in does nothing for the people it has already happened to. Their
    phone holds a session issued by one community and the name of another, and every launch
    repeated the same silent refusal of everything — they would have had to notice the
    community picker and work out for themselves which community was theirs.

    The decision is the same shared one (lib/tenancy/signInTenant.ts). These are about when
    it runs, what it costs when nothing is wrong, and that it holds the apology back while
    it works.
  */
  const cachedMemberOf = (tenantId: number, extra: Record<string, unknown> = {}) => ({
    ...mockUser,
    tenant_id: tenantId,
    is_super_admin: false,
    is_god: false,
    ...extra,
  });

  it('puts a member who launches in the wrong community back into their own', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(cachedMemberOf(SUB.id));
    // Everything token-scoped is refused in this state, including the profile fetch.
    mockGetMe.mockRejectedValue(Object.assign(new Error('mismatch'), { status: 403 }));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await waitFor(() => expect(mockSetTenantSlug).toHaveBeenCalledWith('stratford'));
    // The screens already on the stack asked the old community and were refused; useApi
    // does not re-fetch because the community changed underneath it.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(tabs)/home'));
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('costs a healthy launch nothing at all', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(cachedMemberOf(HUB.id));
    mockGetMe.mockResolvedValue({ data: cachedMemberOf(HUB.id) });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockSetTenantSlug).not.toHaveBeenCalled();
  });

  /*
    🔴 This is what keeps the cost at nothing. Without the wait the community id is unknown
    on every cold start, and "unknown" means asking the server for the community list —
    an extra request on every launch, for everybody, to catch a rare fault.
  */
  it('waits for the community configuration rather than guessing', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(cachedMemberOf(SUB.id));
    mockGetMe.mockRejectedValue(Object.assign(new Error('mismatch'), { status: 403 }));
    mockTenantContext = stillLoadingCommunity;

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockSetTenantSlug).not.toHaveBeenCalled();
  });

  /*
    🔴 A repair, not a policy. A member who picks a different community later in the same
    session must not be dragged back to their own on the next render.
  */
  it('tries once per launch, not once per render', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(cachedMemberOf(SUB.id));
    mockGetMe.mockRejectedValue(Object.assign(new Error('mismatch'), { status: 403 }));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(mockSetTenantSlug).toHaveBeenCalledTimes(1));

    /*
      🔴 The user object changing is what would restart it — a profile edit, or the
      background `getMe` landing — so that is what this provokes, rather than a bare
      re-render the effect would ignore anyway.

      🔴 And it has to WAIT before asserting. Written without the flush below this test
      passed with the once-only guard deleted: the repair's second run does not reach
      `setTenantSlug` until two promises have settled, so a synchronous assertion is taken
      before the thing it is looking for could possibly have happened. Caught by a control
      run, which is the only reason it is written properly now.
    */
    await act(async () => {
      result.current.refreshUser({ ...cachedMemberOf(SUB.id), first_name: 'Jo' } as never);
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(mockListTenants).toHaveBeenCalledTimes(1);
    expect(mockSetTenantSlug).toHaveBeenCalledTimes(1);
  });

  /*
    🔴 The apology and the repair race at launch, and the apology must lose. Otherwise the
    member is told "choose your community below" at the exact moment the app is choosing it
    for them. `communityRepairStore` is the only thing joining the two.
  */
  it('holds the community picker back while it is working', async () => {
    let releaseSwitch: () => void = () => {};
    mockSetTenantSlug.mockImplementation(() => new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    }));
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(cachedMemberOf(SUB.id));
    mockGetMe.mockRejectedValue(Object.assign(new Error('mismatch'), { status: 403 }));

    renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(mockSetTenantSlug).toHaveBeenCalled());

    expect(communityRepairStore.isRepairing()).toBe(true);

    await act(async () => { releaseSwitch(); });
    await waitFor(() => expect(communityRepairStore.isRepairing()).toBe(false));
  });

  it('lets the picker apologise again once a failed repair is over', async () => {
    mockSetTenantSlug.mockRejectedValue(new Error('Unable to load community'));
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(cachedMemberOf(SUB.id));
    mockGetMe.mockRejectedValue(Object.assign(new Error('mismatch'), { status: 403 }));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(mockSetTenantSlug).toHaveBeenCalled());

    await waitFor(() => expect(communityRepairStore.isRepairing()).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(router.replace).not.toHaveBeenCalledWith('/(tabs)/home');
  });

  /*
    🔴 A cache written by an older build may predate the super-admin flags, and then "no
    flag" and "flag is false" look identical. Moving a platform super admin out of the
    community they deliberately chose is the one expensive mistake here, so an admin we
    cannot classify is left alone and the picker rescues them instead.
  */
  it('will not move an admin whose cached profile predates the super-admin flags', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue({
      ...mockUser, tenant_id: SUB.id, is_admin: true,
    });
    mockGetMe.mockRejectedValue(Object.assign(new Error('mismatch'), { status: 403 }));

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockSetTenantSlug).not.toHaveBeenCalled();
  });

  it('refreshUser() updates in-memory user without a network call', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(mockUser);
    mockGetMe.mockResolvedValue({ data: mockFullUser });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    const updated = { ...mockFullUser, first_name: 'Updated' };
    act(() => { result.current.refreshUser(updated); });

    expect(result.current.user).toEqual(updated);
    // getMe should only have been called once (during restore), not again
    expect(mockGetMe).toHaveBeenCalledTimes(1);
  });
});
