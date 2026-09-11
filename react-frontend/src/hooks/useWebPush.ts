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
