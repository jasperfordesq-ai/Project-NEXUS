// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installServiceWorkerLifecycle } from './serviceWorkerLifecycle';

interface WorkerHarness {
  dispatchControllerChange: () => void;
  register: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  navigatorRef: Navigator;
}

function workerHarness(): WorkerHarness {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const update = vi.fn(async () => undefined);
  const registration = { update } as unknown as ServiceWorkerRegistration;
  const register = vi.fn(async () => registration);
  const serviceWorker = {
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'controllerchange') listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    }),
    register,
    getRegistration: vi.fn(async () => registration),
  } as unknown as ServiceWorkerContainer;

  return {
    register,
    update,
    navigatorRef: { serviceWorker } as Navigator,
    dispatchControllerChange: () => {
      const event = new Event('controllerchange');
      for (const listener of listeners) {
        if (typeof listener === 'function') listener(event);
        else listener.handleEvent(event);
      }
    },
  };
}

describe('service-worker upgrade lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers without HTTP-cache reuse and polls for deployed updates', async () => {
    const worker = workerHarness();
    const cleanup = installServiceWorkerLifecycle({
      breadcrumb: vi.fn(),
      schedule: (callback) => callback(),
      navigatorRef: worker.navigatorRef,
    });

    await vi.waitFor(() => {
      expect(worker.register).toHaveBeenCalledWith('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(worker.update).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('reloads once with a cache-busting URL after the new worker takes control', () => {
    const worker = workerHarness();
    const reload = vi.fn();
    installServiceWorkerLifecycle({
      breadcrumb: vi.fn(),
      schedule: vi.fn(),
      navigatorRef: worker.navigatorRef,
      reload,
      now: () => 1234,
    });

    worker.dispatchControllerChange();
    worker.dispatchControllerChange();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload.mock.calls[0]?.[0]).toContain('nexus_refresh=1234');
  });

  it('defers the upgrade reload while editing and resumes on blur', () => {
    const worker = workerHarness();
    const reload = vi.fn();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    installServiceWorkerLifecycle({
      breadcrumb: vi.fn(),
      schedule: vi.fn(),
      navigatorRef: worker.navigatorRef,
      reload,
    });

    worker.dispatchControllerChange();
    expect(reload).not.toHaveBeenCalled();

    input.dispatchEvent(new FocusEvent('blur'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});


describe('service-worker upgrade on authentication pages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  // 12 September 2026: mandatory administrator two-factor went live and the owner's
  // first web sign-in was refused. The tab held the previous bundle, which could not
  // read the new sign-in answer; the new worker had activated but its reload was
  // deferred because the cursor was in the password field. A sign-in form holds
  // nothing worth protecting, and a stale bundle on it is exactly the failure.
  it.each(['/login', '/hour-timebank/login', '/register', '/auth/two-factor/setup', '/password/forgot', '/hour-timebank/password/reset'])(
    'reloads at once on %s even while a field is focused',
    (pathname) => {
      window.history.replaceState({}, '', pathname);
      const worker = workerHarness();
      const reload = vi.fn();
      const breadcrumb = vi.fn();
      const input = document.createElement('input');
      document.body.append(input);
      input.focus();

      installServiceWorkerLifecycle({ breadcrumb, schedule: vi.fn(), navigatorRef: worker.navigatorRef, reload });

      worker.dispatchControllerChange();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(breadcrumb).toHaveBeenCalledWith(
        'SW controllerchange — reloading',
        'pwa',
        expect.objectContaining({ reason: 'immediate-auth-page' }),
        'info',
      );
    },
  );

  it('still defers on an ordinary page while a field is focused', () => {
    window.history.replaceState({}, '', '/hour-timebank/messages');
    const worker = workerHarness();
    const reload = vi.fn();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    installServiceWorkerLifecycle({ breadcrumb: vi.fn(), schedule: vi.fn(), navigatorRef: worker.navigatorRef, reload });

    worker.dispatchControllerChange();
    expect(reload).not.toHaveBeenCalled();
  });
});
