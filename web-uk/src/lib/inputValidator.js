// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Input validation utilities for server-side validation
 * Complements client-side validation with server-side checks
 */

/**
 * Validates and sanitizes a page number from query parameters
 * @param {string|number} page - The page value from query params
 * @param {number} defaultPage - Default page if invalid (default: 1)
 * @param {number} maxPage - Maximum allowed page (default: 10000)
 * @returns {number} - Valid page number
 */
function validatePageNumber(page, defaultPage = 1, maxPage = 10000) {
  const parsed = parseInt(page, 10);
  if (isNaN(parsed) || parsed < 1) {
    return defaultPage;
  }
  return Math.min(parsed, maxPage);
}

/**
 * Validates an email address format
 * @param {string} email - The email to validate
 * @returns {boolean} - True if valid email format
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  // RFC 5322 compliant email regex (simplified)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validates a string length is within bounds
 * @param {string} value - The string to validate
 * @param {number} minLength - Minimum length (default: 1)
 * @param {number} maxLength - Maximum length (default: 255)
 * @returns {boolean} - True if valid length
 */
function isValidLength(value, minLength = 1, maxLength = 255) {
  if (!value || typeof value !== 'string') {
    return minLength === 0;
  }
  const trimmed = value.trim();
  return trimmed.length >= minLength && trimmed.length <= maxLength;
}

/**
 * Validates a value against an allowed list (enum validation)
 * @param {string} value - The value to validate
 * @param {string[]} allowedValues - Array of allowed values
 * @param {boolean} allowEmpty - Whether empty/null values are allowed (default: true)
 * @returns {boolean} - True if valid
 */
function isValidEnum(value, allowedValues, allowEmpty = true) {
  if (!value || value === '') {
    return allowEmpty;
  }
  return allowedValues.includes(value);
}

/**
 * Validates a positive integer within bounds
 * @param {string|number} value - The value to validate
 * @param {number} min - Minimum value (default: 0)
 * @param {number} max - Maximum value (default: Number.MAX_SAFE_INTEGER)
 * @returns {boolean} - True if valid
 */
function isValidPositiveInt(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return false;
  }
  return parsed >= min && parsed <= max;
}

/**
 * Sanitizes a string by trimming and removing control characters
 * @param {string} value - The string to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeString(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  // Remove control characters except newlines and tabs
  // eslint-disable-next-line no-control-regex
  return value.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Validates a slug format (lowercase alphanumeric with hyphens)
 * @param {string} slug - The slug to validate
 * @returns {boolean} - True if valid slug format
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') {
    return false;
  }
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return slugRegex.test(slug.trim());
}

/**
 * Creates a validation result object
 * @param {boolean} isValid - Whether validation passed
 * @param {string} field - The field name
 * @param {string} message - Error message if invalid
 * @returns {Object} - Validation result
 */
function validationResult(isValid, field, message) {
  return {
    isValid,
    field,
    message: isValid ? null : message
  };
}

/**
 * Collects validation errors into GOV.UK error format
 * @param {Object[]} results - Array of validation results
 * @returns {Object} - { errors: [], fieldErrors: {} }
 */
function collectErrors(results) {
  const errors = [];
  const fieldErrors = {};

  for (const result of results) {
    if (!result.isValid) {
      errors.push({ text: result.message, href: `#${result.field}` });
      fieldErrors[result.field] = result.message;
    }
  }

  return { errors, fieldErrors };
}

// Allowed values for common enums
const ALLOWED_USER_ROLES = ['member', 'moderator', 'admin', 'super_admin'];
const ALLOWED_USER_STATUSES = ['active', 'suspended', 'pending', 'inactive', 'banned', 'deactivated'];

module.exports = {
  validatePageNumber,
  isValidEmail,
  isValidLength,
  isValidEnum,
  isValidPositiveInt,
  sanitizeString,
  isValidSlug,
  validationResult,
  collectErrors,
  ALLOWED_USER_ROLES,
  ALLOWED_USER_STATUSES
};
