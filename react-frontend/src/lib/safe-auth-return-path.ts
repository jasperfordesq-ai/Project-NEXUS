// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Only root-relative local paths may be followed after authentication. */
export function safeAuthReturnPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  // Reject browser URL normalization tricks, including encoded slash/backslash
  // and control characters. Nested percent encoding is not a return-path need.
  if (Array.from(value).some(character => character.charCodeAt(0) <= 32) || value.includes('\\')
    || /%(?:25|2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(value)) return fallback;
  try {
    const parsed = new URL(value, 'https://auth-return.invalid');
    return parsed.origin === 'https://auth-return.invalid' ? value : fallback;
  } catch { return fallback; }
}
