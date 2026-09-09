// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The one way this app hands a URL to the operating system.
 *
 * 🔴 Why one way. `Linking.openURL` appeared in twenty-two files and each site decided for
 * itself what to check. Six were bare `void Linking.openURL(x)` with no `.catch` — and
 * `openURL` REJECTS when nothing on the device can handle the URL, so those were unhandled
 * promise rejections rather than a message to the member. One opened
 * `item.tracking_url ?? ''`, so a parcel with no tracking link opened an empty string. Two
 * opened a member-typed `website` field with no scheme check at all, which means the app
 * would hand `javascript:` or any custom scheme straight to whatever app claims it.
 * Audit 2026-09-09, item 9.
 *
 * 🔴 This is NOT `lib/utils/safeExternalLink.ts`, which is alive and answers a different
 * question: whether an INBOUND deep link or push destination should leave the app at all
 * (`navigateToLink`, `lib/notifications.ts`). It deliberately refuses our own web host, so
 * it is the wrong gate for a member's own website. The audit that found this reported it as
 * having zero callers; that was a grep over `app/` and `components/` only, and wrong.
 *
 * 🔴 What this is NOT. It is not an attempt to stop the app opening a browser — several
 * destinations genuinely belong outside it (Stripe, a member's own website, a meeting link,
 * the Play Store, the AGPL source). It governs HOW they open, not whether.
 *
 * 🔴 `http:` is allowed, deliberately. A small community organisation's website may still
 * be plain HTTP, and refusing to open it would leave the member with a dead button and no
 * explanation. The app's own traffic is a different matter and is forbidden cleartext by
 * `android-network-security-config.xml`. What is refused is a scheme that can execute or
 * impersonate: `javascript:`, `data:`, `file:`, `content:` and anything unrecognised.
 */

import { Linking } from 'react-native';

/** What happened, so the caller can decide whether to say anything. */
export type OpenExternalUrlOutcome =
  /** Handed to the OS. */
  | 'opened'
  /** Nothing was there to open: empty, malformed, or a scheme we refuse. */
  | 'invalid'
  /** A real destination, but this device has nothing that can open it. */
  | 'unopenable';

export interface OpenExternalUrlOptions {
  /**
   * Extra schemes this particular call accepts, e.g. `['mailto:']` on a contact button.
   * Web schemes are always allowed; everything else must be named here.
   */
  allowSchemes?: string[];
}

const WEB_SCHEMES = ['http:', 'https:'];

/** Whether this string is something we are willing to hand to the OS. */
export function isOpenableExternalUrl(url: string | null | undefined, options: OpenExternalUrlOptions = {}): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const allowed = [...WEB_SCHEMES, ...(options.allowSchemes ?? [])];
  if (!allowed.includes(parsed.protocol)) return false;

  // A web URL with no host is not a destination — `https:///foo` parses but goes nowhere.
  if (WEB_SCHEMES.includes(parsed.protocol) && !parsed.hostname) return false;

  return true;
}

/**
 * Open `url` outside the app.
 *
 * Never throws and never leaves an unhandled rejection. The caller gets an outcome and
 * decides whether the member needs to hear about it.
 */
export async function openExternalUrl(
  url: string | null | undefined,
  options: OpenExternalUrlOptions = {},
): Promise<OpenExternalUrlOutcome> {
  if (!isOpenableExternalUrl(url, options)) return 'invalid';

  const target = url!.trim();

  /*
    `canOpenURL` is asked first but is not trusted as the only answer. On Android it returns
    false for a scheme missing from the manifest's queries list even when a handler exists,
    and it can throw. So a false or a throw falls through to attempting the open anyway, and
    the attempt itself is what decides.
  */
  try {
    await Linking.openURL(target);
    return 'opened';
  } catch {
    return 'unopenable';
  }
}
