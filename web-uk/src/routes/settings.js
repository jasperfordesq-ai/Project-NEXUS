// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const {
  callUserSettingsApi,
  uploadInsuranceCertificate,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const SETTINGS_THEMES = ['light', 'dark', 'system'];
const SETTINGS_LINK_TYPES = ['family', 'guardian', 'carer', 'organization'];
const SETTINGS_LINK_PERMISSIONS = [
  'can_view_activity',
  'can_manage_listings',
  'can_transact',
  'can_view_messages'
];
const SETTINGS_GDPR_TYPES = ['portability', 'rectification', 'restriction', 'objection'];
const SETTINGS_INSURANCE_TYPES = [
  'public_liability',
  'professional_indemnity',
  'employers_liability',
  'product_liability',
  'personal_accident',
  'other'
];
const SETTINGS_STATUS_MESSAGES = {
  'link-requested': 'Your link request has been sent. The other member must approve it.',
  'link-approved': 'You have approved the link.',
  'link-revoked': 'The link has been removed.',
  'link-permissions-saved': 'Permissions updated.',
  'link-email-invalid': 'Enter a valid email address.',
  'link-user-not-found': 'We could not find a member with that email address in this community.',
  'link-self': 'You cannot link your own account to itself.',
  'link-exists': 'A link with this member already exists.',
  'link-max': 'You have reached the maximum number of linked accounts.',
  'link-failed': 'Sorry, we could not complete that request. Please try again.',
  'link-vetting-required': 'Safeguarding check needed',
  'link-contact-restricted': 'This member has asked for a coordinator to arrange contact on their behalf. Your message has not been sent. Please contact your broker or community administrator so they can help arrange the next safe step.',
  'link-safeguarding-unavailable': 'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.',
  'appearance-saved': 'Your appearance settings have been saved.',
  'appearance-invalid': 'Choose one of the available themes.',
  'appearance-failed': 'Sorry, we could not save your appearance settings. Please try again.',
  'availability-saved': 'Your availability has been saved.',
  'availability-invalid': 'Check the times you entered. Each end time must be after its start time.',
  'availability-failed': 'Sorry, we could not save your availability. Please try again.',
  'gdpr-requested': 'Your request has been submitted. We will be in touch.',
  'gdpr-duplicate': 'You already have a request of this type being looked into.',
  'gdpr-invalid': 'Choose the type of request you want to make.',
  'gdpr-failed': 'Sorry, we could not submit your request. Please try again.',
  'insurance-uploaded': 'Your certificate has been uploaded and is awaiting review.',
  'insurance-type-invalid': 'Choose the type of insurance.',
  'insurance-file-required': 'Choose a certificate file to upload.',
  'insurance-file-type': 'The certificate must be a PDF, JPG or PNG file.',
  'insurance-file-large': 'The certificate file must be smaller than 10MB.',
  'insurance-failed': 'Sorry, we could not upload your certificate. Please try again.'
};
const SETTINGS_AVAILABILITY_DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];
const SETTINGS_AVAILABILITY_SLOTS_PER_DAY = 3;
const SETTINGS_INSURANCE_STATUS_TAGS = {
  verified: 'govuk-tag--green',
  submitted: 'govuk-tag--yellow',
  pending: 'govuk-tag--yellow',
  rejected: 'govuk-tag--red',
  revoked: 'govuk-tag--red',
  expired: 'govuk-tag--red'
};

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function allowedValue(value, allowed, fallback = null) {
  const text = trimmed(value);
  return allowed.includes(text) ? text : fallback;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
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

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function apiErrorCode(error) {
  const data = error && error.data && typeof error.data === 'object' ? error.data : {};
  return String(data.code || data.error || '').toUpperCase();
}

function apiErrorField(error) {
  const data = error && error.data && typeof error.data === 'object' ? error.data : {};
  if (typeof data.field === 'string') return data.field;
  if (Array.isArray(data.errors) && data.errors[0] && typeof data.errors[0].field === 'string') {
    return data.errors[0].field;
  }
  return '';
}

function insuranceEnabledForRequest(req) {
  const compliance = req?.accessibleRouting?.tenant?.compliance;
  return Boolean(compliance && typeof compliance === 'object' && compliance.insurance_enabled);
}

function renderNotFound(res) {
  return res.status(404).render('errors/404', { title: 'Page not found' });
}

function dataFrom(result) {
  return result && result.data && typeof result.data === 'object' ? result.data : {};
}

function payloadFrom(result) {
  return result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
}

function redirectOnAuthError(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

async function callSettings(token, method, path, data = undefined) {
  if (data === undefined) {
    return callUserSettingsApi(token, method, path);
  }

  return callUserSettingsApi(token, method, path, data);
}

function permissionPayload(body) {
  return SETTINGS_LINK_PERMISSIONS.reduce((permissions, key) => {
    permissions[key] = checked(body[`perm_${key}`]);
    return permissions;
  }, {});
}

function settingsStatusRedirect(path, status, fragment = '') {
  return `${path}?status=${encodeURIComponent(status)}${fragment}`;
}

function jsonObjectFrom(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function relationshipRowsFromPayload(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  if (payload.data && typeof payload.data === 'object') {
    return relationshipRowsFromPayload(payload.data, keys);
  }

  return [];
}

function normalizeRelationship(row, t) {
  const permissions = jsonObjectFrom(row && row.permissions);
  const first = trimmed(row && row.first_name);
  const last = trimmed(row && row.last_name);
  const name = trimmed((row && row.name) || `${first} ${last}` || (row && row.email));
  const type = allowedValue(row && row.relationship_type, SETTINGS_LINK_TYPES, 'family');

  return {
    relationshipId: positiveInteger(row && (row.relationship_id || row.id)) || 0,
    name: name || t('govuk_alpha_settings.common.unknown_member'),
    email: trimmed(row && row.email),
    avatarUrl: trimmed(row && row.avatar_url),
    relationshipType: type,
    relationshipTypeLabel: t(`govuk_alpha_settings.linked.types.${type}`),
    status: trimmed(row && row.status) || 'pending',
    permissions: SETTINGS_LINK_PERMISSIONS.reduce((acc, key) => {
      acc[key] = Boolean(permissions[key]);
      return acc;
    }, {})
  };
}

function normalizeRelationships(payload, keys, t) {
  return relationshipRowsFromPayload(payload, keys).map((row) => normalizeRelationship(row, t));
}

function humanizeStatus(value) {
  const text = trimmed(value);
  if (text === '') return '';
  return text
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatInsuranceDate(value) {
  const text = trimmed(value);
  if (text === '') return '';
  const date = new Date(text.includes('T') ? text : `${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function insuranceRowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['certificates', 'insurance_certificates', 'items', 'data']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === 'object') {
    return insuranceRowsFromPayload(payload.data);
  }
  return [];
}

function normalizeInsuranceCertificate(row, t) {
  const type = allowedValue(row && row.insurance_type, SETTINGS_INSURANCE_TYPES, 'other');
  const status = trimmed(row && row.status) || 'pending';

  return {
    insuranceType: type,
    insuranceTypeLabel: t(`govuk_alpha_settings.insurance.types.${type}`),
    providerName: trimmed(row && row.provider_name),
    expiryLabel: formatInsuranceDate(row && row.expiry_date),
    status,
    statusLabel: Object.prototype.hasOwnProperty.call(SETTINGS_INSURANCE_STATUS_TAGS, status)
      ? t(`govuk_alpha_settings.insurance.statuses.${status}`)
      : humanizeStatus(status) || t('govuk_alpha_settings.insurance.statuses.pending'),
    statusTagClass: SETTINGS_INSURANCE_STATUS_TAGS[status] || 'govuk-tag--grey'
  };
}

function normalizeInsuranceCertificates(payload, t) {
  return insuranceRowsFromPayload(payload).map((row) => normalizeInsuranceCertificate(row, t));
}

function themeFromSettingsData(data) {
  const nested = data.user && typeof data.user === 'object' ? data.user : {};
  return allowedValue(data.preferred_theme || data.theme || nested.preferred_theme || nested.theme, SETTINGS_THEMES, 'system');
}

function normalizeAvailabilitySlot(slot) {
  if (!slot || typeof slot !== 'object') return null;
  const start = trimmed(slot.start || slot.start_time).slice(0, 5);
  const end = trimmed(slot.end || slot.end_time).slice(0, 5);
  return start || end ? { start, end } : null;
}

function availabilityByDayFromData(data) {
  const raw = Array.isArray(data.schedule)
    ? data.schedule
    : Array.isArray(data.availability)
      ? data.availability
      : Array.isArray(data.weekly)
        ? data.weekly
        : [];
  const byDay = {};

  for (const slot of raw) {
    if (!slot || typeof slot !== 'object') continue;
    if (slot.is_recurring === false || slot.is_recurring === 0) continue;
    const day = Number(slot.day_of_week ?? slot.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;

    const normalized = normalizeAvailabilitySlot(slot);
    if (!normalized) continue;
    byDay[day] = byDay[day] || [];
    byDay[day].push(normalized);
  }

  return byDay;
}

function availabilitySlotsFromRawBody(rawBody) {
  const hasAvailabilityKeys = rawBody && (rawBody.includes('slots%5B') || rawBody.includes('slots['));
  if (!hasAvailabilityKeys) {
    return null;
  }

  const slotsByDay = {};
  for (const [key, value] of new URLSearchParams(rawBody).entries()) {
    const match = key.match(/^slots\[([0-6])\]\[([^\]]+)\]\[(start|end)\]$/);
    if (!match) continue;

    const [, day, index, field] = match;
    slotsByDay[day] = slotsByDay[day] || {};
    slotsByDay[day][index] = slotsByDay[day][index] || {};
    slotsByDay[day][index][field] = value;
  }

  return Object.keys(slotsByDay).length > 0 ? slotsByDay : null;
}

function flattenAvailabilitySlots(rawSlots, rawBody = '') {
  const slotsByDay = availabilitySlotsFromRawBody(rawBody) || (rawSlots && typeof rawSlots === 'object' ? rawSlots : {});
  const flat = [];
  let hasInvalid = false;

  for (const [dayKey, slots] of Object.entries(slotsByDay)) {
    const day = Number(dayKey);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !slots || typeof slots !== 'object') {
      continue;
    }

    for (const slot of Object.values(slots)) {
      if (!slot || typeof slot !== 'object') continue;

      const start = trimmed(slot.start);
      const end = trimmed(slot.end);
      if (start === '' && end === '') continue;
      if (start === '' || end === '' || start >= end) {
        hasInvalid = true;
        continue;
      }

      flat.push({
        day_of_week: day,
        start_time: start,
        end_time: end
      });
    }
  }

  return { flat, hasInvalid };
}

function linkedFailureStatus(error) {
  if (error instanceof ApiError && error.status === 404) {
    return 'link-user-not-found';
  }

  const code = apiErrorCode(error);
  if (code.includes('SAFEGUARDING_POLICY_UNAVAILABLE')) return 'link-safeguarding-unavailable';
  if (code.includes('VETTING_REQUIRED')) return 'link-vetting-required';
  if (code.includes('CONTACT_RESTRICTED')) return 'link-contact-restricted';
  if (code.includes('SELF')) return 'link-self';
  if (code.includes('EXIST')) return 'link-exists';
  if (code.includes('MAX') || code.includes('LIMIT')) return 'link-max';
  return 'link-failed';
}

router.get('/linked-accounts', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let children = [];
  let parents = [];

  try {
    children = normalizeRelationships(payloadFrom(await callSettings(token, 'GET', '/sub-accounts')), [
      'children',
      'child_accounts',
      'sub_accounts',
      'accounts',
      'items'
    ], res.locals.t);
    parents = normalizeRelationships(payloadFrom(await callSettings(token, 'GET', '/parent-accounts')), [
      'parents',
      'parent_accounts',
      'accounts',
      'items'
    ], res.locals.t);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/linked-accounts', {
    title: res.locals.t('govuk_alpha_settings.linked.title'),
    activeNav: 'account',
    status,
    statusMessage: SETTINGS_STATUS_MESSAGES[status]
      ? (['link-vetting-required', 'link-contact-restricted', 'link-safeguarding-unavailable'].includes(status)
        ? SETTINGS_STATUS_MESSAGES[status]
        : res.locals.t(`govuk_alpha_settings.states.${status}`))
      : '',
    successStatus: ['link-requested', 'link-approved', 'link-revoked', 'link-permissions-saved'].includes(status),
    errorStatus: [
      'link-email-invalid',
      'link-user-not-found',
      'link-self',
      'link-exists',
      'link-max',
      'link-failed',
      'link-vetting-required',
      'link-contact-restricted',
      'link-safeguarding-unavailable'
    ].includes(status),
    children,
    parents,
    maxChildren: 20,
    linkTypes: SETTINGS_LINK_TYPES.map((type) => ({
      value: type,
      label: res.locals.t(`govuk_alpha_settings.linked.types.${type}`),
      selected: type === 'family'
    })),
    permissions: SETTINGS_LINK_PERMISSIONS.map((permission) => ({
      value: permission,
      field: `perm_${permission}`,
      label: res.locals.t(`govuk_alpha_settings.linked.permissions.${permission}`),
      checkedByDefault: permission === 'can_view_activity'
    }))
  });
}));

router.get('/appearance', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let currentTheme = 'system';
  try {
    currentTheme = themeFromSettingsData(dataFrom(await callSettings(token, 'GET', '')));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/appearance', {
    title: res.locals.t('govuk_alpha_settings.appearance.title'),
    activeNav: 'account',
    status,
    statusMessage: SETTINGS_STATUS_MESSAGES[status]
      ? res.locals.t(`govuk_alpha_settings.states.${status}`)
      : '',
    successStatus: status === 'appearance-saved',
    errorStatus: ['appearance-invalid', 'appearance-failed'].includes(status),
    currentTheme,
    themes: SETTINGS_THEMES.map((theme) => ({
      value: theme,
      label: res.locals.t(`govuk_alpha_settings.appearance.themes.${theme}`),
      hint: res.locals.t(`govuk_alpha_settings.appearance.theme_hints.${theme}`),
      checked: currentTheme === theme
    }))
  });
}));

router.post('/appearance', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const theme = allowedValue(req.body.theme, SETTINGS_THEMES, null);
  if (theme === null) {
    return redirectTo(res, settingsStatusRedirect('/settings/appearance', 'appearance-invalid'));
  }

  let status = 'appearance-saved';
  try {
    await callSettings(token, 'PUT', '/theme', { theme });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'appearance-failed';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/appearance', status));
}));

router.get('/availability', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let availabilityByDay = {};
  try {
    availabilityByDay = availabilityByDayFromData(dataFrom(await callSettings(token, 'GET', '/availability')));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/availability', {
    title: res.locals.t('govuk_alpha_settings.availability.title'),
    activeNav: 'account',
    status,
    statusMessage: SETTINGS_STATUS_MESSAGES[status]
      ? res.locals.t(`govuk_alpha_settings.states.${status}`)
      : '',
    successStatus: status === 'availability-saved',
    errorStatus: ['availability-invalid', 'availability-failed'].includes(status),
    availabilityByDay,
    displayDays: SETTINGS_AVAILABILITY_DISPLAY_DAYS,
    dayLabels: SETTINGS_AVAILABILITY_DISPLAY_DAYS.map((_, index) => (
      res.locals.t(`govuk_alpha_settings.availability.day_labels.${index}`)
    )),
    slotsPerDay: SETTINGS_AVAILABILITY_SLOTS_PER_DAY
  });
}));

router.post('/availability', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const { flat, hasInvalid } = flattenAvailabilitySlots(req.body.slots, req.rawUrlencodedBody);
  if (hasInvalid) {
    return redirectTo(res, settingsStatusRedirect('/settings/availability', 'availability-invalid', '#availability'));
  }

  let status = 'availability-saved';
  try {
    await callSettings(token, 'PUT', '/availability', { schedule: flat });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'availability-failed';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/availability', status));
}));

router.post('/data-rights', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const type = allowedValue(req.body.request_type, SETTINGS_GDPR_TYPES, null);
  if (type === null) {
    return redirectTo(res, settingsStatusRedirect('/settings/data-rights', 'gdpr-invalid', '#request'));
  }

  const notes = trimmed(req.body.notes, 2000);
  let status = 'gdpr-requested';
  let fragment = '#your-requests';
  try {
    await callSettings(token, 'POST', '/gdpr-request', {
      type,
      notes: notes || null
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = error instanceof ApiError && error.status === 409 ? 'gdpr-duplicate' : 'gdpr-failed';
    fragment = '#request';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/data-rights', status, fragment));
}));

router.get('/data-rights', (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const requests = [];

  return res.render('settings/data-rights', {
    title: res.locals.t('govuk_alpha_settings.gdpr.title'),
    activeNav: 'account',
    status,
    statusMessage: status ? res.locals.t(`govuk_alpha_settings.states.${status}`) : '',
    successStatus: status === 'gdpr-requested',
    infoStatus: status === 'gdpr-duplicate',
    errorStatus: ['gdpr-invalid', 'gdpr-failed'].includes(status),
    requestTypes: SETTINGS_GDPR_TYPES.map((type) => ({
      value: type,
      label: res.locals.t(`govuk_alpha_settings.gdpr.types.${type}`),
      hint: res.locals.t(`govuk_alpha_settings.gdpr.type_descriptions.${type}`)
    })),
    requests
  });
});

router.get('/insurance', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  if (!insuranceEnabledForRequest(req)) return renderNotFound(res);

  let certificates = [];
  try {
    certificates = normalizeInsuranceCertificates(
      payloadFrom(await callSettings(token, 'GET', '/insurance')),
      res.locals.t
    );
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/insurance', {
    title: res.locals.t('govuk_alpha_settings.insurance.title'),
    activeNav: 'account',
    status,
    statusMessage: SETTINGS_STATUS_MESSAGES[status]
      ? res.locals.t(`govuk_alpha_settings.states.${status}`)
      : '',
    successStatus: status === 'insurance-uploaded',
    errorStatus: [
      'insurance-type-invalid',
      'insurance-file-required',
      'insurance-file-type',
      'insurance-file-large',
      'insurance-failed'
    ].includes(status),
    errorAnchor: status === 'insurance-type-invalid' ? 'insurance_type' : 'certificate_file',
    certificates,
    insuranceTypes: SETTINGS_INSURANCE_TYPES.map((type) => ({
      value: type,
      label: res.locals.t(`govuk_alpha_settings.insurance.types.${type}`)
    }))
  });
}));

router.post('/linked-accounts/request', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const email = trimmed(req.body.email);
  if (email === '' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', 'link-email-invalid', '#request'));
  }

  const payload = {
    email,
    relationship_type: allowedValue(req.body.relationship_type, SETTINGS_LINK_TYPES, 'family'),
    permissions: permissionPayload(req.body)
  };

  let status = 'link-requested';
  let fragment = '#children';
  try {
    await callSettings(token, 'POST', '/sub-accounts', payload);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = linkedFailureStatus(error);
    fragment = '#request';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', status, fragment));
}));

router.post('/linked-accounts/approve', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const relationshipId = positiveInteger(req.body.relationship_id);
  let status = 'link-approved';
  try {
    if (relationshipId === null) {
      status = 'link-failed';
    } else {
      await callSettings(token, 'PUT', `/sub-accounts/${relationshipId}/approve`);
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'link-failed';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', status, '#parents'));
}));

router.post('/linked-accounts/permissions', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const relationshipId = positiveInteger(req.body.relationship_id);
  if (relationshipId === null) {
    return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', 'link-failed', '#children'));
  }

  let status = 'link-permissions-saved';
  try {
    await callSettings(token, 'PUT', `/sub-accounts/${relationshipId}/permissions`, {
      permissions: permissionPayload(req.body)
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'link-failed';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', status, '#children'));
}));

router.post('/linked-accounts/revoke', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const relationshipId = positiveInteger(req.body.relationship_id);
  let status = 'link-revoked';
  try {
    if (relationshipId === null) {
      status = 'link-failed';
    } else {
      await callSettings(token, 'DELETE', `/sub-accounts/${relationshipId}`);
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'link-failed';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', status, '#children'));
}));

router.post('/insurance', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const file = uploadedFile(req, 'certificate_file');
  if (!token) {
    await removeUploadedFile(file);
    return redirectTo(res, loginRedirect());
  }
  if (!insuranceEnabledForRequest(req)) {
    await removeUploadedFile(file);
    return renderNotFound(res);
  }

  const insuranceType = allowedValue(req.body.insurance_type, SETTINGS_INSURANCE_TYPES, null);
  if (insuranceType === null) {
    await removeUploadedFile(file);
    return redirectTo(res, settingsStatusRedirect('/settings/insurance', 'insurance-type-invalid', '#upload'));
  }

  if (!file) {
    return redirectTo(res, settingsStatusRedirect('/settings/insurance', 'insurance-file-required', '#upload'));
  }

  try {
    const buffer = await fs.readFile(file.filepath);
    await uploadInsuranceCertificate(token, {
      insurance_type: insuranceType,
      provider_name: trimmed(req.body.provider_name, 255),
      policy_number: trimmed(req.body.policy_number, 255),
      coverage_amount: trimmed(req.body.coverage_amount),
      start_date: trimmed(req.body.start_date),
      expiry_date: trimmed(req.body.expiry_date),
      notes: trimmed(req.body.notes, 1000),
      file: {
        buffer,
        filename: trimmed(file.originalFilename) || 'certificate',
        contentType: trimmed(file.mimetype) || 'application/octet-stream',
        size: file.size
      }
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const field = apiErrorField(error);
    const message = String(error?.message || '').toLowerCase();
    const status = field === 'certificate_file' && /type|pdf|jpe?g|png|mime/.test(message)
      ? 'insurance-file-type'
      : field === 'certificate_file' && /size|large|limit|10\s*mb/.test(message)
        ? 'insurance-file-large'
        : 'insurance-failed';
    return redirectTo(res, settingsStatusRedirect('/settings/insurance', status, '#upload'));
  } finally {
    await removeUploadedFile(file);
  }

  return redirectTo(res, settingsStatusRedirect('/settings/insurance', 'insurance-uploaded', '#certificates'));
}));

module.exports = router;
