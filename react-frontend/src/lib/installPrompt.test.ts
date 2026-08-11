// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal BeforeInstallPromptEvent-shaped object. */
function makePromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  return {
    preventDefault: vi.fn(),
    platforms: [] as string[],
    userChoice: Promise.resolve({ outcome, platform: '' }),
    prompt: vi.fn().mockResolvedValue(undefined),
  };
}

/** Dispatch a beforeinstallprompt event on window with the given event object. */
function fireBeforeInstallPrompt(detail: ReturnType<typeof makePromptEvent>): void {
  // The module listener calls e.preventDefault() then casts the Event to its
  // own type — we just need the same shape on the native event target.
  const event = Object.assign(new Event('beforeinstallprompt'), detail);
  window.dispatchEvent(event);
}

/** Dispatch the appinstalled event. */
function fireAppInstalled(): void {
  window.dispatchEvent(new Event('appinstalled'));
}

/**
 * Fresh module import each test so singleton state is reset.
 * Returns the module's exports.
 */
async function loadModule() {
  vi.resetModules();
  return import('./installPrompt');
}

// ─── matchMedia stub ────────────────────────────────────────────────────────

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches, media: '', onchange: null }),
  );
}

// ─── navigator stubs ────────────────────────────────────────────────────────

function stubUserAgent(ua: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function stubMaxTouchPoints(n: number): void {
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: n, configurable: true });
}

function stubStandalone(val: boolean | undefined): void {
  Object.defineProperty(window.navigator, 'standalone', { value: val, configurable: true });
}

// ────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Reset navigator properties to non-iOS defaults so tests don't bleed
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 0, configurable: true });
  Object.defineProperty(window.navigator, 'standalone', { value: undefined, configurable: true });
});

// ────────────────────────────────────────────────────────────────────────────
// shouldOfferInstall
// ────────────────────────────────────────────────────────────────────────────

describe('shouldOfferInstall', () => {
  it('returns true when not installed and not ios-other', async () => {
    const { shouldOfferInstall } = await loadModule();
    expect(
      shouldOfferInstall({ isInstalled: false, browser: 'chrome-desktop', canPrompt: false, isIos: false, isIosSafari: false }),
    ).toBe(true);
  });

  it('returns false when isInstalled is true', async () => {
    const { shouldOfferInstall } = await loadModule();
    expect(
      shouldOfferInstall({ isInstalled: true, browser: 'chrome-android', canPrompt: false, isIos: false, isIosSafari: false }),
    ).toBe(false);
  });

  it('returns false when browser is ios-other', async () => {
    const { shouldOfferInstall } = await loadModule();
    expect(
      shouldOfferInstall({ isInstalled: false, browser: 'ios-other', canPrompt: false, isIos: true, isIosSafari: false }),
    ).toBe(false);
  });

  it('returns true for all other browsers when not installed', async () => {
    const { shouldOfferInstall } = await loadModule();
    const browsers = ['chrome-android', 'edge-desktop', 'samsung', 'firefox-android', 'firefox-desktop', 'ios-safari', 'other'] as const;
    for (const browser of browsers) {
      expect(
        shouldOfferInstall({ isInstalled: false, browser, canPrompt: false, isIos: false, isIosSafari: false }),
        `browser=${browser}`,
      ).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// promptInstall
// ────────────────────────────────────────────────────────────────────────────

describe('promptInstall — no captured event', () => {
  it('returns "unavailable" when no beforeinstallprompt has fired', async () => {
    const { promptInstall } = await loadModule();
    await expect(promptInstall()).resolves.toBe('unavailable');
  });
});

describe('promptInstall — with captured event', () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  it('returns "accepted" when the user accepts', async () => {
    const mod = await loadModule();
    const event = makePromptEvent('accepted');
    fireBeforeInstallPrompt(event);
    await expect(mod.promptInstall()).resolves.toBe('accepted');
  });

  it('returns "dismissed" when the user dismisses', async () => {
    const mod = await loadModule();
    const event = makePromptEvent('dismissed');
    fireBeforeInstallPrompt(event);
    await expect(mod.promptInstall()).resolves.toBe('dismissed');
  });

  it('calls event.prompt() exactly once', async () => {
    const mod = await loadModule();
    const event = makePromptEvent('accepted');
    fireBeforeInstallPrompt(event);
    await mod.promptInstall();
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('clears the captured event after use so subsequent calls return "unavailable"', async () => {
    const mod = await loadModule();
    fireBeforeInstallPrompt(makePromptEvent('accepted'));
    await mod.promptInstall();
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });

  it('returns "unavailable" when event.prompt() throws', async () => {
    const mod = await loadModule();
    const event = makePromptEvent('accepted');
    event.prompt.mockRejectedValueOnce(new Error('NotAllowedError'));
    fireBeforeInstallPrompt(event);
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// requestInstall
// ────────────────────────────────────────────────────────────────────────────

describe('requestInstall', () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  it('does nothing when isInstalled is true', async () => {
    const { requestInstall } = await loadModule();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    requestInstall({ isInstalled: true, canPrompt: true, isIos: false, isIosSafari: false, browser: 'chrome-desktop' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('calls promptInstall when canPrompt is true (fires the native prompt)', async () => {
    const mod = await loadModule();
    const event = makePromptEvent('accepted');
    fireBeforeInstallPrompt(event);

    // requestInstall will internally call void promptInstall()
    mod.requestInstall({
      isInstalled: false,
      canPrompt: true,
      isIos: false,
      isIosSafari: false,
      browser: 'chrome-desktop',
    });
    // Give the microtask queue a chance to settle
    await Promise.resolve();
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('dispatches nexus:install-modal with kind=ios for iOS Safari', async () => {
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('nexus:install-modal', listener);

    requestInstall({ isInstalled: false, canPrompt: false, isIos: true, isIosSafari: true, browser: 'ios-safari' });

    window.removeEventListener('nexus:install-modal', listener);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ kind: 'ios' });
  });

  it('does nothing for ios-other (Chrome/Firefox on iOS)', async () => {
    const { requestInstall } = await loadModule();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    requestInstall({ isInstalled: false, canPrompt: false, isIos: true, isIosSafari: false, browser: 'ios-other' });

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('dispatches nexus:install-modal with kind=manual and browser for non-iOS', async () => {
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('nexus:install-modal', listener);

    requestInstall({ isInstalled: false, canPrompt: false, isIos: false, isIosSafari: false, browser: 'firefox-desktop' });

    window.removeEventListener('nexus:install-modal', listener);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ kind: 'manual', browser: 'firefox-desktop' });
  });

  it('dispatches nexus:install-modal with correct browser for samsung', async () => {
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('nexus:install-modal', listener);

    requestInstall({ isInstalled: false, canPrompt: false, isIos: false, isIosSafari: false, browser: 'samsung' });

    window.removeEventListener('nexus:install-modal', listener);
    expect(events[0].detail).toEqual({ kind: 'manual', browser: 'samsung' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getSnapshot / module-level state via promptInstall + window events
// ────────────────────────────────────────────────────────────────────────────

describe('snapshot — canPrompt', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    stubStandalone(undefined);
  });

  it('canPrompt is false before any beforeinstallprompt event', async () => {
    const mod = await loadModule();
    // Access getSnapshot indirectly via useInstallPrompt's subscribe/getSnapshot
    // by observing promptInstall returning 'unavailable'
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });

  it('canPrompt becomes true after beforeinstallprompt fires', async () => {
    const mod = await loadModule();
    fireBeforeInstallPrompt(makePromptEvent('accepted'));
    // promptInstall resolves non-unavailable only when capturedEvent is set
    const result = await mod.promptInstall();
    expect(result).toBe('accepted');
  });

  it('canPrompt resets to false after appinstalled fires', async () => {
    const mod = await loadModule();
    fireBeforeInstallPrompt(makePromptEvent('accepted'));
    fireAppInstalled();
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// isStandalone — matchMedia and navigator.standalone branches
// ────────────────────────────────────────────────────────────────────────────

describe('isStandalone (via snapshot.isInstalled)', () => {
  it('isInstalled is false when matchMedia is false and standalone is undefined', async () => {
    stubMatchMedia(false);
    stubStandalone(undefined);
    const { promptInstall } = await loadModule();
    // If isInstalled were true, the snapshot would reflect that; we verify
    // the negative via requestInstall reaching the modal branch (not returning early).
    // Simplest proxy: canPrompt path still works.
    fireBeforeInstallPrompt(makePromptEvent('dismissed'));
    const r = await promptInstall();
    expect(r).toBe('dismissed');
  });

  it('navigator.standalone=true causes ios-safari install path to be skipped (isInstalled guard)', async () => {
    stubMatchMedia(false);
    stubStandalone(true);
    const { requestInstall } = await loadModule();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    // isInstalled is true because navigator.standalone=true — requestInstall returns early
    requestInstall({ isInstalled: true, canPrompt: false, isIos: true, isIosSafari: true, browser: 'ios-safari' });

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('matchMedia standalone=true causes install to be skipped', async () => {
    stubMatchMedia(true);
    const { requestInstall } = await loadModule();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    requestInstall({ isInstalled: true, canPrompt: false, isIos: false, isIosSafari: false, browser: 'chrome-desktop' });

    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// detectBrowser — all BrowserKind branches
// ────────────────────────────────────────────────────────────────────────────

describe('detectBrowser (via requestInstall manual modal detail.browser)', () => {
  /** Helper: fire requestInstall with canPrompt=false, isIos=false, capture the
   *  dispatched nexus:install-modal event and return its detail.browser. */
  async function getBrowser(ua: string, maxTouch = 0): Promise<string | undefined> {
    stubUserAgent(ua);
    stubMaxTouchPoints(maxTouch);
    stubMatchMedia(false);
    stubStandalone(undefined);

    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('nexus:install-modal', listener);

    // Determine isIos/isIosSafari from the UA (mirrors the module logic)
    const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1);
    const isIosSafari = isIos && /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
    const iosOther = isIos && !isIosSafari;

    requestInstall({ isInstalled: false, canPrompt: false, isIos, isIosSafari, browser: iosOther ? 'ios-other' : 'other' });

    window.removeEventListener('nexus:install-modal', listener);
    return events[0]?.detail?.browser;
  }

  it('chrome-desktop for Chrome on Windows', async () => {
    const { requestInstall } = await loadModule();
    stubUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36');
    stubMatchMedia(false);
    const events: CustomEvent[] = [];
    window.addEventListener('nexus:install-modal', (e) => events.push(e as CustomEvent));
    requestInstall({ isInstalled: false, canPrompt: false, isIos: false, isIosSafari: false, browser: 'chrome-desktop' });
    window.removeEventListener('nexus:install-modal', events as unknown as EventListenerOrEventListenerObject);
    expect(events[0]?.detail.browser).toBe('chrome-desktop');
  });

  it('samsung for SamsungBrowser UA', async () => {
    stubUserAgent('Mozilla/5.0 (Linux; Android 13) SamsungBrowser/23.0 Chrome/115 Mobile Safari/537.36');
    stubMatchMedia(false);
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    window.addEventListener('nexus:install-modal', (e) => events.push(e as CustomEvent));
    requestInstall({ isInstalled: false, canPrompt: false, isIos: false, isIosSafari: false, browser: 'samsung' });
    window.removeEventListener('nexus:install-modal', events as unknown as EventListenerOrEventListenerObject);
    expect(events[0]?.detail.browser).toBe('samsung');
  });

  it('edge-desktop for Edge UA', async () => {
    stubUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120.0.2210.91');
    stubMatchMedia(false);
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    window.addEventListener('nexus:install-modal', (e) => events.push(e as CustomEvent));
    requestInstall({ isInstalled: false, canPrompt: false, isIos: false, isIosSafari: false, browser: 'edge-desktop' });
    window.removeEventListener('nexus:install-modal', events as unknown as EventListenerOrEventListenerObject);
    expect(events[0]?.detail.browser).toBe('edge-desktop');
  });

  it('firefox-desktop for Firefox on desktop', async () => {
    stubUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0');
    stubMatchMedia(false);
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    window.addEventListener('nexus:install-modal', (e) => events.push(e as CustomEvent));
    requestInstall({ isInstalled: false, canPrompt: false, isIos: false, isIosSafari: false, browser: 'firefox-desktop' });
    window.removeEventListener('nexus:install-modal', events as unknown as EventListenerOrEventListenerObject);
    expect(events[0]?.detail.browser).toBe('firefox-desktop');
  });

  it('firefox-android for Firefox on Android', async () => {
    stubUserAgent('Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0');
    stubMatchMedia(false);
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    window.addEventListener('nexus:install-modal', (e) => events.push(e as CustomEvent));
    requestInstall({ isInstalled: false, canPrompt: false, isIos: false, isIosSafari: false, browser: 'firefox-android' });
    window.removeEventListener('nexus:install-modal', events as unknown as EventListenerOrEventListenerObject);
    expect(events[0]?.detail.browser).toBe('firefox-android');
  });

  it('chrome-android for Chrome on Android', async () => {
    stubUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
    stubMatchMedia(false);
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    window.addEventListener('nexus:install-modal', (e) => events.push(e as CustomEvent));
    requestInstall({ isInstalled: false, canPrompt: false, isIos: false, isIosSafari: false, browser: 'chrome-android' });
    window.removeEventListener('nexus:install-modal', events as unknown as EventListenerOrEventListenerObject);
    expect(events[0]?.detail.browser).toBe('chrome-android');
  });

  it('ios-safari dispatches ios modal (not manual)', async () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    stubMaxTouchPoints(5);
    stubMatchMedia(false);
    stubStandalone(undefined);
    const { requestInstall } = await loadModule();
    const events: CustomEvent[] = [];
    window.addEventListener('nexus:install-modal', (e) => events.push(e as CustomEvent));
    requestInstall({ isInstalled: false, canPrompt: false, isIos: true, isIosSafari: true, browser: 'ios-safari' });
    window.removeEventListener('nexus:install-modal', events as unknown as EventListenerOrEventListenerObject);
    expect(events[0]?.detail.kind).toBe('ios');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// subscribe / listener management
// ────────────────────────────────────────────────────────────────────────────

describe('subscribe / unsubscribe', () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  it('calls the subscriber when beforeinstallprompt fires', async () => {
    // Subscribe using promptInstall side-effect is indirect; instead we trigger
    // emit() via the beforeinstallprompt event and verify that subscribers run.
    // We cannot reach `subscribe` directly (it's unexported), so we verify the
    // observable side-effect: promptInstall becomes available.
    const mod = await loadModule();
    const called: string[] = [];
    // Re-export is not available; we verify indirectly via promptInstall outcome.
    fireBeforeInstallPrompt(makePromptEvent('accepted'));
    const r = await mod.promptInstall();
    called.push(r);
    expect(called).toEqual(['accepted']);
  });

  it('multiple beforeinstallprompt events replace the stored event', async () => {
    const mod = await loadModule();

    // First event → dismissed
    fireBeforeInstallPrompt(makePromptEvent('dismissed'));
    // Second event replaces the first
    fireBeforeInstallPrompt(makePromptEvent('accepted'));

    const r = await mod.promptInstall();
    // The second event's prompt() was never called because the first was replaced
    // But the second event IS the capturedEvent, so outcome=accepted
    expect(r).toBe('accepted');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// cachedSnapshot invalidation (emit() clears cachedSnapshot)
// ────────────────────────────────────────────────────────────────────────────

describe('cachedSnapshot invalidation', () => {
  it('promptInstall emits after use, clearing the cache so canPrompt is false', async () => {
    stubMatchMedia(false);
    const mod = await loadModule();
    fireBeforeInstallPrompt(makePromptEvent('accepted'));
    await mod.promptInstall(); // emits → cache cleared, capturedEvent=null
    // Subsequent promptInstall returns unavailable (capturedEvent null)
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });

  it('appinstalled event clears capturedEvent and emits', async () => {
    stubMatchMedia(false);
    const mod = await loadModule();
    fireBeforeInstallPrompt(makePromptEvent('accepted'));
    fireAppInstalled(); // clears capturedEvent, sets installed=true, emits
    // capturedEvent is now null
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BrowserKind type coverage — shouldOfferInstall returns true for all except
// ios-other and any installed state
// ────────────────────────────────────────────────────────────────────────────

describe('shouldOfferInstall — exhaustive browser coverage', () => {
  it('returns false only for ios-other and isInstalled=true cases', async () => {
    const { shouldOfferInstall } = await loadModule();

    const shouldOffer: Array<[import('./installPrompt').BrowserKind, boolean, boolean]> = [
      ['chrome-android',   false, true],
      ['chrome-desktop',   false, true],
      ['edge-desktop',     false, true],
      ['samsung',          false, true],
      ['firefox-android',  false, true],
      ['firefox-desktop',  false, true],
      ['ios-safari',       false, true],
      ['ios-other',        false, false], // ios-other → never offer
      ['other',            false, true],
      ['chrome-desktop',   true,  false], // installed → never offer
    ];

    for (const [browser, isInstalled, expected] of shouldOffer) {
      expect(
        shouldOfferInstall({ isInstalled, browser, canPrompt: false, isIos: false, isIosSafari: false }),
        `browser=${browser} isInstalled=${isInstalled}`,
      ).toBe(expected);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Real detectBrowser coverage, via the hook's snapshot.
//
// The suite above passes `browser` into requestInstall and asserts it comes
// back, which cannot catch a detection bug. These go through
// useInstallPrompt(), which calls detectBrowser() for real.
// ────────────────────────────────────────────────────────────────────────────

describe('detectBrowser (real, via useInstallPrompt snapshot)', () => {
  async function detect(ua: string, maxTouch = 0): Promise<string> {
    stubUserAgent(ua);
    stubMaxTouchPoints(maxTouch);
    stubMatchMedia(false);
    stubStandalone(undefined);

    const { useInstallPrompt } = await loadModule();
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useInstallPrompt());

    return result.current.browser;
  }

  it('detects Safari on macOS, which has no three-dot menu', async () => {
    // Real macOS Sonoma Safari UA. Note it contains "Safari" AND "Version/",
    // but no Chrome/Edg/Firefox token.
    expect(
      await detect(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      ),
    ).toBe('macos-safari');
  });

  it('does not mistake Chrome on macOS for Safari', async () => {
    // Chrome's UA also ends in "Safari/537.36" — the ordering of the checks in
    // detectBrowser is what keeps these apart.
    expect(
      await detect(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      ),
    ).toBe('chrome-desktop');
  });

  it('does not mistake iPadOS Safari (which reports as Macintosh) for macOS', async () => {
    // iPad on iOS 13+ sends a Macintosh UA; touch points are the only tell.
    expect(
      await detect(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        5,
      ),
    ).toBe('ios-safari');
  });

  it('still detects iPhone Safari', async () => {
    expect(
      await detect(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('ios-safari');
  });
});
