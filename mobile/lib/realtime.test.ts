// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `lib/realtime.ts` is the Pusher connection: subscribed after login, torn down
 * on logout. Its risky part is the custom authorizer, which has to attach the
 * Bearer token AND the tenant slug to every private-channel auth request. Drop
 * either and the connection fails per channel — messages simply stop arriving,
 * with no error a member could report beyond "the app is quiet".
 *
 * The module also holds a single client in module scope, so re-initialising
 * without disconnecting would leak a socket per login. That is asserted here
 * too, because a leaked socket keeps delivering events to a signed-out session.
 */

const mockDisconnect = jest.fn();
const mockPusherConstructor = jest.fn();
const mockStorageGet = jest.fn();

jest.mock('pusher-js', () => {
  return {
    __esModule: true,
    default: class FakePusher {
      public options: Record<string, unknown>;
      public disconnect = mockDisconnect;

      constructor(key: string, options: Record<string, unknown>) {
        mockPusherConstructor(key, options);
        this.options = options;
      }
    },
  };
});

jest.mock('@/lib/constants', () => ({
  API_BASE_URL: 'https://api.example.test',
  STORAGE_KEYS: {
    AUTH_TOKEN: 'nexus_auth_token',
    TENANT_SLUG: 'nexus_tenant_slug',
  },
}));

jest.mock('@/lib/storage', () => ({
  storage: { get: (...args: unknown[]) => mockStorageGet(...args) },
}));

import { disconnectRealtime, getRealtimeClient, initRealtime } from './realtime';

/** Pull the authorizer the module handed to Pusher for a named channel. */
function authorizeFor(channelName: string) {
  const options = mockPusherConstructor.mock.calls.at(-1)?.[1] as {
    authorizer: (channel: { name: string }) => {
      authorize: (socketId: string, cb: (err: Error | null, data: unknown) => void) => Promise<void>;
    };
  };
  return options.authorizer({ name: channelName }).authorize;
}

const enabledConfig = { key: 'app-key', cluster: 'eu', enabled: true };

describe('realtime connection lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    disconnectRealtime();
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    disconnectRealtime();
  });

  it('does not connect when realtime is disabled for the tenant', () => {
    expect(initRealtime({ ...enabledConfig, enabled: false })).toBeNull();
    expect(mockPusherConstructor).not.toHaveBeenCalled();
    expect(getRealtimeClient()).toBeNull();
  });

  it('does not connect when no Pusher key is configured', () => {
    expect(initRealtime({ ...enabledConfig, key: '' })).toBeNull();
    expect(mockPusherConstructor).not.toHaveBeenCalled();
  });

  it('connects over TLS with the configured cluster and no stats reporting', () => {
    initRealtime(enabledConfig);

    expect(mockPusherConstructor).toHaveBeenCalledTimes(1);
    const [key, options] = mockPusherConstructor.mock.calls[0];
    expect(key).toBe('app-key');
    expect(options).toMatchObject({ cluster: 'eu', forceTLS: true, disableStats: true });
  });

  it('defaults to the eu cluster when none is configured', () => {
    initRealtime({ key: 'app-key', enabled: true } as never);

    expect(mockPusherConstructor.mock.calls[0][1]).toMatchObject({ cluster: 'eu' });
  });

  it('exposes the live client and clears it on disconnect', () => {
    const client = initRealtime(enabledConfig);

    expect(getRealtimeClient()).toBe(client);

    disconnectRealtime();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(getRealtimeClient()).toBeNull();
  });

  it('tears the previous socket down before opening another', () => {
    // Without this, signing out and in again leaks a socket that keeps
    // delivering events to the previous session.
    initRealtime(enabledConfig);
    initRealtime(enabledConfig);

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockPusherConstructor).toHaveBeenCalledTimes(2);
  });

  it('is safe to disconnect when nothing is connected', () => {
    expect(() => disconnectRealtime()).not.toThrow();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});

describe('private channel authorisation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    disconnectRealtime();
    jest.clearAllMocks();
    mockStorageGet.mockImplementation((key: string) =>
      Promise.resolve(
        key === 'nexus_auth_token' ? 'jwt-token' : key === 'nexus_tenant_slug' ? 'hour-timebank' : null
      )
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ auth: 'app-key:signature' }),
    });
    initRealtime(enabledConfig);
  });

  afterEach(() => {
    disconnectRealtime();
  });

  it('sends the Bearer token and the tenant slug with the auth request', async () => {
    const callback = jest.fn();

    await authorizeFor('private-user.7')('socket-123', callback);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/pusher/auth',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Bearer jwt-token',
          'X-Tenant-Slug': 'hour-timebank',
        },
      })
    );
    expect(callback).toHaveBeenCalledWith(null, { auth: 'app-key:signature' });
  });

  it('url-encodes the socket id and channel name into the form body', async () => {
    await authorizeFor('presence-tenant.hour timebank')('socket/123', jest.fn());

    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(body).toBe('socket_id=socket%2F123&channel_name=presence-tenant.hour%20timebank');
  });

  it('omits the auth headers entirely when no credentials are stored', async () => {
    // Sending `Authorization: Bearer null` would look authenticated and be
    // rejected as malformed; omitting the header lets the server answer honestly.
    mockStorageGet.mockResolvedValue(null);

    await authorizeFor('private-user.7')('socket-123', jest.fn());

    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;
    expect(headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
  });

  it('reports a rejected authorisation to Pusher with its status code', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    const callback = jest.fn();

    await authorizeFor('private-user.7')('socket-123', callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), null);
    expect(callback.mock.calls[0][0].message).toBe('Auth failed: 403');
  });

  it('reports a network failure rather than hanging the subscription', async () => {
    const failure = new Error('offline');
    global.fetch = jest.fn().mockRejectedValue(failure);
    const callback = jest.fn();

    await authorizeFor('private-user.7')('socket-123', callback);

    expect(callback).toHaveBeenCalledWith(failure, null);
  });

  it('wraps a non-Error rejection so Pusher always receives an Error', async () => {
    global.fetch = jest.fn().mockRejectedValue('a string, not an Error');
    const callback = jest.fn();

    await authorizeFor('private-user.7')('socket-123', callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), null);
    expect(callback.mock.calls[0][0].message).toBe('Auth error');
  });
});
