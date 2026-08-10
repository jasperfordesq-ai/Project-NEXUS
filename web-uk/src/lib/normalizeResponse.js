// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Normalize API response keys from camelCase to snake_case for consistent template access.
 * This eliminates the need for `event.startsAt or event.starts_at` fallbacks in templates.
 *
 * @param {Object|Array} data - API response data
 * @returns {Object|Array} Normalized data with snake_case keys added alongside camelCase
 */
function normalizeResponse(data) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(normalizeResponse);
  if (typeof data !== 'object') return data;
  // Avoid normalising Date objects or other special types
  if (data instanceof Date) return data;

  const result = {};

  for (const [key, value] of Object.entries(data)) {
    // Keep original key
    result[key] = normalizeResponse(value);

    // Add snake_case version if key is camelCase
    const snakeKey = camelToSnake(key);
    if (snakeKey !== key) {
      result[snakeKey] = result[key];
    }
  }

  return result;
}

/**
 * Convert camelCase string to snake_case
 * @param {string} str
 * @returns {string}
 */
function camelToSnake(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

module.exports = { normalizeResponse };
