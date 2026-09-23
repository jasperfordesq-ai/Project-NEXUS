// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-108: signing out must drop this browser's push subscription, best-effort and
 * without ever holding sign-out up.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '@/lib/api';
import { unsubscribeBrowserPushOnLogout } from './useWebPush';

function makeSub(endpoint = 'https://push.example/sub-1') {
  return { endpoint, unsubscribe: vi.fn().mockResolvedValue(true) };
}

function installServiceWorker(getRegistration: () => Promise<unknown>) {
  Object.defineProperty(window, 'PushManager', { configurable: true, writable: true, value: class {} });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn(getRegistration) },
  });
}

function removeServiceWorker() {
  try { delete (window as unknown as Record<string, unknown>).PushManager; } catch { /* noop */ }
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
}

describe('unsubscribeBrowserPushOnLogout (F-108)', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    removeServiceWorker();
  });

  it('unsubscribes locally and tells the server which endpoint to delete', async () => {
    const sub = makeSub('https://push.example/sub-42');
    installServiceWorker(async () => ({ pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } }));

    await unsubscribeBrowserPushOnLogout();

    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/push/unsubscribe', { endpoint: 'https://push.example/sub-42' });
  });

  it('does nothing when this browser has no subscription or no service worker', async () => {
    installServiceWorker(async () => ({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } }));
    await unsubscribeBrowserPushOnLogout();

    installServiceWorker(async () => undefined);
    await unsubscribeBrowserPushOnLogout();

    removeServiceWorker();
    await unsubscribeBrowserPushOnLogout();

    expect(api.post).not.toHaveBeenCalled();
  });

  it('still asks the server to delete the row when the local unsubscribe throws', async () => {
    const sub = makeSub();
    sub.unsubscribe.mockRejectedValue(new Error('push service unreachable'));
    installServiceWorker(async () => ({ pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } }));

    await expect(unsubscribeBrowserPushOnLogout()).resolves.toBeUndefined();
    expect(api.post).toHaveBeenCalledWith('/push/unsubscribe', { endpoint: sub.endpoint });
  });

  it('never throws when the server call fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('network'));
    installServiceWorker(async () => ({ pushManager: { getSubscription: vi.fn().mockResolvedValue(makeSub()) } }));

    await expect(unsubscribeBrowserPushOnLogout()).resolves.toBeUndefined();
  });

  it('gives up after the timeout instead of holding sign-out up', async () => {
    installServiceWorker(() => new Promise(() => { /* never settles */ }));
    const started = Date.now();

    await expect(unsubscribeBrowserPushOnLogout(50)).resolves.toBeUndefined();

    expect(Date.now() - started).toBeLessThan(2000);
    expect(api.post).not.toHaveBeenCalled();
  });
});
