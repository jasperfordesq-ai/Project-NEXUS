// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

type Breadcrumb = (
  message: string,
  category: string,
  data: Record<string, unknown>,
  level?: 'info' | 'warning' | 'error',
) => void;

interface ServiceWorkerLifecycleOptions {
  breadcrumb: Breadcrumb;
  schedule: (callback: () => void) => void;
  documentRef?: Document;
  navigatorRef?: Navigator;
  windowRef?: Window;
  /** Test seam; production uses location.replace with an href fallback. */
  reload?: (url: string) => void;
  now?: () => number;
  updateIntervalMs?: number;
  deferredReloadMs?: number;
}

/**
 * Sign-in, registration, password and two-factor pages. A focused field there is
 * not work worth protecting, and a stale bundle on one of them is exactly the
 * failure this lifecycle exists to prevent: on 12 September 2026 the previous
 * bundle could not read the new two-factor sign-in answer, the new worker had
 * activated, and its reload sat deferred behind the cursor in the password
 * field until the owner gave up and restarted the browser.
 */
export function isAuthenticationPage(pathname: string): boolean {
  return /(^|\/)(login|register|verify-email|verify-identity|password|auth)(\/|$)/.test(pathname);
}

function isUserEditing(documentRef: Document): boolean {
  const element = documentRef.activeElement as HTMLElement | null;
  if (!element || element === documentRef.body) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return true;
  if (element.isContentEditable) return true;
  return Boolean(element.closest?.('[contenteditable="true"]'));
}

/**
 * Install update handling around the generated Workbox worker.
 *
 * A controller change proves that a new worker has activated. Reloads happen
 * immediately unless the user is editing, in which case the next natural
 * break-point (blur/tab hide/page hide) wins, with a bounded ceiling.
 */
export function installServiceWorkerLifecycle({
  breadcrumb,
  schedule,
  documentRef = document,
  navigatorRef = navigator,
  windowRef = window,
  reload,
  now = Date.now,
  updateIntervalMs = 5 * 60 * 1000,
  deferredReloadMs = 5 * 60 * 1000,
}: ServiceWorkerLifecycleOptions): () => void {
  const serviceWorker = navigatorRef.serviceWorker;
  if (!serviceWorker) return () => undefined;

  let refreshing = false;
  let deferred = false;
  let updateTimer: number | undefined;
  let deferredTimer: number | undefined;
  let editingElement: HTMLElement | null = null;

  const performReload = (reason: string) => {
    if (refreshing) return;
    refreshing = true;
    breadcrumb('SW controllerchange — reloading', 'pwa', { reason }, 'info');
    const url = new URL(windowRef.location.href);
    url.searchParams.set('nexus_refresh', String(now()));

    if (reload) {
      reload(url.href);
      return;
    }

    try {
      windowRef.location.replace(url.href);
    } catch {
      windowRef.location.href = url.href;
    }
  };

  const clearDeferredListeners = () => {
    if (deferredTimer !== undefined) windowRef.clearTimeout(deferredTimer);
    editingElement?.removeEventListener('blur', onBlur);
    documentRef.removeEventListener('visibilitychange', onVisibilityChange);
    windowRef.removeEventListener('pagehide', onPageHide);
    deferredTimer = undefined;
    editingElement = null;
    deferred = false;
  };

  const finishDeferredReload = (reason: string) => {
    clearDeferredListeners();
    performReload(reason);
  };
  const onBlur = () => finishDeferredReload('deferred-blur');
  const onVisibilityChange = () => {
    if (documentRef.visibilityState === 'hidden') {
      finishDeferredReload('deferred-tab-hidden');
    }
  };
  const onPageHide = () => finishDeferredReload('deferred-pagehide');

  const onControllerChange = () => {
    if (refreshing || deferred) return;
    if (!isUserEditing(documentRef)) {
      performReload('immediate');
      return;
    }
    if (isAuthenticationPage(windowRef.location?.pathname ?? '')) {
      performReload('immediate-auth-page');
      return;
    }

    deferred = true;
    breadcrumb('SW controllerchange — reload deferred (user editing)', 'pwa', {}, 'info');
    editingElement = documentRef.activeElement as HTMLElement | null;
    editingElement?.addEventListener('blur', onBlur, { once: true });
    documentRef.addEventListener('visibilitychange', onVisibilityChange);
    windowRef.addEventListener('pagehide', onPageHide, { once: true });
    deferredTimer = windowRef.setTimeout(
      () => finishDeferredReload('deferred-ceiling'),
      deferredReloadMs,
    );
  };

  serviceWorker.addEventListener('controllerchange', onControllerChange);

  const onVisible = () => {
    if (documentRef.visibilityState === 'visible') {
      void serviceWorker.getRegistration().then((registration) => registration?.update()).catch(() => undefined);
    }
  };

  schedule(() => {
    void serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).then((registration) => {
      const update = () => { void registration.update().catch(() => undefined); };
      updateTimer = windowRef.setInterval(update, updateIntervalMs);
      documentRef.addEventListener('visibilitychange', onVisible);
    }).catch(() => undefined);
  });

  return () => {
    clearDeferredListeners();
    serviceWorker.removeEventListener('controllerchange', onControllerChange);
    documentRef.removeEventListener('visibilitychange', onVisible);
    if (updateTimer !== undefined) windowRef.clearInterval(updateTimer);
  };
}

