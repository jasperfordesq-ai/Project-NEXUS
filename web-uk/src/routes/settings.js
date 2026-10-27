// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { randomUUID } = require('crypto');
const express = require('express');
const {
  callUserSettingsApi,
  downloadMemberDataExport,
  getMemberDataExportHistory,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { readDate, dateParts } = require('../lib/date-input');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { isValidEmail } = require('../lib/inputValidator');
const { isValidationFailureStatus } = require('../lib/validation-status');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
const { resolveBackendMediaUrl } = require('../lib/accessible-shell');

const router = express.Router();

const SETTINGS_THEMES = ['light', 'dark', 'system'];
const SETTINGS_LINK_TYPES = ['family', 'guardian', 'carer', 'organization'];
// 🔴 `can_view_messages` is NOT here, and must never be added back.
//
// It is enforced as NOTHING, at any tier — SubAccountService hard-falses it in
// hasPermission() and SupportTiers::resolve() overwrites it to false on every
// read. Its own docblock calls it "the fossil of a switch that saved-and-did-
// nothing for years", kept only so historical rows parse, and warns that mapping
// it to the real capability would retroactively grant access to every family
// that ever ticked it.
//
// Offering it here put a tick box labelled "View their messages" on a carer's
// card, under a "Save permissions" button, with the supported member never
// asked. Real message access is CONSENT-GATED: the supporter asks, the supported
// member agrees, every read is audited with a purpose, and either side can
// withdraw. That flow is rendered from `relationship.messageAccess` below.
const SETTINGS_LINK_PERMISSIONS = [
  'can_view_activity',
  'can_manage_listings',
  'can_transact'
];
// Where each linked-account permission's LABEL lives in the Laravel catalogs.
//
// Three still sit under `linked.permissions.*`. `can_view_messages` does not:
// Laravel moved message viewing out of the flat permission list into its own
// `linked_messages.*` namespace when it became a request-and-approve capability
// (ask -> the other member approves -> viewing is recorded -> either side can
// withdraw). The old `linked.permissions.can_view_messages` key was removed
// upstream, so building the key by pattern rendered an EMPTY label here.
//
// 🔴 Scope note: this maps the label only. Web UK still presents message access
// as a simple checkbox, whereas Laravel now runs the full consent flow above.
// Reproducing that flow is outstanding parity work, not part of this fix —
// see web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md.
const SETTINGS_LINK_PERMISSION_LABEL_KEYS = {
  can_view_messages: 'govuk_alpha_settings.linked_messages.view_link'
};

function linkPermissionLabelKey(permission) {
  return SETTINGS_LINK_PERMISSION_LABEL_KEYS[permission]
    || `govuk_alpha_settings.linked.permissions.${permission}`;
}

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
  'link-tiers-member-approval': 'Only the person you support can give you more access.',
  'support-not-allowed': 'You cannot do this for them. What you can do may have changed.',
  'message-access-requested': 'They have been asked. Viewing only starts if they say yes.',
  'message-access-withdrawn': 'Stopped. They can no longer view your messages.',
  // Every refusal from the read-only message viewer lands here. Its copy has
  // existed and been translated all along; without an entry in this table the
  // render resolves an empty statusMessage, so a member who was refused was
  // simply bounced back to the page with nothing said.
  'message-view-denied': "You cannot view this member's messages. The permission may have been withdrawn.",
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
  'insurance-recorded': 'Your insurance record has been saved.',
  'insurance-type-invalid': 'Choose the type of insurance.',
  'insurance-expiry-required': 'Enter a valid insurance expiry date.',
  'insurance-failed': 'Sorry, we could not save your insurance record. Please try again.'
};
const INSURANCE_ERROR_STATUSES = ['insurance-type-invalid', 'insurance-expiry-required', 'insurance-failed'];
// The GOV.UK date input's first box carries the field's id, so the summary link lands there.
const INSURANCE_ERROR_ANCHORS = {
  'insurance-type-invalid': 'insurance_type',
  'insurance-expiry-required': 'expiry_date-day'
};

// 🔴 These three statuses have no govuk_alpha_settings.states.* key; their text lives in
// the already-translated safeguarding.errors.* namespace. Resolve them there so a member
// hears the message in their own language instead of the English literal above. The
// SETTINGS_STATUS_MESSAGES entries stay as the English source of record and the
// valid-status existence check.
const SETTINGS_SAFEGUARDING_STATUS_KEYS = {
  'link-vetting-required': 'safeguarding.errors.vetting_required_title',
  'link-contact-restricted': 'safeguarding.errors.contact_restricted',
  'link-safeguarding-unavailable': 'safeguarding.errors.policy_unavailable'
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
  return res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
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

// Support levels (React SubAccountsManager / Laravel SupportTiers). Mirror of
// SupportTiers::resolve(): the legacy booleans are the floor, an explicit tiers
// object wins per capability, and anything unrecognised degrades toward LESS
// power. `messages` is deliberately not resolved here — message access is the
// separate consent flow, rendered from the server-derived `message_access`.
const SUPPORT_TIER_RANK = Object.freeze({ none: 0, assist: 1, co_decide: 2, represent: 3 });
const SUPPORT_TIER_CAPABILITIES = Object.freeze(['activity', 'listings', 'credits']);
// What a member may grant for listings/credits. `assist` is not offered: it has
// no listing or credit action behind it, and showing it would present a state
// that does nothing (React GRANTABLE_ACTION_TIERS).
const GRANTABLE_ACTION_TIERS = Object.freeze(['none', 'co_decide', 'represent']);

function isSupportTier(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUPPORT_TIER_RANK, value);
}

function resolveSupportTiers(rawPermissions) {
  const permissions = jsonObjectFrom(rawPermissions);
  const resolved = {
    activity: permissions.can_view_activity ? 'assist' : 'none',
    listings: permissions.can_manage_listings ? 'represent' : 'none',
    credits: permissions.can_transact ? 'represent' : 'none'
  };
  const tiers = permissions.tiers && typeof permissions.tiers === 'object' && !Array.isArray(permissions.tiers)
    ? permissions.tiers
    : {};
  for (const capability of SUPPORT_TIER_CAPABILITIES) {
    if (isSupportTier(tiers[capability])) resolved[capability] = tiers[capability];
  }
  return resolved;
}

/** A tier that actually lets a supporter prepare or act (co_decide or above). */
function tierPermitsAction(tier) {
  return tier === 'co_decide' || tier === 'represent';
}

function normalizeRelationship(row, t) {
  const permissions = jsonObjectFrom(row && row.permissions);
  const tiers = resolveSupportTiers(row && row.permissions);
  const first = trimmed(row && row.first_name);
  const last = trimmed(row && row.last_name);
  const composite = `${first} ${last}`.trim();
  const name = trimmed((row && row.name) || composite || (row && row.email));
  const type = allowedValue(row && row.relationship_type, SETTINGS_LINK_TYPES, 'family');

  return {
    relationshipId: positiveInteger(row && (row.relationship_id || row.id)) || 0,
    name: name || t('govuk_alpha_settings.common.unknown_member'),
    email: trimmed(row && row.email),
    avatarUrl: resolveBackendMediaUrl(row && row.avatar_url),
    relationshipType: type,
    relationshipTypeLabel: t(`govuk_alpha_settings.linked.types.${type}`),
    status: trimmed(row && row.status) || 'pending',
    // The supported member's USER id — what the read-only message viewer is
    // keyed by. The relationship id is what the consent writes are keyed by;
    // they are different numbers and mixing them up shows the wrong person.
    userId: positiveInteger(row && (row.user_id || row.child_user_id || row.parent_user_id)) || 0,
    // none | pending | active, derived server-side (SubAccountController) so
    // both sides of the card agree with the consent machinery rather than
    // re-deriving it here from raw tiers.
    messageAccess: allowedValue(row && row.message_access, ['none', 'pending', 'active'], 'none'),
    messageAccessSince: formatLongDate(row && row.message_access_granted_at),
    // F-224: a pending link can be asked for from either end, so the API says
    // whether the answer is this viewer's. null = an API that does not send it;
    // the view then falls back to "the supported member answers".
    awaitingYourResponse: row && typeof row.awaiting_your_response === 'boolean'
      ? row.awaiting_your_response
      : null,
    permissions: SETTINGS_LINK_PERMISSIONS.reduce((acc, key) => {
      acc[key] = Boolean(permissions[key]);
      return acc;
    }, {}),
    tiers,
    // A coordinator-recorded arrangement: the levels are the supported
    // member's to set on their guardians page, so no control is offered here.
    staffRecorded: Boolean(row && row.staff_recorded),
    // A supporter may only lower or keep a level — raising it belongs to the
    // supported member (SubAccountService::updatePermissions refuses an
    // expansion with MEMBER_APPROVAL_REQUIRED).
    supporterTierOptions: {
      listings: GRANTABLE_ACTION_TIERS.filter((tier) => SUPPORT_TIER_RANK[tier] <= SUPPORT_TIER_RANK[tiers.listings]),
      credits: GRANTABLE_ACTION_TIERS.filter((tier) => SUPPORT_TIER_RANK[tier] <= SUPPORT_TIER_RANK[tiers.credits])
    },
    canPrepareListing: tierPermitsAction(tiers.listings),
    canPrepareTransfer: tierPermitsAction(tiers.credits)
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

// Long-form date ('17 August 2026') in the reader's locale. Named for what it
// does rather than for insurance, which merely needed it first.
function formatLongDate(value) {
  const text = trimmed(value);
  if (text === '') return '';
  // 🔴 Three shapes reach this: a bare date ('2026-08-25'), an ISO instant
  // ('2026-08-25T20:47:36.000000Z') and MySQL's space-separated datetime
  // ('2026-08-25 20:47:36'). Only the first two were handled, so the third
  // became '2026-08-25 20:47:36T00:00:00Z', an invalid Date, and the raw
  // database value was printed to the member.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00Z`
    : text.replace(' ', 'T');
  const date = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
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
    expiryLabel: formatLongDate(row && row.expiry_date),
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
  let loadError = false;

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
    loadError = true;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/linked-accounts', {
    title: res.locals.t('govuk_alpha_settings.linked.title'),
    activeNav: 'account',
    loadError: loadError ? res.locals.t('states.load_error') : '',
    status,
    // 🔴 The three safeguarding statuses rendered the ENGLISH SETTINGS_STATUS_MESSAGES
    // value in all eleven languages. They map exactly to already-translated
    // safeguarding.errors.* keys, so resolve them there instead — no new strings.
    // Every other status resolves via the translated govuk_alpha_settings.states.*.
    statusMessage: SETTINGS_STATUS_MESSAGES[status]
      ? (SETTINGS_SAFEGUARDING_STATUS_KEYS[status]
        ? res.locals.t(SETTINGS_SAFEGUARDING_STATUS_KEYS[status])
        : res.locals.t(`govuk_alpha_settings.states.${status}`))
      : '',
    successStatus: ['link-requested', 'link-approved', 'link-revoked', 'link-permissions-saved',
      'message-access-requested', 'message-access-withdrawn'].includes(status),
    // layouts/base.njk cannot see a validation failure signalled only by a status string,
    // so the "Error:" page-title prefix is passed from the route. `link-user-not-found` is
    // named explicitly because it is genuine input validation — the member typed an email
    // address that belongs to nobody here — but it does not end in `-invalid`, so the
    // shared helper's suffix rule would miss it.
    pageHasErrors: isValidationFailureStatus(status) || status === 'link-user-not-found',
    errorStatus: [
      'link-email-invalid',
      'link-user-not-found',
      'link-self',
      'link-exists',
      'link-max',
      'link-failed',
      'link-tiers-member-approval',
      'support-not-allowed',
      'link-vetting-required',
      'link-contact-restricted',
      'link-safeguarding-unavailable',
      // Every refusal from the read-only message viewer redirects here. Without
      // it in this list the banner block renders neither arm, so the member was
      // bounced back to an unchanged page with no explanation.
      'message-view-denied'
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
      label: res.locals.t(linkPermissionLabelKey(permission)),
      checkedByDefault: permission === 'can_view_activity'
    })),
    grantableTiers: GRANTABLE_ACTION_TIERS
  });
}));

router.get('/appearance', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let currentTheme = 'system';
  let loadError = false;
  try {
    currentTheme = themeFromSettingsData(dataFrom(await callSettings(token, 'GET', '')));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = true;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/appearance', {
    title: res.locals.t('govuk_alpha_settings.appearance.title'),
    activeNav: 'account',
    loadError: loadError ? res.locals.t('states.load_error') : '',
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
  let loadError = false;
  try {
    availabilityByDay = availabilityByDayFromData(dataFrom(await callSettings(token, 'GET', '/availability')));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = true;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/availability', {
    title: res.locals.t('govuk_alpha_settings.availability.title'),
    activeNav: 'account',
    loadError: loadError ? res.locals.t('states.load_error') : '',
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
  // Top of page, not '#your-requests': that section is gone (see the template),
  // and the member needs to land on the confirmation banner anyway.
  let fragment = '';
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
    }))
  });
});

/* ---------- Instant personal-data download (React DataExportPage) ---------- */

const DATA_EXPORT_FORMATS = Object.freeze(['json', 'zip']);
const DATA_EXPORT_ERRORS = Object.freeze({
  'export-rate-limited': 'govuk_alpha_settings.data_export.error_rate_limit',
  'export-failed': 'govuk_alpha_settings.data_export.error_build_failed'
});

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function formatDateTime(value) {
  const text = trimmed(value);
  if (text === '') return '';
  const normalized = text.replace(' ', 'T');
  const date = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }).format(date);
}

// Only a plain filename survives; anything else (paths, quotes, CR/LF) falls
// back to a neutral name so an upstream value can never inject a header.
function safeExportFilename(disposition, format) {
  const match = /filename="?([^";\r\n]+)"?/i.exec(String(disposition || ''));
  const candidate = match ? match[1].trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(json|zip)$/.test(candidate)
    ? candidate
    : `personal-data.${format}`;
}

router.get('/data-export', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let history = [];
  let historyError = false;
  try {
    const data = dataFrom(await getMemberDataExportHistory(token));
    history = (Array.isArray(data.exports) ? data.exports : []).map((row) => ({
      id: positiveInteger(row && row.id) || 0,
      format: trimmed(row && row.format).toUpperCase(),
      requestedLabel: formatDateTime(row && row.requested_at),
      sizeLabel: formatBytes(row && row.file_size_bytes)
    }));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    historyError = true;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/data-export', {
    title: res.locals.t('govuk_alpha_settings.data_export.title'),
    activeNav: 'account',
    errorMessage: DATA_EXPORT_ERRORS[status] ? res.locals.t(DATA_EXPORT_ERRORS[status]) : '',
    pageHasErrors: Boolean(DATA_EXPORT_ERRORS[status]),
    formats: DATA_EXPORT_FORMATS.map((format) => ({
      value: format,
      label: res.locals.t(`govuk_alpha_settings.data_export.format_${format}`),
      hint: res.locals.t(`govuk_alpha_settings.data_export.format_${format}_help`),
      checked: format === 'json'
    })),
    // Laravel replays an export for a repeated key instead of building a new
    // one, so a double press cannot use up two of the five daily exports.
    idempotencyKey: randomUUID(),
    history,
    historyError
  });
}));

router.post('/data-export', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const format = allowedValue(req.body.format, DATA_EXPORT_FORMATS, 'json');
  const key = trimmed(req.body.idempotency_key, 191);

  let download;
  try {
    download = await downloadMemberDataExport(token, format, key.length >= 8 ? key : null);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const status = error instanceof ApiError && error.status === 429 ? 'export-rate-limited' : 'export-failed';
    return redirectTo(res, settingsStatusRedirect('/settings/data-export', status, '#download'));
  }

  const headers = download.headers || {};
  res.set('Content-Type', format === 'zip' ? 'application/zip' : 'application/json');
  res.set('Content-Disposition', `attachment; filename="${safeExportFilename(headers['content-disposition'], format)}"`);
  // A personal-data archive must never be kept by a shared cache or browser history.
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(download.body);
}));

router.get('/insurance', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  if (!insuranceEnabledForRequest(req)) return renderNotFound(res);

  let certificates = [];
  let loadError = false;
  try {
    certificates = normalizeInsuranceCertificates(
      payloadFrom(await callSettings(token, 'GET', '/insurance')),
      res.locals.t
    );
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = true;
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';

  return res.render('settings/insurance', {
    title: res.locals.t('govuk_alpha_settings.insurance.title'),
    activeNav: 'account',
    loadError: loadError ? res.locals.t('states.load_error') : '',
    status,
    statusMessage: SETTINGS_STATUS_MESSAGES[status]
      ? res.locals.t(`govuk_alpha_settings.states.${status}`)
      : '',
    insuranceForm: consumeFormReplay(req, 'settings', 'insurance'),
    // `insurance-uploaded` is kept only so an old bookmarked confirmation still reads.
    successStatus: ['insurance-recorded', 'insurance-uploaded'].includes(status),
    errorStatus: INSURANCE_ERROR_STATUSES.includes(status),
    errorAnchor: INSURANCE_ERROR_ANCHORS[status] || 'insurance_type',
    expiryError: status === 'insurance-expiry-required'
      ? res.locals.t('govuk_alpha_settings.states.insurance-expiry-required')
      : '',
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
  if (!isValidEmail(email)) {
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
      await callSettings(token, 'PUT', `/sub-accounts/${encodeURIComponent(relationshipId)}/approve`);
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
    await callSettings(token, 'PUT', `/sub-accounts/${encodeURIComponent(relationshipId)}/permissions`, {
      permissions: permissionPayload(req.body)
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'link-failed';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', status, '#children'));
}));

// The tier fields a support-level form may carry. `messages` is never read:
// message access is the consent flow, not a level anyone can set here.
function tierPayloadFrom(body, { activityAsCheckbox = false } = {}) {
  const tiers = {};
  if (activityAsCheckbox) {
    tiers.activity = checked(body.tier_activity) || body.tier_activity === 'assist' ? 'assist' : 'none';
  } else if (['none', 'assist'].includes(trimmed(body.tier_activity))) {
    tiers.activity = trimmed(body.tier_activity);
  }
  for (const capability of ['listings', 'credits']) {
    const value = trimmed(body[`tier_${capability}`]);
    if (GRANTABLE_ACTION_TIERS.includes(value)) tiers[capability] = value;
  }
  return tiers;
}

function apiErrorCodes(error) {
  const data = error && error.data && typeof error.data === 'object' ? error.data : {};
  const codes = [data.code, data.error];
  if (Array.isArray(data.errors)) codes.push(...data.errors.map((item) => item && item.code));
  return codes.filter((code) => typeof code === 'string').map((code) => code.toUpperCase());
}

/**
 * SUPPORTER side (React SubAccountsManager handleTierChange): lower or keep a
 * level. Raising belongs to the supported member, and Laravel refuses it with
 * MEMBER_APPROVAL_REQUIRED, which is said plainly rather than as a generic fail.
 */
router.post('/linked-accounts/tiers', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const relationshipId = positiveInteger(req.body.relationship_id);
  const tiers = tierPayloadFrom(req.body);
  if (relationshipId === null || Object.keys(tiers).length === 0) {
    return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', 'link-failed', '#children'));
  }

  let status = 'link-permissions-saved';
  try {
    await callSettings(token, 'PUT', `/sub-accounts/${encodeURIComponent(relationshipId)}/permissions`, {
      permissions: { tiers }
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = apiErrorCodes(error).includes('MEMBER_APPROVAL_REQUIRED')
      ? 'link-tiers-member-approval'
      : (error instanceof ApiError && error.status === 404 ? 'link-failed' : linkedFailureStatus(error));
  }

  return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', status, '#children'));
}));

/**
 * SUPPORTED MEMBER side (React handleMemberTierChange): the only party who may
 * grant or raise a supporter's level. Raising re-runs Laravel's safeguarding
 * contact check, whose refusal keeps its own message.
 */
router.post('/linked-accounts/member-tiers', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const relationshipId = positiveInteger(req.body.relationship_id);
  if (relationshipId === null) {
    return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', 'link-failed', '#parents'));
  }

  let status = 'link-permissions-saved';
  try {
    await callSettings(token, 'PUT', `/parent-accounts/${encodeURIComponent(relationshipId)}/permissions`, {
      tiers: tierPayloadFrom(req.body, { activityAsCheckbox: true })
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = error instanceof ApiError && error.status === 404 ? 'link-failed' : linkedFailureStatus(error);
  }

  return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', status, '#parents'));
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
      await callSettings(token, 'DELETE', `/sub-accounts/${encodeURIComponent(relationshipId)}`);
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'link-failed';
  }

  return redirectTo(res, settingsStatusRedirect('/settings/linked-accounts', status, '#children'));
}));

router.post('/insurance', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  if (!insuranceEnabledForRequest(req)) return renderNotFound(res);

  // 🔴 Laravel keeps an insurance RECORD, not a document: type, optional provider and
  // a required expiry date (UserInsuranceController::store). Any `certificate_file`
  // is refused with 422 DOCUMENT_UPLOAD_FORBIDDEN, and every other field is discarded.
  // This form required a certificate and always sent it, so from 14 July 2026 it could
  // not succeed. It now sends exactly what React's Settings page sends.
  const insuranceType = allowedValue(req.body.insurance_type, SETTINGS_INSURANCE_TYPES, null);
  const providerName = trimmed(req.body.provider_name, 255);
  const expiry = readDate(req.body, 'expiry_date');
  const rememberRecord = () => rememberFormReplay(req, 'settings', 'insurance', {
    insuranceType: trimmed(req.body.insurance_type, 60),
    providerName,
    expiryDateParts: dateParts(req.body, 'expiry_date')
  });

  if (insuranceType === null) {
    rememberRecord();
    return redirectTo(res, settingsStatusRedirect('/settings/insurance', 'insurance-type-invalid', '#upload'));
  }

  if (!expiry.value) {
    rememberRecord();
    return redirectTo(res, settingsStatusRedirect('/settings/insurance', 'insurance-expiry-required', '#upload'));
  }

  try {
    await callSettings(token, 'POST', '/insurance', {
      insurance_type: insuranceType,
      provider_name: providerName || null,
      expiry_date: expiry.value
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    rememberRecord();
    const status = apiErrorCode(error) === 'VALIDATION_ERROR' && apiErrorField(error) === 'expiry_date'
      ? 'insurance-expiry-required'
      : 'insurance-failed';
    return redirectTo(res, settingsStatusRedirect('/settings/insurance', status, '#upload'));
  }

  return redirectTo(res, settingsStatusRedirect('/settings/insurance', 'insurance-recorded', '#certificates'));
}));

module.exports = router;
module.exports.normalizeRelationship = normalizeRelationship;
module.exports.resolveSupportTiers = resolveSupportTiers;
module.exports.tierPermitsAction = tierPermitsAction;
module.exports.GRANTABLE_ACTION_TIERS = GRANTABLE_ACTION_TIERS;
