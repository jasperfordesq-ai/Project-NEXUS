// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * One rule for every Translate button on this site: is a refused translation
 * permanent (the community has none, switched it off, or AI is not set up) or a
 * passing fault worth trying again? Each route used to keep its own list, and
 * none knew TRANSLATION_NOT_SET_UP when the API started sending it (30 Oct 2026),
 * so a community without a key was told "try again later".
 */
const PERMANENT_CODES = new Set([
  'TRANSLATION_UNAVAILABLE',
  'TRANSLATION_DISABLED',
  'TRANSLATION_NOT_SET_UP',
  'AI_NOT_CONFIGURED',
  'AI_UNAVAILABLE'
]);

function translationErrorCode(error) {
  return String(error?.data?.code || error?.data?.errors?.[0]?.code || '').toUpperCase();
}

function isPermanentTranslationFailure(error) {
  const code = translationErrorCode(error);
  return PERMANENT_CODES.has(code) || code.includes('FEATURE_DISABLED');
}

function translationFailureStatus(error) {
  return isPermanentTranslationFailure(error) ? 'translate-unavailable' : 'translate-failed';
}

module.exports = { translationErrorCode, isPermanentTranslationFailure, translationFailureStatus };
