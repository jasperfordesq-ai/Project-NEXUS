// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace & Freecycle — three things a member could do in React and not here
 * (26 Oct 2026, React-parity drift pass):
 *
 * 1. Listing photos (`/marketplace/:id/photos`). A seller could not add, replace or remove
 *    a photo: `uploadMarketplaceListingImages` existed and no route called it. Photos can
 *    also be chosen on the create form (routes/marketplace-actions.js).
 * 2. Shipping options (`/marketplace/shipping`, React `marketplace/seller/shipping-options`).
 *    Without one, a buyer of a posted item meets "This seller has no active shipping
 *    options. You cannot place this order yet." — so a seller here could not sell anything
 *    they post.
 * 3. A member's own reports (`/marketplace/reports`, React `marketplace/reports[/:id]`).
 *    Reporting worked, but the report then vanished: the reporter could not follow it and
 *    a seller could not see or appeal a decision against their listing.
 *
 * Every GET works without JavaScript; every change is a POST with `_csrf`, and the two
 * permanent removals have a confirmation page first. Laravel is the contract throughout —
 * nothing here invents a field the API does not take.
 */

const express = require('express');
const { ApiError, callMarketplaceApi } = require('../lib/api');
const { resolveBackendMediaUrl } = require('../lib/accessible-shell');
const { asyncRoute } = require('../lib/routeHelpers');
const { translateForRequest } = require('../lib/request-translator');
const {
  MAX_PHOTOS_PER_UPLOAD,
  filesFrom,
  photoProblem,
  removeFiles,
  uploadListingPhotos
} = require('../lib/marketplace-photos');
const { helpers } = require('./marketplace');

const router = express.Router();

const REPORT_REASONS = ['counterfeit', 'illegal', 'unsafe', 'misleading', 'discrimination', 'ip_violation', 'other'];
const REPORT_STATUSES = ['received', 'acknowledged', 'under_review', 'action_taken', 'no_action', 'appealed', 'appeal_resolved'];
const REPORT_ACTIONS = ['none', 'warning', 'listing_removed', 'seller_suspended'];
const REPORT_STATUS_TAGS = {
  received: 'govuk-tag--yellow',
  acknowledged: 'govuk-tag--blue',
  under_review: 'govuk-tag--blue',
  action_taken: 'govuk-tag--red',
  no_action: 'govuk-tag--green',
  appealed: 'govuk-tag--yellow',
  appeal_resolved: 'govuk-tag--green'
};
// Laravel's own rule: `appeal_text` required|string|min:20|max:5000.
const APPEAL_MIN = 20;
const APPEAL_MAX = 5000;

// ?status= values each page understands. Anything else is ignored, so a crafted link
// cannot put arbitrary text on the page.
const PHOTO_STATUS = {
  uploaded: { type: 'success', key: 'govuk_alpha_commerce.photos.status_uploaded' },
  removed: { type: 'success', key: 'govuk_alpha_commerce.photos.status_removed' },
  'main-changed': { type: 'success', key: 'govuk_alpha_commerce.photos.status_main' },
  'remove-failed': { type: 'error', key: 'govuk_alpha_commerce.photos.status_remove_failed' },
  'main-failed': { type: 'error', key: 'govuk_alpha_commerce.photos.status_main_failed' },
  'created-photos-failed': { type: 'error', key: 'govuk_alpha_commerce.photos.status_created_photos_failed' }
};
const SHIPPING_STATUS = {
  added: { type: 'success', key: 'govuk_alpha_commerce.shipping.status_added' },
  saved: { type: 'success', key: 'govuk_alpha_commerce.shipping.status_saved' },
  deleted: { type: 'success', key: 'govuk_alpha_commerce.shipping.status_deleted' },
  'delete-failed': { type: 'error', key: 'govuk_alpha_commerce.shipping.status_delete_failed' },
  disabled: { type: 'error', key: 'govuk_alpha_commerce.shipping.disabled' }
};
const REPORT_STATUS_MESSAGES = {
  appealed: { type: 'success', key: 'govuk_alpha_commerce.my_reports.status_appealed_done' }
};

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function trimmed(value, limit = null) {
  const text = String(value ?? '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function rowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function requireToken(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, '/login?status=auth-required');
    return null;
  }
  return token;
}

function translator(res) {
  return typeof res.locals.t === 'function' ? res.locals.t : translateForRequest;
}

function statusFrom(res, map, value) {
  const entry = map[trimmed(value)];
  return entry ? { type: entry.type, message: translator(res)(entry.key) } : null;
}

function apiMessage(error) {
  if (!(error instanceof ApiError) || error.status !== 422) return '';
  const message = trimmed(error.message, 2000);
  return message && message !== 'API request failed' ? message : '';
}

function apiErrorCode(error) {
  const first = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  return trimmed(first?.code ?? error?.data?.code ?? error?.data?.error).toUpperCase();
}

/** 401 → sign in; 403 → forbidden page; 404 → not found page; anything else is rethrown. */
function renderToolError(error, res) {
  if (error instanceof ApiError && error.status === 401) {
    redirectTo(res, '/login?status=auth-required');
    return;
  }
  if (error instanceof ApiError && error.status === 403) {
    res.status(403).render('errors/403', { title: translator(res)('govuk_alpha.error_pages.403_title') });
    return;
  }
  if (error instanceof ApiError && error.status === 404) {
    res.status(404).render('errors/404', { title: translator(res)('govuk_alpha.error_pages.404_title') });
    return;
  }
  throw error;
}

function sessionTake(req, key) {
  const value = req.session ? req.session[key] : undefined;
  if (req.session && value !== undefined) delete req.session[key];
  return value && typeof value === 'object' ? value : null;
}

function sessionPut(req, key, value) {
  if (req.session) req.session[key] = value;
}

function tenantKey(req) {
  return trimmed(req.accessibleRouting?.tenant?.slug || req.accessibleRouting?.tenantSlug || 'default');
}

// ---------------------------------------------------------------------------
// 1. Listing photos
// ---------------------------------------------------------------------------

async function loadOwnListing(token, id) {
  const result = await callMarketplaceApi(token, 'GET', `/listings/${encodeURIComponent(id)}`);
  const raw = dataFrom(result);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('Listing not found', 404);
  const item = helpers.decorateListing(raw);
  // Only the seller manages photos. Laravel refuses anyone else too (ensureOwner); this
  // keeps a stranger from seeing an upload form that can only fail.
  if (!item.isOwnItem) throw new ApiError('Not your listing', 403);
  const photos = (Array.isArray(raw.images) ? raw.images : [])
    .map((image, index) => ({
      id: positiveInteger(image && image.id),
      url: resolveBackendMediaUrl(image && (image.thumbnail_url || image.url)),
      fullUrl: resolveBackendMediaUrl(image && (image.url || image.thumbnail_url)),
      isPrimary: Boolean(image && (image.is_primary === true || image.is_primary === 1 || image.is_primary === '1')),
      number: index + 1
    }))
    .filter((photo) => photo.id && photo.url);
  // The main photo is the one shown on cards; Laravel orders it first only by
  // sort_order, so say which it is rather than assume position.
  if (photos.length > 0 && !photos.some((photo) => photo.isPrimary)) photos[0].isPrimary = true;
  return { item, photos };
}

function photoErrorSessionKey(req, id) {
  return `marketplacePhotoError:${tenantKey(req)}:${id}`;
}

router.get('/:id(\\d+)/photos', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  try {
    const { item, photos } = await loadOwnListing(token, id);
    const t = translator(res);
    const stashed = sessionTake(req, photoErrorSessionKey(req, id));
    const fieldError = stashed ? (stashed.text || t(stashed.key)) : '';
    return res.render('marketplace/photos', {
      title: t('govuk_alpha_commerce.photos.title'),
      activeNav: 'explore',
      activeTab: 'mine',
      item,
      photos,
      maxPerUpload: MAX_PHOTOS_PER_UPLOAD,
      fieldError,
      status: fieldError ? null : statusFrom(res, PHOTO_STATUS, req.query.status)
    });
  } catch (error) {
    return renderToolError(error, res);
  }
}));

router.post('/:id(\\d+)/photos', asyncRoute(async (req, res) => {
  const files = filesFrom(req);
  const token = tokenFrom(req);
  if (!token) {
    await removeFiles(files);
    return redirectTo(res, '/login?status=auth-required');
  }
  const id = Number(req.params.id);
  const problem = photoProblem(files);
  if (problem) {
    await removeFiles(files);
    sessionPut(req, photoErrorSessionKey(req, id), { key: problem });
    return redirectTo(res, `/marketplace/${id}/photos`);
  }
  try {
    await uploadListingPhotos(token, id, files);
    return redirectTo(res, `/marketplace/${id}/photos?status=uploaded`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    if (error instanceof ApiError && [403, 404].includes(error.status)) return renderToolError(error, res);
    // A 422 carries Laravel's own translated reason ("This listing already has the
    // maximum of 20 images", "No valid images"); show it at the field.
    const text = apiMessage(error);
    sessionPut(req, photoErrorSessionKey(req, id), text ? { text } : { key: 'govuk_alpha_commerce.photos.error_failed' });
    return redirectTo(res, `/marketplace/${id}/photos`);
  }
}));

router.get('/:id(\\d+)/photos/:imageId(\\d+)/remove', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  const t = translator(res);
  try {
    const { photos } = await loadOwnListing(token, id);
    if (!photos.some((photo) => photo.id === Number(req.params.imageId))) throw new ApiError('Photo not found', 404);
  } catch (error) {
    return renderToolError(error, res);
  }
  return res.render('confirm-delete', {
    title: t('govuk_alpha_commerce.photos.remove_heading'),
    activeNav: 'explore',
    confirmHeading: t('govuk_alpha_commerce.photos.remove_heading'),
    confirmWarning: t('govuk_alpha_commerce.photos.remove_warning'),
    confirmButton: t('govuk_alpha_commerce.photos.remove'),
    confirmAction: `/marketplace/${id}/photos/${Number(req.params.imageId)}/remove`,
    cancelHref: `/marketplace/${id}/photos`
  });
}));

router.post('/:id(\\d+)/photos/:imageId(\\d+)/remove', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  try {
    await callMarketplaceApi(token, 'DELETE', `/listings/${encodeURIComponent(id)}/images/${encodeURIComponent(req.params.imageId)}`);
    return redirectTo(res, `/marketplace/${id}/photos?status=removed`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    return redirectTo(res, `/marketplace/${id}/photos?status=remove-failed`);
  }
}));

// "Make this the main photo": Laravel's reorder makes the FIRST id the primary image,
// so the chosen photo goes first and the rest keep their order.
router.post('/:id(\\d+)/photos/:imageId(\\d+)/main', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  const imageId = Number(req.params.imageId);
  try {
    const { photos } = await loadOwnListing(token, id);
    if (!photos.some((photo) => photo.id === imageId)) throw new ApiError('Photo not found', 404);
    const order = [imageId, ...photos.map((photo) => photo.id).filter((value) => value !== imageId)];
    await callMarketplaceApi(token, 'PUT', `/listings/${encodeURIComponent(id)}/images/reorder`, { image_ids: order });
    return redirectTo(res, `/marketplace/${id}/photos?status=main-changed`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    return redirectTo(res, `/marketplace/${id}/photos?status=main-failed`);
  }
}));

// ---------------------------------------------------------------------------
// 2. Shipping options
// ---------------------------------------------------------------------------

function decorateShippingOption(option, res) {
  const row = option && typeof option === 'object' ? option : {};
  const days = positiveInteger(row.estimated_days);
  const tc = typeof res.locals.tc === 'function' ? res.locals.tc : null;
  return {
    id: positiveInteger(row.id),
    courierName: trimmed(row.courier_name),
    price: row.price ?? '',
    currency: trimmed(row.currency, 3).toUpperCase(),
    priceLabel: Number(row.price) > 0
      ? helpers.formatMoney(row.price, row.currency)
      : translator(res)('govuk_alpha_commerce.shipping.free_postage'),
    estimatedDays: days || '',
    daysLabel: days
      ? (tc ? tc('govuk_alpha_commerce.shipping.days_value', days, { count: days }) : String(days))
      : '',
    isDefault: Boolean(row.is_default === true || row.is_default === 1 || row.is_default === '1')
  };
}

const SHIPPING_ERROR_FIELDS = {
  'govuk_alpha_commerce.shipping.error_courier': 'courier_name',
  'govuk_alpha_commerce.shipping.error_price': 'price',
  'govuk_alpha_commerce.shipping.error_currency': 'currency',
  'govuk_alpha_commerce.shipping.error_days': 'estimated_days'
};

function shippingFormValues(body) {
  return {
    courierName: String(body.courier_name || '').slice(0, 100),
    price: String(body.price ?? '').slice(0, 20),
    currency: trimmed(body.currency, 3).toUpperCase(),
    estimatedDays: String(body.estimated_days ?? '').slice(0, 5),
    isDefault: ['1', 'true', 'on', 'yes'].includes(String(body.is_default || '').toLowerCase())
  };
}

function shippingValidation(values) {
  const errors = [];
  if (trimmed(values.courierName) === '') errors.push('govuk_alpha_commerce.shipping.error_courier');
  const price = Number(trimmed(values.price));
  if (trimmed(values.price) === '' || !Number.isFinite(price) || price < 0) errors.push('govuk_alpha_commerce.shipping.error_price');
  if (values.currency && !/^[A-Z]{3}$/.test(values.currency)) errors.push('govuk_alpha_commerce.shipping.error_currency');
  const days = trimmed(values.estimatedDays);
  if (days !== '' && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365)) {
    errors.push('govuk_alpha_commerce.shipping.error_days');
  }
  return errors;
}

function shippingPayload(values) {
  const payload = {
    courier_name: trimmed(values.courierName, 100),
    price: Number(trimmed(values.price)),
    // An empty field must clear the estimate, not keep the old one.
    estimated_days: trimmed(values.estimatedDays) === '' ? null : Number(trimmed(values.estimatedDays)),
    is_default: values.isDefault
  };
  if (values.currency) payload.currency = values.currency;
  return payload;
}

function shippingFormKey(req, key) {
  return `marketplaceShippingForm:${tenantKey(req)}:${key}`;
}

function shippingFormErrors(res, state) {
  const t = translator(res);
  const fieldErrors = {};
  const errorList = [];
  let formMessage = '';
  (Array.isArray(state?.errors) ? state.errors : []).forEach((error) => {
    const message = error.text || t(error.key);
    const field = error.key ? SHIPPING_ERROR_FIELDS[error.key] : undefined;
    if (!field) {
      if (!formMessage) formMessage = message;
      return;
    }
    if (fieldErrors[field] === undefined) {
      fieldErrors[field] = message;
      errorList.push({ text: message, href: `#${field}` });
    }
  });
  return { fieldErrors, errorList, formMessage };
}

function blankShippingValues(req) {
  return {
    courierName: '',
    price: '',
    currency: helpers.tenantCurrency(req),
    estimatedDays: '',
    isDefault: false
  };
}

async function loadShippingOptions(token, res) {
  const result = await callMarketplaceApi(token, 'GET', '/seller/shipping-options');
  return rowsFrom(result).map((option) => decorateShippingOption(option, res)).filter((option) => option.id);
}

router.get('/seller/shipping-options', (req, res) => redirectTo(res, '/marketplace/shipping'));

router.get('/shipping', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  try {
    const options = await loadShippingOptions(token, res);
    const state = sessionTake(req, shippingFormKey(req, 'create'));
    return res.render('marketplace/shipping', {
      title: translator(res)('govuk_alpha_commerce.shipping.title'),
      activeNav: 'explore',
      activeTab: 'shipping',
      options,
      values: { ...blankShippingValues(req), ...(state?.values || {}) },
      ...shippingFormErrors(res, state),
      status: state ? null : statusFrom(res, SHIPPING_STATUS, req.query.status)
    });
  } catch (error) {
    return renderToolError(error, res);
  }
}));

// `send` carries the literal method and path so the API consumer ledger can
// classify each call (a variable method reads as an unresolved contract).
async function saveShippingOption(req, res, { send, formKey, back, success }) {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const values = shippingFormValues(req.body);
  const errorKeys = shippingValidation(values);
  if (errorKeys.length > 0) {
    sessionPut(req, shippingFormKey(req, formKey), { values, errors: errorKeys.map((key) => ({ key })) });
    return redirectTo(res, back);
  }
  try {
    await send(token, shippingPayload(values));
    return redirectTo(res, `/marketplace/shipping?status=${success}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    // The community does not allow posting at all (MarketplaceConfigurationService::allowShipping).
    if (error instanceof ApiError && error.status === 403 && apiErrorCode(error) === 'FEATURE_DISABLED') {
      return redirectTo(res, '/marketplace/shipping?status=disabled');
    }
    if (error instanceof ApiError && error.status === 404) return renderToolError(error, res);
    const text = apiMessage(error);
    sessionPut(req, shippingFormKey(req, formKey), {
      values,
      errors: [text ? { text } : { key: 'govuk_alpha_commerce.shipping.status_failed' }]
    });
    return redirectTo(res, back);
  }
}

router.post('/shipping', asyncRoute(async (req, res) => saveShippingOption(req, res, {
  send: (token, payload) => callMarketplaceApi(token, 'POST', '/seller/shipping-options', payload),
  formKey: 'create',
  back: '/marketplace/shipping',
  success: 'added'
})));

async function loadShippingOption(token, res, id) {
  const option = (await loadShippingOptions(token, res)).find((row) => row.id === Number(id));
  if (!option) throw new ApiError('Shipping option not found', 404);
  return option;
}

router.get('/shipping/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  try {
    const option = await loadShippingOption(token, res, id);
    const state = sessionTake(req, shippingFormKey(req, `edit:${id}`));
    return res.render('marketplace/shipping-form', {
      title: translator(res)('govuk_alpha_commerce.shipping.edit_title'),
      activeNav: 'explore',
      activeTab: 'shipping',
      option,
      values: {
        courierName: option.courierName,
        price: String(option.price),
        currency: option.currency,
        estimatedDays: option.estimatedDays === '' ? '' : String(option.estimatedDays),
        isDefault: option.isDefault,
        ...(state?.values || {})
      },
      ...shippingFormErrors(res, state)
    });
  } catch (error) {
    return renderToolError(error, res);
  }
}));

router.post('/shipping/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return saveShippingOption(req, res, {
    formKey: `edit:${id}`,
    back: `/marketplace/shipping/${id}/edit`,
    success: 'saved',
    send: (token, payload) => callMarketplaceApi(token, 'PUT', `/seller/shipping-options/${encodeURIComponent(id)}`, payload)
  });
}));

router.get('/shipping/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  const t = translator(res);
  try {
    await loadShippingOption(token, res, id);
  } catch (error) {
    return renderToolError(error, res);
  }
  return res.render('confirm-delete', {
    title: t('govuk_alpha_commerce.shipping.delete_heading'),
    activeNav: 'explore',
    confirmHeading: t('govuk_alpha_commerce.shipping.delete_heading'),
    confirmWarning: t('govuk_alpha_commerce.shipping.delete_warning'),
    confirmButton: t('govuk_alpha_commerce.shipping.delete'),
    confirmAction: `/marketplace/shipping/${id}/delete`,
    cancelHref: '/marketplace/shipping'
  });
}));

router.post('/shipping/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  try {
    await callMarketplaceApi(token, 'DELETE', `/seller/shipping-options/${encodeURIComponent(req.params.id)}`);
    return redirectTo(res, '/marketplace/shipping?status=deleted');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    return redirectTo(res, '/marketplace/shipping?status=delete-failed');
  }
}));

// ---------------------------------------------------------------------------
// 3. A member's own reports, and the appeal
// ---------------------------------------------------------------------------

function decorateReport(report, res) {
  const t = translator(res);
  const row = report && typeof report === 'object' ? report : {};
  const status = REPORT_STATUSES.includes(trimmed(row.status)) ? trimmed(row.status) : '';
  const reason = REPORT_REASONS.includes(trimmed(row.reason)) ? trimmed(row.reason) : '';
  const action = REPORT_ACTIONS.includes(trimmed(row.action_taken)) ? trimmed(row.action_taken) : '';
  const listing = row.listing && typeof row.listing === 'object' ? row.listing : null;
  const listingId = positiveInteger(listing && listing.id) || positiveInteger(row.marketplace_listing_id);
  const isReporter = trimmed(row.viewer_role) !== 'seller';
  return {
    id: positiveInteger(row.id),
    reference: t('govuk_alpha_commerce.my_reports.reference', { id: positiveInteger(row.id) || 0 }),
    status,
    statusLabel: status ? t(`govuk_alpha_commerce.my_reports.status_${status}`) : trimmed(row.status),
    statusTagClass: REPORT_STATUS_TAGS[status] || 'govuk-tag--grey',
    reasonLabel: reason ? t(`govuk_alpha_commerce.report.reason_${reason}`) : trimmed(row.reason),
    actionLabel: action ? t(`govuk_alpha_commerce.my_reports.action_${action}`) : '',
    resolutionReason: trimmed(row.resolution_reason),
    description: trimmed(row.description),
    appealText: trimmed(row.appeal_text),
    isReporter,
    roleLabel: t(`govuk_alpha_commerce.my_reports.role_${isReporter ? 'reporter' : 'seller'}`),
    listingTitle: trimmed(listing && listing.title),
    // A removed listing has no page to go to; Laravel keeps the report.
    listingHref: listingId && listing && trimmed(listing.status) !== 'removed' ? `/marketplace/${listingId}` : '',
    canAppeal: row.can_appeal === true || row.can_appeal === 1,
    href: positiveInteger(row.id) ? `/marketplace/reports/${positiveInteger(row.id)}` : ''
  };
}

router.get('/reports', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  try {
    const result = await callMarketplaceApi(token, 'GET', '/reports');
    return res.render('marketplace/reports', {
      title: translator(res)('govuk_alpha_commerce.my_reports.title'),
      activeNav: 'explore',
      activeTab: 'reports',
      reports: rowsFrom(result).map((report) => decorateReport(report, res)).filter((report) => report.id)
    });
  } catch (error) {
    return renderToolError(error, res);
  }
}));

function appealFormKey(req, id) {
  return `marketplaceReportAppeal:${tenantKey(req)}:${id}`;
}

router.get('/reports/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  try {
    const result = await callMarketplaceApi(token, 'GET', `/reports/${encodeURIComponent(id)}`);
    const report = decorateReport(dataFrom(result), res);
    if (!report.id) throw new ApiError('Report not found', 404);
    const state = sessionTake(req, appealFormKey(req, id));
    const t = translator(res);
    return res.render('marketplace/report-detail', {
      title: report.reference,
      activeNav: 'explore',
      activeTab: 'reports',
      report,
      appealText: state ? String(state.text || '') : '',
      appealError: state ? (state.errorText || (state.errorKey ? t(state.errorKey) : '')) : '',
      status: state ? null : statusFrom(res, REPORT_STATUS_MESSAGES, req.query.status)
    });
  } catch (error) {
    return renderToolError(error, res);
  }
}));

router.post('/reports/:id(\\d+)/appeal', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  const text = String(req.body.appeal_text || '').slice(0, APPEAL_MAX + 100);
  const length = trimmed(text).length;
  let errorKey = '';
  if (length < APPEAL_MIN) errorKey = 'govuk_alpha_commerce.my_reports.error_appeal_short';
  else if (length > APPEAL_MAX) errorKey = 'govuk_alpha_commerce.my_reports.error_appeal_long';
  if (errorKey) {
    sessionPut(req, appealFormKey(req, id), { text, errorKey });
    return redirectTo(res, `/marketplace/reports/${id}#appeal_text`);
  }
  try {
    await callMarketplaceApi(token, 'POST', `/reports/${encodeURIComponent(id)}/appeal`, { appeal_text: trimmed(text) });
    return redirectTo(res, `/marketplace/reports/${id}?status=appealed`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    if (error instanceof ApiError && [403, 404].includes(error.status)) return renderToolError(error, res);
    // 422: the report is no longer open to appeal (already appealed, or decided again).
    const message = apiMessage(error);
    sessionPut(req, appealFormKey(req, id), message
      ? { text, errorText: message }
      : { text, errorKey: 'govuk_alpha_commerce.my_reports.status_appeal_failed' });
    return redirectTo(res, `/marketplace/reports/${id}#appeal_text`);
  }
}));

module.exports = router;
