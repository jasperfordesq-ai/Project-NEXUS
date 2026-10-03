// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Which modifier key the broker panel's shortcut hints should name.
 *
 * The header showed a fixed "⌘K" to every broker, including the Windows
 * majority whose key is Ctrl. Reads the client-hint platform first (the
 * modern API), then the legacy `navigator.platform`, and answers `false`
 * when neither exists so a test or server render never throws.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const platform = hinted || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}
