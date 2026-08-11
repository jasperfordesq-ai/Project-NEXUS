// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PWA install prompt singleton.
 *
 * Captures the `beforeinstallprompt` event at module load (imported once from
 * main.tsx) so it isn't lost — Chrome only fires the event once per page load
 * and doesn't fire it again, so we MUST capture eagerly. Subscribers (the
 * useInstallPrompt hook) read the captured value via getSnapshot.
 */

import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

let capturedEvent: BeforeInstallPromptEvent | null = null;
let installed = false;
let cachedSnapshot: InstallPromptState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  cachedSnapshot = null;
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    capturedEvent = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    capturedEvent = null;
    installed = true;
    emit();
  });
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari exposes this non-standard flag when launched from the home screen.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIos(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  // iPad on iOS 13+ reports as Mac — also check touch points to distinguish.
  const isIpadOS = /Macintosh/.test(ua) && (window.navigator.maxTouchPoints ?? 0) > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIpadOS;
}

function isSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
}

export type BrowserKind =
  | 'chrome-android'
  | 'chrome-desktop'
  | 'edge-desktop'
  | 'samsung'
  | 'firefox-android'
  | 'firefox-desktop'
  | 'ios-safari'
  | 'ios-other'
  | 'macos-safari'
  | 'other';

function detectBrowser(): BrowserKind {
  if (typeof window === 'undefined') return 'other';
  const ua = window.navigator.userAgent;
  if (isIos()) return isSafari() ? 'ios-safari' : 'ios-other';
  const isAndroid = /Android/.test(ua);
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/EdgA?\//.test(ua)) return 'edge-desktop';
  if (/FxiOS|Firefox/.test(ua)) return isAndroid ? 'firefox-android' : 'firefox-desktop';
  if (/Chrome|CriOS/.test(ua)) return isAndroid ? 'chrome-android' : 'chrome-desktop';
  // Safari on macOS. Must come AFTER the Chrome/Edge/Firefox checks, because
  // every one of those puts "Safari" in its user agent too. Reached only when
  // isIos() was false, so this is desktop Safari, not iPadOS.
  //
  // It matters because Safari never fires `beforeinstallprompt`, so it always
  // lands on the manual-instructions modal — and the generic copy told people
  // to open a "three-dot menu" that Safari does not have. Safari 17+ on macOS
  // Sonoma installs via Share → Add to Dock.
  if (isSafari()) return 'macos-safari';
  return 'other';
}

export interface InstallPromptState {
  /** Native prompt is available — call promptInstall() to show it. */
  canPrompt: boolean;
  /** Browser is iOS/iPadOS — show manual "Add to Home Screen" instructions. */
  isIos: boolean;
  /** App is currently running in standalone/installed mode. */
  isInstalled: boolean;
  /** Browser is iOS Safari specifically (the only iOS browser that can install). */
  isIosSafari: boolean;
  /** Coarse browser identification for tailored install instructions. */
  browser: BrowserKind;
}

function getSnapshot(): InstallPromptState {
  // useSyncExternalStore compares snapshots by Object.is — must return a stable
  // reference until emit() invalidates the cache, otherwise React re-renders
  // every tick and trips the max-update-depth guard.
  if (cachedSnapshot) return cachedSnapshot;
  cachedSnapshot = {
    canPrompt: capturedEvent !== null && !installed,
    isIos: isIos(),
    isInstalled: installed || isStandalone(),
    isIosSafari: isIos() && isSafari(),
    browser: detectBrowser(),
  };
  return cachedSnapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * High-level "user clicked Install" trigger. Routes to the right path based
 * on browser capability:
 *   - native prompt available → fire it
 *   - iOS Safari → request the iOS instructions modal
 *   - everything else → request the generic manual-instructions modal
 *
 * Modals are rendered by `<InstallModalHost />` at the Layout level so they
 * survive when their trigger (drawer item, dropdown item) unmounts on close.
 */
export function requestInstall(state: InstallPromptState): void {
  if (state.isInstalled) return;
  if (state.canPrompt) {
    void promptInstall();
    return;
  }
  if (state.isIosSafari) {
    window.dispatchEvent(new CustomEvent('nexus:install-modal', { detail: { kind: 'ios' } }));
    return;
  }
  if (state.browser === 'ios-other') return;
  window.dispatchEvent(
    new CustomEvent('nexus:install-modal', { detail: { kind: 'manual', browser: state.browser } }),
  );
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!capturedEvent) return 'unavailable';
  try {
    await capturedEvent.prompt();
    const { outcome } = await capturedEvent.userChoice;
    // Per spec, the event can only be used once.
    capturedEvent = null;
    emit();
    return outcome;
  } catch {
    return 'unavailable';
  }
}

export function useInstallPrompt(): InstallPromptState & { promptInstall: typeof promptInstall } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...state, promptInstall };
}

/**
 * True whenever the app isn't already installed. We always offer the entry so
 * users on Chrome (which only fires `beforeinstallprompt` opportunistically),
 * iOS Safari, and other browsers all see a discoverable install affordance.
 * The click handler degrades to a manual-instructions modal when no native
 * prompt is captured.
 *
 * We hide the entry on `ios-other` (Chrome/Firefox on iOS) because iOS only
 * lets Safari add to home screen — pointing those users at instructions they
 * can't follow is worse than hiding it.
 */
export function shouldOfferInstall(state: InstallPromptState): boolean {
  if (state.isInstalled) return false;
  if (state.browser === 'ios-other') return false;
  return true;
}
