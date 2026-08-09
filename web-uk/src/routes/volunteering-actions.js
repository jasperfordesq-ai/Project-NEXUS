// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const {
  ApiError,
  callVolunteeringApi,
  downloadVolunteerCredential,
  getVolunteeringCategories,
  uploadVolunteerCredential
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { isValidEmail } = require('../lib/inputValidator');

const router = express.Router();
const DOWNLOAD_HEADER_NAMES = [
  'content-type',
  'content-disposition',
  'content-length',
  'cache-control',
  'pragma',
  'expires',
  'etag',
  'last-modified'
];
const ACCESSIBILITY_NEED_TYPES = [
  { value: 'mobility', label: 'Mobility' },
  { value: 'visual', label: 'Visual or sight' },
  { value: 'hearing', label: 'Hearing' },
  { value: 'cognitive', label: 'Cognitive or learning' },
  { value: 'dietary', label: 'Dietary' },
  { value: 'language', label: 'Language or communication' },
  { value: 'other', label: 'Other' }
];
const CREDENTIAL_TYPES = [
  { value: 'first_aid', label: 'First aid' },
  { value: 'safeguarding', label: 'Safeguarding' },
  { value: 'manual_handling', label: 'Manual handling' },
  { value: 'food_hygiene', label: 'Food hygiene' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'professional_registration', label: 'Professional registration' },
  { value: 'other', label: 'Other' }
];
const CREDENTIAL_STATUS_LABELS = {
  pending: 'Awaiting review',
  verified: 'Verified',
  rejected: 'Rejected',
  expired: 'Expired',
  retired: 'Removal required'
};
const CREDENTIAL_STATUS_CLASSES = {
  pending: 'govuk-tag--yellow',
  verified: 'govuk-tag--green',
  rejected: 'govuk-tag--red',
  expired: 'govuk-tag--grey',
  retired: 'govuk-tag--red'
};
const EXPENSE_TYPES = [
  { value: 'travel', label: 'Travel' },
  { value: 'meals', label: 'Meals' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'parking', label: 'Parking' },
  { value: 'other', label: 'Other' }
];
const EXPENSE_TYPE_LABELS = Object.fromEntries(EXPENSE_TYPES.map((type) => [type.value, type.label]));
const ALERT_PRIORITY_LABELS = {
  normal: 'Normal',
  urgent: 'Urgent',
  critical: 'Critical'
};
const ALERT_PRIORITY_CLASSES = {
  normal: 'govuk-tag--blue',
  urgent: 'govuk-tag--orange',
  critical: 'govuk-tag--red'
};
const GROUP_RESERVATION_STATUS_LABELS = {
  active: 'Active',
  confirmed: 'Confirmed',
  pending: 'Pending',
  cancelled: 'Cancelled'
};
const GROUP_RESERVATION_STATUS_CLASSES = {
  active: 'govuk-tag--green',
  confirmed: 'govuk-tag--green',
  pending: 'govuk-tag--yellow',
  cancelled: 'govuk-tag--grey'
};
const GROUP_MEMBER_STATUS_LABELS = {
  confirmed: 'Confirmed',
  pending: 'Pending',
  declined: 'Declined'
};
const GROUP_MEMBER_STATUS_CLASSES = {
  confirmed: 'govuk-tag--green',
  pending: 'govuk-tag--yellow',
  declined: 'govuk-tag--red'
};
const SAFEGUARDING_TRAINING_TYPES = [
  { value: 'children_first', label: 'Children First' },
  { value: 'vulnerable_adults', label: 'Vulnerable Adults' },
  { value: 'first_aid', label: 'First Aid' },
  { value: 'manual_handling', label: 'Manual Handling' },
  { value: 'other', label: 'Other' }
];
const SAFEGUARDING_TRAINING_TYPE_LABELS = Object.fromEntries(
  SAFEGUARDING_TRAINING_TYPES.map((type) => [type.value, type.label])
);
const SAFEGUARDING_TRAINING_STATUS_LABELS = {
  pending: 'Pending',
  verified: 'Verified',
  expired: 'Expired',
  rejected: 'Not approved'
};
const SAFEGUARDING_TRAINING_STATUS_CLASSES = {
  pending: 'govuk-tag--yellow',
  verified: 'govuk-tag--green',
  expired: 'govuk-tag--grey',
  rejected: 'govuk-tag--red'
};
const SAFEGUARDING_SEVERITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical'
};
const SAFEGUARDING_SEVERITY_CLASSES = {
  low: 'govuk-tag--blue',
  medium: 'govuk-tag--yellow',
  high: 'govuk-tag--orange',
  critical: 'govuk-tag--red'
};
const SAFEGUARDING_INCIDENT_STATUS_LABELS = {
  open: 'Open',
  investigating: 'Under review',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed'
};
const SAFEGUARDING_INCIDENT_STATUS_CLASSES = {
  open: 'govuk-tag--yellow',
  investigating: 'govuk-tag--blue',
  escalated: 'govuk-tag--red',
  resolved: 'govuk-tag--green',
  closed: 'govuk-tag--grey'
};
const SWAP_STATUS_LABELS = {
  pending: 'Pending',
  admin_pending: 'Awaiting approval',
  accepted: 'Accepted',
  admin_approved: 'Approved',
  rejected: 'Declined',
  admin_rejected: 'Declined by organiser',
  cancelled: 'Cancelled',
  expired: 'Expired'
};
const SWAP_STATUS_CLASSES = {
  pending: 'govuk-tag--yellow',
  admin_pending: 'govuk-tag--yellow',
  accepted: 'govuk-tag--green',
  admin_approved: 'govuk-tag--green',
  rejected: 'govuk-tag--red',
  admin_rejected: 'govuk-tag--red',
  cancelled: 'govuk-tag--grey',
  expired: 'govuk-tag--grey'
};
const VOLUNTEER_ORG_STATUS_LABELS = {
  approved: 'Approved',
  active: 'Active',
  pending: 'Pending',
  declined: 'Declined',
  suspended: 'Suspended'
};
const VOLUNTEER_ORG_STATUS_CLASSES = {
  approved: 'govuk-tag--green',
  active: 'govuk-tag--green',
  pending: 'govuk-tag--yellow',
  declined: 'govuk-tag--red',
  suspended: 'govuk-tag--red'
};
const VOLUNTEER_ORG_ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Administrator',
  member: 'Member'
};

function tokenFrom(req) {
  return req.signedCookies.token || '';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function tenantCurrency(req) {
  const configuredCurrency = trimmed(req.accessibleRouting?.tenant?.settings?.default_currency).toUpperCase();
  return /^[A-Z]{3}$/.test(configuredCurrency) ? configuredCurrency : 'EUR';
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function decimalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function stringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  const single = trimmed(value);
  return single ? [single] : [];
}

function uploadedFile(req, fieldName) {
  const file = req.files && req.files[fieldName];
  return file && typeof file === 'object' ? file : null;
}

async function removeUploadedFile(file) {
  if (!file || !file.filepath) return;
  try {
    await fs.unlink(file.filepath);
  } catch {
    // Temporary upload cleanup is best-effort only.
  }
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function redirectTo(res, pathname) {
  const target = res.locals && typeof res.locals.urlFor === 'function'
    ? res.locals.urlFor(pathname)
    : pathname;
  return res.redirect(target);
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

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function collectionMetaFrom(result) {
  const source = result && typeof result === 'object' ? result : {};
  const data = dataFrom(result);
  const nestedMeta = data && typeof data === 'object' && !Array.isArray(data) && data.meta
    && typeof data.meta === 'object'
    ? data.meta
    : {};
  const topMeta = source.meta && typeof source.meta === 'object' ? source.meta : {};
  const dataMeta = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return { ...dataMeta, ...nestedMeta, ...topMeta };
}

function resultId(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' ? positiveInteger(data.id) : null;
}

async function callApi(token, method, path, data = undefined) {
  if (data === undefined) {
    return callVolunteeringApi(token, method, path);
  }

  return callVolunteeringApi(token, method, path, data);
}

async function runAction(req, res, method, path, data, successRedirect, failureRedirect) {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    const result = await callApi(token, method, path, data);
    const redirect = typeof successRedirect === 'function'
      ? successRedirect(result)
      : successRedirect;
    return redirectTo(res, redirect);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, failureRedirect);
  }
}

function orgManageRedirect(orgId, status) {
  return `/volunteering/organisations/${orgId}/manage?status=${encodeURIComponent(status)}`;
}

function orgWalletRedirect(orgId, status) {
  return `/volunteering/organisations/${orgId}/wallet?status=${encodeURIComponent(status)}`;
}

function orgSettingsRedirect(orgId, status) {
  return `/volunteering/organisations/${orgId}/settings?status=${encodeURIComponent(status)}`;
}

function orgVolunteersHref(orgId, cursor) {
  return `/volunteering/organisations/${orgId}/volunteers?cursor=${encodeURIComponent(cursor)}`;
}

function opportunityRedirect(id, status) {
  return `/volunteering/opportunities/${id}?status=${encodeURIComponent(status)}`;
}

async function runOpportunityAction(req, res, options) {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  try {
    await callApi(token, options.method, options.path, options.data);
    return redirectTo(res, opportunityRedirect(options.opportunityId, options.successStatus));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
      return redirectTo(res, opportunityRedirect(options.opportunityId, options.unavailableStatus));
    }
    if (['SAFEGUARDING_CONTACT_RESTRICTED', 'SAFEGUARDING_INTERACTION_NOT_ALLOWED', 'VETTING_REQUIRED'].includes(code)) {
      return redirectTo(res, opportunityRedirect(options.opportunityId, options.restrictedStatus));
    }
    return redirectTo(res, opportunityRedirect(options.opportunityId, options.failureStatus));
  }
}

function accessibilityStatus(status, t = null) {
  if (status === 'accessibility-saved') {
    return {
      type: 'success',
      message: t ? t('govuk_alpha.volunteering.accessibility_saved') : 'Your accessibility needs have been saved.'
    };
  }
  if (status === 'accessibility-failed') {
    return {
      type: 'error',
      message: t
        ? t('govuk_alpha.volunteering.accessibility_failed')
        : 'Your accessibility needs could not be saved. Try again.'
    };
  }
  return null;
}

function dateLabel(value) {
  const text = trimmed(value);
  if (!text) return '';
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(text);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function isoDateTime(value) {
  const text = trimmed(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function dateTimeLabel(value) {
  const text = trimmed(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(date);
}

function hoursLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : '0.0';
}

function monthLabel(value) {
  const text = trimmed(value);
  const match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) return text;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  if (Number.isNaN(date.getTime())) return text;

  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function certificateStatus(status, t = null) {
  if (status === 'certificate-generated') {
    return {
      type: 'success',
      message: t ? t('govuk_alpha.vol_depth.certificate_generated') : 'Your certificate has been generated.'
    };
  }
  if (status === 'certificate-no-hours') {
    return {
      type: 'error',
      message: t
        ? t('govuk_alpha.vol_depth.certificate_no_hours')
        : 'You do not have any approved volunteering hours to certify yet.'
    };
  }
  return null;
}

function hoursStatus(status, t = null) {
  if (status === 'hours-created') {
    return {
      type: 'success',
      message: t ? t('govuk_alpha.volunteering.hours_created') : 'Your hours have been submitted for review.'
    };
  }
  if (status === 'hours-failed') {
    return {
      type: 'error',
      message: t
        ? t('govuk_alpha.volunteering.hours_failed')
        : 'Your hours could not be logged. Check the details and try again.'
    };
  }
  return null;
}

function wellbeingStatus(status, t = null) {
  if (status === 'checkin-saved') {
    return {
      type: 'success',
      message: t ? t('govuk_alpha_volunteering.wellbeing.checkin_saved') : 'Your check-in has been saved.'
    };
  }
  if (status === 'mood-invalid') {
    return {
      type: 'error',
      message: t ? t('govuk_alpha_volunteering.wellbeing.mood_invalid') : 'Choose a mood between 1 and 5.'
    };
  }
  if (status === 'checkin-failed') {
    return {
      type: 'error',
      message: t
        ? t('govuk_alpha_volunteering.wellbeing.checkin_failed')
        : 'Your check-in could not be saved. Please try again.'
    };
  }
  return null;
}

function donationStatus(status, donateError = '', t = null) {
  if (status === 'donate-recorded') {
    return {
      type: 'success',
      message: t
        ? t('govuk_alpha_volunteering.donations.donate_recorded')
        : 'Thank you. Your donation has been recorded and is awaiting confirmation of payment.'
    };
  }
  if (status === 'donate-failed') {
    const messages = {
      amount: 'error_amount',
      'amount-max': 'error_amount_max',
      validation: 'error_validation'
    };
    const key = messages[donateError] || 'donate_failed';
    return {
      type: 'error',
      message: t
        ? t(`govuk_alpha_volunteering.donations.${key}`)
        : {
          error_amount: 'Enter a donation amount greater than zero',
          error_amount_max: 'Enter a donation amount within the allowed limit',
          error_validation: 'Check your answers and try again',
          donate_failed: 'Your donation could not be recorded. Please try again.'
        }[key],
      field: 'donate-amount'
    };
  }
  return null;
}

function emergencyAlertStatus(status, t = null) {
  const messages = {
    'alert-accepted': {
      type: 'success',
      message: 'Thank you. You have accepted the shift and the coordinator has been notified.'
    },
    'alert-declined': {
      type: 'success',
      message: 'You have declined the shift request.'
    },
    'alert-respond-failed': {
      type: 'error',
      message: 'Your response could not be recorded. The request may have been filled or expired.'
    },
    'alert-safeguarding-restricted': {
      type: 'error',
      message: 'This member has asked for a coordinator to arrange contact on their behalf. Your message has not been sent. Please contact your broker or community administrator so they can help arrange the next safe step.'
    },
    'alert-safeguarding-unavailable': {
      type: 'error',
      message: 'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.'
    }
  };
  const config = messages[status] || null;
  const key = {
    'alert-accepted': 'govuk_alpha_volunteering.emergency.alert_accepted',
    'alert-declined': 'govuk_alpha_volunteering.emergency.alert_declined',
    'alert-respond-failed': 'govuk_alpha_volunteering.emergency.alert_respond_failed',
    'alert-safeguarding-restricted': 'safeguarding.errors.contact_restricted',
    'alert-safeguarding-unavailable': 'safeguarding.errors.policy_unavailable'
  }[status];
  if (key && typeof t === 'function') {
    const translated = t(key);
    return {
      type: ['alert-accepted', 'alert-declined'].includes(status) ? 'success' : 'error',
      message: translated !== key ? translated : config.message
    };
  }
  return config;
}

function apiErrorCode(error) {
  const firstError = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  return trimmed(firstError?.code ?? error?.data?.code).toUpperCase();
}

function groupSignupStatus(status, t = null) {
  const messages = {
    'member-added': { type: 'success', key: 'govuk_alpha_volunteering.group_signups.success_member_added' },
    'member-removed': { type: 'success', key: 'govuk_alpha_volunteering.group_signups.success_member_removed' },
    'reservation-cancelled': { type: 'success', key: 'govuk_alpha_volunteering.group_signups.success_reservation_cancelled' },
    'member-id-required': { type: 'error', key: 'govuk_alpha_volunteering.group_signups.error_member_id_required' },
    'member-add-failed': { type: 'error', key: 'govuk_alpha_volunteering.group_signups.error_member_add_failed' },
    'member-remove-failed': { type: 'error', key: 'govuk_alpha_volunteering.group_signups.error_member_remove_failed' },
    'reservation-cancel-failed': { type: 'error', key: 'govuk_alpha_volunteering.group_signups.error_reservation_cancel_failed' },
    'member-safeguarding-restricted': {
      type: 'error', key: 'safeguarding.errors.interaction_not_allowed',
      fallback: 'The recipient’s community safeguarding policy does not allow this direct interaction. Ask a coordinator for help.'
    },
    'member-safeguarding-unavailable': {
      type: 'error', key: 'safeguarding.errors.policy_unavailable',
      fallback: 'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.'
    }
  };
  const config = messages[status] || null;
  if (!config) return null;
  const translated = t ? t(config.key) : config.key;
  return { ...config, message: translated !== config.key ? translated : (config.fallback || translated) };
}

function safeguardingStatus(status, t = null) {
  const messages = {
    'training-added': { type: 'success', key: 'success_training_added' },
    'incident-reported': { type: 'success', key: 'success_incident_reported' },
    'training-type-required': { type: 'error', key: 'error_training_type_required', field: 'training_type' },
    'training-name-required': { type: 'error', key: 'error_training_name_required', field: 'training_name' },
    'training-date-required': { type: 'error', key: 'error_training_date_required', field: 'completed_at' },
    'training-failed': { type: 'error', key: 'error_training_failed' },
    'incident-title-required': { type: 'error', key: 'error_incident_title_required', field: 'title' },
    'incident-description-too-short': { type: 'error', key: 'error_incident_description_short', field: 'description' },
    'incident-failed': { type: 'error', key: 'error_incident_failed' }
  };
  const config = messages[status] || null;
  return config
    ? { ...config, message: t ? t(`govuk_alpha_volunteering.safeguarding.${config.key}`) : config.key }
    : null;
}

function waitlistStatus(status, t = null) {
  const messages = {
    'waitlist-left': {
      type: 'success',
      key: 'govuk_alpha.vol_depth.waitlist_left'
    },
    'waitlist-leave-failed': {
      type: 'error',
      key: 'govuk_alpha.vol_depth.waitlist_leave_failed'
    }
  };
  const config = messages[status] || null;
  return config ? { ...config, message: t ? t(config.key) : config.key } : null;
}

function swapPageStatus(status, t = null) {
  const messages = {
    'swap-requested': { type: 'success', key: 'govuk_alpha.vol_depth.swap_requested_success' },
    'swap-accepted': { type: 'success', key: 'govuk_alpha.vol_depth.swap_accepted_success' },
    'swap-rejected': { type: 'success', key: 'govuk_alpha.vol_depth.swap_rejected_success' },
    'swap-cancelled': { type: 'success', key: 'govuk_alpha.vol_depth.swap_cancelled_success' },
    'swap-invalid': { type: 'error', key: 'govuk_alpha.vol_depth.swap_invalid' },
    'swap-request-failed': { type: 'error', key: 'govuk_alpha.vol_depth.swap_request_failed' },
    'swap-respond-failed': { type: 'error', key: 'govuk_alpha.vol_depth.swap_respond_failed' },
    'swap-cancel-failed': { type: 'error', key: 'govuk_alpha.vol_depth.swap_cancel_failed' },
    'swap-safeguarding-restricted': {
      type: 'error', key: 'safeguarding.errors.interaction_not_allowed',
      fallback: 'The recipient’s community safeguarding policy does not allow this direct interaction. Ask a coordinator for help.'
    },
    'swap-safeguarding-unavailable': {
      type: 'error', key: 'safeguarding.errors.policy_unavailable',
      fallback: 'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.'
    }
  };
  const config = messages[status] || null;
  if (!config) return null;
  const translated = t ? t(config.key) : config.key;
  return { ...config, message: translated !== config.key ? translated : (config.fallback || translated) };
}

function orgManageStatus(status, t = null) {
  const messages = {
    'application-approved': { type: 'success', key: 'govuk_alpha.vol_org.states.application-approved' },
    'application-declined': { type: 'success', key: 'govuk_alpha.vol_org.states.application-declined' },
    'hours-approved': { type: 'success', key: 'govuk_alpha.vol_org.states.hours-approved' },
    'hours-declined': { type: 'success', key: 'govuk_alpha.vol_org.states.hours-declined' },
    'application-failed': { type: 'error', key: 'govuk_alpha.vol_org.states.application-failed' },
    'application-safeguarding-restricted': {
      type: 'error',
      key: 'safeguarding.errors.interaction_not_allowed',
      fallback: 'The recipient’s community safeguarding policy does not allow this direct interaction. Ask a coordinator for help.'
    },
    'application-safeguarding-unavailable': {
      type: 'error',
      key: 'safeguarding.errors.policy_unavailable',
      fallback: 'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.'
    },
    'hours-verify-failed': { type: 'error', key: 'govuk_alpha.vol_org.states.hours-verify-failed' }
  };
  const config = messages[status] || null;
  if (!config) return null;
  const translated = typeof t === 'function' ? t(config.key) : config.key;
  return {
    ...config,
    message: translated !== config.key ? translated : (config.fallback || translated)
  };
}

function orgSettingsStatus(status, t = null) {
  const messages = {
    'settings-saved': { type: 'success', key: 'govuk_alpha_volunteering.org_settings.saved' },
    'name-required': { type: 'error', key: 'govuk_alpha_volunteering.org_settings.error_name_required', field: 'name' },
    'email-invalid': { type: 'error', key: 'govuk_alpha_volunteering.org_settings.error_email_invalid', field: 'contact_email' },
    'settings-failed': { type: 'error', key: 'govuk_alpha_volunteering.org_settings.save_failed' }
  };
  const config = messages[status] || null;
  if (!config) return null;
  return {
    ...config,
    message: typeof t === 'function' ? t(config.key) : config.key
  };
}

function orgWalletStatus(status, t = null) {
  const messages = {
    'deposit-made': { type: 'success', key: 'govuk_alpha_volunteering.org_wallet.deposit_made' },
    'auto-credit-always-on': { type: 'success', key: 'govuk_alpha_volunteering.org_wallet.auto_credit_always_on' },
    'deposit-failed': { type: 'error', key: 'govuk_alpha_volunteering.org_wallet.deposit_failed' },
    'deposit-amount-invalid': { type: 'error', key: 'govuk_alpha_volunteering.org_wallet.deposit_amount_invalid' }
  };
  const config = messages[status] || null;
  if (!config) return null;
  return {
    ...config,
    message: typeof t === 'function' ? t(config.key) : config.key
  };
}

function expenseStatus(status, t = null) {
  const messages = {
    'expense-submitted': { type: 'success', key: 'success_submitted' },
    'expense-org-required': { type: 'error', key: 'error_org_required', field: 'organization_id' },
    'expense-amount-invalid': { type: 'error', key: 'error_amount_invalid', field: 'amount' },
    'expense-description-required': { type: 'error', key: 'error_description_required', field: 'description' },
    'expense-validation': { type: 'error', key: 'error_validation' },
    'expense-forbidden': { type: 'error', key: 'error_forbidden' },
    'expense-not-found': { type: 'error', key: 'error_not_found' },
    'expense-failed': { type: 'error', key: 'error_failed' }
  };
  const config = messages[status] || null;
  return config
    ? { ...config, message: t ? t(`govuk_alpha_volunteering.expenses.${config.key}`) : config.key }
    : null;
}

function credentialStatus(status, t = null) {
  const messages = {
    'credential-uploaded': { type: 'success', key: 'uploaded' },
    'credential-deleted': { type: 'success', key: 'deleted' },
    'credential-type-required': { type: 'error', key: 'type_required', field: 'credential_type' },
    'credential-vetting-prohibited': { type: 'error', key: 'vetting_prohibited' },
    'credential-file-required': { type: 'error', key: 'file_required', field: 'document' },
    'credential-file-type': { type: 'error', key: 'file_type', field: 'document' },
    'credential-file-size': { type: 'error', key: 'file_size', field: 'document' },
    'credential-upload-failed': { type: 'error', key: 'upload_failed' },
    'credential-delete-failed': { type: 'error', key: 'delete_failed' }
  };
  const config = messages[status] || null;
  if (!config) return null;
  const message = t ? t(`govuk_alpha_volunteering.credentials.${config.key}`) : config.key;
  return { ...config, message, linkText: message.replace(/[.]$/, '') };
}

function headline(value) {
  return trimmed(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function credentialRowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.credentials)) return data.credentials;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function credentialStatusPresentation(status, t = null) {
  const value = trimmed(status) || 'pending';
  const key = `govuk_alpha_volunteering.credentials.status_${value}`;
  const translated = t ? t(key) : key;
  return {
    value,
    label: translated !== key
      ? translated
      : (CREDENTIAL_STATUS_LABELS[value] || headline(value) || 'Awaiting review'),
    className: CREDENTIAL_STATUS_CLASSES[value] || 'govuk-tag--grey'
  };
}

function normalizeHourSummary(result) {
  const summary = dataFrom(result);
  const data = summary && typeof summary === 'object' ? summary : {};
  return {
    approvedHoursLabel: hoursLabel(data.total_approved_hours ?? data.approved_hours ?? data.total_verified),
    pendingHoursLabel: hoursLabel(data.pending_hours ?? data.total_pending),
    thisMonthHoursLabel: hoursLabel(data.this_month_hours),
    approvedTotal: Number(data.total_approved_hours ?? data.approved_hours ?? data.total_verified) || 0,
    byOrganization: Array.isArray(data.by_organization)
      ? data.by_organization.map((row) => ({
        name: trimmed(row?.name),
        hoursLabel: hoursLabel(row?.hours)
      })).filter((row) => row.name)
      : [],
    byMonth: Array.isArray(data.by_month)
      ? data.by_month.map((row) => ({
        monthLabel: monthLabel(row?.month),
        hoursLabel: hoursLabel(row?.hours)
      })).filter((row) => row.monthLabel)
      : []
  };
}

function riskPresentation(value, t = null) {
  const risk = ['low', 'moderate', 'high'].includes(trimmed(value)) ? trimmed(value) : 'low';
  const labels = {
    low: 'Low',
    moderate: 'Moderate',
    high: 'High'
  };
  const classNames = {
    low: 'govuk-tag--green',
    moderate: 'govuk-tag--yellow',
    high: 'govuk-tag--red'
  };
  return {
    value: risk,
    label: t ? t(`govuk_alpha_volunteering.wellbeing.risk_${risk}`) : labels[risk],
    className: classNames[risk]
  };
}

function warningLabel(value, t = null) {
  const text = trimmed(value?.message ?? value?.type ?? value);
  const labels = {
    frequency: 'Your shift frequency is declining.',
    cancellation: 'Your cancellation rate is higher than usual.',
    hours: 'Your logged hours are dropping significantly.',
    engagement: 'It has been a while since your last activity.'
  };
  if (!Object.hasOwn(labels, text)) return '';
  return t ? t(`govuk_alpha_volunteering.wellbeing.warning_${text}`) : labels[text];
}

function moodLabel(value, t = null) {
  const mood = Number(value);
  const labels = {
    1: '1 — Struggling',
    2: '2 — Low',
    3: '3 — Okay',
    4: '4 — Good',
    5: '5 — Great'
  };
  return Object.hasOwn(labels, mood) && t
    ? t(`govuk_alpha_volunteering.wellbeing.mood_${mood}`)
    : (labels[mood] || trimmed(value));
}

function bladeDateTimeLabel(value) {
  if (!value) return '';
  const text = String(value);
  const isoParts = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const year = isoParts ? Number(isoParts[1]) : date.getFullYear();
  const monthIndex = isoParts ? Number(isoParts[2]) - 1 : date.getMonth();
  const day = isoParts ? Number(isoParts[3]) : date.getDate();
  const hours = isoParts ? Number(isoParts[4]) : date.getHours();
  const minutes = isoParts ? Number(isoParts[5]) : date.getMinutes();
  const month = new Intl.DateTimeFormat(getRequestIntlLocale(), {
    month: 'long',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, monthIndex, day)));
  const hour = hours % 12 || 12;
  const minute = String(minutes).padStart(2, '0');
  const period = hours < 12 ? 'am' : 'pm';
  return `${day} ${month} ${year}, ${hour}:${minute}${period}`;
}

function normalizeCheckin(row, t = null) {
  const checkin = row && typeof row === 'object' ? row : {};
  const mood = Number(checkin.mood);
  return {
    id: positiveInteger(checkin.id),
    createdAtLabel: bladeDateTimeLabel(checkin.created_at ?? checkin.createdAt),
    moodLabel: moodLabel(mood, t),
    note: trimmed(checkin.note)
  };
}

function normalizeWellbeingDashboard(result, t = null) {
  const dashboard = dataFrom(result);
  const data = dashboard && typeof dashboard === 'object' ? dashboard : {};
  const rawScore = Number(data.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 100;
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.map((warning) => warningLabel(warning, t)).filter(Boolean)
    : [];
  const checkins = Array.isArray(data.recent_checkins)
    ? data.recent_checkins
    : (Array.isArray(data.recentCheckins) ? data.recentCheckins : []);

  return {
    score,
    risk: riskPresentation(data.burnout_risk ?? data.burnoutRisk, t),
    hoursThisWeekLabel: hoursLabel(data.hours_this_week ?? data.hoursThisWeek),
    hoursThisMonthLabel: hoursLabel(data.hours_this_month ?? data.hoursThisMonth),
    streakDays: Number.isFinite(Number(data.streak_days ?? data.streakDays))
      ? Number(data.streak_days ?? data.streakDays)
      : 0,
    warnings,
    moodOptions: [1, 2, 3, 4, 5].map((value) => ({
      value,
      label: moodLabel(value, t),
      checked: value === 3
    })),
    recentCheckins: checkins.map((checkin) => normalizeCheckin(checkin, t))
  };
}

function moneyLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function percentageLabel(value, total) {
  const amount = Number(value);
  const goal = Number(total);
  if (!Number.isFinite(amount) || !Number.isFinite(goal) || goal <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((amount / goal) * 100)));
}

function donationMethodLabel(value, t = null) {
  const keys = {
    bank_transfer: 'method_bank_transfer',
    paypal: 'method_paypal',
    card: 'method_card',
    stripe: 'method_stripe'
  };
  const method = trimmed(value);
  if (keys[method] && t) return t(`govuk_alpha_volunteering.donations.${keys[method]}`);
  const labels = { bank_transfer: 'Bank transfer', paypal: 'PayPal', card: 'Card', stripe: 'Card' };
  return labels[method] || method || '—';
}

function donationStatusPresentation(value, t = null) {
  const status = trimmed(value) || 'pending';
  const keys = {
    pending: 'status_pending',
    completed: 'status_completed',
    failed: 'status_failed',
    refunded: 'status_refunded'
  };
  const classNames = {
    pending: 'govuk-tag--yellow',
    completed: 'govuk-tag--green',
    failed: 'govuk-tag--red',
    refunded: 'govuk-tag--grey'
  };
  return {
    value: status,
    label: t
      ? t(`govuk_alpha_volunteering.donations.${keys[status] || 'status_pending'}`)
      : ({ pending: 'Pending', completed: 'Completed', failed: 'Failed', refunded: 'Refunded' }[status] || 'Pending'),
    className: classNames[status] || 'govuk-tag--grey'
  };
}

function givingDayStatusPresentation(value, isActive = false, t = null) {
  const status = trimmed(value) || (isActive ? 'active' : 'ended');
  const keys = {
    active: 'day_status_active',
    upcoming: 'day_status_upcoming',
    ended: 'day_status_ended'
  };
  const classNames = {
    active: 'govuk-tag--green',
    upcoming: 'govuk-tag--blue',
    ended: 'govuk-tag--grey'
  };
  return {
    value: status,
    label: t
      ? t(`govuk_alpha_volunteering.donations.${keys[status] || 'day_status_ended'}`)
      : ({ active: 'Active', upcoming: 'Upcoming', ended: 'Ended' }[status] || 'Ended'),
    className: classNames[status] || 'govuk-tag--grey'
  };
}

function normalizeGivingDay(row, t = null) {
  const day = row && typeof row === 'object' ? row : {};
  const goal = Number(day.goal_amount ?? day.target_amount);
  const raised = Number(day.raised_amount);
  const status = givingDayStatusPresentation(day.status, checked(day.is_active), t);
  const donorCount = Number(day.donor_count);
  const percent = percentageLabel(raised, goal);
  return {
    id: positiveInteger(day.id),
    title: trimmed(day.title ?? day.name),
    description: trimmed(day.description),
    status,
    goalLabel: moneyLabel(goal),
    raisedLabel: moneyLabel(raised),
    donorCount: Number.isFinite(donorCount) ? donorCount : 0,
    endDateLabel: dateLabel(day.end_date ?? day.ends_at ?? day.endsAt),
    percent
  };
}

function normalizeDonation(row, t = null) {
  const donation = row && typeof row === 'object' ? row : {};
  return {
    id: positiveInteger(donation.id),
    amountLabel: moneyLabel(donation.amount),
    currency: trimmed(donation.currency),
    status: donationStatusPresentation(donation.status, t),
    methodLabel: donationMethodLabel(donation.payment_method ?? donation.paymentMethod, t),
    createdAtLabel: dateLabel(donation.created_at ?? donation.createdAt),
    message: trimmed(donation.message),
    isAnonymous: checked(donation.is_anonymous ?? donation.isAnonymous)
  };
}

function normalizeDonationDashboard(givingDaysResult, donationsResult, t = null) {
  const givingDays = collectionFrom(givingDaysResult).map((day) => normalizeGivingDay(day, t));
  const donations = collectionFrom(donationsResult).map((donation) => normalizeDonation(donation, t));
  const stats = givingDays.reduce((totals, day) => ({
    totalRaised: totals.totalRaised + Number(day.raisedLabel),
    totalDonors: totals.totalDonors + day.donorCount,
    activeCampaigns: totals.activeCampaigns + (day.status.value === 'active' ? 1 : 0)
  }), { totalRaised: 0, totalDonors: 0, activeCampaigns: 0 });

  return {
    givingDays,
    donations,
    paymentMethods: [
      { value: 'bank_transfer', label: donationMethodLabel('bank_transfer', t), checked: true },
      { value: 'paypal', label: donationMethodLabel('paypal', t), checked: false }
    ],
    stats: {
      totalRaisedLabel: moneyLabel(stats.totalRaised),
      totalDonors: stats.totalDonors,
      activeCampaigns: stats.activeCampaigns
    }
  };
}

function alertRowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.alerts)) return data.alerts;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function alertPriorityPresentation(value, t = null) {
  const priority = trimmed(value) || 'urgent';
  return {
    value: priority,
    label: typeof t === 'function'
      ? t(`govuk_alpha_volunteering.emergency.priority_${['normal', 'urgent', 'critical'].includes(priority) ? priority : 'urgent'}`)
      : (ALERT_PRIORITY_LABELS[priority] || headline(priority) || 'Urgent'),
    className: ALERT_PRIORITY_CLASSES[priority] || 'govuk-tag--grey'
  };
}

function normalizeEmergencyAlert(row, t = null) {
  const alert = row && typeof row === 'object' ? row : {};
  const shift = alert.shift && typeof alert.shift === 'object' ? alert.shift : {};
  const opportunity = alert.opportunity && typeof alert.opportunity === 'object' ? alert.opportunity : {};
  const organization = alert.organization && typeof alert.organization === 'object' ? alert.organization : {};
  const coordinator = alert.coordinator && typeof alert.coordinator === 'object' ? alert.coordinator : {};
  const startLabel = dateTimeLabel(shift.start_time ?? shift.startTime);
  const endLabel = dateTimeLabel(shift.end_time ?? shift.endTime);

  return {
    id: positiveInteger(alert.id),
    priority: alertPriorityPresentation(alert.priority, t),
    message: trimmed(alert.message),
    myResponse: trimmed(alert.my_response ?? alert.myResponse) || 'pending',
    skills: stringArray(alert.required_skills ?? alert.requiredSkills).join(', '),
    expiresAtLabel: dateTimeLabel(alert.expires_at ?? alert.expiresAt),
    opportunityTitle: trimmed(opportunity.title) || (typeof t === 'function' ? t('volunteering.detail_title') : 'Volunteering opportunity'),
    location: trimmed(opportunity.location),
    organizationName: trimmed(organization.name),
    coordinatorName: trimmed(coordinator.name),
    shiftLabel: startLabel && endLabel ? `${startLabel} – ${endLabel}` : startLabel
  };
}

function normalizeEmergencyAlertDashboard(result, t = null) {
  const data = dataFrom(result);
  const meta = data && typeof data === 'object' ? data : {};
  const nextCursor = trimmed(meta.cursor ?? meta.next_cursor ?? meta.nextCursor);
  const hasMore = Boolean(meta.has_more ?? meta.hasMore);

  return {
    alerts: alertRowsFrom(result).map((alert) => normalizeEmergencyAlert(alert, t)).filter((alert) => alert.id),
    nextHref: hasMore && nextCursor ? `/volunteering/emergency-alerts?cursor=${encodeURIComponent(nextCursor)}` : ''
  };
}

function groupReservationRowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.reservations)) return data.reservations;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function statusPresentation(value, labels, classNames, fallback) {
  const status = trimmed(value) || fallback;
  return {
    value: status,
    label: labels[status] || headline(status) || headline(fallback),
    className: classNames[status] || 'govuk-tag--grey'
  };
}

function normalizeGroupMember(row, t = null) {
  const member = row && typeof row === 'object' ? row : {};
  const statusValue = Object.hasOwn(GROUP_MEMBER_STATUS_LABELS, trimmed(member.status))
    ? trimmed(member.status)
    : 'pending';
  return {
    id: positiveInteger(member.id ?? member.user_id ?? member.userId),
    name: trimmed(member.name),
    status: {
      ...statusPresentation(statusValue, GROUP_MEMBER_STATUS_LABELS, GROUP_MEMBER_STATUS_CLASSES, 'pending'),
      label: t
        ? t(`govuk_alpha_volunteering.group_signups.member_status_${statusValue}`)
        : GROUP_MEMBER_STATUS_LABELS[statusValue]
    }
  };
}

function normalizeGroupReservation(row, t = null) {
  const reservation = row && typeof row === 'object' ? row : {};
  const shift = reservation.shift && typeof reservation.shift === 'object' ? reservation.shift : {};
  const opportunity = reservation.opportunity && typeof reservation.opportunity === 'object' ? reservation.opportunity : {};
  const organization = reservation.organization && typeof reservation.organization === 'object' ? reservation.organization : {};
  const members = Array.isArray(reservation.members)
    ? reservation.members.map((member) => normalizeGroupMember(member, t))
    : [];
  const confirmedCount = members.filter((member) => member.status.value === 'confirmed').length;
  const maxMembers = positiveInteger(reservation.max_members ?? reservation.maxMembers);
  const isLeader = checked(reservation.is_leader ?? reservation.isLeader);
  const statusValue = Object.hasOwn(GROUP_RESERVATION_STATUS_LABELS, trimmed(reservation.status))
    ? trimmed(reservation.status)
    : 'active';
  const status = {
    ...statusPresentation(statusValue, GROUP_RESERVATION_STATUS_LABELS, GROUP_RESERVATION_STATUS_CLASSES, 'active'),
    label: t
      ? t(`govuk_alpha_volunteering.group_signups.status_${statusValue}`)
      : GROUP_RESERVATION_STATUS_LABELS[statusValue]
  };
  const isCancelled = status.value === 'cancelled';
  const membersCountLabel = maxMembers
    ? (t
      ? t('govuk_alpha_volunteering.group_signups.members_count', { filled: confirmedCount, total: maxMembers })
      : `${confirmedCount} of ${maxMembers} slots filled`)
    : (t
      ? t('govuk_alpha_volunteering.group_signups.members_count_open', { count: members.length })
      : `${members.length} members`);

  return {
    id: positiveInteger(reservation.id),
    groupName: trimmed(reservation.group_name ?? reservation.groupName)
      || (t ? t('govuk_alpha_volunteering.group_signups.title') : 'Group sign-ups'),
    status,
    isLeader,
    isCancelled,
    opportunityId: positiveInteger(opportunity.id),
    opportunityTitle: trimmed(opportunity.title),
    organizationName: trimmed(organization.name),
    location: trimmed(opportunity.location),
    shiftLabel: dateTimeLabel(shift.start_time ?? shift.startTime),
    createdAtLabel: dateLabel(reservation.created_at ?? reservation.createdAt),
    members,
    confirmedCount,
    maxMembers,
    membersCountLabel,
    canAddMembers: isLeader && !isCancelled && (!maxMembers || confirmedCount < maxMembers)
  };
}

function safeguardingRowsFrom(result, keys = []) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (data && Array.isArray(data[key])) return data[key];
  }
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function normalizeSafeguardingTraining(row, t = null) {
  const training = row && typeof row === 'object' ? row : {};
  const type = trimmed(training.training_type ?? training.trainingType);
  const rawStatus = trimmed(training.status);
  const statusValue = Object.hasOwn(SAFEGUARDING_TRAINING_STATUS_LABELS, rawStatus) ? rawStatus : 'pending';
  return {
    id: positiveInteger(training.id),
    trainingName: trimmed(training.training_name ?? training.trainingName),
    provider: trimmed(training.provider),
    type: {
      value: type,
      label: Object.hasOwn(SAFEGUARDING_TRAINING_TYPE_LABELS, type) && t
        ? t(`govuk_alpha_volunteering.safeguarding.training_type_${type}`)
        : (SAFEGUARDING_TRAINING_TYPE_LABELS[type] || headline(type))
    },
    completedAtLabel: dateLabel(training.completed_at ?? training.completedAt),
    expiresAtLabel: dateLabel(training.expires_at ?? training.expiresAt),
    status: {
      ...statusPresentation(statusValue, SAFEGUARDING_TRAINING_STATUS_LABELS, SAFEGUARDING_TRAINING_STATUS_CLASSES, 'pending'),
      label: t
        ? t(`govuk_alpha_volunteering.safeguarding.status_${statusValue}`)
        : SAFEGUARDING_TRAINING_STATUS_LABELS[statusValue]
    }
  };
}

function normalizeSafeguardingIncident(row, t = null) {
  const incident = row && typeof row === 'object' ? row : {};
  const description = trimmed(incident.description);
  const rawSeverity = trimmed(incident.severity);
  const severityValue = Object.hasOwn(SAFEGUARDING_SEVERITY_LABELS, rawSeverity) ? rawSeverity : 'low';
  const rawStatus = trimmed(incident.status);
  const statusValue = Object.hasOwn(SAFEGUARDING_INCIDENT_STATUS_LABELS, rawStatus) ? rawStatus : 'open';
  return {
    id: positiveInteger(incident.id),
    title: trimmed(incident.title),
    description,
    descriptionExcerpt: description.length > 100 ? `${description.slice(0, 97)}...` : description,
    severity: {
      ...statusPresentation(severityValue, SAFEGUARDING_SEVERITY_LABELS, SAFEGUARDING_SEVERITY_CLASSES, 'low'),
      label: t
        ? t(`govuk_alpha_volunteering.safeguarding.severity_${severityValue}`)
        : SAFEGUARDING_SEVERITY_LABELS[severityValue]
    },
    status: {
      ...statusPresentation(statusValue, SAFEGUARDING_INCIDENT_STATUS_LABELS, SAFEGUARDING_INCIDENT_STATUS_CLASSES, 'open'),
      label: t
        ? t(`govuk_alpha_volunteering.safeguarding.incident_status_${statusValue}`)
        : SAFEGUARDING_INCIDENT_STATUS_LABELS[statusValue]
    },
    category: trimmed(incident.category),
    createdAtLabel: dateLabel(incident.created_at ?? incident.createdAt)
  };
}

function normalizeWaitlistEntry(row, t = null) {
  const entry = row && typeof row === 'object' ? row : {};
  const shift = entry.shift && typeof entry.shift === 'object' ? entry.shift : {};
  const opportunity = entry.opportunity && typeof entry.opportunity === 'object' ? entry.opportunity : {};
  const organization = entry.organization && typeof entry.organization === 'object' ? entry.organization : {};
  const status = trimmed(entry.status) || 'waiting';
  const position = Number(entry.position);
  return {
    id: positiveInteger(entry.id),
    position: Number.isFinite(position) ? position : 0,
    status,
    isNotified: status === 'notified',
    shiftId: positiveInteger(shift.id ?? entry.shift_id ?? entry.shiftId),
    title: trimmed(opportunity.title)
      || (t ? t('govuk_alpha.volunteering.detail_title') : 'Volunteering opportunity'),
    location: trimmed(opportunity.location),
    organizationName: trimmed(organization.name),
    shiftLabel: dateTimeLabel(shift.start_time ?? shift.startTime),
    joinedAtLabel: dateTimeLabel(entry.joined_at ?? entry.joinedAt ?? entry.created_at ?? entry.createdAt)
  };
}

function normalizeMyShift(row) {
  const shift = row && typeof row === 'object' ? row : {};
  const id = positiveInteger(shift.id ?? shift.shift_id ?? shift.shiftId);
  const title = trimmed(shift.opportunity_title ?? shift.opportunityTitle ?? shift.title) || 'Volunteering opportunity';
  const when = dateTimeLabel(shift.start_time ?? shift.startTime);
  return {
    id,
    label: when ? `${title} — ${when}` : title
  };
}

function normalizeSwapShift(row, t = null) {
  const shift = row && typeof row === 'object' ? row : {};
  return {
    id: positiveInteger(shift.id),
    title: trimmed(shift.opportunity_title ?? shift.opportunityTitle)
      || (t ? t('govuk_alpha.volunteering.detail_title') : 'Volunteering opportunity'),
    organizationName: trimmed(shift.organization_name ?? shift.organizationName),
    startLabel: dateTimeLabel(shift.start_time ?? shift.startTime)
  };
}

function normalizeSwapRequest(row, t = null) {
  const swap = row && typeof row === 'object' ? row : {};
  const direction = trimmed(swap.direction) === 'received' ? 'received' : 'sent';
  const statusValue = Object.hasOwn(SWAP_STATUS_LABELS, trimmed(swap.status)) ? trimmed(swap.status) : 'pending';
  const requester = swap.requester && typeof swap.requester === 'object' ? swap.requester : {};
  const recipient = swap.recipient && typeof swap.recipient === 'object' ? swap.recipient : {};
  return {
    id: positiveInteger(swap.id),
    direction,
    directionLabel: t
      ? t(`govuk_alpha.vol_depth.swap_${direction}`)
      : (direction === 'sent' ? 'Sent' : 'Received'),
    directionClassName: direction === 'sent' ? 'govuk-tag--blue' : 'govuk-tag--purple',
    status: {
      ...statusPresentation(statusValue, SWAP_STATUS_LABELS, SWAP_STATUS_CLASSES, 'pending'),
      label: t ? t(`govuk_alpha.vol_depth.swap_status_${statusValue}`) : SWAP_STATUS_LABELS[statusValue]
    },
    message: trimmed(swap.message),
    requesterName: trimmed(requester.name),
    recipientName: trimmed(recipient.name),
    originalShift: normalizeSwapShift(swap.original_shift ?? swap.originalShift, t),
    proposedShift: normalizeSwapShift(swap.proposed_shift ?? swap.proposedShift, t)
  };
}

function normalizeVolunteerOrganizationCard(row, t = null) {
  const organization = row && typeof row === 'object' ? row : {};
  const id = positiveInteger(organization.id);
  const statusValue = trimmed(organization.status) || 'pending';
  const roleValue = trimmed(organization.member_role ?? organization.memberRole ?? organization.role) || 'member';
  const website = trimmed(organization.website);
  const websiteHref = /^https?:\/\//i.test(website) ? website : '';
  return {
    id,
    name: trimmed(organization.name) || `Organisation ${id || ''}`.trim(),
    status: {
      ...statusPresentation(statusValue, VOLUNTEER_ORG_STATUS_LABELS, VOLUNTEER_ORG_STATUS_CLASSES, 'pending'),
      label: Object.hasOwn(VOLUNTEER_ORG_STATUS_LABELS, statusValue) && t
        ? t(`govuk_alpha.volunteering.status_values.${statusValue}`)
        : (VOLUNTEER_ORG_STATUS_LABELS[statusValue] || headline(statusValue))
    },
    roleValue,
    roleLabel: Object.hasOwn(VOLUNTEER_ORG_ROLE_LABELS, roleValue) && t
      ? t(`govuk_alpha.volunteering.roles.${roleValue}`)
      : (VOLUNTEER_ORG_ROLE_LABELS[roleValue] || headline(roleValue) || 'Member'),
    contactEmail: trimmed(organization.contact_email ?? organization.contactEmail ?? organization.email),
    website,
    websiteHref,
    description: trimmed(String(organization.description || '').replace(/<[^>]*>/g, ''), 220),
    canManage: ['owner', 'admin'].includes(roleValue),
    isApproved: ['approved', 'active'].includes(statusValue)
  };
}

function normalizeRecommendedShift(row, t = null) {
  const shift = row && typeof row === 'object' ? row : {};
  const matchScore = Number(shift.match_score ?? shift.matchScore);
  const spotsRemaining = Number(shift.spots_remaining ?? shift.spotsRemaining);
  return {
    id: positiveInteger(shift.shift_id ?? shift.shiftId ?? shift.id),
    opportunityId: positiveInteger(shift.opportunity_id ?? shift.opportunityId),
    title: trimmed(shift.title ?? shift.opportunity_title ?? shift.opportunityTitle)
      || (t ? t('govuk_alpha.volunteering.detail_title') : 'Volunteering opportunity'),
    organizationName: trimmed(shift.organization_name ?? shift.organizationName),
    location: trimmed(shift.location),
    startLabel: bladeDateTimeLabel(shift.start_time ?? shift.startTime),
    spotsRemaining: Number.isFinite(spotsRemaining) ? spotsRemaining : 0,
    matchScore: Number.isFinite(matchScore) ? Math.max(0, Math.min(100, Math.round(matchScore))) : 0,
    alreadyApplied: Boolean(shift.already_applied ?? shift.alreadyApplied)
  };
}

function volunteeringMyOrganisationsNextHref(roleFilter, meta) {
  const nextCursor = trimmed(meta.cursor ?? meta.next_cursor ?? meta.nextCursor);
  const hasMore = Boolean(meta.has_more ?? meta.hasMore);
  if (!hasMore || !nextCursor) {
    return '';
  }

  const params = new URLSearchParams();
  if (roleFilter) params.set('role', roleFilter);
  params.set('cursor', nextCursor);
  return `/volunteering/my-organisations?${params.toString()}`;
}

function normalizeOrgStats(result) {
  const data = dataFrom(result);
  const stats = data && typeof data === 'object' ? data : {};
  const orgStatus = trimmed(stats.status) || 'approved';
  return {
    orgName: trimmed(stats.org_name ?? stats.orgName) || 'Volunteering organisation',
    orgStatus,
    isApproved: ['approved', 'active'].includes(orgStatus),
    activeOpportunities: Number(stats.active_opportunities ?? stats.activeOpportunities) || 0,
    pendingApplications: Number(stats.pending_applications ?? stats.pendingApplications) || 0,
    pendingHours: Number(stats.pending_hours ?? stats.pendingHours) || 0,
    totalVolunteers: Number(stats.total_volunteers ?? stats.totalVolunteers) || 0,
    totalApprovedHoursLabel: hoursLabel(stats.total_approved_hours ?? stats.totalApprovedHours),
    walletBalanceLabel: hoursLabel(stats.wallet_balance ?? stats.walletBalance),
    autoPayEnabled: checked(stats.auto_pay_enabled ?? stats.autoPayEnabled)
  };
}

function normalizeOrgDetail(result) {
  const data = dataFrom(result);
  const organization = data && typeof data === 'object' ? data : {};
  return {
    id: positiveInteger(organization.id),
    name: trimmed(organization.name),
    description: trimmed(organization.description),
    contactEmail: trimmed(organization.contact_email ?? organization.contactEmail ?? organization.email),
    website: trimmed(organization.website)
  };
}

function normalizeOrgApplication(row, t = null) {
  const application = row && typeof row === 'object' ? row : {};
  const user = application.user && typeof application.user === 'object' ? application.user : {};
  const opportunity = application.opportunity && typeof application.opportunity === 'object' ? application.opportunity : {};
  const shift = application.shift && typeof application.shift === 'object' ? application.shift : null;
  return {
    id: positiveInteger(application.id),
    status: trimmed(application.status) || 'pending',
    message: trimmed(application.message),
    createdAtLabel: dateLabel(application.created_at ?? application.createdAt),
    applicant: {
      id: positiveInteger(user.id ?? application.user_id ?? application.userId),
      name: trimmed(user.name ?? application.user_name ?? application.userName)
        || (typeof t === 'function' ? t('govuk_alpha.vol_org.applicant_unknown') : 'A volunteer'),
      email: trimmed(user.email ?? application.user_email ?? application.userEmail)
    },
    opportunity: {
      id: positiveInteger(opportunity.id ?? application.opportunity_id ?? application.opportunityId),
      title: trimmed(opportunity.title ?? application.opportunity_title ?? application.opportunityTitle) || 'Volunteering opportunity'
    },
    shiftLabel: shift ? dateTimeLabel(shift.start_time ?? shift.startTime) : ''
  };
}

function normalizeOrgPendingHour(row, t = null) {
  const log = row && typeof row === 'object' ? row : {};
  const user = log.user && typeof log.user === 'object' ? log.user : {};
  const opportunity = log.opportunity && typeof log.opportunity === 'object' ? log.opportunity : {};
  return {
    id: positiveInteger(log.id),
    hoursLabel: hoursLabel(log.hours),
    dateLabel: dateLabel(log.date ?? log.date_logged ?? log.dateLogged),
    description: trimmed(log.description),
    volunteer: {
      id: positiveInteger(user.id ?? log.user_id ?? log.userId),
      name: trimmed(user.name ?? log.user_name ?? log.userName)
        || (typeof t === 'function' ? t('govuk_alpha.vol_org.applicant_unknown') : 'A volunteer')
    },
    opportunity: {
      id: positiveInteger(opportunity.id ?? log.opportunity_id ?? log.opportunityId),
      title: trimmed(opportunity.title ?? log.opportunity_title ?? log.opportunityTitle)
    }
  };
}

function normalizeOrgVolunteer(row, t = null) {
  const volunteer = row && typeof row === 'object' ? row : {};
  const totalHours = Number(volunteer.total_hours ?? volunteer.totalHours);
  const appliedAt = volunteer.applied_at ?? volunteer.appliedAt;
  return {
    id: positiveInteger(volunteer.id),
    name: trimmed(volunteer.name) || (typeof t === 'function' ? t('members.unknown_member') : 'Unknown member'),
    email: trimmed(volunteer.email),
    totalHoursLabel: Number.isFinite(totalHours) ? totalHours.toFixed(2) : '0.00',
    applicationsCount: Number(volunteer.applications_count ?? volunteer.applicationsCount) || 0,
    appliedAtLabel: dateLabel(appliedAt),
    appliedAtIso: isoDateTime(appliedAt)
  };
}

function orgVolunteersNextHref(orgId, meta) {
  const nextCursor = trimmed(meta.cursor ?? meta.next_cursor ?? meta.nextCursor);
  const hasMore = Boolean(meta.has_more ?? meta.hasMore);
  return hasMore && nextCursor ? orgVolunteersHref(orgId, nextCursor) : '';
}

function normalizeOrgWalletSummary(result) {
  const data = dataFrom(result);
  const summary = data && typeof data === 'object' ? data : {};
  return {
    balanceLabel: hoursLabel(summary.balance),
    totalDepositedLabel: hoursLabel(summary.total_deposited ?? summary.totalDeposited),
    totalPaidOutLabel: hoursLabel(summary.total_paid_out ?? summary.totalPaidOut),
    pendingHoursValueLabel: hoursLabel(summary.pending_hours_value ?? summary.pendingHoursValue)
  };
}

function normalizeOrgWalletTransaction(row) {
  const transaction = row && typeof row === 'object' ? row : {};
  return {
    id: positiveInteger(transaction.id),
    createdAtLabel: dateTimeLabel(transaction.created_at ?? transaction.createdAt) || '—',
    typeLabel: headline(transaction.type) || 'Transaction',
    amountLabel: hoursLabel(transaction.amount),
    balanceAfterLabel: hoursLabel(transaction.balance_after ?? transaction.balanceAfter),
    description: trimmed(transaction.description)
  };
}

function expenseRowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.expenses)) return data.expenses;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function expenseStatusPresentation(value, t = null) {
  const rawStatus = trimmed(value);
  const status = ['pending', 'approved', 'rejected', 'paid'].includes(rawStatus) ? rawStatus : 'pending';
  const labels = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    paid: 'Paid'
  };
  const classNames = {
    pending: 'govuk-tag--yellow',
    approved: 'govuk-tag--green',
    rejected: 'govuk-tag--red',
    paid: 'govuk-tag--blue'
  };
  return {
    value: status,
    label: t ? t(`govuk_alpha_volunteering.expenses.status_${status}`) : labels[status],
    className: classNames[status] || 'govuk-tag--grey'
  };
}

function normalizeExpense(row, t = null) {
  const expense = row && typeof row === 'object' ? row : {};
  const type = trimmed(expense.expense_type ?? expense.expenseType);
  const status = expenseStatusPresentation(expense.status, t);
  const currency = trimmed(expense.currency);
  return {
    id: positiveInteger(expense.id),
    type,
    typeLabel: Object.hasOwn(EXPENSE_TYPE_LABELS, type) && t
      ? t(`govuk_alpha_volunteering.expenses.type_${type}`)
      : (EXPENSE_TYPE_LABELS[type] || headline(type) || (t ? t('govuk_alpha_volunteering.expenses.type_other') : 'Other')),
    amountLabel: moneyLabel(expense.amount),
    currency,
    amountWithCurrency: `${currency ? `${currency} ` : ''}${moneyLabel(expense.amount)}`,
    description: trimmed(expense.description),
    status,
    submittedAtLabel: dateLabel(expense.submitted_at ?? expense.submittedAt ?? expense.created_at ?? expense.createdAt),
    reviewNotes: trimmed(expense.review_notes ?? expense.reviewNotes)
  };
}

function normalizeExpenseDashboard(expensesResult, organizationsResult, t = null) {
  const data = dataFrom(expensesResult);
  const statsData = data && typeof data === 'object' && data.stats && typeof data.stats === 'object'
    ? data.stats
    : {};
  const expenses = expenseRowsFrom(expensesResult).map((expense) => normalizeExpense(expense, t));
  const fallbackStats = expenses.reduce((totals, expense) => {
    const amount = Number(expense.amountLabel);
    return {
      totalClaimed: totals.totalClaimed + amount,
      approved: totals.approved + (['approved', 'paid'].includes(expense.status.value) ? amount : 0),
      paid: totals.paid + (expense.status.value === 'paid' ? amount : 0)
    };
  }, { totalClaimed: 0, approved: 0, paid: 0 });

  return {
    expenses,
    organizations: collectionFrom(organizationsResult).map(normalizeOrganization).filter(Boolean),
    expenseTypes: EXPENSE_TYPES.map((type) => ({
      ...type,
      label: t ? t(`govuk_alpha_volunteering.expenses.type_${type.value}`) : type.label
    })),
    stats: {
      totalClaimedLabel: moneyLabel(statsData.total_submitted ?? statsData.total_claimed ?? fallbackStats.totalClaimed),
      approvedLabel: moneyLabel(statsData.approved_total ?? statsData.total_approved ?? fallbackStats.approved),
      paidLabel: moneyLabel(statsData.paid_total ?? statsData.total_paid ?? fallbackStats.paid)
    }
  };
}

function normalizeOrganization(row) {
  const organization = row && typeof row === 'object' ? row : {};
  const id = positiveInteger(organization.id);
  return id === null ? null : {
    id,
    name: trimmed(organization.name) || `Organisation ${id}`
  };
}

function normalizeApplication(row) {
  const application = row && typeof row === 'object' ? row : {};
  const opportunity = application.opportunity && typeof application.opportunity === 'object'
    ? application.opportunity
    : {};
  const organization = application.organization && typeof application.organization === 'object'
    ? application.organization
    : {};
  return {
    id: positiveInteger(application.id),
    status: trimmed(application.status),
    opportunity: {
      id: positiveInteger(opportunity.id ?? application.opportunity_id ?? application.opportunityId),
      title: trimmed(opportunity.title ?? application.opportunity_title ?? application.opportunityTitle)
    },
    organization: normalizeOrganization({
      id: organization.id ?? application.organization_id ?? application.organizationId,
      name: organization.name ?? application.organization_name ?? application.organizationName
    })
  };
}

function hoursOrganizations(organizations, applications) {
  const byId = new Map();
  for (const organization of organizations.map(normalizeOrganization).filter(Boolean)) {
    byId.set(organization.id, organization);
  }
  for (const application of applications) {
    if (application.organization) {
      byId.set(application.organization.id, application.organization);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

function hourStatusPresentation(status, t = null) {
  const value = trimmed(status) || 'pending';
  if (value === 'pending') {
    return {
      value,
      label: t ? t('govuk_alpha.vol_clarity.status_submitted') : 'Submitted',
      className: 'govuk-tag--yellow',
      note: t
        ? t('govuk_alpha.vol_clarity.status_pending_note')
        : 'Waiting for the organisation to review and approve these hours.'
    };
  }
  if (value === 'approved') {
    return {
      value,
      label: t ? t('govuk_alpha.volunteering.status_values.approved') : 'Approved',
      className: 'govuk-tag--green',
      note: t
        ? t('govuk_alpha.vol_clarity.status_approved_credited')
        : 'Approved. The time credits for these hours have been added to your wallet automatically.'
    };
  }
  if (value === 'declined' || value === 'rejected') {
    return {
      value,
      label: t ? t('govuk_alpha.volunteering.status_values.declined') : 'Declined',
      className: 'govuk-tag--red',
      note: ''
    };
  }
  const key = `govuk_alpha.volunteering.status_values.${value}`;
  const translated = t ? t(key) : key;
  return {
    value,
    label: translated !== key ? translated : headline(value),
    className: 'govuk-tag--grey',
    note: ''
  };
}

function normalizeHourLog(row, t = null) {
  const log = row && typeof row === 'object' ? row : {};
  const organization = log.organization && typeof log.organization === 'object' ? log.organization : {};
  const status = hourStatusPresentation(log.status, t);
  return {
    id: positiveInteger(log.id),
    dateLabel: dateLabel(log.date ?? log.date_logged ?? log.dateLogged ?? log.logged_at ?? log.loggedAt ?? log.created_at),
    hoursLabel: hoursLabel(log.hours),
    status,
    organizationName: trimmed(organization.name ?? log.organization_name ?? log.organizationName),
    description: trimmed(log.description)
  };
}

function normalizeCertificate(row, t = null) {
  const certificate = row && typeof row === 'object' ? row : {};
  const code = trimmed(certificate.verification_code ?? certificate.verificationCode);
  const dateRange = certificate.date_range && typeof certificate.date_range === 'object'
    ? certificate.date_range
    : (certificate.dateRange && typeof certificate.dateRange === 'object' ? certificate.dateRange : {});
  const organizations = Array.isArray(certificate.organizations)
    ? certificate.organizations
    : (Array.isArray(certificate.organisations) ? certificate.organisations : []);
  const totalHoursLabel = hoursLabel(certificate.total_hours ?? certificate.totalHours);

  return {
    verificationCode: code,
    totalHoursLabel,
    heading: t
      ? t('govuk_alpha.vol_depth.certificate_hours', { hours: totalHoursLabel })
      : `${totalHoursLabel} hours of approved volunteering`,
    rangeStartLabel: dateLabel(dateRange.start ?? certificate.start_date ?? certificate.startDate),
    rangeEndLabel: dateLabel(dateRange.end ?? certificate.end_date ?? certificate.endDate),
    generatedAtLabel: dateLabel(certificate.generated_at ?? certificate.generatedAt),
    organizations: organizations.map((organization) => {
      const name = trimmed(organization?.name)
        || (t ? t('govuk_alpha.vol_depth.certificate_independent') : 'Independent volunteering');
      const organizationHoursLabel = hoursLabel(organization?.hours);
      return {
        name,
        hoursLabel: organizationHoursLabel,
        label: t
          ? t('govuk_alpha.vol_depth.certificate_org_hours', { name, hours: organizationHoursLabel })
          : `${name} (${organizationHoursLabel} hours)`
      };
    }),
    downloadPath: code ? `/volunteering/certificates/${encodeURIComponent(code)}/download` : ''
  };
}

function normalizeManageableOrganization(row) {
  const organization = row && typeof row === 'object' ? row : {};
  const id = positiveInteger(organization.id);
  const role = trimmed(organization.member_role ?? organization.memberRole ?? organization.role).toLowerCase();
  const status = trimmed(organization.status ?? organization.membership_status ?? organization.membershipStatus).toLowerCase();
  if (
    id === null
    || !['owner', 'admin'].includes(role)
    || !['approved', 'active'].includes(status)
  ) {
    return null;
  }

  return {
    id,
    name: trimmed(organization.name) || `#${id}`
  };
}

function normalizeCategory(row) {
  const category = row && typeof row === 'object' ? row : {};
  const id = positiveInteger(category.id);
  if (id === null) return null;

  return {
    id,
    name: trimmed(category.name) || `#${id}`
  };
}

function createOpportunityStatus(status, t = null) {
  if (status === 'opp-validation') {
    return {
      type: 'validation',
      errors: [
        { href: '#organization_id', text: t ? t('govuk_alpha_volunteering.create_opp.error_org_required') : 'Select an organisation' },
        { href: '#title', text: t ? t('govuk_alpha_volunteering.create_opp.error_title_required') : 'Enter an opportunity title' },
        { href: '#description', text: t ? t('govuk_alpha_volunteering.create_opp.error_description_required') : 'Enter a description' }
      ]
    };
  }

  const messages = {
    'opp-forbidden': 'govuk_alpha_volunteering.create_opp.forbidden',
    'opp-org-not-found': 'govuk_alpha_volunteering.create_opp.org_not_found',
    'opp-create-failed': 'govuk_alpha_volunteering.create_opp.create_failed'
  };

  return messages[status]
    ? { type: 'error', message: t ? t(messages[status]) : messages[status] }
    : null;
}

function normalizeCredential(row, t = null) {
  const credential = row && typeof row === 'object' ? row : {};
  const type = trimmed(credential.credential_type ?? credential.type);
  const isLegacyVettingEvidence = checked(credential.legacy_vetting_evidence ?? credential.legacyVettingEvidence);
  const manualReviewRequired = checked(credential.manual_review_required ?? credential.manualReviewRequired);
  const status = manualReviewRequired
    ? { value: 'manual_review', label: t ? t('govuk_alpha_volunteering.credentials.status_manual_review') : 'Manual review required', className: 'govuk-tag--yellow' }
    : credentialStatusPresentation(credential.status, t);
  const typeKey = `govuk_alpha_volunteering.credentials.type_${type}`;
  const translatedType = t ? t(typeKey) : typeKey;
  const normalTypeLabel = translatedType !== typeKey
    ? translatedType
    : (trimmed(credential.type_label ?? credential.typeLabel) || headline(type) || 'Credential');
  const typeLabel = isLegacyVettingEvidence && t
    ? t('govuk_alpha_volunteering.credentials.retired_vetting_label')
    : normalTypeLabel;
  const expiry = dateLabel(credential.expires_at ?? credential.expiry_date ?? credential.expiryDate);

  const id = positiveInteger(credential.id);

  return {
    id,
    type,
    typeLabel,
    fileName: isLegacyVettingEvidence || manualReviewRequired
      ? ''
      : trimmed(credential.file_name ?? credential.document_name ?? credential.fileName ?? credential.documentName),
    downloadPath: id && !isLegacyVettingEvidence && !manualReviewRequired
      ? `/volunteering/credentials/${id}/download`
      : '',
    status,
    isLegacyVettingEvidence,
    manualReviewRequired,
    warning: isLegacyVettingEvidence
      ? (t ? t('govuk_alpha_volunteering.credentials.retired_vetting_warning') : '')
      : (manualReviewRequired ? (t ? t('govuk_alpha_volunteering.credentials.manual_review_warning') : '') : ''),
    expiryLabel: isLegacyVettingEvidence || manualReviewRequired
      ? (t ? t('govuk_alpha_volunteering.credentials.not_applicable') : 'Not applicable')
      : (expiry || (t ? t('govuk_alpha_volunteering.credentials.no_expiry') : 'No expiry')),
    uploadedLabel: dateLabel(
      credential.created_at
      ?? credential.upload_date
      ?? credential.uploadDate
      ?? credential.createdAt
    ) || '—',
    deleteLabel: isLegacyVettingEvidence
      ? (t ? t('govuk_alpha_volunteering.credentials.delete_vetting_evidence_button') : 'Delete historical document')
      : (t ? t('govuk_alpha_volunteering.credentials.delete_button') : 'Delete'),
    deleteAriaLabel: t
      ? t('govuk_alpha_volunteering.credentials.delete_for', { type: typeLabel })
      : `Delete the ${typeLabel} credential`
  };
}

function accessibilityPayload(rows) {
  const selected = [];
  const shared = {
    description: '',
    accommodations: '',
    emergencyName: '',
    emergencyPhone: ''
  };

  for (const item of rows) {
    const row = item && typeof item === 'object' ? item : {};
    const needType = trimmed(row.need_type ?? row.needType);
    if (ACCESSIBILITY_NEED_TYPES.some((type) => type.value === needType)) {
      selected.push(needType);
    }
    if (!shared.description && row.description) shared.description = trimmed(row.description);
    if (!shared.accommodations && (row.accommodations_required ?? row.accommodationsRequired)) {
      shared.accommodations = trimmed(row.accommodations_required ?? row.accommodationsRequired);
    }
    if (!shared.emergencyName && (row.emergency_contact_name ?? row.emergencyContactName)) {
      shared.emergencyName = trimmed(row.emergency_contact_name ?? row.emergencyContactName);
    }
    if (!shared.emergencyPhone && (row.emergency_contact_phone ?? row.emergencyContactPhone)) {
      shared.emergencyPhone = trimmed(row.emergency_contact_phone ?? row.emergencyContactPhone);
    }
  }

  return {
    selectedTypes: [...new Set(selected)],
    details: shared
  };
}

router.get('/certificates', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let certificates = [];
  let loadError = null;
  try {
    certificates = collectionFrom(await callApi(token, 'GET', '/certificates'))
      .map((certificate) => normalizeCertificate(certificate, res.locals.t));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = res.locals.t('govuk_alpha.vol_depth.certificates_error');
  }

  return res.render('volunteering/certificates', {
    title: res.locals.t('govuk_alpha.vol_depth.certificates_title'),
    activeNav: 'volunteering',
    certificates,
    loadError,
    status: certificateStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/certificates/:code([A-Za-z0-9]+)/download', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const code = trimmed(req.params.code);
  const certificates = collectionFrom(await callApi(token, 'GET', '/certificates'));
  const ownsCertificate = certificates.some((certificate) => (
    trimmed(certificate?.verification_code ?? certificate?.verificationCode) === code
  ));

  if (!ownsCertificate) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  const html = await callApi(token, 'GET', `/certificates/${encodeURIComponent(code)}/html`);
  const safeCode = code.replace(/[^A-Za-z0-9_-]/g, '');
  res.set('Content-Type', 'text/html; charset=UTF-8');
  res.set('Content-Disposition', `inline; filename="volunteer-certificate-${safeCode}.html"`);
  return res.send(String(html));
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Certificate not found' }));

router.get('/accessibility', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const accessibility = accessibilityPayload(collectionFrom(await callApi(token, 'GET', '/accessibility-needs')));
  return res.render('volunteering/accessibility', {
    title: res.locals.t('govuk_alpha.volunteering.accessibility_title'),
    activeNav: 'volunteering',
    needTypes: ACCESSIBILITY_NEED_TYPES.map((type) => ({
      ...type,
      label: res.locals.t(`govuk_alpha.volunteering.need_type_labels.${type.value}`)
    })),
    selectedTypes: accessibility.selectedTypes,
    accessibility: accessibility.details,
    status: accessibilityStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/emergency-alerts', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let dashboard = normalizeEmergencyAlertDashboard({});
  let loadError = null;
  const cursor = trimmed(req.query.cursor, 512);
  try {
    const result = cursor
      ? await callApi(token, 'GET', `/emergency-alerts?cursor=${encodeURIComponent(cursor)}`)
      : await callApi(token, 'GET', '/emergency-alerts');
    dashboard = normalizeEmergencyAlertDashboard(result, res.locals.t);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your urgent shift requests. Please try again.';
  }

  return res.render('volunteering/emergency-alerts', {
    title: res.locals.t('govuk_alpha_volunteering.emergency.title'),
    activeNav: 'volunteering',
    dashboard,
    loadError,
    status: emergencyAlertStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/group-signups', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let reservations = [];
  let loadError = null;
  try {
    reservations = groupReservationRowsFrom(await callApi(token, 'GET', '/group-reservations'))
      .map((reservation) => normalizeGroupReservation(reservation, res.locals.t))
      .filter((reservation) => reservation.id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your group sign-ups. Please try again.';
  }

  return res.render('volunteering/group-signups', {
    title: res.locals.t('govuk_alpha_volunteering.group_signups.title'),
    activeNav: 'volunteering',
    reservations,
    loadError,
    status: groupSignupStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

async function renderSafeguarding(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const queryTab = trimmed(req.query.tab);
  const subView = ['training', 'incidents'].includes(queryTab)
    ? queryTab
    : (req.path.includes('/incidents') ? 'incidents' : 'training');
  let trainings = [];
  let incidents = [];
  let loadError = null;

  try {
    trainings = safeguardingRowsFrom(
      await callApi(token, 'GET', '/training'),
      ['training', 'trainings']
    ).map((training) => normalizeSafeguardingTraining(training, res.locals.t));
    incidents = safeguardingRowsFrom(
      await callApi(token, 'GET', '/incidents'),
      ['incidents']
    ).map((incident) => normalizeSafeguardingIncident(incident, res.locals.t));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your safeguarding records. Please try again.';
  }

  return res.render('volunteering/safeguarding', {
    title: res.locals.t('govuk_alpha_volunteering.safeguarding.title'),
    activeNav: 'volunteering',
    subView,
    trainings,
    incidents,
    trainingTypes: SAFEGUARDING_TRAINING_TYPES.map((type) => ({
      ...type,
      label: res.locals.t(`govuk_alpha_volunteering.safeguarding.training_type_${type.value}`)
    })),
    severities: Object.keys(SAFEGUARDING_SEVERITY_LABELS).map((value) => ({
      value,
      label: res.locals.t(`govuk_alpha_volunteering.safeguarding.severity_${value}`)
    })),
    loadError,
    status: safeguardingStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

router.get('/training', asyncRoute(renderSafeguarding, { redirectOn401: loginRedirect() }));
router.get('/incidents', asyncRoute(renderSafeguarding, { redirectOn401: loginRedirect() }));

router.get('/waitlist', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let entries = [];
  let loadError = null;
  try {
    entries = collectionFrom(await callApi(token, 'GET', '/my-waitlists'))
      .map((entry) => normalizeWaitlistEntry(entry, res.locals.t))
      .filter((entry) => entry.id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = res.locals.t('govuk_alpha.vol_depth.waitlist_error');
  }

  return res.render('volunteering/waitlist', {
    title: res.locals.t('govuk_alpha.vol_depth.waitlist_title'),
    activeNav: 'volunteering',
    entries,
    loadError,
    status: waitlistStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/swaps', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let swaps = [];
  let myShifts = [];
  let loadError = null;
  try {
    swaps = collectionFrom(await callApi(token, 'GET', '/swaps'))
      .map((swap) => normalizeSwapRequest(swap, res.locals.t))
      .filter((swap) => swap.id);
    myShifts = collectionFrom(await callApi(token, 'GET', '/shifts?limit=50'))
      .map(normalizeMyShift)
      .filter((shift) => shift.id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = res.locals.t('govuk_alpha.vol_depth.swaps_error');
  }

  return res.render('volunteering/swaps', {
    title: res.locals.t('govuk_alpha.vol_depth.swaps_title'),
    activeNav: 'volunteering',
    swaps,
    myShifts,
    loadError,
    status: swapPageStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/my-organisations', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const roleFilter = ['owner', 'admin', 'member'].includes(trimmed(req.query.role))
    ? trimmed(req.query.role)
    : '';
  const cursor = trimmed(req.query.cursor);
  const params = new URLSearchParams({ per_page: '20' });
  if (cursor) params.set('cursor', cursor);

  let organizations = [];
  let nextHref = '';
  let loadError = null;
  try {
    const result = await callApi(token, 'GET', `/my-organisations?${params.toString()}`);
    organizations = collectionFrom(result)
      .map((organization) => normalizeVolunteerOrganizationCard(organization, res.locals.t))
      .filter((organization) => organization.id)
      .filter((organization) => !roleFilter || organization.roleValue === roleFilter);
    nextHref = volunteeringMyOrganisationsNextHref(roleFilter, collectionMetaFrom(result));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your volunteering organisations. Please try again.';
  }

  return res.render('volunteering/my-organisations', {
    title: res.locals.t('govuk_alpha_volunteering.my_orgs.title'),
    activeNav: 'volunteering',
    organizations,
    roleFilter,
    nextHref,
    loadError
  });
}, { redirectOn401: loginRedirect() }));

router.get('/recommended-shifts', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let shifts = [];
  let loadError = null;
  try {
    shifts = collectionFrom(await callApi(token, 'GET', '/recommended-shifts?limit=15&min_score=20'))
      .map((shift) => normalizeRecommendedShift(shift, res.locals.t))
      .filter((shift) => shift.id || shift.opportunityId);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your recommended shifts. Please try again.';
  }

  return res.render('volunteering/recommended-shifts', {
    title: res.locals.t('govuk_alpha_volunteering.recommended.title'),
    activeNav: 'volunteering',
    shifts,
    loadError
  });
}, { redirectOn401: loginRedirect() }));

router.get('/organisations/:id(\\d+)/dashboard', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const id = Number(req.params.id);
  let dashboard = normalizeOrgStats({});
  let loadError = null;
  try {
    dashboard = normalizeOrgStats(await callApi(token, 'GET', `/organisations/${id}/stats`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load the organisation dashboard. Check that you manage this organisation and try again.';
  }

  return res.render('volunteering/org-dashboard', {
    title: res.locals.t('govuk_alpha_volunteering.org_dashboard.title'),
    activeNav: 'volunteering',
    orgId: id,
    dashboard,
    loadError
  });
}, { redirectOn401: loginRedirect() }));

router.get('/organisations/:id(\\d+)/manage', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const id = Number(req.params.id);
  let dashboard = normalizeOrgStats({});
  let applications = [];
  let hours = [];
  let loadError = null;
  try {
    dashboard = normalizeOrgStats(await callApi(token, 'GET', `/organisations/${id}/stats`));
    applications = collectionFrom(
      await callApi(token, 'GET', `/organisations/${id}/applications?status=pending&per_page=20`)
    ).map((application) => normalizeOrgApplication(application, res.locals.t)).filter((application) => application.id);
    hours = collectionFrom(
      await callApi(token, 'GET', `/organisations/${id}/hours/pending?per_page=20`)
    ).map((log) => normalizeOrgPendingHour(log, res.locals.t)).filter((log) => log.id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load the organisation management queue. Check that you manage this organisation and try again.';
  }

  return res.render('volunteering/org-manage', {
    title: res.locals.t('govuk_alpha.vol_org.manage_title'),
    activeNav: 'volunteering',
    orgId: id,
    orgName: dashboard.orgName,
    applications,
    hours,
    loadError,
    status: orgManageStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/organisations/:id(\\d+)/settings', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const id = Number(req.params.id);
  let organization = normalizeOrgDetail({});
  let loadError = null;
  try {
    organization = normalizeOrgDetail(await callApi(token, 'GET', `/organisations/${id}`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load the organisation settings. Check that you manage this organisation and try again.';
  }

  return res.render('volunteering/org-settings', {
    title: res.locals.t('govuk_alpha_volunteering.org_settings.title'),
    activeNav: 'volunteering',
    orgId: id,
    organization,
    loadError,
    status: orgSettingsStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/organisations/:id(\\d+)/volunteers', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const id = Number(req.params.id);
  const cursor = trimmed(req.query.cursor);
  const params = new URLSearchParams({ per_page: '20' });
  if (cursor) params.set('cursor', cursor);

  let dashboard = normalizeOrgStats({});
  let volunteers = [];
  let nextHref = '';
  let loadError = null;
  try {
    dashboard = normalizeOrgStats(await callApi(token, 'GET', `/organisations/${id}/stats`));
    const result = await callApi(token, 'GET', `/organisations/${id}/volunteers?${params.toString()}`);
    volunteers = collectionFrom(result)
      .map((volunteer) => normalizeOrgVolunteer(volunteer, res.locals.t))
      .filter((volunteer) => volunteer.id);
    nextHref = orgVolunteersNextHref(id, collectionMetaFrom(result));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load the organisation volunteers. Check that you manage this organisation and try again.';
  }

  return res.render('volunteering/org-volunteers', {
    title: res.locals.t('govuk_alpha_volunteering.org_volunteers.title'),
    activeNav: 'volunteering',
    orgId: id,
    orgName: dashboard.orgName || res.locals.tenantName,
    volunteers,
    nextHref,
    loadError
  });
}, { redirectOn401: loginRedirect() }));

router.get('/organisations/:id(\\d+)/wallet', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const id = Number(req.params.id);
  let dashboard = normalizeOrgStats({});
  let summary = normalizeOrgWalletSummary({});
  let transactions = [];
  let loadError = null;
  try {
    dashboard = normalizeOrgStats(await callApi(token, 'GET', `/organisations/${id}/stats`));
    summary = normalizeOrgWalletSummary(await callApi(token, 'GET', `/organisations/${id}/wallet`));
    transactions = collectionFrom(
      await callApi(token, 'GET', `/organisations/${id}/wallet/transactions?per_page=20`)
    ).map(normalizeOrgWalletTransaction).filter((transaction) => transaction.id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load the organisation wallet. Check that you manage this organisation and try again.';
  }

  return res.render('volunteering/org-wallet', {
    title: res.locals.t('govuk_alpha_volunteering.org_wallet.title'),
    activeNav: 'volunteering',
    orgId: id,
    orgName: dashboard.orgName,
    summary,
    transactions,
    loadError,
    status: orgWalletStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/credentials', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let credentials = [];
  let loadError = null;
  try {
    credentials = credentialRowsFrom(await callApi(token, 'GET', '/credentials'))
      .map((credential) => normalizeCredential(credential, res.locals.t));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your credentials. Please try again.';
  }

  return res.render('volunteering/credentials', {
    title: res.locals.t('govuk_alpha_volunteering.credentials.title'),
    activeNav: 'volunteering',
    credentialTypes: CREDENTIAL_TYPES.map((type) => ({
      ...type,
      label: res.locals.t(`govuk_alpha_volunteering.credentials.type_${type.value}`)
    })),
    credentials,
    loadError,
    status: credentialStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/credentials/:id(\\d+)/download', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let download;
  try {
    download = await downloadVolunteerCredential(token, Number(req.params.id));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }
    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  res.status(download.status || 200);
  DOWNLOAD_HEADER_NAMES.forEach((header) => {
    if (download.headers && download.headers[header]) {
      res.set(header, download.headers[header]);
    }
  });
  return res.send(Buffer.isBuffer(download.body) ? download.body : Buffer.from(download.body || ''));
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Credential download' }));

router.get('/hours', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let summary = normalizeHourSummary({});
  let logs = [];
  let applications = [];
  let organizations = [];
  let loadError = null;
  try {
    summary = normalizeHourSummary(await callApi(token, 'GET', '/hours/summary'));
    logs = collectionFrom(await callApi(token, 'GET', '/hours?per_page=10'))
      .map((log) => normalizeHourLog(log, res.locals.t));
    applications = collectionFrom(
      await callApi(token, 'GET', '/applications?status=approved&per_page=50')
    ).map(normalizeApplication);
    organizations = hoursOrganizations(
      collectionFrom(await callApi(token, 'GET', '/my-organisations?per_page=50')),
      applications
    );
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your volunteering hours. Please try again.';
  }

  const nextGoal = summary.approvedTotal > 0 ? Math.ceil(summary.approvedTotal / 50) * 50 : 0;
  const nextGoalLabel = nextGoal
    ? res.locals.t('govuk_alpha.volunteering.hours_of_goal', {
      hours: summary.approvedHoursLabel,
      goal: nextGoal
    })
    : '';

  return res.render('volunteering/hours', {
    title: res.locals.t('govuk_alpha.volunteering.hours_title'),
    activeNav: 'volunteering',
    summary,
    nextGoal,
    nextGoalLabel,
    logs,
    applications,
    organizations,
    loadError,
    today: new Date().toISOString().slice(0, 10),
    status: hoursStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/wellbeing', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let wellbeing = normalizeWellbeingDashboard({}, res.locals.t);
  let loadError = null;
  try {
    wellbeing = normalizeWellbeingDashboard(await callApi(token, 'GET', '/wellbeing'), res.locals.t);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your wellbeing dashboard. Please try again.';
  }

  return res.render('volunteering/wellbeing', {
    title: res.locals.t('govuk_alpha_volunteering.wellbeing.title'),
    activeNav: 'volunteering',
    wellbeing,
    loadError,
    status: wellbeingStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/donations', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let dashboard = normalizeDonationDashboard({}, {}, res.locals.t);
  let loadError = null;
  try {
    const givingDays = await callApi(token, 'GET', '/giving-days');
    const donations = await callApi(token, 'GET', '/donations?per_page=20');
    dashboard = normalizeDonationDashboard(givingDays, donations, res.locals.t);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your donations. Please try again.';
  }

  return res.render('volunteering/donations', {
    title: res.locals.t('govuk_alpha_volunteering.donations.title'),
    activeNav: 'volunteering',
    dashboard,
    tenantCurrency: tenantCurrency(req),
    loadError,
    status: donationStatus(trimmed(req.query.status), trimmed(req.query.donate_error), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/expenses', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let dashboard = normalizeExpenseDashboard({}, {}, res.locals.t);
  let loadError = null;
  try {
    const expenses = await callApi(token, 'GET', '/expenses?per_page=50');
    const organizations = await callApi(token, 'GET', '/my-organisations?per_page=50');
    dashboard = normalizeExpenseDashboard(expenses, organizations, res.locals.t);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load your expenses. Please try again.';
  }

  return res.render('volunteering/expenses', {
    title: res.locals.t('govuk_alpha_volunteering.expenses.title'),
    activeNav: 'volunteering',
    dashboard,
    loadError,
    status: expenseStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/opportunities/create', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let organizations = [];
  let categories = [];
  let loadError = null;
  try {
    organizations = collectionFrom(await callApi(token, 'GET', '/my-organisations?per_page=50'))
      .map(normalizeManageableOrganization)
      .filter(Boolean);
    categories = collectionFrom(await getVolunteeringCategories(token))
      .map(normalizeCategory)
      .filter(Boolean);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = 'We could not load the create opportunity form. Please try again.';
  }

  return res.render('volunteering/create-opportunity', {
    title: res.locals.t('govuk_alpha_volunteering.create_opp.title'),
    activeNav: 'volunteering',
    organizations,
    categories,
    loadError,
    status: createOpportunityStatus(trimmed(req.query.status), res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.post('/opportunities/create', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const organizationId = positiveInteger(req.body.organization_id);
  const title = trimmed(req.body.title);
  const description = trimmed(req.body.description);
  if (organizationId === null || title === '' || description === '') {
    return redirectTo(res, '/volunteering/opportunities/create?status=opp-validation');
  }

  const categoryId = positiveInteger(req.body.category_id);
  const payload = {
    organization_id: organizationId,
    title,
    description,
    location: trimmed(req.body.location),
    is_remote: checked(req.body.is_remote),
    skills_needed: trimmed(req.body.skills_needed),
    start_date: trimmed(req.body.start_date) || null,
    end_date: trimmed(req.body.end_date) || null,
    category_id: categoryId,
    federated_visibility: checked(req.body.federated_visibility) ? 'listed' : 'none'
  };

  try {
    const result = await callApi(token, 'POST', '/opportunities', payload);
    return redirectTo(res, opportunityRedirect(resultId(result) || 'create', 'opp-created'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const status = {
      FORBIDDEN: 'opp-forbidden',
      NOT_FOUND: 'opp-org-not-found',
      VALIDATION_ERROR: 'opp-validation'
    }[apiErrorCode(error)] || 'opp-create-failed';
    return redirectTo(res, `/volunteering/opportunities/create?status=${status}`);
  }
}));

router.post('/opportunities/:id(\\d+)/apply', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const payload = {
    message: trimmed(req.body.message),
    shift_id: positiveInteger(req.body.shift_id)
  };

  return runOpportunityAction(req, res, {
    method: 'POST',
    path: `/opportunities/${id}/apply`,
    data: payload,
    opportunityId: id,
    successStatus: 'apply-created',
    failureStatus: 'apply-failed',
    restrictedStatus: 'apply-safeguarding-restricted',
    unavailableStatus: 'apply-safeguarding-unavailable'
  });
}));

router.post('/opportunities/:id(\\d+)/shifts/:shiftId(\\d+)/signup', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);

  return runOpportunityAction(req, res, {
    method: 'POST',
    path: `/shifts/${shiftId}/signup`,
    opportunityId: id,
    successStatus: 'shift-signed-up',
    failureStatus: 'shift-signup-failed',
    restrictedStatus: 'shift-safeguarding-restricted',
    unavailableStatus: 'shift-safeguarding-unavailable'
  });
}));

router.post('/opportunities/:id(\\d+)/shifts/:shiftId(\\d+)/cancel', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);

  return runOpportunityAction(req, res, {
    method: 'DELETE',
    path: `/shifts/${shiftId}/signup`,
    opportunityId: id,
    successStatus: 'shift-cancelled',
    failureStatus: 'shift-cancel-failed',
    restrictedStatus: 'shift-safeguarding-restricted',
    unavailableStatus: 'shift-safeguarding-unavailable'
  });
}));

router.post('/applications/:id(\\d+)/withdraw', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/applications/${id}`,
    undefined,
    '/volunteering?tab=applications&status=application-withdrawn',
    '/volunteering?tab=applications&status=application-withdraw-failed'
  );
}));

router.post('/hours', asyncRoute(async (req, res) => {
  const payload = {
    organization_id: positiveInteger(req.body.organization_id),
    opportunity_id: positiveInteger(req.body.opportunity_id),
    date: trimmed(req.body.date),
    hours: decimalNumber(req.body.hours),
    description: trimmed(req.body.description)
  };

  return runAction(
    req,
    res,
    'POST',
    '/hours',
    payload,
    '/volunteering/hours?status=hours-created',
    '/volunteering/hours?status=hours-failed'
  );
}));

router.post('/accessibility', asyncRoute(async (req, res) => {
  const selectedTypes = stringArray(req.body.need_types).filter((value) => (
    ACCESSIBILITY_NEED_TYPES.some((type) => type.value === value)
  ));
  const sharedDetails = {
    description: trimmed(req.body.description) || null,
    accommodations_required: trimmed(req.body.accommodations_required) || null,
    emergency_contact_name: trimmed(req.body.emergency_contact_name) || null,
    emergency_contact_phone: trimmed(req.body.emergency_contact_phone) || null
  };
  const payload = {
    needs: selectedTypes.map((needType) => ({
      need_type: needType,
      ...sharedDetails
    }))
  };

  return runAction(
    req,
    res,
    'PUT',
    '/accessibility-needs',
    payload,
    '/volunteering/accessibility?status=accessibility-saved',
    '/volunteering/accessibility?status=accessibility-failed'
  );
}));

router.post('/certificates/generate', asyncRoute(async (req, res) => runAction(
  req,
  res,
  'POST',
  '/certificates',
  undefined,
  '/volunteering/certificates?status=certificate-generated',
  '/volunteering/certificates?status=certificate-no-hours'
)));

router.post('/waitlist/:shiftId(\\d+)/leave', asyncRoute(async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  return runAction(
    req,
    res,
    'DELETE',
    `/shifts/${shiftId}/waitlist`,
    undefined,
    '/volunteering/waitlist?status=waitlist-left',
    '/volunteering/waitlist?status=waitlist-leave-failed'
  );
}));

router.post('/swaps', asyncRoute(async (req, res) => {
  const fromShiftId = positiveInteger(req.body.from_shift_id);
  const toShiftId = positiveInteger(req.body.to_shift_id);
  const toUserId = positiveInteger(req.body.to_user_id);
  if (fromShiftId === null || toShiftId === null || toUserId === null) {
    return redirectTo(res, '/volunteering/swaps?status=swap-invalid');
  }

  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  try {
    await callApi(token, 'POST', '/swaps', {
      from_shift_id: fromShiftId,
      to_shift_id: toShiftId,
      to_user_id: toUserId,
      message: trimmed(req.body.message)
    });
    return redirectTo(res, '/volunteering/swaps?status=swap-requested');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
      return redirectTo(res, '/volunteering/swaps?status=swap-safeguarding-unavailable');
    }
    if (['SAFEGUARDING_CONTACT_RESTRICTED', 'VETTING_REQUIRED'].includes(code)) {
      return redirectTo(res, '/volunteering/swaps?status=swap-safeguarding-restricted');
    }
    return redirectTo(res, '/volunteering/swaps?status=swap-request-failed');
  }
}));

router.post('/swaps/:id(\\d+)/respond', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const action = trimmed(req.body.action) === 'reject' ? 'reject' : 'accept';
  const status = action === 'accept' ? 'swap-accepted' : 'swap-rejected';

  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  try {
    await callApi(token, 'PUT', `/swaps/${id}`, { action });
    return redirectTo(res, `/volunteering/swaps?status=${status}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
      return redirectTo(res, '/volunteering/swaps?status=swap-safeguarding-unavailable');
    }
    if (['SAFEGUARDING_CONTACT_RESTRICTED', 'VETTING_REQUIRED'].includes(code)) {
      return redirectTo(res, '/volunteering/swaps?status=swap-safeguarding-restricted');
    }
    return redirectTo(res, '/volunteering/swaps?status=swap-respond-failed');
  }
}));

router.post('/swaps/:id(\\d+)/cancel', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/swaps/${id}`,
    undefined,
    '/volunteering/swaps?status=swap-cancelled',
    '/volunteering/swaps?status=swap-cancel-failed'
  );
}));

router.post('/emergency-alerts/:id(\\d+)/respond', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const response = trimmed(req.body.response) === 'declined' ? 'declined' : 'accepted';
  const status = response === 'accepted' ? 'alert-accepted' : 'alert-declined';
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  try {
    await callApi(token, 'PUT', `/emergency-alerts/${id}`, { response });
    return redirectTo(res, `/volunteering/emergency-alerts?status=${status}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    const failureStatus = code === 'SAFEGUARDING_POLICY_UNAVAILABLE'
      ? 'alert-safeguarding-unavailable'
      : (['SAFEGUARDING_CONTACT_RESTRICTED', 'VETTING_REQUIRED'].includes(code)
        ? 'alert-safeguarding-restricted'
        : 'alert-respond-failed');
    return redirectTo(res, `/volunteering/emergency-alerts?status=${failureStatus}`);
  }
}));

router.post('/credentials', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const type = trimmed(req.body.credential_type || req.body.type, 100);
  const expiresAt = trimmed(req.body.expires_at || req.body.expiry_date);
  const file = uploadedFile(req, 'file') || uploadedFile(req, 'document');
  if (!type || !file) {
    await removeUploadedFile(file);
    return redirectTo(res, '/volunteering/credentials?status=credential-upload-failed');
  }

  try {
    const buffer = await fs.readFile(file.filepath);
    await uploadVolunteerCredential(token, {
      credential_type: type,
      expires_at: expiresAt,
      file: {
        buffer,
        filename: trimmed(file.originalFilename) || 'credential',
        contentType: trimmed(file.mimetype) || 'application/octet-stream',
        size: file.size
      }
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, '/volunteering/credentials?status=credential-upload-failed');
  } finally {
    await removeUploadedFile(file);
  }

  return redirectTo(res, '/volunteering/credentials?status=credential-uploaded');
}));

router.post('/credentials/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/credentials/${id}`,
    undefined,
    '/volunteering/credentials?status=credential-deleted',
    '/volunteering/credentials?status=credential-delete-failed'
  );
}));

router.post('/wellbeing/checkin', asyncRoute(async (req, res) => {
  const mood = positiveInteger(req.body.mood);
  if (mood === null || mood < 1 || mood > 5) {
    return redirectTo(res, '/volunteering/wellbeing?status=mood-invalid');
  }

  return runAction(
    req,
    res,
    'POST',
    '/wellbeing/checkin',
    {
      mood,
      note: trimmed(req.body.note, 500)
    },
    '/volunteering/wellbeing?status=checkin-saved',
    '/volunteering/wellbeing?status=checkin-failed'
  );
}));

router.post('/donations', asyncRoute(async (req, res) => {
  const amount = decimalNumber(req.body.amount);
  if (amount <= 0) {
    return redirectTo(res, '/volunteering/donations?status=donate-failed&donate_error=amount#donate');
  }
  if (amount > 1000000) {
    return redirectTo(res, '/volunteering/donations?status=donate-failed&donate_error=amount-max#donate');
  }

  const givingDayId = positiveInteger(req.body.giving_day_id);
  const payload = {
    amount,
    payment_method: trimmed(req.body.payment_method) === 'paypal' ? 'paypal' : 'bank_transfer',
    message: trimmed(req.body.message, 500),
    is_anonymous: checked(req.body.is_anonymous)
  };
  if (givingDayId !== null) {
    payload.giving_day_id = givingDayId;
  }

  return runAction(
    req,
    res,
    'POST',
    '/donations',
    payload,
    '/volunteering/donations?status=donate-recorded#donate',
    '/volunteering/donations?status=donate-failed#donate'
  );
}));

router.post('/group-signups/:id(\\d+)/members', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const userId = positiveInteger(req.body.user_id);
  if (userId === null) {
    return redirectTo(res, '/volunteering/group-signups?status=member-id-required');
  }

  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  try {
    await callApi(token, 'POST', `/group-reservations/${id}/members`, { user_id: userId });
    return redirectTo(res, '/volunteering/group-signups?status=member-added');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
      return redirectTo(res, '/volunteering/group-signups?status=member-safeguarding-unavailable');
    }
    if (['SAFEGUARDING_CONTACT_RESTRICTED', 'VETTING_REQUIRED'].includes(code)) {
      return redirectTo(res, '/volunteering/group-signups?status=member-safeguarding-restricted');
    }
    return redirectTo(res, '/volunteering/group-signups?status=member-add-failed');
  }
}));

router.post('/group-signups/:id(\\d+)/members/:userId(\\d+)/remove', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  return runAction(
    req,
    res,
    'DELETE',
    `/group-reservations/${id}/members/${userId}`,
    undefined,
    '/volunteering/group-signups?status=member-removed',
    '/volunteering/group-signups?status=member-remove-failed'
  );
}));

router.post('/group-signups/:id(\\d+)/cancel', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/group-reservations/${id}`,
    undefined,
    '/volunteering/group-signups?status=reservation-cancelled',
    '/volunteering/group-signups?status=reservation-cancel-failed'
  );
}));

router.post('/expenses', asyncRoute(async (req, res) => {
  const organizationId = positiveInteger(req.body.organization_id);
  const amount = decimalNumber(req.body.amount);
  const description = trimmed(req.body.description);
  if (organizationId === null) {
    return redirectTo(res, '/volunteering/expenses?status=expense-org-required');
  }
  if (amount <= 0) {
    return redirectTo(res, '/volunteering/expenses?status=expense-amount-invalid');
  }
  if (description === '') {
    return redirectTo(res, '/volunteering/expenses?status=expense-description-required');
  }

  const expenseType = trimmed(req.body.expense_type);
  return runAction(
    req,
    res,
    'POST',
    '/expenses',
    {
      organization_id: organizationId,
      expense_type: ['travel', 'meals', 'supplies', 'equipment', 'parking', 'other'].includes(expenseType)
        ? expenseType
        : 'travel',
      amount,
      description,
      currency: trimmed(req.body.currency, 10)
    },
    '/volunteering/expenses?status=expense-submitted',
    '/volunteering/expenses?status=expense-failed'
  );
}));

router.post('/training', asyncRoute(async (req, res) => {
  const trainingType = trimmed(req.body.training_type);
  const trainingName = trimmed(req.body.training_name);
  const completedAt = trimmed(req.body.completed_at);
  if (trainingType === '') {
    return redirectTo(res, '/volunteering/training?status=training-type-required&tab=training');
  }
  if (trainingName === '') {
    return redirectTo(res, '/volunteering/training?status=training-name-required&tab=training');
  }
  if (completedAt === '') {
    return redirectTo(res, '/volunteering/training?status=training-date-required&tab=training');
  }

  return runAction(
    req,
    res,
    'POST',
    '/training',
    {
      training_type: trainingType,
      training_name: trainingName,
      provider: trimmed(req.body.provider) || null,
      completed_at: completedAt,
      expires_at: trimmed(req.body.expires_at) || null
    },
    '/volunteering/training?status=training-added&tab=training',
    '/volunteering/training?status=training-failed&tab=training'
  );
}));

router.post('/incidents', asyncRoute(async (req, res) => {
  const title = trimmed(req.body.title);
  const description = trimmed(req.body.description);
  if (title === '') {
    return redirectTo(res, '/volunteering/incidents?status=incident-title-required&tab=incidents');
  }
  if (description.length < 20) {
    return redirectTo(res, '/volunteering/incidents?status=incident-description-too-short&tab=incidents');
  }

  const severity = trimmed(req.body.severity);
  return runAction(
    req,
    res,
    'POST',
    '/incidents',
    {
      title,
      description,
      severity: ['low', 'medium', 'high', 'critical'].includes(severity)
        ? severity
        : 'low',
      category: trimmed(req.body.category) || 'general',
      incident_type: 'other'
    },
    '/volunteering/incidents?status=incident-reported&tab=incidents',
    '/volunteering/incidents?status=incident-failed&tab=incidents'
  );
}));

router.post('/organisations/:id(\\d+)/applications/:appId(\\d+)', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const appId = Number(req.params.appId);
  const action = trimmed(req.body.action) === 'decline' ? 'decline' : 'approve';
  const status = action === 'approve' ? 'application-approved' : 'application-declined';
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    await callApi(token, 'PUT', `/applications/${appId}`, {
      action,
      org_note: trimmed(req.body.org_note)
    });
    return redirectTo(res, orgManageRedirect(id, status));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
      return redirectTo(res, orgManageRedirect(id, 'application-safeguarding-unavailable'));
    }
    if (['SAFEGUARDING_CONTACT_RESTRICTED', 'VETTING_REQUIRED'].includes(code)) {
      return redirectTo(res, orgManageRedirect(id, 'application-safeguarding-restricted'));
    }
    return redirectTo(res, orgManageRedirect(id, 'application-failed'));
  }
}));

router.post('/organisations/:id(\\d+)/hours/:logId(\\d+)', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const logId = Number(req.params.logId);
  const action = trimmed(req.body.action) === 'decline' ? 'decline' : 'approve';
  const status = action === 'approve' ? 'hours-approved' : 'hours-declined';

  return runAction(
    req,
    res,
    'PUT',
    `/hours/${logId}/verify`,
    { action },
    orgManageRedirect(id, status),
    orgManageRedirect(id, 'hours-verify-failed')
  );
}));

router.post('/organisations/:id(\\d+)/settings', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const name = trimmed(req.body.name);
  const contactEmail = trimmed(req.body.contact_email);
  if (name === '') {
    return redirectTo(res, orgSettingsRedirect(id, 'name-required'));
  }
  if (contactEmail !== '' && !isValidEmail(contactEmail)) {
    return redirectTo(res, orgSettingsRedirect(id, 'email-invalid'));
  }

  return runAction(
    req,
    res,
    'PUT',
    `/organisations/${id}`,
    {
      name,
      description: trimmed(req.body.description),
      contact_email: contactEmail,
      website: trimmed(req.body.website)
    },
    orgSettingsRedirect(id, 'settings-saved'),
    orgSettingsRedirect(id, 'settings-failed')
  );
}));

router.post('/organisations/:id(\\d+)/wallet/deposit', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const amount = decimalNumber(req.body.amount);
  if (amount <= 0) {
    return redirectTo(res, orgWalletRedirect(id, 'deposit-amount-invalid'));
  }

  return runAction(
    req,
    res,
    'POST',
    `/organisations/${id}/wallet/deposit`,
    {
      amount,
      note: trimmed(req.body.note) || null
    },
    orgWalletRedirect(id, 'deposit-made'),
    orgWalletRedirect(id, 'deposit-failed')
  );
}));

router.post('/organisations/:id(\\d+)/wallet/auto-pay', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  await callApi(token, 'GET', `/organisations/${id}/stats`);
  return redirectTo(res, orgWalletRedirect(id, 'auto-credit-always-on'));
}));

module.exports = router;
