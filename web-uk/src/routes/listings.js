// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const { requireAuth } = require('../middleware/auth');
const {
  getListings,
  getListing,
  createListing,
  updateListing,
  deleteListing,
  getListingCategories,
  getBookmarks,
  setListingSkillTags,
  uploadListingImage,
  callListingApi,
  createExchangeRequest,
  getExchangeConfig,
  checkExchangeForListing,
  createComment,
  getComments,
  getMemberVerificationBadges,
  toggleFeedLike,
  callWalletApi,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { audit } = require('../lib/auditLogger');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { getRequestProfile } = require('../lib/request-profile');
const { resolveBackendAssetUrl, flagEnabled } = require('../lib/accessible-shell');

const router = express.Router();

const LISTING_CONFIG_DEFAULTS = Object.freeze({
  'listing.allow_offers': true,
  'listing.allow_requests': true,
  'listing.require_category': true,
  'listing.require_location': false,
  'listing.require_hours_estimate': false,
  'listing.enable_skill_tags': true,
  'listing.enable_service_type': true,
  'listing.require_image': false,
  'listing.min_title_length': 5,
  'listing.min_description_length': 20,
  'listing.max_image_size_mb': 8
});
const LISTING_SERVICE_TYPES = new Set(['physical_only', 'remote_only', 'hybrid', 'location_dependent']);

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function phpFloat(value) {
  const match = String(value ?? '').trimStart().match(
    /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?/i
  );
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : 0;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function characterLength(value) {
  return Array.from(String(value || '')).length;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function listingFrom(result) {
  const data = dataFrom(result);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data.listing && typeof data.listing === 'object' ? data.listing : data;
}

function profileFrom(result) {
  const data = dataFrom(result);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data.user || data.profile || data;
}

function booleanValue(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = trimmed(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function numberValue(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function listingConfigFrom(req) {
  const tenant = req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};
  const configured = tenant.listing_config && typeof tenant.listing_config === 'object'
    ? tenant.listing_config
    : {};
  const config = { ...LISTING_CONFIG_DEFAULTS, ...configured };

  return {
    allowOffers: booleanValue(config['listing.allow_offers'], true),
    allowRequests: booleanValue(config['listing.allow_requests'], true),
    requireCategory: booleanValue(config['listing.require_category'], true),
    requireLocation: booleanValue(config['listing.require_location'], false),
    requireHours: booleanValue(config['listing.require_hours_estimate'], false),
    enableSkillTags: booleanValue(config['listing.enable_skill_tags'], true),
    enableServiceType: booleanValue(config['listing.enable_service_type'], true),
    requireImage: booleanValue(config['listing.require_image'], false),
    minTitleLength: Math.round(numberValue(config['listing.min_title_length'], 5, 1, 255)),
    minDescriptionLength: Math.round(numberValue(config['listing.min_description_length'], 20, 1, 10000)),
    maxImageSizeMb: numberValue(config['listing.max_image_size_mb'], 8, 1, 25)
  };
}

function listingCategoryFrom(value) {
  const category = value && typeof value === 'object' ? value : {};
  const id = positiveInteger(category.id);
  const name = trimmed(category.name || category.title);
  return id !== null && name ? { id, name } : null;
}

async function listingFormSupport(req) {
  const config = listingConfigFrom(req);
  let setupErrorMessage = null;
  let categoriesResult;

  try {
    categoriesResult = await getListingCategories(tokenFrom(req));
  } catch (error) {
    if (isAuthError(error)) throw error;
    setupErrorMessage = 'Sorry, there is a problem loading listing categories.';
    categoriesResult = { data: [] };
  }

  const categories = collectionFrom(categoriesResult)
    .map(listingCategoryFrom)
    .filter(Boolean);
  if (!setupErrorMessage && config.requireCategory && categories.length === 0) {
    setupErrorMessage = 'No listing categories are currently available. Contact your community administrator.';
  }

  return { config, categories, setupErrorMessage };
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

async function uploadListingCoverImage(token, listingId, image) {
  if (!image || !image.filepath || listingId === null) return;
  const buffer = await fs.readFile(image.filepath);
  await uploadListingImage(token, listingId, {
    file: {
      buffer,
      filename: trimmed(image.originalFilename) || 'listing-image',
      contentType: trimmed(image.mimetype) || 'application/octet-stream',
      size: image.size
    }
  });
}

function skillTagsFrom(value) {
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map(tag => trimmed(tag, 100))
    .filter((tag) => {
      const key = tag.toLocaleLowerCase('en');
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function listingFormValues(source = {}, listing = null) {
  const base = listing && typeof listing === 'object' ? listing : {};
  const values = source && typeof source === 'object' ? source : {};
  const skillTags = values.skill_tags !== undefined
    ? values.skill_tags
    : (Array.isArray(base.skill_tags) ? base.skill_tags.join(', ') : (base.skill_tags || ''));

  return {
    title: values.title !== undefined ? values.title : (base.title || ''),
    description: values.description !== undefined ? values.description : (base.description || ''),
    type: values.type !== undefined ? values.type : (base.type || 'offer'),
    category_id: values.category_id !== undefined ? values.category_id : (base.category_id || base.category?.id || ''),
    hours_estimate: values.hours_estimate !== undefined
      ? values.hours_estimate
      : (base.hours_estimate ?? base.estimated_hours ?? ''),
    service_type: values.service_type !== undefined ? values.service_type : (base.service_type || 'physical_only'),
    location: values.location !== undefined ? values.location : (base.location || ''),
    skill_tags: skillTags
  };
}

function boundedListingFormValues(source = {}) {
  const values = listingFormValues(source);
  return {
    title: trimmed(values.title, 255),
    description: trimmed(values.description, 10000),
    type: trimmed(values.type, 32),
    category_id: trimmed(values.category_id, 32),
    hours_estimate: trimmed(values.hours_estimate, 32),
    service_type: trimmed(values.service_type, 64),
    location: trimmed(values.location, 255),
    skill_tags: trimmed(values.skill_tags, 600)
  };
}

function storeListingFormReplay(req, listingId, values) {
  if (!req.session) return;
  req.session.listingFormReplay = {
    listingId: listingId === null ? null : positiveInteger(listingId),
    values: boundedListingFormValues(values)
  };
}

function consumeListingFormReplay(req, listingId) {
  if (!req.session || !req.session.listingFormReplay) return null;
  const replay = req.session.listingFormReplay;
  delete req.session.listingFormReplay;
  const expectedId = listingId === null ? null : positiveInteger(listingId);
  return replay.listingId === expectedId ? boundedListingFormValues(replay.values) : null;
}

function listingPayloadFrom(values) {
  const hours = trimmed(values.hours_estimate);
  return {
    title: trimmed(values.title),
    description: trimmed(values.description),
    type: trimmed(values.type),
    category_id: positiveInteger(values.category_id),
    hours_estimate: hours === '' ? null : Number(hours),
    service_type: LISTING_SERVICE_TYPES.has(trimmed(values.service_type))
      ? trimmed(values.service_type)
      : 'physical_only',
    location: trimmed(values.location) || null
  };
}

function validateListingValues(values, config, allowedTypes, image = null, t = key => key) {
  const errors = [];
  const fieldErrors = {};
  const add = (field, text) => {
    if (fieldErrors[field]) return;
    fieldErrors[field] = text;
    errors.push({ text, href: `#${field}` });
  };
  const title = trimmed(values.title);
  const description = trimmed(values.description);
  const type = trimmed(values.type);
  const categoryText = trimmed(values.category_id);
  const hoursText = trimmed(values.hours_estimate);
  const location = trimmed(values.location);
  const titleLength = characterLength(title);
  const descriptionLength = characterLength(description);
  const locationLength = characterLength(location);

  if (!title) add('title', t('listings.create.errors.title_required'));
  else if (titleLength < config.minTitleLength) add('title', t('listings.create.errors.title_min', { min: config.minTitleLength }));
  else if (titleLength > 255) add('title', t('listings.create.errors.title_max'));

  if (!description) add('description', t('listings.create.errors.description_required'));
  else if (descriptionLength < config.minDescriptionLength) add('description', t('listings.create.errors.description_min', { min: config.minDescriptionLength }));
  else if (descriptionLength > 10000) add('description', t('listings.create.errors.description_max'));

  if (!allowedTypes.includes(type)) add('type', t('listings.create.errors.type_required'));
  if (config.requireCategory && !categoryText) add('category_id', t('listings.create.errors.category_required'));

  if (config.requireHours && !hoursText) add('hours_estimate', t('listings.create.errors.hours_required'));
  if (hoursText) {
    const hours = Number(hoursText);
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 2000) {
      add('hours_estimate', t('listings.create.errors.hours_range'));
    }
  }

  if (config.requireLocation && !location) add('location', t('listings.create.errors.location_required'));
  else if (locationLength > 255) add('location', 'Location must be 255 characters or fewer');

  if (config.enableServiceType && !LISTING_SERVICE_TYPES.has(trimmed(values.service_type))) {
    add('service_type', 'Select how the service will be delivered');
  }
  if (image) {
    const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    if (!allowedMimes.has(trimmed(image.mimetype).toLowerCase())) {
      add('image', 'Choose a JPEG, PNG, GIF or WebP image');
    } else if (Number(image.size) > config.maxImageSizeMb * 1024 * 1024) {
      add('image', `Image must be ${config.maxImageSizeMb} MB or smaller`);
    }
  }

  return { errors, fieldErrors };
}

function apiErrorsFrom(error) {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') return [];
  const entries = error.data.errors;
  if (Array.isArray(entries)) {
    return entries
      .filter(entry => entry && typeof entry === 'object')
      .map(entry => ({
        code: trimmed(entry.code).toUpperCase(),
        message: trimmed(entry.message),
        field: trimmed(entry.field)
      }));
  }
  if (entries && typeof entries === 'object') {
    return Object.entries(entries).flatMap(([field, messages]) => {
      const values = Array.isArray(messages) ? messages : [messages];
      return values.map(message => ({
        code: 'VALIDATION_ERROR',
        message: trimmed(message),
        field
      })).filter(entry => entry.message);
    });
  }
  return [];
}

function listingFormErrorState(error, fallback) {
  const apiErrors = apiErrorsFrom(error);
  if (apiErrors.length === 0) {
    return { errors: [{ text: trimmed(error?.message) || fallback }], fieldErrors: {} };
  }
  const fieldAliases = { tags: 'skill_tags' };
  const fieldErrors = {};
  const errors = apiErrors.map((entry) => {
    const field = fieldAliases[entry.field] || entry.field;
    const text = entry.message || fallback;
    if (field && !fieldErrors[field]) fieldErrors[field] = text;
    return { text, ...(field ? { href: `#${field}` } : {}) };
  });
  return { errors, fieldErrors };
}

async function listingFormViewData(req, options) {
  const support = await listingFormSupport(req);
  const currentCategoryId = positiveInteger(
    options.values?.category_id
    || options.listing?.category_id
    || options.listing?.category?.id
  );
  if (currentCategoryId !== null && !support.categories.some(category => category.id === currentCategoryId)) {
    support.categories.push({
      id: currentCategoryId,
      name: trimmed(options.listing?.category_name || options.listing?.category?.name)
        || `Current category (${currentCategoryId})`
    });
  }
  return {
    title: options.title,
    listing: options.listing || null,
    listingImageUrl: resolveBackendAssetUrl(options.listing?.image_url || options.listing?.imageUrl),
    values: options.values || null,
    errors: options.errors || null,
    fieldErrors: options.fieldErrors || {},
    status: trimmed(req.query.status),
    ...support,
    setupErrorMessage: options.setupErrorMessage || support.setupErrorMessage,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  };
}

function renderForbidden(res, error) {
  return res.status(403).render('errors/403', {
    title: 'Forbidden',
    message: trimmed(error?.message) || 'You do not have permission to manage this listing.'
  });
}

function isOnboardingRequired(error) {
  return error instanceof ApiError && error.status === 403 && apiErrorCode(error) === 'ONBOARDING_REQUIRED';
}

function listingGalleryFrom(listing) {
  const images = Array.isArray(listing.images) ? listing.images : [];
  return images.map((image) => {
    const item = image && typeof image === 'object' ? image : {};
    const url = resolveBackendAssetUrl(item.url || item.image_url || item.imageUrl);
    if (!url) return null;
    return {
      url,
      altText: trimmed(item.alt_text || item.altText)
    };
  }).filter(Boolean);
}

function listingSkillTagsFrom(listing) {
  const tags = Array.isArray(listing.skill_tags) ? listing.skill_tags : [];
  const seen = new Set();
  return tags.map((tag) => {
    const value = tag && typeof tag === 'object' ? (tag.name || tag.tag) : tag;
    return trimmed(value);
  }).filter((tag) => {
    const key = tag.toLocaleLowerCase('en');
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function listingAuthorFrom(listing) {
  const user = listing.user && typeof listing.user === 'object' ? listing.user : {};
  const name = trimmed(listing.author_name || listing.authorName || user.name);
  const id = listingOwnerId(listing);
  if (!name) return null;
  return {
    id,
    name,
    initial: Array.from(name)[0]?.toLocaleUpperCase() || '',
    avatarUrl: resolveBackendAssetUrl(listing.author_avatar || listing.authorAvatar || user.avatar_url || user.avatar),
    tagline: trimmed(listing.author_tagline || listing.authorTagline || user.tagline),
    rating: Number.isFinite(Number(listing.author_rating)) ? Number(listing.author_rating) : null,
    reviewsCount: Math.max(0, Number(listing.author_reviews_count) || 0),
    exchangesCount: Math.max(0, Number(listing.author_exchanges_count) || 0)
  };
}

function relatedListingsFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.map((listing) => {
    const item = listing && typeof listing === 'object' ? listing : {};
    const id = positiveInteger(item.id);
    const title = trimmed(item.title || item.name);
    return id !== null && title ? { id, title } : null;
  }).filter(Boolean);
}

function listingVerificationBadgesFrom(result, t) {
  return collectionFrom(result).map((badge) => {
    const item = badge && typeof badge === 'object' ? badge : {};
    const type = trimmed(item.badge_type || item.type);
    if (!type) return null;
    const key = `govuk_alpha_listings.badges.${type}`;
    const translated = t(key);
    return {
      type,
      label: translated === key ? (trimmed(item.label) || type.replaceAll('_', ' ')) : translated
    };
  }).filter(Boolean);
}

async function exchangeWorkflowEnabled(token) {
  const payload = await getExchangeConfig(token);
  const data = dataFrom(payload) || {};
  return data.exchange_workflow_enabled === true;
}

async function listingExchangeContext(token, listingId) {
  const configPayload = await getExchangeConfig(token);
  const config = dataFrom(configPayload) || {};
  const exchangeWorkflowEnabled = config.exchange_workflow_enabled === true;

  if (!exchangeWorkflowEnabled) {
    return {
      exchangeWorkflowEnabled: false,
      directMessagingEnabled: config.direct_messaging_enabled === true,
      exchangeContextReady: true,
      activeExchange: null
    };
  }

  const activePayload = await checkExchangeForListing(token, listingId);
  const active = dataFrom(activePayload);
  return {
    exchangeWorkflowEnabled: true,
    directMessagingEnabled: config.direct_messaging_enabled === true,
    exchangeContextReady: true,
    activeExchange: active && typeof active === 'object' && positiveInteger(active.id) !== null
      ? active
      : null
  };
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function urlFor(res, path) {
  return typeof res.locals?.urlFor === 'function' ? res.locals.urlFor(path) : path;
}

function redirectTo(res, path) {
  return res.redirect(urlFor(res, path));
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function apiErrorCode(error) {
  const data = error && error.data && typeof error.data === 'object' ? error.data : {};
  return apiErrorsFrom(error)[0]?.code || String(data.code || data.error || data.error_code || '').toUpperCase();
}

function redirectOnAuthError(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

function listingRedirect(id, status, fragment = '') {
  return `/listings/${id}?status=${encodeURIComponent(status)}${fragment}`;
}

async function callListing(token, method, path, data = undefined) {
  if (data === undefined) {
    return callListingApi(token, method, path);
  }

  return callListingApi(token, method, path, data);
}

async function runListingAction(req, res, method, path, data, successRedirect, failureRedirect) {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    await callListing(token, method, path, data);
    return redirectTo(res, successRedirect);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, failureRedirect);
  }
}

function listingType(value) {
  const type = trimmed(value).toLowerCase();
  return ['offer', 'request'].includes(type) ? type : 'offer';
}

function generateDescriptionRedirect(listingId, status) {
  const target = listingId === null ? '/listings/new' : `/listings/${listingId}/edit`;
  return `${target}?status=${encodeURIComponent(status)}#description`;
}

function reportPayload(body) {
  const allowedReasons = new Set(['inappropriate', 'safety_concern', 'misleading', 'spam', 'not_timebank_service', 'other']);
  const reason = trimmed(body.reason);
  if (!allowedReasons.has(reason)) {
    return null;
  }

  return {
    reason,
    details: trimmed(body.details, 500) || null
  };
}

function listingOwnerId(listing) {
  return positiveInteger(listing && (listing.user_id || listing.author_id || listing.userId || listing.authorId))
    || positiveInteger(listing && listing.user && listing.user.id)
    || positiveInteger(listing && listing.provider && listing.provider.id)
    || positiveInteger(listing && listing.public_contract && listing.public_contract.provider && listing.public_contract.provider.id);
}

function listingReportStatus(status, t) {
  const messages = {
    'report-invalid': t('polish_listings.report_reason_required'),
    'report-failed': t('polish_listings.status_listing_report_failed'),
    'already-reported': 'You have already reported this listing.'
  };
  const message = messages[trimmed(status)];
  return message ? { type: 'error', message } : null;
}

function listingReportReasons(t) {
  return [
    { value: 'inappropriate', label: t('polish_listings.report_reason_inappropriate') },
    { value: 'safety_concern', label: t('polish_listings.report_reason_safety_concern') },
    { value: 'misleading', label: t('polish_listings.report_reason_misleading') },
    { value: 'spam', label: t('polish_listings.report_reason_spam') },
    { value: 'not_timebank_service', label: t('polish_listings.report_reason_not_timebank_service') },
    { value: 'other', label: t('polish_listings.report_reason_other') }
  ];
}

function storeListingReportReplay(req, listingId, body) {
  if (!req.session) return;
  req.session.listingReportReplay = {
    listingId: positiveInteger(listingId),
    reason: trimmed(body && body.reason, 40),
    details: trimmed(body && body.details, 500)
  };
}

function consumeListingReportReplay(req, listingId) {
  if (!req.session || !req.session.listingReportReplay) return null;
  const replay = req.session.listingReportReplay;
  delete req.session.listingReportReplay;
  return replay.listingId === positiveInteger(listingId) ? replay : null;
}

function suggestedExchangeHours(listing) {
  const raw = Number(listing && (listing.hours_estimate ?? listing.estimated_hours));
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return Math.max(0.25, Math.min(24, hours));
}

function oneDecimal(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : '';
}

function exchangeRequestStatus(status, t) {
  const messages = {
    'compliance-failed': t('exchanges.compliance_failed'),
    'exchange-failed': t('exchanges.request_failed')
  };
  const message = messages[trimmed(status)];
  return message ? { type: 'error', message } : null;
}

function listingAuthorName(listing) {
  return trimmed(listing && (listing.author_name || listing.authorName))
    || trimmed(listing && listing.user && listing.user.name)
    || '';
}

function listingAnalyticsDays(value) {
  const allowed = new Set([7, 14, 30, 60, 90]);
  const days = Number(value);
  return allowed.has(days) ? days : 30;
}

function integerLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number).toLocaleString(getRequestIntlLocale()) : '0';
}

function decimalLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString(getRequestIntlLocale(), { maximumFractionDigits: 1 });
}

function dateParts(value) {
  const text = trimmed(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3])
  };
}

function dateLabel(value, month = 'long') {
  const parts = dateParts(value);
  if (!parts) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month,
    year: month === 'long' ? 'numeric' : undefined,
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(parts.year, parts.month, parts.day)));
}

function contactTypeLabel(value, t) {
  const labels = {
    message: t('govuk_alpha_listings.analytics.contact_type_message'),
    phone: t('govuk_alpha_listings.analytics.contact_type_phone'),
    email: t('govuk_alpha_listings.analytics.contact_type_email'),
    exchange_request: t('govuk_alpha_listings.analytics.contact_type_exchange_request')
  };
  const type = trimmed(value);
  if (labels[type]) return labels[type];
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function analyticsSeries(rows) {
  const series = Array.isArray(rows) ? rows : [];
  const max = series.reduce((highest, row) => Math.max(highest, Number(row && row.count) || 0), 1);
  return series.map((row) => {
    const count = Math.max(0, Number(row && row.count) || 0);
    return {
      dateLabel: dateLabel(row && row.date, 'short'),
      count,
      countLabel: integerLabel(count),
      max
    };
  });
}

function decorateListingAnalytics(result, t) {
  const data = dataFrom(result) || {};
  const summary = data && typeof data.summary === 'object' && data.summary !== null ? data.summary : {};
  const viewsOverTime = analyticsSeries(data.views_over_time || data.viewsOverTime);
  const contactsOverTime = analyticsSeries(data.contacts_over_time || data.contactsOverTime);
  const contactTypes = (Array.isArray(data.contact_types || data.contactTypes) ? (data.contact_types || data.contactTypes) : [])
    .map((row) => ({
      label: contactTypeLabel(row && (row.contact_type || row.contactType), t),
      countLabel: integerLabel(row && row.count)
    }));
  const trend = Number(summary.views_trend_percent ?? summary.viewsTrendPercent ?? 0);

  return {
    hasData: Object.keys(summary).length > 0 || viewsOverTime.length > 0 || contactsOverTime.length > 0,
    summary: {
      totalViews: integerLabel(summary.total_views ?? summary.totalViews),
      uniqueViewers: integerLabel(summary.unique_viewers ?? summary.uniqueViewers),
      totalContacts: integerLabel(summary.total_contacts ?? summary.totalContacts),
      totalSaves: integerLabel(summary.total_saves ?? summary.totalSaves),
      contactRate: decimalLabel(summary.contact_rate ?? summary.contactRate),
      saveRate: decimalLabel(summary.save_rate ?? summary.saveRate),
      trendLabel: trend > 0
        ? t('govuk_alpha_listings.analytics.trend_up', { percent: decimalLabel(Math.abs(trend)) })
        : trend < 0
          ? t('govuk_alpha_listings.analytics.trend_down', { percent: decimalLabel(Math.abs(trend)) })
          : t('govuk_alpha_listings.analytics.trend_flat')
    },
    createdAtLabel: dateLabel(data.created_at || data.createdAt),
    expiresAtLabel: dateLabel(data.expires_at || data.expiresAt),
    viewsOverTime,
    contactsOverTime,
    contactTypes
  };
}

function listingCommentsStatus(status, t) {
  const states = {
    'comment-added': { type: 'success', title: t('states.success_title'), message: t('govuk_alpha_listings.comments.states.comment-added') },
    'reply-added': { type: 'success', title: t('states.success_title'), message: t('govuk_alpha_listings.comments.states.reply-added') },
    'comment-invalid': { type: 'error', title: t('states.error_title'), message: t('govuk_alpha_listings.comments.states.comment-invalid'), anchor: 'body' },
    'comment-failed': { type: 'error', title: t('states.error_title'), message: t('govuk_alpha_listings.comments.states.comment-failed'), anchor: 'body' }
  };
  return states[trimmed(status)] || null;
}

function normalizeListingComment(comment, depth = 0) {
  const item = comment && typeof comment === 'object' ? comment : {};
  const replies = Array.isArray(item.replies) && depth < 4
    ? item.replies.map((reply) => normalizeListingComment(reply, depth + 1))
    : [];
  const author = item.author && typeof item.author === 'object' ? item.author : {};

  return {
    id: positiveInteger(item.id),
    content: trimmed(item.content || item.body || item.text, 5000),
    authorName: trimmed(author.name || item.author_name || item.authorName),
    createdAtLabel: dateLabel(item.created_at || item.createdAt),
    edited: Boolean(item.edited || item.is_edited || item.isEdited),
    replies
  };
}

function commentsPayload(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) {
    return { comments: data.map((comment) => normalizeListingComment(comment)), count: data.length };
  }

  const object = data && typeof data === 'object' ? data : {};
  const rows = Array.isArray(object.comments) ? object.comments : [];
  const comments = rows.map((comment) => normalizeListingComment(comment));
  const count = positiveInteger(object.count || object.total || object.comments_count || object.commentsCount);
  return { comments, count: count || countListingComments(comments) };
}

function countListingComments(comments) {
  return comments.reduce((total, comment) => total + 1 + countListingComments(comment.replies || []), 0);
}

async function walletBalanceForExchange(token) {
  try {
    const result = await callWalletApi(token, 'GET', '/balance');
    const data = dataFrom(result) || {};
    const balance = Number(data.balance ?? data.available_balance ?? data.current_balance);
    return Number.isFinite(balance) ? balance : null;
  } catch {
    return null;
  }
}

router.post('/generate-description', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const listingId = positiveInteger(req.body.listing_id);
  const values = boundedListingFormValues(req.body);
  const title = values.title;
  storeListingFormReplay(req, listingId, values);
  if (title === '') {
    return redirectTo(res, generateDescriptionRedirect(listingId, 'ai-title-required'));
  }

  const payload = {
    title,
    type: listingType(values.type),
    category: trimmed(req.body.category || req.body.category_name || req.body.category_id),
    notes: trimmed(req.body.notes || values.description, 5000)
  };

  if (payload.category === '') delete payload.category;
  if (payload.notes === '') delete payload.notes;

  let status = 'ai-generated';
  try {
    const result = await callListing(token, 'POST', '/generate-description', payload);
    const description = trimmed(dataFrom(result)?.description, 5000);
    if (!description) {
      status = 'ai-failed';
    } else {
      values.description = description;
      storeListingFormReplay(req, listingId, values);
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = error instanceof ApiError && error.status === 403 ? 'ai-disabled' : 'ai-failed';
  }

  return redirectTo(res, generateDescriptionRedirect(listingId, status));
}));

router.post('/:id(\\d+)/save', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runListingAction(
    req,
    res,
    'POST',
    `/${id}/save`,
    undefined,
    listingRedirect(id, 'listing-saved'),
    listingRedirect(id, 'save-failed')
  );
}));

router.post('/:id(\\d+)/unsave', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runListingAction(
    req,
    res,
    'DELETE',
    `/${id}/save`,
    undefined,
    listingRedirect(id, 'listing-unsaved'),
    listingRedirect(id, 'unsave-failed')
  );
}));

router.post('/:id(\\d+)/renew', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runListingAction(
    req,
    res,
    'POST',
    `/${id}/renew`,
    undefined,
    listingRedirect(id, 'listing-renewed'),
    listingRedirect(id, 'renew-failed')
  );
}));

router.post('/:id(\\d+)/like', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'like-failed';
  try {
    const result = await toggleFeedLike(token, {
      target_type: 'listing',
      target_id: id
    });
    const data = dataFrom(result);
    status = data && data.action === 'unliked' ? 'unliked' : 'liked';
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  return redirectTo(res, listingRedirect(id, status, '#like'));
}));

router.post('/:id(\\d+)/comments', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const body = trimmed(req.body.body || req.body.content, 5000);
  if (body === '') {
    return redirectTo(res, `/listings/${id}/comments?status=comment-invalid#add-comment`);
  }

  const parentId = positiveInteger(req.body.parent_id);
  const payload = {
    target_type: 'listing',
    target_id: id,
    content: body
  };
  if (parentId !== null) {
    payload.parent_id = parentId;
  }

  let status = parentId !== null ? 'reply-added' : 'comment-added';
  try {
    await createComment(token, payload);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = error instanceof ApiError && [400, 422].includes(error.status)
      ? 'comment-invalid'
      : 'comment-failed';
  }

  return redirectTo(res, `/listings/${id}/comments?status=${status}#add-comment`);
}));

router.post('/:listingId(\\d+)/exchange-request', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const listingId = Number(req.params.listingId);
  const workflowEnabled = await exchangeWorkflowEnabled(token);
  if (!workflowEnabled) {
    return redirectTo(res, listingRedirect(listingId, 'exchange-disabled'));
  }

  const proposedHoursInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'proposed_hours')
    ? req.body.proposed_hours
    : 1;
  const prepTime = trimmed(req.body.prep_time) === ''
    ? null
    : phpFloat(req.body.prep_time);
  const message = trimmed(req.body.message, 5000);
  const payload = {
    listing_id: listingId,
    proposed_hours: Math.max(0.25, Math.min(24, phpFloat(proposedHoursInput)))
  };
  if (prepTime !== null) {
    payload.prep_time = prepTime;
  }
  if (message !== '') {
    payload.message = message;
  }

  try {
    const result = await createExchangeRequest(token, payload);
    const data = dataFrom(result);
    const exchangeId = positiveInteger(
      data && (data.id || data.exchange_id || (data.exchange && data.exchange.id))
    );
    if (exchangeId !== null) {
      return redirectTo(res, `/exchanges/${exchangeId}?status=exchange-created`);
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    if (code === 'COMPLIANCE_VIOLATION') {
      return redirectTo(res, `/listings/${listingId}/exchange-request?status=compliance-failed`);
    }
    if (code === 'FEATURE_DISABLED') {
      return redirectTo(res, listingRedirect(listingId, 'exchange-disabled'));
    }
  }

  return redirectTo(res, `/listings/${listingId}/exchange-request?status=exchange-failed`);
}));

router.get('/:listingId(\\d+)/exchange-request', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const listingId = Number(req.params.listingId);
  const workflowEnabled = await exchangeWorkflowEnabled(token);
  if (!workflowEnabled) {
    return redirectTo(res, listingRedirect(listingId, 'exchange-disabled'));
  }

  const [listingResult, profileResult, walletBalance] = await Promise.all([
    callListing(token, 'GET', `/${listingId}`),
    getRequestProfile(req, token).catch(() => null),
    walletBalanceForExchange(token)
  ]);

  const listing = dataFrom(listingResult) || {};
  const currentUser = dataFrom(profileResult) || {};
  const ownerId = listingOwnerId(listing);
  const currentUserId = positiveInteger(currentUser.id);
  if (ownerId !== null && currentUserId !== null && ownerId === currentUserId) {
    return redirectTo(res, listingRedirect(listingId, 'own-listing'));
  }

  const suggestedHours = suggestedExchangeHours(listing);
  const t = res.locals.t;
  res.render('listings/exchange-request', {
    title: t('exchanges.request_title'),
    listing: { ...listing, id: listingId },
    listingType: listingType(listing.type),
    authorName: listingAuthorName(listing),
    suggestedHours,
    suggestedHoursLabel: oneDecimal(suggestedHours),
    walletBalance,
    walletBalanceLabel: walletBalance === null ? '' : oneDecimal(walletBalance),
    status: exchangeRequestStatus(req.query.status, t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Listing not found' }));

router.get('/:id(\\d+)/analytics', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const days = listingAnalyticsDays(req.query.days);
  let listingResult;
  let analyticsResult;

  try {
    [listingResult, analyticsResult] = await Promise.all([
      callListing(token, 'GET', `/${id}`),
      callListing(token, 'GET', `/${id}/analytics?days=${days}`)
    ]);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Listing not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }
    throw error;
  }

  const listing = dataFrom(listingResult) || {};
  const analyticsData = dataFrom(analyticsResult) || {};
  const t = res.locals.t;
  const pageTitle = t('govuk_alpha_listings.analytics.title');
  const listingTitle = trimmed(listing.title || listing.name || analyticsData.title) || pageTitle;

  return res.render('listings/analytics', {
    title: pageTitle,
    listing: { ...listing, id },
    listingTitle,
    days,
    dayOptions: [7, 14, 30, 60, 90],
    analytics: decorateListingAnalytics(analyticsResult, t)
  });
}, { notFoundTitle: 'Listing not found' }));

router.get('/:id(\\d+)/comments', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const listingResult = await callListing(token, 'GET', `/${id}`);
  let commentsResult = { data: { comments: [], count: 0 } };

  try {
    commentsResult = await getComments(token, { target_type: 'listing', target_id: id });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const listing = dataFrom(listingResult) || {};
  const commentData = commentsPayload(commentsResult);
  return res.render('listings/comments', {
    title: res.locals.t('govuk_alpha_listings.comments.title'),
    listing: { ...listing, id },
    listingTitle: trimmed(listing.title || listing.name) || 'Comments',
    comments: commentData.comments,
    commentsCount: commentData.count,
    status: listingCommentsStatus(req.query.status, res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Listing not found' }));

router.post('/:id(\\d+)/report', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const payload = reportPayload(req.body);
  if (payload === null) {
    storeListingReportReplay(req, id, req.body);
    return redirectTo(res, `/listings/${id}/report?status=report-invalid`);
  }

  let status = 'listing-reported';
  try {
    await callListing(token, 'POST', `/${id}/report`, payload);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = error instanceof ApiError && error.status === 409
      ? 'already-reported'
      : 'report-failed';
  }

  return redirectTo(res, listingRedirect(id, status));
}));

router.get('/:id(\\d+)/report', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const [listingResult, profileResult] = await Promise.all([
    callListing(token, 'GET', `/${id}`),
    getRequestProfile(req, token).catch(() => null)
  ]);

  const listing = dataFrom(listingResult) || {};
  const currentUser = dataFrom(profileResult) || {};
  const ownerId = listingOwnerId(listing);
  const currentUserId = positiveInteger(currentUser.id);
  if (ownerId !== null && currentUserId !== null && ownerId === currentUserId) {
    return renderForbidden(res);
  }

  const t = res.locals.t;
  const oldInput = consumeListingReportReplay(req, id) || { reason: '', details: '' };

  res.render('listings/report', {
    title: t('polish_listings.report_form_title'),
    listing: { ...listing, id },
    status: listingReportStatus(req.query.status, t),
    reasons: listingReportReasons(t),
    oldInput,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Listing not found' }));

// List all listings with search/filter/pagination
router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const search = trimmed(req.query.q || req.query.search);
  const type = ['offer', 'request'].includes(String(req.query.type || '')) ? String(req.query.type) : '';
  const categoryId = positiveInteger(req.query.category_id);
  const hours = ['any', 'quick', 'short', 'half_day', 'full_day'].includes(String(req.query.hours || 'any')) ? String(req.query.hours || 'any') : 'any';
  const service = ['any', 'remote', 'in_person'].includes(String(req.query.service || 'any')) ? String(req.query.service || 'any') : 'any';
  const posted = ['any', '1', '7', '30'].includes(String(req.query.posted || 'any')) ? String(req.query.posted || 'any') : 'any';
  const sort = ['newest', 'recommended'].includes(String(req.query.sort || 'newest')) ? String(req.query.sort || 'newest') : 'newest';
  const near = ['any', '5', '10', '25', '50'].includes(String(req.query.near || 'any')) ? String(req.query.near || 'any') : 'any';
  const cursor = trimmed(req.query.cursor);
  const params = {
    limit: 12,
    ...(search ? { q: search } : {}),
    ...(type ? { type } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(cursor ? { cursor } : {})
  };
  const hoursMap = {
    quick: { max_hours: 1 },
    short: { min_hours: 1, max_hours: 3 },
    half_day: { min_hours: 3, max_hours: 6 },
    full_day: { min_hours: 6 }
  };
  Object.assign(params, hoursMap[hours] || {});
  if (service === 'remote') params.service_type = 'remote_only,hybrid';
  if (service === 'in_person') params.service_type = 'physical_only';
  if (posted !== 'any') params.posted_within = Number(posted);
  if (sort === 'recommended') params.featured_first = true;
  const currentUserResult = token ? await getRequestProfile(req, token).catch(() => null) : null;
  const currentUser = profileFrom(currentUserResult);
  const latitude = Number(currentUser.latitude);
  const longitude = Number(currentUser.longitude);
  const nearNoLocation = near !== 'any' && Boolean(token) && (!Number.isFinite(latitude) || !Number.isFinite(longitude));
  if (near !== 'any' && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    params.near_lat = latitude;
    params.near_lng = longitude;
    params.radius_km = Number(near);
  }

  const [listingResult, categoriesResult, bookmarksResult] = await Promise.all([
    getListings(token, params).then(result => ({ result, error: false })).catch(() => ({ result: { data: [], meta: {} }, error: true })),
    getListingCategories(token).catch(() => ({ data: [] })),
    token ? getBookmarks(token, { type: 'listing', page: 1, per_page: 50 }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] })
  ]);
  const result = listingResult.result;
  const listings = collectionFrom(result).map(listing => ({
    ...listing,
    imageUrl: resolveBackendAssetUrl(listing && (listing.image_url || listing.imageUrl)),
    authorName: trimmed(listing && ((listing.user && listing.user.name) || listing.author_name)),
    categoryName: trimmed(listing && (listing.category_name || (listing.category && listing.category.name))),
    hoursEstimate: listing && (listing.hours_estimate ?? listing.hoursEstimate)
  }));
  const categories = collectionFrom(categoriesResult)
    .map(category => ({ id: positiveInteger(category && category.id), name: trimmed(category && category.name) }))
    .filter(category => category.id && category.name);
  const savedListingIds = new Set(collectionFrom(bookmarksResult)
    .map(bookmark => positiveInteger(bookmark && (bookmark.bookmarkable_id ?? bookmark.bookmarkableId ?? bookmark.item_id ?? bookmark.itemId)))
    .filter(Boolean));
  for (const listing of listings) listing.isSaved = savedListingIds.has(positiveInteger(listing.id));
  const meta = result?.meta || {};
  const pagination = {
    hasMore: Boolean(meta.has_more),
    cursor: trimmed(meta.cursor || meta.next_cursor),
    total: Number(meta.total_items ?? meta.total ?? listings.length) || 0
  };
  const nextQuery = new URLSearchParams();
  if (search) nextQuery.set('q', search);
  if (type) nextQuery.set('type', type);
  if (categoryId) nextQuery.set('category_id', String(categoryId));
  if (hours !== 'any') nextQuery.set('hours', hours);
  if (service !== 'any') nextQuery.set('service', service);
  if (near !== 'any') nextQuery.set('near', near);
  if (posted !== 'any') nextQuery.set('posted', posted);
  if (sort !== 'newest') nextQuery.set('sort', sort);
  if (pagination.cursor) nextQuery.set('cursor', pagination.cursor);

  res.render('listings/index', {
    title: 'Listings',
    listings,
    categories,
    pagination,
    nextHref: pagination.hasMore && pagination.cursor ? `/listings?${nextQuery.toString()}` : null,
    filters: { search, type, categoryId, hours, service, posted, sort, near, nearNoLocation },
    hasFilters: Boolean(search || type || categoryId || hours !== 'any' || service !== 'any' || posted !== 'any'),
    currentUser,
    isAuthenticated: Boolean(token),
    loadError: listingResult.error,
    status: trimmed(req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

// New listing form
router.get('/new', requireAuth, asyncRoute(async (req, res) => {
  const replay = consumeListingFormReplay(req, null);
  res.render('listings/form', await listingFormViewData(req, {
    title: 'Create listing',
    listing: null,
    values: replay,
    errors: null,
    fieldErrors: {}
  }));
}, { redirectOn401: loginRedirect() }));

// Create listing
router.post('/new', requireAuth, audit.listingCreate(), asyncRoute(async (req, res) => {
  const image = uploadedFile(req, 'image');
  const config = listingConfigFrom(req);
  const allowedTypes = ['offer', 'request'];
  const values = listingFormValues(req.body);
  const validation = validateListingValues(values, config, allowedTypes, image, res.locals.t);

  if (validation.errors.length > 0) {
    await removeUploadedFile(image);
    return res.render('listings/form', await listingFormViewData(req, {
      title: 'Create listing',
      listing: null,
      values,
      ...validation
    }));
  }

  try {
    const result = await createListing(req.token, listingPayloadFrom(values));
    const listingId = positiveInteger(listingFrom(result).id);
    if (listingId === null) {
      if (req.flash) {
        req.flash('error', 'The listing was saved, but Laravel did not return its ID.');
      }
      return redirectTo(res, '/listings');
    }

    const secondaryFailures = [];
    try {
      await setListingSkillTags(req.token, listingId, skillTagsFrom(values.skill_tags));
    } catch (error) {
      secondaryFailures.push(error.message || 'skill tags could not be saved');
    }
    if (image) {
      try {
        await uploadListingCoverImage(req.token, listingId, image);
      } catch (error) {
        secondaryFailures.push(error.message || 'the image could not be uploaded');
      }
    }

    if (req.flash && secondaryFailures.length > 0) {
      req.flash('error', `The listing was created, but ${secondaryFailures.join('; ')}.`);
    }
    return redirectTo(res, `/listings/${listingId}?status=listing-created`);
  } catch (error) {
    if (isOnboardingRequired(error)) return redirectTo(res, '/onboarding');
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      const state = listingFormErrorState(error, 'Unable to create listing');
      return res.render('listings/form', await listingFormViewData(req, {
        title: 'Create listing',
        listing: null,
        values,
        ...state
      }));
    }
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res, error);
    throw error;
  } finally {
    await removeUploadedFile(image);
  }
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Listing not found' }));

// View listing detail
router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const [listingResult, currentUserResult] = await Promise.all([
    getListing(token, req.params.id),
    token ? getRequestProfile(req, token).catch(() => null) : Promise.resolve(null)
  ]);
  const listing = listingFrom(listingResult);
  const currentUser = profileFrom(currentUserResult);
  const ownerId = listingOwnerId(listing);
  const currentUserId = positiveInteger(currentUser.id);
  const can_edit = ownerId !== null && currentUserId !== null && ownerId === currentUserId;
  const status = trimmed(req.query.status);
  if (req.flash) req.flash('success');
  const flashedError = req.flash ? req.flash('error')[0] : null;
  const tenant = req.accessibleRouting?.tenant || {};
  const verificationBadges = ownerId === null
    ? []
    : listingVerificationBadgesFrom(
      await Promise.resolve(getMemberVerificationBadges(token, ownerId)).catch(() => ({ data: [] })),
      res.locals.t
    );
  let exchangeContext = {
    exchangeWorkflowEnabled: false,
    directMessagingEnabled: false,
    exchangeContextReady: false,
    activeExchange: null
  };

  if (token && !can_edit) {
    try {
      exchangeContext = await listingExchangeContext(token, req.params.id);
    } catch (error) {
      if (isAuthError(error)) throw error;
      // Do not offer a second exchange request while the authoritative config or
      // active-exchange check is unavailable. This deliberately fails closed.
    }
  }

  res.render('listings/detail', {
    title: listing.title || listing.name || 'Listing details',
    listing: { ...listing, can_edit },
    listingImageUrl: resolveBackendAssetUrl(listing.image_url || listing.imageUrl),
    listingGallery: listingGalleryFrom(listing),
    listingSkillTags: listingSkillTagsFrom(listing),
    listingAuthor: listingAuthorFrom(listing),
    listingAuthorVerified: verificationBadges.some(badge => badge.type === 'id_verified'),
    listingVerificationBadges: verificationBadges,
    memberOffers: relatedListingsFrom(listing.member_offers || listing.memberOffers),
    memberRequests: relatedListingsFrom(listing.member_requests || listing.memberRequests),
    isSaved: listing.is_favorited === true || listing.isFavorited === true,
    hasLiked: listing.is_liked === true || listing.isLiked === true,
    likeCount: Math.max(0, Number(listing.likes_count ?? listing.likesCount) || 0),
    commentsCount: Math.max(0, Number(listing.comments_count ?? listing.commentsCount) || 0),
    isAuthenticated: Boolean(token),
    currentUserId,
    ownerId,
    connectionsEnabled: flagEnabled(tenant, 'connections', 'features', true),
    listingShareUrl: urlFor(res, `/listings/${listing.id}`),
    ...exchangeContext,
    status,
    supplementalErrorMessage: ['listing-created', 'listing-updated'].includes(status) ? flashedError : null,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Listing not found' }));

// Edit listing form
router.get('/:id(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const [listingResult, currentUserResult] = await Promise.all([
    getListing(req.token, req.params.id),
    getRequestProfile(req, req.token)
  ]);
  const listing = listingFrom(listingResult);
  const currentUser = profileFrom(currentUserResult);

  // Only the owner may access the edit form
  const ownerId = listingOwnerId(listing);
  const currentUserId = positiveInteger(currentUser.id);
  if (ownerId === null || currentUserId === null || ownerId !== currentUserId) {
    return renderForbidden(res);
  }

  const replay = consumeListingFormReplay(req, req.params.id);
  res.render('listings/form', await listingFormViewData(req, {
    title: 'Edit listing',
    listing,
    values: replay || listingFormValues({}, listing),
    errors: null,
    fieldErrors: {}
  }));
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Listing not found' }));

// Update listing
router.post('/:id(\\d+)/edit', requireAuth, audit.listingUpdate(), asyncRoute(async (req, res) => {
  const { id } = req.params;
  const image = uploadedFile(req, 'image');
  const config = listingConfigFrom(req);
  const allowedTypes = ['offer', 'request'];
  const values = listingFormValues(req.body);
  const validation = validateListingValues(values, config, allowedTypes, image, res.locals.t);

  if (validation.errors.length > 0) {
    await removeUploadedFile(image);
    return res.render('listings/form', await listingFormViewData(req, {
      title: 'Edit listing',
      listing: { id },
      values,
      ...validation
    }));
  }

  try {
    await updateListing(req.token, id, listingPayloadFrom(values));
    const secondaryFailures = [];
    try {
      await setListingSkillTags(req.token, id, skillTagsFrom(values.skill_tags));
    } catch (error) {
      secondaryFailures.push(error.message || 'skill tags could not be saved');
    }
    if (image) {
      try {
        await uploadListingCoverImage(req.token, positiveInteger(id), image);
      } catch (error) {
        secondaryFailures.push(error.message || 'the image could not be uploaded');
      }
    }

    if (req.flash && secondaryFailures.length > 0) {
      req.flash('error', `The listing was updated, but ${secondaryFailures.join('; ')}.`);
    }
    return redirectTo(res, `/listings/${id}?status=listing-updated`);
  } catch (error) {
    if (isOnboardingRequired(error)) return redirectTo(res, '/onboarding');
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      const state = listingFormErrorState(error, 'Unable to update listing');
      return res.render('listings/form', await listingFormViewData(req, {
        title: 'Edit listing',
        listing: { id },
        values,
        ...state
      }));
    }
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res, error);
    throw error;
  } finally {
    await removeUploadedFile(image);
  }
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Listing not found' }));

// Delete listing
router.post('/:id(\\d+)/delete', requireAuth, audit.listingDelete(), asyncRoute(async (req, res) => {
  const { id } = req.params;
  try {
    await deleteListing(req.token, id);
    return redirectTo(res, '/listings?status=listing-deleted');
  } catch (error) {
    if (isOnboardingRequired(error)) return redirectTo(res, '/onboarding');
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res, error);
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      return redirectTo(res, `/listings/${id}?status=listing-delete-failed`);
    }
    throw error;
  }
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Listing not found' }));

module.exports = router;
