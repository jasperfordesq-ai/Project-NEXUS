// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Component, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// The heading typeface (warmth plan P4): Nunito, served from this site's own
// files — no request leaves for a font service. Each script's file is fetched
// only when a page uses it; scripts it does not cover (Arabic, Japanese) fall
// back to the device's own font through --font-display.
import '@fontsource-variable/nunito/wght.css';
import './index.css';
import i18n from './i18n'; // Initialize i18n before App renders
import type { ErrorInfo, ReactNode } from 'react';
import { queueSentryBreadcrumb } from '@/lib/telemetryQueue';
import { configureTenantManifestLink } from '@/lib/pwaManifest';
import { installServiceWorkerLifecycle } from '@/lib/serviceWorkerLifecycle';
import { requestStaleChunkRecovery } from '@/routes/lazyWithRetry';

configureTenantManifestLink();

// Log build version to console for deployment verification
console.info(`[NEXUS] Build: ${__BUILD_COMMIT__} | ${__BUILD_TIME__}`);

// Catch-all for stale dynamic-import chunks after a deploy. Vite dispatches
// `vite:preloadError` when a hashed chunk 404s (a client still on an old
// index.html requests a filename a newer build re-hashed). Route it through the
// same one-time reload-to-fresh-index recovery lazyWithRetry uses, so every raw
// React.lazy() call site that does NOT wrap its import (broker/caring/admin
// route bundles, etc.) is covered too. preventDefault() suppresses Vite's
// re-throw once we've scheduled the reload; unmatched errors fall through
// untouched to the error boundary.
window.addEventListener('vite:preloadError', (event) => {
  const payload = (event as Event & { payload?: unknown }).payload;
  if (requestStaleChunkRecovery(payload)) {
    event.preventDefault();
  }
});

// Initialize telemetry after first paint/idle. The local error boundary stays
// active immediately, but Sentry must not compete with login/register startup.
import { installSupportDiagnosticsCapture } from '@/lib/supportDiagnostics';
installSupportDiagnosticsCapture();

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
};

function runAfterFirstPaintIdle(callback: () => void): void {
  const scheduleIdle = () => {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(callback, { timeout: 5000 });
      return;
    }

    window.setTimeout(callback, 3000);
  };

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(scheduleIdle);
  });
}

function addTelemetryBreadcrumb(
  message: string,
  category: string,
  data: Record<string, unknown>,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  queueSentryBreadcrumb(message, category, data, level);
}

// Eagerly import the install prompt singleton so its `beforeinstallprompt`
// listener attaches before Chrome fires the event. The event only fires once
// per page load and is lost if no listener is registered in time.
import '@/lib/installPrompt';

// Register PWA service worker (production only — dev uses Vite HMR).
//
// We register manually instead of using vite-plugin-pwa's `registerSW()` so we
// can pass `updateViaCache: 'none'`. The default `'imports'` lets mobile Chrome
// serve scripts loaded via importScripts() from HTTP cache — the byte-for-byte
// update check sees no change and no waiting worker is ever installed.
// `'none'` bypasses the HTTP cache for both the top-level SW and any imports.
// See https://developer.chrome.com/blog/fresher-sw.
//
// The page reload happens in the `controllerchange` listener below —
// `controllerchange` is the only event that mathematically guarantees the new
// SW has assumed control. The reload is deferred when the user is mid-edit
// (focused inside an input / textarea / contenteditable) so we don't lose
// their work; the deferred reload then fires on the next blur, tab hide, or
// 5-minute ceiling. Linear / Notion / Slack all do this; the immediate
// reload variant interrupted users mid-typing.
if (import.meta.env.PROD) {
  installServiceWorkerLifecycle({
    breadcrumb: addTelemetryBreadcrumb,
    schedule: runAfterFirstPaintIdle,
  });
}

// One-shot cleanup: strip the `?nexus_refresh=…` cache-bust query param that
// the controllerchange reload added. Cosmetic only — it would otherwise
// linger in the address bar across navigations and look ugly when shared.
// `history.replaceState` doesn't fire popstate or trigger React Router so
// it's a pure URL rewrite. Same treatment for `?nexus_recovered=` from the
// /api/sw-reset recovery shell.
(() => {
  try {
    const url = new URL(window.location.href);
    const had = url.searchParams.has('nexus_refresh') || url.searchParams.has('nexus_recovered');
    if (!had) return;
    url.searchParams.delete('nexus_refresh');
    url.searchParams.delete('nexus_recovered');
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, document.title, next);
  } catch {
    // Cosmetic-only — never block boot on this.
  }
})();

class RootErrorBoundary extends Component<{
  children: ReactNode;
  fallback?: ReactNode;
}, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    void import('@/lib/sentry').then(({ captureSentryException }) => {
      captureSentryException(error, {
        componentStack: errorInfo.componentStack,
      });
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary fallback={<ErrorFallback />}>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </RootErrorBoundary>
  </StrictMode>
);

// Error fallback component
function ErrorFallback() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      textAlign: 'center',
      backgroundColor: 'var(--color-background, #0f172a)',
      color: 'var(--color-text, #e2e8f0)',
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
        {i18n.t('common:error_boundary.title')}
      </h1>
      <p style={{ marginBottom: '2rem', opacity: 0.8 }}>
        {i18n.t('common:error_boundary.description')}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: '0.75rem 1.5rem',
          backgroundColor: 'var(--color-primary, #6366f1)',
          color: 'white',
          border: 'none',
          borderRadius: '0.5rem',
          fontSize: '1rem',
          cursor: 'pointer',
        }}
      >
        {i18n.t('common:error_boundary.try_again')}
      </button>
    </div>
  );
}
