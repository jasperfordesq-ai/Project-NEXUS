// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * useWebPush — PWA Web Push (W3C Push API) subscription lifecycle.
 *
 * Native push registration belongs to the Expo client in mobile/.
 * This hook handles the browser path:
 *   1. Notification.requestPermission()
 *   2. registration.pushManager.subscribe({ applicationServerKey: VAPID_PUB })
 *   3. POST /api/push/subscribe   (persist endpoint+keys to push_subscriptions)
 *
 * Disable flow:
 *   1. Local subscription.unsubscribe()
 *   2. POST /api/push/unsubscribe (delete row)
 *
 * The actual notification rendering happens in /sw-push-handler.js. The send
 * path (PHP) is in app/Services/WebPushService.php.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';

export type WebPushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export interface WebPushState {
  /** Browser supports SW + PushManager + Notification API. */
  isSupported: boolean;
  /** Current Notification.permission. */
  permission: WebPushPermission;
  /** Live PushSubscription exists in this browser (and on server). */
  isSubscribed: boolean;
  /** A subscribe/unsubscribe call is currently in flight. */
  isPending: boolean;
  /** Last error message from a failed call. */
  error: string | null;
}

interface VapidKeyResponse { vapid_public_key: string | null }

const SUPPORTED = typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!SUPPORTED) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function readPermission(): WebPushPermission {
  if (!SUPPORTED) return 'unsupported';
  return Notification.permission as WebPushPermission;
}

/** Upper bound on how long sign-out waits for push cleanup. */
const LOGOUT_PUSH_CLEANUP_TIMEOUT_MS = 3000;

/**
 * Drop this browser's push subscription as part of signing out (F-108).
 *
 * Subscriptions are stored per user + endpoint, and the endpoint belongs to the
 * BROWSER, not the member. Signing out used to leave it in place, so the old
 * account kept receiving notifications on this browser — and once the next person
 * enabled push here, both accounts' notifications arrived.
 *
 * Call it BEFORE the server logout: `/push/unsubscribe` needs the member's
 * still-valid session. The local `unsubscribe()` runs first, so even if the server
 * call fails the endpoint is dead and the push service answers 410 to any send.
 *
 * Best-effort by contract: never throws, and never holds sign-out up for longer
 * than `timeoutMs`. Uses `getRegistration()` rather than `ready`, because `ready`
 * never settles on a page with no service worker.
 */
export async function unsubscribeBrowserPushOnLogout(
  timeoutMs: number = LOGOUT_PUSH_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  if (
    typeof window === 'undefined'
    || typeof navigator === 'undefined'
    || !navigator.serviceWorker
    || typeof navigator.serviceWorker.getRegistration !== 'function'
    || !('PushManager' in window)
  ) {
    return;
  }

  const cleanup = (async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const pushSub = await reg?.pushManager.getSubscription();
    if (!pushSub) return;
    const endpoint = pushSub.endpoint;
    try { await pushSub.unsubscribe(); } catch { /* keep going — server cleanup still useful */ }
    if (endpoint) {
      await api.post('/push/unsubscribe', { endpoint });
    }
  })().catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try {
    await Promise.race([cleanup, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function useWebPush() {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<WebPushState>(() => ({
    isSupported: SUPPORTED,
    permission: readPermission(),
    isSubscribed: false,
    isPending: false,
    error: null,
  }));

  const refresh = useCallback(async () => {
    if (!SUPPORTED) return;
    const reg = await getRegistration();
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    setState((s) => ({ ...s, permission: readPermission(), isSubscribed: !!sub }));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-check when SW pushsubscriptionchange propagates a message to the page.
  useEffect(() => {
    if (!SUPPORTED) return;
    const handler = (e: MessageEvent) => {
      if (e.data && e.data.type === 'nexus:push_subscription_changed') void refresh();
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [refresh]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!SUPPORTED) {
      setState((s) => ({ ...s, error: t('push_status.unsupported') }));
      return false;
    }
    setState((s) => ({ ...s, isPending: true, error: null }));
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState((s) => ({ ...s, isPending: false, permission: permission as WebPushPermission }));
        return false;
      }

      const keyRes = await api.get<VapidKeyResponse>('/push/vapid-key');
      const vapidPublicKey = keyRes?.data?.vapid_public_key;
      if (!vapidPublicKey) {
        setState((s) => ({ ...s, isPending: false, error: t('push_errors.not_configured') }));
        return false;
      }

      const reg = await getRegistration();
      if (!reg) {
        setState((s) => ({ ...s, isPending: false, error: t('push_errors.not_ready') }));
        return false;
      }

      // Reuse an existing subscription if present, else create a new one.
      let pushSub = await reg.pushManager.getSubscription();
      if (!pushSub) {
        pushSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const json = pushSub.toJSON();
      const sendRes = await api.post('/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      if (!sendRes.success) {
        setState((s) => ({ ...s, isPending: false, error: t('push_errors.enable_failed') }));
        return false;
      }

      setState((s) => ({ ...s, isPending: false, isSubscribed: true, permission: 'granted', error: null }));
      return true;
    } catch {
      setState((s) => ({ ...s, isPending: false, error: t('push_errors.enable_failed') }));
      return false;
    }
  }, [t]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!SUPPORTED) return false;
    setState((s) => ({ ...s, isPending: true, error: null }));
    try {
      const reg = await getRegistration();
      const pushSub = await reg?.pushManager.getSubscription();
      const endpoint = pushSub?.endpoint;
      if (pushSub) {
        try { await pushSub.unsubscribe(); } catch { /* keep going — server cleanup still useful */ }
      }
      if (endpoint) {
        await api.post('/push/unsubscribe', { endpoint });
      }
      setState((s) => ({ ...s, isPending: false, isSubscribed: false, error: null }));
      return true;
    } catch {
      setState((s) => ({ ...s, isPending: false, error: t('push_errors.disable_failed') }));
      return false;
    }
  }, [t]);

  return { ...state, subscribe, unsubscribe, refresh };
}

export default useWebPush;
