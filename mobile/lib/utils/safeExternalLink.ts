// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const NATIVE_WEB_HOST = 'app.project-nexus.ie';

/**
 * Allow a promotional call-to-action to leave the app only when it is a plain
 * HTTPS URL on a public-looking DNS host. Internal Project NEXUS links continue
 * through the native route mapper instead.
 */
export function isSafeExternalBrowserLink(link: string): boolean {
  try {
    const url = new URL(link);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol !== 'https:' || hostname === NATIVE_WEB_HOST) return false;
    if (url.username || url.password || url.port || url.hash) return false;
    if (hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname.endsWith('.internal')) return false;

    // Campaign destinations must use a DNS name. Rejecting literal IPs avoids
    // loopback/private/link-local targets without relying on device DNS state.
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) return false;

    return hostname.includes('.');
  } catch {
    return false;
  }
}
