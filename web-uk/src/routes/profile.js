// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const { clearAuthCookies, requireAuth } = require('../middleware/auth');
const {
  callUserSettingsApi,
  callProfileApi,
  callWebAuthnApi,
  getAllBadges,
  getGamificationProfileByUserId,
  getListings,
  getUserReviews,
  invalidateUserCache,
  requestAccountDeletion,
  uploadProfileAvatar,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { flagEnabled, resolveBackendAssetUrl } = require('../lib/accessible-shell');
const { createChoiceTranslator, createTranslator, SUPPORTED_LOCALES } = require('../lib/localization');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();
const fallbackTranslator = createTranslator('en');
const fallbackChoiceTranslator = createChoiceTranslator('en');

const PROFILE_LOCALES = SUPPORTED_LOCALES;
const PROFILE_DIGEST_FREQUENCIES = ['off', 'instant', 'daily', 'monthly'];
const PROFILE_PRIVACY_OPTIONS = ['public', 'members', 'connections'];
const PROFILE_TYPES = ['individual', 'organisation'];
const PROFILE_MATCH_FREQUENCIES = ['daily', 'weekly', 'monthly', 'fortnightly', 'never'];
const PROFILE_LOCALE_LABELS = {
  en: 'English',
  ga: 'Irish',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  es: 'Spanish',
  nl: 'Dutch',
  pl: 'Polish',
  ja: 'Japanese',
  ar: 'Arabic'
};
const PROFILE_PRIVACY_LABELS = {
  public: 'Anyone signed in to the community',
  members: 'Members only',
  connections: 'Connections only'
};
const PROFILE_TYPE_LABELS = {
  individual: 'Individual',
  organisation: 'Organisation'
};
const PROFILE_DIGEST_LABELS = {
  off: 'Off',
  instant: 'Immediately',
  daily: 'Daily',
  monthly: 'Monthly'
};
const PROFILE_MATCH_FREQUENCY_LABELS = {
  daily: 'Every day',
  weekly: 'Every week',
  fortnightly: 'Every fortnight',
  monthly: 'Every month',
  never: 'Never'
};
const PROFILE_STATUS_MESSAGES = {
  'profile-updated': { type: 'success', message: 'Your profile has been updated.' },
  'profile-update-failed': {
    type: 'error',
    message: 'Your profile could not be updated. Check the details and try again.',
    anchor: 'first_name'
  },
  'data-export-requested': {
    type: 'success',
    message: 'Your data export request has been received. We will email you when it is ready.'
  },
  'data-export-exists': {
    type: 'info',
    message: 'A data export request is already being prepared.'
  },
  'data-export-failed': {
    type: 'error',
    message: 'We could not request your data export. Please try again.',
    anchor: 'data-export'
  },
  'avatar-invalid': {
    type: 'error',
    message: 'Upload a JPG, PNG, GIF or WEBP image smaller than 10MB.',
    anchor: 'avatar'
  },
  'email-changed': { type: 'success', message: 'Your email address has been updated.' },
  'email-unchanged': { type: 'info', message: 'That is already your email address.' },
  'email-invalid': { type: 'error', message: 'Enter a valid email address', anchor: 'new_email' },
  'email-password-incorrect': {
    type: 'error',
    message: 'Your current password was incorrect. Your email was not changed.',
    anchor: 'email_current_password'
  },
  'email-reauthentication-unavailable': {
    type: 'error',
    message: 'Email changes are temporarily unavailable because we cannot securely confirm your password. Your email was not changed.',
    anchor: 'email_current_password'
  },
  'email-failed': {
    type: 'error',
    message: 'Your email address could not be updated. It may already be in use.',
    anchor: 'new_email'
  },
  'password-changed': { type: 'success', message: 'Your password has been changed.' },
  'password-current-required': {
    type: 'error',
    message: 'Enter your current password',
    anchor: 'current_password'
  },
  'password-current-incorrect': {
    type: 'error',
    message: 'Your current password was incorrect',
    anchor: 'current_password'
  },
  'password-weak': {
    type: 'error',
    message: 'Your new password must be at least 12 characters',
    anchor: 'new_password'
  },
  'password-mismatch': {
    type: 'error',
    message: 'The new passwords you entered do not match',
    anchor: 'new_password_confirmation'
  },
  'password-reused': {
    type: 'error',
    message: 'You cannot reuse a recent password. Choose a different one.',
    anchor: 'new_password'
  },
  'password-failed': {
    type: 'error',
    message: 'Your password could not be changed. Try again.',
    anchor: 'new_password'
  },
  'language-changed': { type: 'success', message: 'Your language has been updated.' },
  'language-invalid': { type: 'error', message: 'Choose a language from the list', anchor: 'language' },
  'language-failed': { type: 'error', message: 'Your language could not be updated.', anchor: 'language' },
  'notifications-saved': { type: 'success', message: 'Your notification preferences have been saved.' },
  'notifications-failed': {
    type: 'error',
    message: 'Your notification preferences could not be saved.',
    anchor: 'notifications'
  },
  'passkey-renamed': { type: 'success', message: 'Your passkey has been renamed.' },
  'passkey-removed': { type: 'success', message: 'Your passkey has been removed.' },
  'passkey-name-required': { type: 'error', message: 'Enter a passkey name.', anchor: 'passkeys' },
  'passkey-not-found': { type: 'error', message: 'We could not find that passkey.', anchor: 'passkeys' },
  'passkey-last-sign-in-method': { type: 'error', message: 'Add another sign-in method before removing this passkey.', anchor: 'passkeys' },
  'passkey-password-required': { type: 'error', message: 'Enter your current password', anchor: 'passkeys' },
  'passkey-password-incorrect': { type: 'error', message: 'Your current password was incorrect', anchor: 'passkeys' },
  'passkey-failed': { type: 'error', message: 'Your passkey could not be updated.', anchor: 'passkeys' },
  'personalisation-saved': { type: 'success', message: 'Your personalisation preferences have been saved.' },
  'personalisation-failed': {
    type: 'error',
    message: 'Your personalisation preferences could not be saved.',
    anchor: 'personalisation'
  },
  'match-prefs-saved': { type: 'success', message: 'Your match notification preferences have been saved.' },
  'match-prefs-failed': {
    type: 'error',
    message: 'Your match notification preferences could not be saved.',
    anchor: 'match-preferences'
  },
  'skill-added': { type: 'success', message: 'Your skill has been added.' },
  'skill-removed': { type: 'success', message: 'Your skill has been removed.' },
  'skill-name-required': { type: 'error', message: 'Enter a skill name.', anchor: 'skills' },
  'skill-failed': { type: 'error', message: 'Your skill could not be saved.', anchor: 'skills' },
  'safeguarding-revoked': { type: 'success', message: 'The safeguarding preference has been removed.' },
  'safeguarding-failed': {
    type: 'error',
    message: 'The safeguarding preference could not be updated.',
    anchor: 'safeguarding'
  },
  'vetting-review-requested': { type: 'success', message: 'Broker review requested.' },
  'vetting-review-evidence-prohibited': {
    type: 'error',
    message: 'Do not upload or send vetting evidence through NEXUS.',
    anchor: 'vetting-status'
  },
  'vetting-review-unavailable': {
    type: 'error',
    message: 'This community does not have an available safeguarding contact policy.',
    anchor: 'vetting-status'
  },
  'vetting-review-failed': {
    type: 'error',
    message: 'The broker review could not be requested. Please try again.',
    anchor: 'vetting-status'
  },
  'safeguarding-policy-reviewed': { type: 'success', message: 'Safeguarding preferences confirmed.' },
  'safeguarding-policy-review-failed': {
    type: 'error',
    message: 'The review could not be confirmed. Please try again.',
    anchor: 'safeguarding-policy-review'
  }
};
// Keep this map limited to semantically exact Laravel catalog entries. Unmapped
// statuses deliberately retain their English fallback from PROFILE_STATUS_MESSAGES.
const PROFILE_STATUS_MESSAGE_KEYS = Object.freeze({
  'profile-updated': 'profile_settings.success',
  'profile-update-failed': 'profile_settings.failed',
  'data-export-requested': 'states.data-export-requested',
  'data-export-exists': 'states.data-export-exists',
  'data-export-failed': 'states.data-export-failed',
  'email-changed': 'profile_settings.email_changed',
  'email-unchanged': 'profile_settings.email_unchanged',
  'email-invalid': 'profile_settings.email_invalid',
  'email-password-incorrect': 'profile_settings.email_password_incorrect',
  'email-failed': 'profile_settings.email_failed',
  'password-changed': 'profile_settings.password_changed',
  'password-current-required': 'profile_settings.password_current_required',
  'password-current-incorrect': 'profile_settings.password_current_incorrect',
  'password-weak': 'profile_settings.password_weak',
  'password-mismatch': 'profile_settings.password_mismatch',
  'password-reused': 'profile_settings.password_reused',
  'password-failed': 'profile_settings.password_failed',
  'language-changed': 'profile_settings.language_changed',
  'language-invalid': 'profile_settings.language_invalid',
  'notifications-saved': 'profile_settings.notifications.saved',
  'notifications-failed': 'profile_settings.notifications.failed',
  'passkey-renamed': 'profile_settings.passkeys.renamed',
  'passkey-removed': 'profile_settings.passkeys.removed',
  'passkey-name-required': 'profile_settings.passkeys.name_required',
  'passkey-not-found': 'profile_settings.passkeys.not_found',
  'passkey-last-sign-in-method': 'profile_settings.passkeys.last_sign_in_method',
  'passkey-password-required': 'profile_settings.password_current_required',
  'passkey-password-incorrect': 'profile_settings.password_current_incorrect',
  'personalisation-saved': 'profile_settings.personalisation.saved',
  'personalisation-failed': 'profile_settings.personalisation.failed',
  'match-prefs-saved': 'profile_settings.match.saved',
  'match-prefs-failed': 'profile_settings.match.failed',
  'skill-added': 'profile_settings.skills.added',
  'skill-removed': 'profile_settings.skills.removed',
  'skill-name-required': 'profile_settings.skills.name_required',
  'skill-failed': 'profile_settings.skills.failed',
  'safeguarding-revoked': 'profile_settings.safeguarding.revoked',
  'safeguarding-failed': 'profile_settings.safeguarding.failed',
  'vetting-review-requested': 'profile_settings.safeguarding.vetting.review_requested_toast',
  'vetting-review-evidence-prohibited': 'profile_settings.safeguarding.vetting.no_documents',
  'vetting-review-unavailable': 'profile_settings.safeguarding.vetting.policy_unavailable_body',
  'vetting-review-failed': 'profile_settings.safeguarding.vetting.review_error',
  'safeguarding-policy-reviewed': 'profile_settings.safeguarding.policy_review_confirmed',
  'safeguarding-policy-review-failed': 'profile_settings.safeguarding.policy_review_error'
});
const PROFILE_NOTIFICATION_KEYS = [
  'email_messages',
  'email_connections',
  'caring_smart_nudges',
  'email_listings',
  'email_events',
  'email_transactions',
  'email_reviews',
  'email_gamification_digest',
  'email_gamification_milestones',
  'email_digest',
  'email_org_payments',
  'email_org_transfers',
  'email_org_membership',
  'email_org_admin',
  'push_enabled',
  'push_campaigns_opted_in'
];
const DELETE_ACCOUNT_ERRORS = {
  'delete-password-required': 'Enter your password to confirm.',
  'delete-confirm-required': 'Confirm that you understand your account will be deleted.',
  'delete-password-incorrect': 'The password you entered is incorrect.',
  'delete-failed': 'Your account could not be deleted. Try again or contact support.'
};
const DELETE_ACCOUNT_ERROR_KEYS = Object.freeze({
  'delete-password-required': 'delete_account.error_password',
  'delete-confirm-required': 'delete_account.error_confirm',
  'delete-password-incorrect': 'delete_account.error_password_incorrect',
  'delete-failed': 'delete_account.error_failed'
});
const TWO_FACTOR_STATUS_MESSAGES = {
  '2fa-enabled': { type: 'success', message: 'Two-step verification is now turned on.' },
  '2fa-disabled': { type: 'success', message: 'Two-step verification has been turned off.' },
  '2fa-code-required': {
    type: 'error',
    message: 'Enter the 6-digit code from your authenticator app.',
    anchor: 'tfa-form'
  },
  '2fa-code-invalid': {
    type: 'error',
    message: 'That code was not correct or has expired. Try the current code from your app.',
    anchor: 'tfa-form'
  },
  '2fa-password-required': {
    type: 'error',
    message: 'Enter your password to turn off two-step verification.',
    anchor: 'tfa-form'
  },
  '2fa-disable-failed': {
    type: 'error',
    message: 'We could not turn off two-step verification. Check your password and try again.',
    anchor: 'tfa-form'
  }
};
const TWO_FACTOR_STATUS_MESSAGE_KEYS = Object.freeze({
  '2fa-enabled': 'security_2fa.enabled_success',
  '2fa-disabled': 'security_2fa.disabled_success',
  '2fa-code-required': 'security_2fa.code_required',
  '2fa-code-invalid': 'security_2fa.code_invalid',
  '2fa-password-required': 'security_2fa.password_required',
  '2fa-disable-failed': 'security_2fa.disable_failed'
});

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function urlFor(res, pathname) {
  return typeof res.locals?.urlFor === 'function' ? res.locals.urlFor(pathname) : pathname;
}

function redirectTo(res, pathname) {
  return res.redirect(urlFor(res, pathname));
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function uploadedFile(req, fieldName) {
  const file = req.files && req.files[fieldName];
  return file && typeof file === 'object' ? file : null;
}

function uploadedFiles(req) {
  if (!req.files || typeof req.files !== 'object') return [];
  return Object.values(req.files).flatMap((file) => (Array.isArray(file) ? file : [file])).filter(Boolean);
}

async function removeUploadedFiles(req) {
  await Promise.all(uploadedFiles(req).map((file) => removeUploadedFile(file)));
}

function hasUnexpectedEmptyWorkflowInput(req) {
  const inputKeys = Object.keys(req.body || {}).filter((key) => key !== '_csrf');
  return inputKeys.length > 0 || uploadedFiles(req).length > 0;
}

function apiErrorCode(error) {
  const firstError = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  return String(firstError?.code || error?.data?.code || '').trim().toUpperCase();
}

async function removeUploadedFile(file) {
  if (!file || !file.filepath) return;
  try {
    await fs.unlink(file.filepath);
  } catch {
    // Temporary upload cleanup is best-effort only.
  }
}

function allowedValue(value, allowed, fallback = null) {
  const text = trimmed(value);
  return allowed.includes(text) ? text : fallback;
}

function profileLocalesForRequest(req) {
  const configuredLocales = req?.accessibleRouting?.tenant?.supported_languages;
  if (!Array.isArray(configuredLocales)) return PROFILE_LOCALES;

  const configuredLocaleSet = new Set(configuredLocales);
  return PROFILE_LOCALES.filter((locale) => configuredLocaleSet.has(locale));
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function redirectOnAuthError(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }

  return false;
}

async function callUserSettings(token, method, path, data = undefined) {
  if (data === undefined) {
    return callUserSettingsApi(token, method, path);
  }

  return callUserSettingsApi(token, method, path, data);
}

async function callProfile(token, method, path, data = undefined) {
  if (data === undefined) {
    return callProfileApi(token, method, path);
  }

  return callProfileApi(token, method, path, data);
}

async function callWebAuthn(token, method, path, data = undefined) {
  if (data === undefined) {
    return callWebAuthnApi(token, method, path);
  }

  return callWebAuthnApi(token, method, path, data);
}

function statusRedirect(path, status, fragment = '') {
  return `${path}?status=${encodeURIComponent(status)}${fragment}`;
}

function profileSettingsRedirect(status, fragment = '') {
  return statusRedirect('/profile/settings', status, fragment);
}

function twoFactorRedirect(status) {
  return statusRedirect('/profile/two-factor', status);
}

function deleteAccountRedirect(status) {
  return statusRedirect('/profile/delete-account', status);
}

async function confirmWebAuthnSecurityAction(token, currentPassword) {
  const result = await callWebAuthn(token, 'POST', '/security-confirm', {
    current_password: currentPassword
  });
  const confirmationToken = trimmed(payloadFrom(result).security_confirmation_token);
  if (!confirmationToken) {
    throw new ApiError('Laravel did not return a security confirmation token', 502, {
      errors: [{ code: 'AUTH_SECURITY_CONFIRMATION_RESPONSE_INVALID' }]
    });
  }
  return confirmationToken;
}

async function destroyRequestSession(req) {
  if (!req.session || typeof req.session.destroy !== 'function') return;
  await new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function notificationPayload(body) {
  const payload = PROFILE_NOTIFICATION_KEYS.reduce((prefs, key) => {
    prefs[key] = checked(body[key]);
    return prefs;
  }, {});

  payload.federation_notifications_enabled = checked(body.federation_notifications_enabled);

  const digestFrequency = allowedValue(body.digest_frequency, PROFILE_DIGEST_FREQUENCIES, null);
  if (digestFrequency !== null) {
    payload.digest_frequency = digestFrequency;
  }

  return payload;
}

function payloadFrom(result) {
  if (!result || typeof result !== 'object') return result || {};
  if (Object.prototype.hasOwnProperty.call(result, 'data')) return result.data || {};
  return result;
}

function arrayFromPayload(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return [];
}

function normalizeProfilePayload(result) {
  const payload = payloadFrom(result);
  const profile = payload && typeof payload === 'object' ? payload : {};
  const nested = profile.profile && typeof profile.profile === 'object' ? profile.profile : {};
  return { ...profile, ...nested };
}

function profileValue(profile, key, fallback = '') {
  const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  return profile[key] ?? profile[camelKey] ?? fallback;
}

function boolValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return checked(value);
  }
  return false;
}

function formatProfileDate(value, includeTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const options = includeTime
    ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'long', year: 'numeric' };
  return date.toLocaleString(getRequestIntlLocale(), options);
}

function translateStatusMessage(req, key, fallbackMessage = '') {
  if (!key) return fallbackMessage;

  const requestTranslator = typeof req?.t === 'function' ? req.t : fallbackTranslator;
  const translated = requestTranslator(key);
  if (typeof translated === 'string' && translated !== '' && translated !== key) return translated;

  const english = fallbackTranslator(key);
  return typeof english === 'string' && english !== '' && english !== key ? english : fallbackMessage;
}

function digestFrequencyFrom(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const frequency = trimmed(source.global_frequency || source.frequency);
  if (frequency === 'weekly') return 'monthly';
  return allowedValue(frequency, PROFILE_DIGEST_FREQUENCIES, 'off');
}

function localizedOptions(req, values, keyForValue, fallbackLabels, selectedValue) {
  return values.map((value) => ({
    value,
    label: translateStatusMessage(req, keyForValue(value), fallbackLabels[value] || value),
    selected: value === selectedValue
  }));
}

function localizedStatusConfig(req, status, messages, messageKeys) {
  const config = messages[status] || null;
  if (!config) return null;

  const messageKey = messageKeys[status];
  if (!messageKey) return config;

  return {
    ...config,
    message: translateStatusMessage(req, messageKey, config.message)
  };
}

function profileStatusConfig(req, status) {
  return localizedStatusConfig(req, status, PROFILE_STATUS_MESSAGES, PROFILE_STATUS_MESSAGE_KEYS);
}

function normalizeNotificationPrefs(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    email_messages: boolValue(source.email_messages),
    email_connections: boolValue(source.email_connections),
    caring_smart_nudges: boolValue(source.caring_smart_nudges),
    email_listings: boolValue(source.email_listings),
    email_events: boolValue(source.email_events),
    email_transactions: boolValue(source.email_transactions),
    email_reviews: boolValue(source.email_reviews),
    email_gamification_digest: boolValue(source.email_gamification_digest),
    email_gamification_milestones: boolValue(source.email_gamification_milestones),
    email_digest: boolValue(source.email_digest),
    email_org_payments: boolValue(source.email_org_payments),
    email_org_transfers: boolValue(source.email_org_transfers),
    email_org_membership: boolValue(source.email_org_membership),
    email_org_admin: boolValue(source.email_org_admin),
    push_enabled: boolValue(source.push_enabled),
    push_campaigns_opted_in: boolValue(source.push_campaigns_opted_in),
    federation_notifications_enabled: boolValue(source.federation_notifications_enabled),
    digest_frequency: allowedValue(source.digest_frequency, PROFILE_DIGEST_FREQUENCIES, 'off')
  };
}

function normalizeMatchPrefs(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    notification_frequency: allowedValue(source.notification_frequency, PROFILE_MATCH_FREQUENCIES, 'monthly'),
    notify_hot_matches: boolValue(source.notify_hot_matches, true),
    notify_mutual_matches: boolValue(source.notify_mutual_matches, true)
  };
}

function normalizeSkills(payload) {
  return arrayFromPayload(payload, ['skills', 'items']).map((skill) => ({
    id: skill.id || skill.user_skill_id || '',
    skill_name: skill.skill_name || skill.name || '',
    is_offering: boolValue(skill.is_offering),
    is_requesting: boolValue(skill.is_requesting),
    endorsement_count: Number(skill.endorsement_count || skill.endorsements_count || 0)
  })).filter((skill) => skill.skill_name !== '');
}

function numericProfileValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function formatProfileNumber(value, options = {}) {
  return new Intl.NumberFormat(getRequestIntlLocale(), options).format(numericProfileValue(value));
}

function ownProfileDisplayName(profile, t = fallbackTranslator) {
  const explicit = trimmed(profileValue(profile, 'name') || profileValue(profile, 'display_name'));
  if (explicit) return explicit;
  const combined = [profileValue(profile, 'first_name'), profileValue(profile, 'last_name')]
    .map((value) => trimmed(value))
    .filter(Boolean)
    .join(' ');
  return combined || t('members.unknown_member');
}

function ownProfileSkills(profile) {
  const rows = Array.isArray(profile.skills) ? profile.skills : [];
  return rows
    .map((skill) => {
      if (typeof skill === 'string') {
        return { name: trimmed(skill), isOffering: false, isRequesting: false };
      }
      if (!skill || typeof skill !== 'object') return null;
      return {
        name: trimmed(skill.skill_name || skill.skillName || skill.name),
        isOffering: boolValue(skill.is_offering, skill.isOffering),
        isRequesting: boolValue(skill.is_requesting, skill.isRequesting)
      };
    })
    .filter((skill) => skill && skill.name)
    .slice(0, 20);
}

function ownProfileListings(result) {
  return arrayFromPayload(payloadFrom(result), ['items', 'listings'])
    .map((listing) => ({
      id: Number(listing?.id) || null,
      title: trimmed(listing?.title || listing?.name),
      description: trimmed(String(listing?.description || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' '),
      type: String(listing?.type || 'offer').toLowerCase() === 'request' ? 'request' : 'offer',
      imageUrl: listing?.image_url || listing?.imageUrl || ''
    }))
    .filter((listing) => listing.id && listing.title)
    .slice(0, 6);
}

function ownProfileReviews(result) {
  return arrayFromPayload(payloadFrom(result), ['items', 'reviews'])
    .map((review) => ({
      id: Number(review?.id) || null,
      rating: Math.max(0, Math.min(5, numericProfileValue(review?.rating))),
      comment: trimmed(review?.comment || review?.body),
      reviewerName: review?.is_anonymous || review?.isAnonymous
        ? ''
        : trimmed(review?.reviewer?.name || review?.reviewer_name || review?.reviewerName),
      createdAt: review?.created_at || review?.createdAt || ''
    }))
    .slice(0, 6);
}

function ownProfileBadges(result) {
  return arrayFromPayload(payloadFrom(result), ['items', 'badges'])
    .map((badge) => ({
      name: trimmed(badge?.name || badge?.title || badge?.badge_name || badge?.badgeName),
      icon: trimmed(badge?.icon || badge?.emoji)
    }))
    .filter((badge) => badge.name)
    .slice(0, 8);
}

function ownProfileStats(profile, gamificationResult) {
  const stats = profile.stats && typeof profile.stats === 'object' ? profile.stats : {};
  const gamification = normalizeProfilePayload(gamificationResult);
  const hoursGiven = numericProfileValue(
    profile.total_hours_given,
    profile.totalHoursGiven,
    stats.total_hours_given,
    stats.totalHoursGiven,
    stats.given_count,
    stats.givenCount
  );
  const hoursReceived = numericProfileValue(
    profile.total_hours_received,
    profile.totalHoursReceived,
    stats.total_hours_received,
    stats.totalHoursReceived,
    stats.received_count,
    stats.receivedCount
  );
  const listingsCount = Math.trunc(numericProfileValue(stats.listings_count, stats.listingsCount));
  const ratingValue = profile.rating ?? stats.average_rating ?? stats.averageRating;
  const rating = ratingValue === null || ratingValue === undefined || ratingValue === ''
    ? null
    : numericProfileValue(ratingValue);
  const level = Math.trunc(numericProfileValue(profile.level, gamification.level, 1));
  const xp = Math.trunc(numericProfileValue(profile.xp, gamification.xp));

  return {
    hoursGivenLabel: formatProfileNumber(hoursGiven, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    hoursReceivedLabel: formatProfileNumber(hoursReceived, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    listingsCountLabel: formatProfileNumber(listingsCount, { maximumFractionDigits: 0 }),
    ratingLabel: rating === null ? '' : formatProfileNumber(rating, { maximumFractionDigits: 1 }),
    levelLabel: formatProfileNumber(level, { maximumFractionDigits: 0 }),
    xpLabel: formatProfileNumber(xp, { maximumFractionDigits: 0 })
  };
}

function optionalOwnProfileResult(promise, fallback) {
  return promise.catch((error) => {
    if (error instanceof ApiError && error.status === 401) throw error;
    return fallback;
  });
}

function normalizePasskeys(payload, req) {
  return arrayFromPayload(payload, ['credentials', 'passkeys', 'items']).map((passkey) => ({
    credential_id: passkey.credential_id || passkey.id || '',
    device_name: passkey.device_name || passkey.name || translateStatusMessage(
      req,
      'profile_settings.passkeys.unnamed',
      'Unnamed passkey'
    ),
    authenticator_type: String(passkey.authenticator_type || passkey.type || '').toLowerCase() === 'platform'
      ? translateStatusMessage(req, 'profile_settings.passkeys.type_platform', 'This device')
      : translateStatusMessage(req, 'profile_settings.passkeys.type_cross_platform', 'Security key or another device'),
    created_label: formatProfileDate(passkey.created_at || passkey.createdAt),
    last_used_label: formatProfileDate(passkey.last_used_at || passkey.lastUsedAt)
  }));
}

function normalizeSessions(payload, req) {
  return arrayFromPayload(payload, ['sessions', 'items']).map((session) => {
    const deviceType = String(session.device_type || session.device || '').trim().toLowerCase();
    const deviceKey = ['web', 'mobile', 'pwa'].includes(deviceType) ? deviceType : 'unknown';
    return {
      id: session.id || '',
      device_label: translateStatusMessage(req, `ux.device_${deviceKey}`, 'Unknown device'),
      ip_address: session.ip_address || session.ip || '—',
      last_active_label: formatProfileDate(
        session.last_active || session.last_activity || session.last_active_at || session.updated_at,
        true
      ) || '—'
    };
  });
}

function normalizeSafeguarding(payload) {
  return arrayFromPayload(payload, ['preferences', 'items']).map((option) => {
    const activationSource = option.activations && typeof option.activations === 'object'
      ? option.activations
      : option;
    const activations = [
      'restricts_messaging',
      'restricts_matching',
      'requires_broker_approval',
      'requires_vetted_interaction'
    ].filter((key) => checked(activationSource[key]));

    return {
      option_id: option.option_id || option.id || '',
      label: option.label || option.name || 'Safeguarding preference',
      description: option.description || '',
      policy_review_required: checked(option.policy_review_required),
      activations
    };
  });
}

function marketingConsentFrom(payload) {
  const rows = arrayFromPayload(payload, ['consents', 'items']);
  const marketing = rows.find((consent) => (
    String(consent.consent_type_slug || consent.slug || '') === 'marketing_email'
  ));
  return marketing ? checked(marketing.given) : undefined;
}

function insuranceEnabledForRequest(req) {
  const compliance = req?.accessibleRouting?.tenant?.compliance;
  return Boolean(compliance && typeof compliance === 'object' && compliance.insurance_enabled);
}

function buildProfileSettingsViewModel(req, data) {
  const profile = data.profile || {};
  const account = data.account || {};
  const profileLocales = profileLocalesForRequest(req);
  const defaultProfileLocale = profileLocales[0] || 'en';
  const preferredLanguage = allowedValue(
    account.preferred_language || profileValue(profile, 'preferred_language'),
    profileLocales,
    defaultProfileLocale
  );
  const privacyProfile = allowedValue(
    profileValue(profile, 'privacy_profile', account.privacy_profile),
    PROFILE_PRIVACY_OPTIONS,
    'public'
  );
  const profileType = allowedValue(profileValue(profile, 'profile_type'), PROFILE_TYPES, 'individual');
  const autoTranslateLocale = allowedValue(
    account.auto_translate_target_locale || profileValue(profile, 'auto_translate_target_locale'),
    profileLocales,
    preferredLanguage
  );
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const statusConfig = profileStatusConfig(req, status);
  const vettingStatus = data.vettingStatus && typeof data.vettingStatus === 'object'
    ? data.vettingStatus
    : null;
  const vettingPolicy = vettingStatus?.policy && typeof vettingStatus.policy === 'object'
    ? vettingStatus.policy
    : {};
  const vettingDecision = String(vettingStatus?.decision || 'not_confirmed');
  const vettingReviewPending = String(vettingStatus?.review_status || '') === 'pending';
  const vettingPolicyAvailable = Boolean(vettingPolicy.configured && vettingPolicy.contact_policy_available);
  const attestationCode = String(vettingPolicy.attestation_code || '');

  return {
    title: 'Edit your profile',
    activeNav: 'profile',
    status,
    statusConfig,
    successStatus: statusConfig && statusConfig.type === 'success',
    infoStatus: statusConfig && statusConfig.type === 'info',
    errorStatus: statusConfig && statusConfig.type === 'error',
    errorAnchor: statusConfig ? statusConfig.anchor || 'profile-settings' : '',
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    profile: {
      id: profileValue(profile, 'id'),
      first_name: profileValue(profile, 'first_name'),
      last_name: profileValue(profile, 'last_name'),
      email: account.email || profileValue(profile, 'email'),
      phone: profileValue(profile, 'phone'),
      profile_type: profileType,
      organization_name: profileValue(profile, 'organization_name'),
      tagline: profileValue(profile, 'tagline'),
      bio: profileValue(profile, 'bio'),
      location: profileValue(profile, 'location'),
      avatar_url: resolveBackendAssetUrl(profileValue(profile, 'avatar_url')),
      privacy_profile: privacyProfile,
      privacy_search: boolValue(profileValue(profile, 'privacy_search'), true),
      privacy_contact: boolValue(account.privacy_contact, profileValue(profile, 'privacy_contact'), true),
      newsletter_opt_in: boolValue(
        data.marketingConsent,
        account.newsletter_opt_in,
        profileValue(profile, 'newsletter_opt_in')
      ),
      prefers_chronological_feed: boolValue(
        account.prefers_chronological_feed,
        profileValue(profile, 'prefers_chronological_feed')
      ),
      auto_translate_ugc: boolValue(account.auto_translate_ugc, profileValue(profile, 'auto_translate_ugc')),
      auto_translate_target_locale: autoTranslateLocale
    },
    profileTypeOptions: localizedOptions(
      req,
      PROFILE_TYPES,
      (value) => `profile.profile_type_${value}`,
      PROFILE_TYPE_LABELS,
      profileType
    ),
    privacyOptions: localizedOptions(
      req,
      PROFILE_PRIVACY_OPTIONS,
      (value) => `profile_settings.privacy_options.${value}`,
      PROFILE_PRIVACY_LABELS,
      privacyProfile
    ),
    localeOptions: localizedOptions(
      req,
      profileLocales,
      (value) => `profile_settings.languages.${value}`,
      PROFILE_LOCALE_LABELS,
      preferredLanguage
    ),
    autoTranslateLocaleOptions: localizedOptions(
      req,
      profileLocales,
      (value) => `profile_settings.languages.${value}`,
      PROFILE_LOCALE_LABELS,
      autoTranslateLocale
    ),
    digestOptions: localizedOptions(
      req,
      PROFILE_DIGEST_FREQUENCIES,
      (value) => `profile_settings.notifications.digest_options.${value}`,
      PROFILE_DIGEST_LABELS,
      data.notificationPrefs.digest_frequency
    ),
    matchFrequencyOptions: localizedOptions(
      req,
      PROFILE_MATCH_FREQUENCIES,
      (value) => `profile_settings.match.frequency.${value}`,
      PROFILE_MATCH_FREQUENCY_LABELS,
      data.matchPrefs.notification_frequency
    ),
    notificationPrefs: data.notificationPrefs,
    matchPrefs: data.matchPrefs,
    mySkills: data.skills,
    passkeys: data.passkeys,
    sessions: data.sessions,
    safeguarding: data.safeguarding,
    safeguardingPolicyReviewRequired: data.safeguarding.some((option) => option.policy_review_required),
    vetting: {
      available: vettingStatus !== null,
      decision: vettingDecision,
      reviewPending: vettingReviewPending,
      policyAvailable: vettingPolicyAvailable,
      attestationLabel: attestationCode
        ? translateStatusMessage(req, `safeguarding.attestations.${attestationCode}`, attestationCode)
        : '',
      statusLabel: vettingReviewPending
        ? translateStatusMessage(req, 'profile_settings.safeguarding.vetting.status_review_requested', 'Review requested')
        : translateStatusMessage(
          req,
          vettingDecision === 'confirmed'
            ? 'govuk_alpha.exchanges.confirmed'
            : `profile_settings.safeguarding.vetting.status_${vettingDecision === 'revoked' ? 'revoked' : 'not_confirmed'}`,
          vettingDecision === 'confirmed' ? 'Confirmed' : (vettingDecision === 'revoked' ? 'Revoked' : 'Not confirmed')
        ),
      tagClass: vettingReviewPending
        ? 'govuk-tag--yellow'
        : ({ confirmed: 'govuk-tag--green', revoked: 'govuk-tag--red' }[vettingDecision] || 'govuk-tag--grey'),
      confirmedDate: formatProfileDate(vettingStatus?.confirmed_at)
    },
    settingsLinks: [
      {
        href: '/settings/linked-accounts',
        title: translateStatusMessage(req, 'govuk_alpha_settings.nav.linked_accounts', 'Linked accounts'),
        text: translateStatusMessage(
          req,
          'govuk_alpha_settings.linked.description',
          'Manage linked family, guardian and carer accounts.'
        )
      },
      {
        href: '/settings/appearance',
        title: translateStatusMessage(req, 'govuk_alpha_settings.nav.appearance', 'Appearance'),
        text: translateStatusMessage(
          req,
          'govuk_alpha_settings.appearance.description',
          'Choose how this service looks on your device.'
        )
      },
      {
        href: '/settings/data-rights',
        title: translateStatusMessage(req, 'govuk_alpha_settings.nav.data_rights', 'Your data rights'),
        text: translateStatusMessage(
          req,
          'govuk_alpha_settings.gdpr.description',
          'Review privacy controls and data protection requests.'
        )
      },
      insuranceEnabledForRequest(req) ? {
        href: '/settings/insurance',
        title: translateStatusMessage(req, 'govuk_alpha_settings.nav.insurance', 'Insurance certificates'),
        text: translateStatusMessage(
          req,
          'govuk_alpha_settings.insurance.description',
          'Upload or review proof of insurance for verified activity.'
        )
      } : null,
      {
        href: '/settings/availability',
        title: translateStatusMessage(req, 'govuk_alpha_settings.nav.availability', 'Your availability'),
        text: translateStatusMessage(
          req,
          'govuk_alpha_settings.availability.description',
          'Keep the times when you are available up to date.'
        )
      }
    ].filter(Boolean),
    notificationGroups: Object.entries({
      messages: ['email_messages', 'email_connections', 'caring_smart_nudges', 'federation_notifications_enabled'],
      activity: ['email_listings', 'email_events', 'email_transactions', 'email_reviews'],
      achievements: ['email_gamification_digest', 'email_gamification_milestones', 'email_digest'],
      organisation: ['email_org_payments', 'email_org_transfers', 'email_org_membership', 'email_org_admin'],
      push: ['push_enabled', 'push_campaigns_opted_in']
    }).map(([group, keys]) => ({
      title: translateStatusMessage(req, `profile_settings.notifications.groups.${group}`, group),
      items: keys.map((key) => ({
        key,
        label: translateStatusMessage(req, `profile_settings.notifications.labels.${key}`, key)
      }))
    }))
  };
}

function twoFactorStatusConfig(req, status) {
  return localizedStatusConfig(req, status, TWO_FACTOR_STATUS_MESSAGES, TWO_FACTOR_STATUS_MESSAGE_KEYS);
}

function backupCodesRemainingLabel(req, count) {
  const number = Number(count || 0);
  const translator = typeof req?.tc === 'function' ? req.tc : fallbackChoiceTranslator;
  return translator('security_2fa.backup_remaining', number, { count: number });
}

function normalizeTwoFactorPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const setup = source.setup && typeof source.setup === 'object' ? source.setup : source;
  const enabled = boolValue(source.enabled, source.is_enabled, source.two_factor_enabled);
  const qrDataUri = setup.qr_code_url
    || setup.qrCodeUrl
    || setup.qr_data_uri
    || setup.qrDataUri
    || setup.qr_code_data_uri
    || '';
  const secret = setup.secret || setup.setup_key || setup.manual_key || '';
  const backupCodes = arrayFromPayload(source, ['backup_codes', 'backupCodes']);
  const backupCodesRemaining = Number(
    source.backup_codes_remaining ?? source.backupCodesRemaining ?? source.backup_code_count ?? backupCodes.length
  );

  return {
    enabled,
    setup: enabled || (qrDataUri === '' && secret === '')
      ? null
      : {
          qr_data_uri: qrDataUri,
          secret
    },
    backupCodes,
    backupCodesRemaining: Number.isFinite(backupCodesRemaining) ? backupCodesRemaining : 0
  };
}

function renderTwoFactor(req, res, twoFactor, status = '') {
  const statusConfig = twoFactorStatusConfig(req, status);

  return res.render('profile/two-factor', {
    title: 'Authenticator app (two-step verification)',
    titleKey: 'security_2fa.title',
    activeNav: 'profile',
    status,
    statusConfig,
    successStatus: statusConfig && statusConfig.type === 'success',
    errorStatus: statusConfig && statusConfig.type === 'error',
    errorAnchor: statusConfig ? statusConfig.anchor || 'tfa-form' : '',
    enabled: twoFactor.enabled,
    setup: twoFactor.setup,
    backupCodes: twoFactor.backupCodes,
    backupCodesRemaining: twoFactor.backupCodesRemaining,
    backupCodesRemainingLabel: backupCodesRemainingLabel(req, twoFactor.backupCodesRemaining),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

function normalizeBlockedUsers(payload, t) {
  return arrayFromPayload(payload, ['blocked', 'users', 'items']).map((blockedUser) => {
    const name = trimmed(blockedUser.name || blockedUser.display_name || blockedUser.full_name)
      || t('members.unknown_member');
    return {
      user_id: Number(blockedUser.user_id || blockedUser.id || blockedUser.blocked_user_id || 0),
      name,
      initial: (name || 'U').slice(0, 1).toUpperCase(),
      avatar_url: resolveBackendAssetUrl(blockedUser.avatar_url || blockedUser.avatarUrl),
      reason: blockedUser.reason || ''
    };
  });
}

router.get('/settings', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const data = {
    profile: {},
    account: {},
    notificationPrefs: normalizeNotificationPrefs({}),
    matchPrefs: normalizeMatchPrefs({}),
    skills: [],
    passkeys: [],
    sessions: [],
    safeguarding: [],
    vettingStatus: null,
    marketingConsent: undefined
  };

  try {
    data.profile = normalizeProfilePayload(await getRequestProfile(req, token));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.account = payloadFrom(await callUserSettings(token, 'GET', ''));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.marketingConsent = marketingConsentFrom(
      payloadFrom(await callUserSettings(token, 'GET', '/consent'))
    );
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.notificationPrefs = normalizeNotificationPrefs(
      payloadFrom(await callUserSettings(token, 'GET', '/notifications'))
    );
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    const digestSettings = payloadFrom(await callProfile(token, 'GET', '/notifications/settings'));
    data.notificationPrefs.digest_frequency = digestFrequencyFrom(digestSettings);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.matchPrefs = normalizeMatchPrefs(payloadFrom(await callUserSettings(token, 'GET', '/match-preferences')));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.skills = normalizeSkills(payloadFrom(await callUserSettings(token, 'GET', '/skills')));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.passkeys = normalizePasskeys(payloadFrom(await callWebAuthn(token, 'GET', '/credentials')), req);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.sessions = normalizeSessions(payloadFrom(await callProfile(token, 'GET', '/users/me/sessions')), req);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.safeguarding = normalizeSafeguarding(
      payloadFrom(await callProfile(token, 'GET', '/safeguarding/my-preferences'))
    );
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  try {
    data.vettingStatus = payloadFrom(await callProfile(token, 'GET', '/safeguarding/my-vetting-status'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  return res.render('profile/settings', buildProfileSettingsViewModel(req, data));
}));

router.post('/settings', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const avatar = uploadedFile(req, 'avatar');
  if (!token) {
    await removeUploadedFile(avatar);
    return redirectTo(res, loginRedirect());
  }

  const profilePayload = {
    first_name: trimmed(req.body.first_name, 100),
    last_name: trimmed(req.body.last_name, 100),
    phone: trimmed(req.body.phone, 50),
    profile_type: allowedValue(req.body.profile_type, PROFILE_TYPES, 'individual'),
    organization_name: trimmed(req.body.organization_name, 150),
    tagline: trimmed(req.body.tagline, 160),
    bio: trimmed(req.body.bio, 5000),
    location: trimmed(req.body.location, 255)
  };
  if (!avatar && checked(req.body.remove_avatar)) profilePayload.avatar_url = null;

  if (profilePayload.first_name === '' || profilePayload.last_name === '') {
    await removeUploadedFile(avatar);
    return redirectTo(res, profileSettingsRedirect('profile-update-failed'));
  }

  let status = 'profile-updated';
  try {
    if (avatar) {
      const buffer = await fs.readFile(avatar.filepath);
      await uploadProfileAvatar(token, {
        file: {
          buffer,
          filename: trimmed(avatar.originalFilename) || 'avatar',
          contentType: trimmed(avatar.mimetype) || 'application/octet-stream',
          size: avatar.size
        }
      });
    }
    await callUserSettings(token, 'PUT', '', profilePayload);
    await callUserSettings(token, 'PUT', '/preferences', {
      privacy: {
        privacy_profile: allowedValue(req.body.privacy_profile, PROFILE_PRIVACY_OPTIONS, 'public'),
        privacy_search: checked(req.body.privacy_search)
      }
    });
    await callUserSettings(token, 'PUT', '/consent', {
      slug: 'marketing_email',
      given: checked(req.body.newsletter_opt_in)
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = avatar && error instanceof ApiError && [400, 413, 422].includes(error.status)
      ? 'avatar-invalid'
      : 'profile-update-failed';
  } finally {
    await removeUploadedFile(avatar);
  }

  return redirectTo(res, status === 'profile-updated'
    ? statusRedirect('/profile', status)
    : profileSettingsRedirect(status));
}));

router.post('/email', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const email = trimmed(req.body.email, 255);
  if (email === '' || !validEmail(email)) {
    return redirectTo(res, profileSettingsRedirect('email-invalid'));
  }

  // Laravel's generic PUT /api/v2/users/me ignores current_password. Calling
  // it here would let a stolen bearer session replace the recovery email
  // without re-authentication. The Laravel accessible controller verifies the
  // password server-side, but no bearer-authenticated equivalent is exposed.
  // Fail closed until that dedicated contract exists; never claim success or
  // send the sensitive write through the ungated generic profile endpoint.
  return redirectTo(res, profileSettingsRedirect('email-reauthentication-unavailable'));
}));

router.post('/password', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const confirmPassword = String(req.body.new_password_confirmation || req.body.confirm_password || '');
  const preStatus = currentPassword === ''
    ? 'password-current-required'
    : newPassword === '' || newPassword.length < 12
      ? 'password-weak'
      : newPassword !== confirmPassword
        ? 'password-mismatch'
        : null;

  if (preStatus !== null) {
    return redirectTo(res, profileSettingsRedirect(preStatus));
  }

  try {
    await callUserSettings(token, 'POST', '/password', {
      current_password: currentPassword,
      new_password: newPassword
    });
    invalidateUserCache(token);
    await destroyRequestSession(req);
    clearAuthCookies(res);
    return redirectTo(res, '/login?status=password-changed');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    const status = code.includes('INVALID')
      ? 'password-current-incorrect'
      : code.includes('REUSED')
        ? 'password-reused'
        : code.includes('WEAK')
          ? 'password-weak'
          : 'password-failed';
    return redirectTo(res, profileSettingsRedirect(status));
  }
}));

router.post('/language', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const language = allowedValue(req.body.language, profileLocalesForRequest(req), null);
  if (language === null) {
    return redirectTo(res, profileSettingsRedirect('language-invalid'));
  }

  let status = 'language-changed';
  try {
    await callUserSettings(token, 'PUT', '/language', { language });
    if (req.session) req.session.locale = language;
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'language-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status));
}));

router.post('/notifications', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let status = 'notifications-saved';
  try {
    const payload = notificationPayload(req.body);
    const digestFrequency = payload.digest_frequency;
    delete payload.digest_frequency;
    await callUserSettings(token, 'PUT', '/notifications', payload);
    if (digestFrequency) {
      await callProfile(token, 'POST', '/notifications/settings', {
        context_type: 'global',
        context_id: 0,
        frequency: digestFrequency
      });
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'notifications-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status, '#notifications'));
}));

router.post('/passkeys/rename', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const credentialId = trimmed(req.body.credential_id);
  const deviceName = trimmed(req.body.device_name, 100);
  const currentPassword = String(req.body.current_password || '');
  if (credentialId === '' || deviceName === '') {
    return redirectTo(res, profileSettingsRedirect('passkey-name-required', '#passkeys'));
  }
  if (currentPassword === '') {
    return redirectTo(res, profileSettingsRedirect('passkey-password-required', '#passkeys'));
  }

  let status = 'passkey-renamed';
  try {
    const securityConfirmationToken = await confirmWebAuthnSecurityAction(token, currentPassword);
    await callWebAuthn(token, 'POST', '/rename', {
      credential_id: credentialId,
      device_name: deviceName,
      security_confirmation_token: securityConfirmationToken
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    status = error instanceof ApiError && error.status === 404
      ? 'passkey-not-found'
      : (error instanceof ApiError && error.status === 403 && code === 'SECURITY_CONFIRMATION_REQUIRED'
        ? 'passkey-password-incorrect'
        : 'passkey-failed');
  }

  return redirectTo(res, profileSettingsRedirect(status, '#passkeys'));
}));

router.post('/passkeys/remove', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const credentialId = trimmed(req.body.credential_id);
  const currentPassword = String(req.body.current_password || '');
  if (credentialId === '') {
    return redirectTo(res, profileSettingsRedirect('passkey-not-found', '#passkeys'));
  }
  if (currentPassword === '') {
    return redirectTo(res, profileSettingsRedirect('passkey-password-required', '#passkeys'));
  }

  try {
    const securityConfirmationToken = await confirmWebAuthnSecurityAction(token, currentPassword);
    const result = await callWebAuthn(token, 'POST', '/remove', {
      credential_id: credentialId,
      security_confirmation_token: securityConfirmationToken
    });
    if (payloadFrom(result).sessions_revoked !== true) {
      return redirectTo(res, profileSettingsRedirect('passkey-not-found', '#passkeys'));
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    const status = error instanceof ApiError && error.status === 404
      ? 'passkey-not-found'
      : (error instanceof ApiError && error.status === 409 && code === 'LAST_SIGN_IN_METHOD'
        ? 'passkey-last-sign-in-method'
        : (error instanceof ApiError && error.status === 403 && code === 'SECURITY_CONFIRMATION_REQUIRED'
          ? 'passkey-password-incorrect'
          : 'passkey-failed'));
    return redirectTo(res, profileSettingsRedirect(status, '#passkeys'));
  }

  invalidateUserCache(token);
  await destroyRequestSession(req);
  clearAuthCookies(res);
  return redirectTo(res, '/login?status=passkey-removed');
}));

router.post('/personalisation', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const locale = allowedValue(req.body.auto_translate_target_locale, profileLocalesForRequest(req), null);
  let status = 'personalisation-saved';
  try {
    await callUserSettings(token, 'PUT', '/preferences', {
      feed: {
        prefers_chronological: checked(req.body.prefers_chronological || req.body.prefers_chronological_feed)
      },
      translation: {
        auto_translate_ugc: checked(req.body.auto_translate_ugc),
        auto_translate_target_locale: locale
      }
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'personalisation-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status, '#personalisation'));
}));

router.post('/match-preferences', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const notificationFrequency = allowedValue(req.body.notification_frequency, PROFILE_MATCH_FREQUENCIES, 'monthly');
  let status = 'match-prefs-saved';
  try {
    await callUserSettings(token, 'PUT', '/match-preferences', {
      notification_frequency: notificationFrequency,
      notify_hot_matches: checked(req.body.notify_hot_matches),
      notify_mutual_matches: checked(req.body.notify_mutual_matches)
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'match-prefs-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status, '#match-preferences'));
}));

router.post('/skills/add', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const skillName = trimmed(req.body.skill_name, 100);
  if (skillName === '') {
    return redirectTo(res, profileSettingsRedirect('skill-name-required', '#skills'));
  }

  const isRequesting = checked(req.body.is_requesting);
  let status = 'skill-added';
  try {
    await callUserSettings(token, 'POST', '/skills', {
      skill_name: skillName,
      is_offering: checked(req.body.is_offering) || !isRequesting,
      is_requesting: isRequesting
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'skill-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status, '#skills'));
}));

router.post('/skills/remove', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const skillId = positiveInteger(req.body.user_skill_id);
  if (skillId === null) {
    return redirectTo(res, profileSettingsRedirect('skill-failed', '#skills'));
  }

  let status = 'skill-removed';
  try {
    await callUserSettings(token, 'DELETE', `/skills/${skillId}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'skill-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status, '#skills'));
}));

router.post('/safeguarding/revoke', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const optionId = positiveInteger(req.body.option_id);
  if (optionId === null) {
    return redirectTo(res, profileSettingsRedirect('safeguarding-failed', '#safeguarding'));
  }

  let status = 'safeguarding-revoked';
  try {
    await callProfile(token, 'POST', '/safeguarding/revoke', {
      option_id: optionId
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'safeguarding-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status, '#safeguarding'));
}));

router.post('/safeguarding/vetting-review', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    await removeUploadedFiles(req);
    return redirectTo(res, loginRedirect());
  }

  if (hasUnexpectedEmptyWorkflowInput(req)) {
    await removeUploadedFiles(req);
    return redirectTo(res, profileSettingsRedirect('vetting-review-evidence-prohibited', '#safeguarding'));
  }

  let status = 'vetting-review-requested';
  try {
    await callProfile(token, 'POST', '/safeguarding/vetting-review-request');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    status = error?.status === 409
      ? 'vetting-review-unavailable'
      : (code === 'VETTING_EVIDENCE_PROHIBITED' ? 'vetting-review-evidence-prohibited' : 'vetting-review-failed');
  }

  return redirectTo(res, profileSettingsRedirect(status, '#safeguarding'));
}));

router.post('/safeguarding/policy-review', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    await removeUploadedFiles(req);
    return redirectTo(res, loginRedirect());
  }

  if (hasUnexpectedEmptyWorkflowInput(req)) {
    await removeUploadedFiles(req);
    return redirectTo(res, profileSettingsRedirect('safeguarding-policy-review-failed', '#safeguarding'));
  }

  let status = 'safeguarding-policy-reviewed';
  try {
    await callProfile(token, 'POST', '/safeguarding/confirm-policy-review');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'safeguarding-policy-review-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status, '#safeguarding'));
}));

router.post('/data-export', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let status = 'data-export-requested';
  try {
    await callUserSettings(token, 'POST', '/gdpr-request', {
      type: 'portability',
      notes: 'Accessible frontend data export request'
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = error instanceof ApiError && error.status === 409 ? 'data-export-exists' : 'data-export-failed';
  }

  return redirectTo(res, profileSettingsRedirect(status));
}));

router.post('/delete-account', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const password = String(req.body.password || '');
  if (password === '') {
    return redirectTo(res, deleteAccountRedirect('delete-password-required'));
  }
  if (!checked(req.body.confirm)) {
    return redirectTo(res, deleteAccountRedirect('delete-confirm-required'));
  }

  try {
    const result = await requestAccountDeletion(token, {
      password,
      reason: trimmed(req.body.reason) || null
    });
    if (payloadFrom(result).logout_required !== true) {
      throw new ApiError('Laravel did not confirm account-deletion session revocation', 502, {
        errors: [{ code: 'ACCOUNT_DELETION_REVOCATION_UNCONFIRMED' }]
      });
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const status = error instanceof ApiError && error.status === 400
      ? 'delete-password-required'
      : (error instanceof ApiError && error.status === 403 ? 'delete-password-incorrect' : 'delete-failed');
    return redirectTo(res, deleteAccountRedirect(status));
  }

  invalidateUserCache(token);
  await destroyRequestSession(req);
  clearAuthCookies(res);
  return redirectTo(res, '/login?status=account-deletion-requested');
}));

router.get('/delete-account', (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const errorMessage = translateStatusMessage(
    req,
    DELETE_ACCOUNT_ERROR_KEYS[status],
    DELETE_ACCOUNT_ERRORS[status] || ''
  );

  return res.render('profile/delete', {
    title: 'Delete your account',
    titleKey: 'delete_account.title',
    activeNav: 'profile',
    status,
    errorMessage,
    passwordError: ['delete-password-required', 'delete-password-incorrect'].includes(status),
    confirmError: status === 'delete-confirm-required',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community'
  });
});

router.get('/two-factor', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let twoFactor = normalizeTwoFactorPayload({});
  try {
    const statusPayload = payloadFrom(await callProfile(token, 'GET', '/auth/2fa/status'));
    twoFactor = normalizeTwoFactorPayload(statusPayload);

    if (!twoFactor.enabled) {
      const setupPayload = payloadFrom(await callProfile(token, 'POST', '/auth/2fa/setup'));
      twoFactor = normalizeTwoFactorPayload({ ...statusPayload, setup: setupPayload });
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  return renderTwoFactor(req, res, twoFactor, status);
}));

router.get('/blocked', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let blocked = [];
  try {
    blocked = normalizeBlockedUsers(payloadFrom(await callProfile(token, 'GET', '/users/blocked')), res.locals.t);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('profile/blocked', {
    title: 'Blocked members',
    activeNav: 'profile',
    status,
    successStatus: ['member-blocked', 'member-unblocked'].includes(status),
    blocked,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/two-factor/verify', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const code = trimmed(req.body.code);
  if (code === '') {
    return redirectTo(res, twoFactorRedirect('2fa-code-required'));
  }

  try {
    const verifiedPayload = payloadFrom(await callProfile(token, 'POST', '/auth/2fa/verify', { code }));
    const twoFactor = normalizeTwoFactorPayload({
      ...verifiedPayload,
      enabled: true,
      backup_codes_remaining: arrayFromPayload(verifiedPayload, ['backup_codes', 'backupCodes']).length
    });
    return renderTwoFactor(req, res, twoFactor, '2fa-enabled');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 400) {
      return redirectTo(res, twoFactorRedirect('2fa-code-invalid'));
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/500', { title: 'Too many requests' });
    }
    if (error instanceof ApiError && error.status >= 500) {
      const view = error.status === 503 ? 'errors/503' : 'errors/500';
      const title = error.status === 503 ? 'Service unavailable' : 'Problem with the service';
      return res.status(error.status).render(view, { title });
    }
    throw error;
  }
}));

router.post('/two-factor/disable', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const password = String(req.body.password || '');
  if (password === '') {
    return redirectTo(res, twoFactorRedirect('2fa-password-required'));
  }

  try {
    await callProfile(token, 'POST', '/auth/2fa/disable', { password });
    invalidateUserCache(token);
    await destroyRequestSession(req);
    clearAuthCookies(res);
    return redirectTo(res, '/login?status=2fa-disabled');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, twoFactorRedirect('2fa-disable-failed'));
  }
}));

function requireOwnProfileFeature(req, res, next) {
  const tenant = req.accessibleRouting?.tenant;
  if (tenant && typeof tenant === 'object' && !flagEnabled(tenant, 'connections', 'features', true)) {
    return res.status(403).render('errors/403', {
      title: 'Forbidden',
      message: 'This feature is not enabled for this community.'
    });
  }
  return next();
}

// View profile
router.get('/', requireOwnProfileFeature, requireAuth, asyncRoute(async (req, res) => {
  const profile = normalizeProfilePayload(await getRequestProfile(req, req.token));
  const memberId = Number(profile.id || profile.user_id || profile.userId) || null;
  const tenant = req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};
  const profileFeatures = {
    listings: flagEnabled(tenant, 'listings', 'modules', true),
    reviews: flagEnabled(tenant, 'reviews', 'features', true),
    gamification: flagEnabled(tenant, 'gamification', 'features', true)
  };
  const [listingsResult, reviewsResult, gamificationResult, badgesResult] = await Promise.all([
    memberId && profileFeatures.listings
      ? optionalOwnProfileResult(getListings(req.token, { user_id: memberId, limit: 6 }), { data: [] })
      : Promise.resolve({ data: [] }),
    memberId && profileFeatures.reviews
      ? optionalOwnProfileResult(getUserReviews(req.token, memberId), { data: [] })
      : Promise.resolve({ data: [] }),
    memberId && profileFeatures.gamification
      ? optionalOwnProfileResult(getGamificationProfileByUserId(req.token, memberId), { data: null })
      : Promise.resolve({ data: null }),
    memberId && profileFeatures.gamification
      ? optionalOwnProfileResult(getAllBadges(req.token, { user_id: memberId }), { data: [] })
      : Promise.resolve({ data: [] })
  ]);
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const statusConfig = status === 'profile-updated' ? profileStatusConfig(req, status) : null;
  const flashSuccess = req.flash ? req.flash('success')[0] : null;
  const t = typeof req.t === 'function' ? req.t : fallbackTranslator;
  const displayName = ownProfileDisplayName(profile, t);
  const firstName = trimmed(profileValue(profile, 'first_name'));
  const lastName = trimmed(profileValue(profile, 'last_name'));
  const profileType = profileValue(profile, 'profile_type') === 'organisation' ? 'organisation' : 'individual';

  res.render('profile/index', {
    title: displayName,
    activeNav: 'profile',
    alphaActiveNav: 'profile',
    profile,
    displayName,
    initials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || displayName.charAt(0).toUpperCase(),
    avatarUrl: profileValue(profile, 'avatar_url'),
    profileType,
    identityVerified: boolValue(profile.id_verified, profile.idVerified),
    profileStats: ownProfileStats(profile, gamificationResult),
    profileSkills: ownProfileSkills(profile),
    profileListings: ownProfileListings(listingsResult),
    profileReviews: ownProfileReviews(reviewsResult),
    profileBadges: ownProfileBadges(badgesResult),
    joinedLabel: formatProfileDate(profileValue(profile, 'created_at')),
    communityName: res.locals.tenantName || res.locals.serviceName || '',
    profileFeatures,
    successMessage: statusConfig?.message || flashSuccess
  });
}));

module.exports = router;
