// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * URL validation utilities for preventing open redirect and XSS vulnerabilities
 */

/**
 * Validates that an image URL uses a safe scheme (http or https only)
 * Prevents XSS attacks via javascript:, data:, or other dangerous URL schemes
 *
 * @param {string} url - The image URL to validate
 * @returns {string|null} - Safe URL or null if invalid
 */
function validateImageUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim();

  if (!trimmed) {
    return null;
  }

  // Allow relative URLs starting with /
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }

  // Only allow http:// and https:// schemes
  const lowerUrl = trimmed.toLowerCase();
  if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    return trimmed;
  }

  // Block all other schemes (javascript:, data:, vbscript:, etc.)
  return null;
}

/**
 * Validates that a return URL is safe (relative path only)
 * Prevents open redirect attacks by ensuring the URL:
 * - Starts with / (relative path)
 * - Does not start with // (protocol-relative URL)
 * - Does not contain :// (absolute URL)
 *
 * @param {string} url - The URL to validate
 * @param {string} fallback - The fallback URL if validation fails
 * @returns {string} - Safe URL or fallback
 */
function validateReturnUrl(url, fallback = '/') {
  if (!url || typeof url !== 'string') {
    return fallback;
  }

  // Trim whitespace
  const trimmed = url.trim();

  // Must start with / to be a relative path
  if (!trimmed.startsWith('/')) {
    return fallback;
  }

  // Must not be a protocol-relative URL (//example.com)
  if (trimmed.startsWith('//')) {
    return fallback;
  }

  // Must not contain protocol (http://, https://, javascript:, etc.)
  if (trimmed.includes('://') || trimmed.toLowerCase().includes('javascript:')) {
    return fallback;
  }

  // Decode repeatedly so encoded and double-encoded protocol-relative paths
  // cannot become an external redirect after a browser or proxy normalizes
  // the Location header. Malformed escapes are rejected rather than thrown.
  let decoded = trimmed;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return fallback;
  }

  if (
    !decoded.startsWith('/')
    || decoded.startsWith('//')
    || decoded.includes('\\')
    || decoded.includes('://')
    || Array.from(decoded).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    return fallback;
  }

  return trimmed;
}

module.exports = {
  validateReturnUrl,
  validateImageUrl
};
