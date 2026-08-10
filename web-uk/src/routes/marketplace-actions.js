// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { ApiError, callMarketplaceApi, callMerchantOnboardingApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

const PRICE_TYPES = ['fixed', 'negotiable', 'free', 'contact'];
const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor'];
const DELIVERY_METHODS = ['pickup', 'shipping', 'both', 'community_delivery'];
const REPORT_REASONS = ['counterfeit', 'illegal', 'unsafe', 'misleading', 'discrimination', 'ip_violation', 'other'];
const SELLER_TYPES = ['private', 'business'];
const COUPON_DISCOUNT_TYPES = ['percent', 'fixed', 'bogo'];
const COUPON_STATUSES = ['draft', 'active', 'paused', 'expired'];

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

function listingFormValues(body, defaultCurrency) {
  return {
    title: String(body.title || '').slice(0, 200),
    tagline: String(body.tagline || '').slice(0, 300),
    description: String(body.description || '').slice(0, 10000),
    priceType: allowed(body.price_type, PRICE_TYPES, 'fixed'),
    price: String(body.price || ''),
    priceCurrency: trimmed(body.price_currency || defaultCurrency, 3).toUpperCase() || defaultCurrency,
    timeCreditPrice: String(body.time_credit_price || ''),
    condition: allowed(body.condition, CONDITIONS, ''),
    categoryId: positiveInteger(body.category_id),
    deliveryMethod: allowed(body.delivery_method, DELIVERY_METHODS, 'pickup'),
    location: String(body.location || '').slice(0, 255),
    quantity: positiveInteger(body.quantity) || 1
  };
}

function listingValidationErrorKeys(payload) {
  const errorKeys = [];
  if (payload.title === '') errorKeys.push('govuk_alpha_commerce.listing_form.error_title');
  if (payload.description === '') errorKeys.push('govuk_alpha_commerce.listing_form.error_description');
  if (payload.price_type === 'fixed' && !(Number(payload.price) > 0) && !(Number(payload.time_credit_price) > 0)) {
    errorKeys.push('govuk_alpha_commerce.listing_form.error_price');
  }
  return errorKeys;
}

function rememberListingForm(req, key, values, errorKeys) {
  if (!req.session) return;
  req.session.marketplaceListingForms ||= {};
  req.session.marketplaceListingForms[key] = { values, errorKeys };
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

function allowed(value, choices, fallback) {
  const text = trimmed(value);
  return choices.includes(text) ? text : fallback;
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function localUrl(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function'
    ? res.locals.urlFor
    : (value) => value;
  return urlFor(pathname);
}

function redirectTo(res, pathname) {
  return res.redirect(localUrl(res, pathname));
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

function apiErrorCode(error) {
  const firstError = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  return trimmed(firstError?.code ?? error?.data?.code ?? error?.data?.error).toUpperCase();
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function resultId(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' ? positiveInteger(data.id) : null;
}

async function callApi(token, method, path, data = undefined) {
  if (data === undefined) {
    return callMarketplaceApi(token, method, path);
  }

  return callMarketplaceApi(token, method, path, data);
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

function listingRedirect(id, status) {
  return `/marketplace/${id}?status=${encodeURIComponent(status)}`;
}

function mineRedirect(status) {
  return `/marketplace/mine?status=${encodeURIComponent(status)}`;
}

function offersRedirect(tab, status) {
  return `/marketplace/offers?tab=${encodeURIComponent(tab)}&status=${encodeURIComponent(status)}`;
}

function offerFormSessionKey(id) {
  return `marketplaceOfferForm:${id}`;
}

function acceptedOfferSessionKey(id) {
  return `marketplaceAcceptedOffer:${id}`;
}

function acceptedOfferCompletedSessionKey(id) {
  return `marketplaceAcceptedOfferCompleted:${id}`;
}

function acceptedOfferErrorSessionKey(id) {
  return `marketplaceAcceptedOfferError:${id}`;
}

function directBuySessionKey(id) {
  return `marketplaceDirectBuy:${id}`;
}

function directBuyCompletedSessionKey(id) {
  return `marketplaceDirectBuyCompleted:${id}`;
}

function directBuyErrorSessionKey(id) {
  return `marketplaceDirectBuyError:${id}`;
}

function matchingKey(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function ordersRedirect(req, status) {
  const target = trimmed(req.body.redirect_to) === 'sales' || trimmed(req.body.role) === 'seller'
    ? '/marketplace/sales'
    : '/marketplace/orders';
  return `${target}?status=${encodeURIComponent(status)}`;
}

function listingPayload(body, defaultCurrency = 'EUR', { includeStatus = true } = {}) {
  const title = trimmed(body.title, 200);
  const description = trimmed(body.description, 10000);
  const priceType = allowed(body.price_type, PRICE_TYPES, 'fixed');
  const payload = {
    title,
    description,
    price_type: priceType
  };
  if (includeStatus) payload.status = 'active';

  const tagline = trimmed(body.tagline, 300);
  if (tagline !== '') {
    payload.tagline = tagline;
  }

  if (priceType === 'free') {
    payload.price = null;
    payload.time_credit_price = null;
  } else {
    const price = decimalNumber(body.price);
    if (String(body.price || '').trim() !== '' && price >= 0) {
      payload.price = price;
      payload.price_currency = trimmed(body.price_currency || defaultCurrency, 3).toUpperCase() || defaultCurrency;
    }

    const timeCreditPrice = decimalNumber(body.time_credit_price);
    if (String(body.time_credit_price || '').trim() !== '' && timeCreditPrice >= 0) {
      payload.time_credit_price = timeCreditPrice;
    }
  }

  const condition = allowed(body.condition, CONDITIONS, '');
  if (condition !== '') {
    payload.condition = condition;
  }

  payload.delivery_method = allowed(body.delivery_method, DELIVERY_METHODS, 'pickup');

  const categoryId = positiveInteger(body.category_id);
  if (categoryId !== null) {
    payload.category_id = categoryId;
  }

  const location = trimmed(body.location, 255);
  if (location !== '') {
    payload.location = location;
  }

  const quantity = positiveInteger(body.quantity);
  if (quantity !== null) {
    payload.quantity = quantity;
  }

  return payload;
}

function pickupSlotPayload(body, { defaultActive = true } = {}) {
  const capacity = positiveInteger(body.capacity);
  return {
    slot_start: trimmed(body.slot_start),
    slot_end: trimmed(body.slot_end),
    capacity: capacity === null ? 1 : Math.min(capacity, 1000),
    is_recurring: checked(body.is_recurring),
    is_active: body.is_active === undefined ? defaultActive : checked(body.is_active)
  };
}

function couponPayload(body) {
  const discountType = allowed(body.discount_type, COUPON_DISCOUNT_TYPES, 'percent');
  const discountValue = decimalNumber(body.discount_value);
  const payload = {
    title: trimmed(body.title, 200),
    description: trimmed(body.description, 2000),
    discount_type: discountType,
    discount_value: discountType === 'bogo' ? 0 : Math.max(0, discountValue),
    status: allowed(body.status, COUPON_STATUSES, 'draft'),
    applies_to: 'all_listings'
  };

  const code = trimmed(body.code, 64);
  if (code !== '') {
    payload.code = code;
  }

  const minOrderRaw = trimmed(body.min_order_cents);
  if (minOrderRaw !== '' && Number.isFinite(Number(minOrderRaw))) {
    payload.min_order_cents = Math.max(0, Math.trunc(Number(minOrderRaw)));
  }

  const maxUsesRaw = trimmed(body.max_uses);
  const maxUses = Number.isFinite(Number(maxUsesRaw)) ? Math.trunc(Number(maxUsesRaw)) : 0;
  if (maxUsesRaw !== '' && maxUses > 0) {
    payload.max_uses = maxUses;
  }

  const validUntil = trimmed(body.valid_until);
  if (validUntil !== '') {
    payload.valid_until = validUntil;
  }

  return payload;
}

function couponFormSessionKey(req, key) {
  const tenantSlug = trimmed(
    req.accessibleRouting?.tenant?.slug
      || req.accessibleRouting?.tenantSlug
      || 'default'
  );
  return `marketplaceCouponForm:${tenantSlug}:${key}`;
}

function couponFormValues(body) {
  return {
    title: String(body.title || '').slice(0, 200),
    code: String(body.code || '').slice(0, 64),
    description: String(body.description || '').slice(0, 2000),
    discountType: trimmed(body.discount_type, 20),
    discountValue: String(body.discount_value || '').slice(0, 50),
    minOrderCents: String(body.min_order_cents || '').slice(0, 50),
    maxUses: String(body.max_uses || '').slice(0, 50),
    validUntil: String(body.valid_until || '').slice(0, 20),
    status: trimmed(body.status, 20)
  };
}

function couponValidationErrors(body) {
  const errors = [];
  if (trimmed(body.title) === '') {
    errors.push({ key: 'govuk_alpha_commerce.coupons.error_title' });
  }
  const discountType = allowed(body.discount_type, COUPON_DISCOUNT_TYPES, 'percent');
  const rawValue = trimmed(body.discount_value);
  if (discountType !== 'bogo' && (rawValue === '' || !Number.isFinite(Number(rawValue)) || Number(rawValue) <= 0)) {
    errors.push({ key: 'govuk_alpha_commerce.coupons.error_discount_value' });
  }
  return errors;
}

function rememberCouponForm(req, key, values, errors = []) {
  if (!req.session) return;
  req.session[couponFormSessionKey(req, key)] = { values, errors };
}

function apiCouponError(error, fallbackKey) {
  if (error instanceof ApiError && error.status === 422) {
    const message = trimmed(error.message, 2000);
    if (message && message !== 'API request failed') return { text: message };
  }
  return { key: fallbackKey };
}

function onboardingFormSessionKey(req) {
  const tenantSlug = trimmed(
    req.accessibleRouting?.tenant?.slug
      || req.accessibleRouting?.tenantSlug
      || 'default'
  );
  return `marketplaceOnboardingForm:${tenantSlug}`;
}

function onboardingFormState(body) {
  return {
    profile: {
      seller_type: trimmed(body.seller_type, 20),
      display_name: String(body.display_name || '').slice(0, 200),
      business_name: String(body.business_name || '').slice(0, 200),
      bio: String(body.bio || '').slice(0, 2000),
      business_registration: String(body.business_registration || '').slice(0, 120)
    },
    address: {
      street: String(body.address_street || '').slice(0, 200),
      city: String(body.address_city || '').slice(0, 120),
      postal_code: String(body.address_postal_code || '').slice(0, 40),
      country: String(body.address_country || '').slice(0, 120)
    }
  };
}

function onboardingPayloads(body) {
  const sellerType = allowed(body.seller_type, SELLER_TYPES, 'business');
  const identity = {
    business_name: trimmed(body.business_name, 200),
    display_name: trimmed(body.display_name, 200),
    bio: trimmed(body.bio, 2000),
    seller_type: sellerType,
    business_registration: trimmed(body.business_registration, 120)
  };
  for (const [key, value] of Object.entries(identity)) {
    if (value === '') delete identity[key];
  }

  const businessAddress = {
    street: trimmed(body.address_street, 200),
    city: trimmed(body.address_city, 120),
    postal_code: trimmed(body.address_postal_code, 40),
    country: trimmed(body.address_country, 120)
  };
  for (const [key, value] of Object.entries(businessAddress)) {
    if (value === '') delete businessAddress[key];
  }

  return { sellerType, identity, businessAddress };
}

function rememberOnboardingForm(req, state, errorKeys = []) {
  if (!req.session) return;
  req.session[onboardingFormSessionKey(req)] = { ...state, errorKeys };
}

function reportFormSessionKey(req, id) {
  const tenantSlug = trimmed(
    req.accessibleRouting?.tenant?.slug
      || req.accessibleRouting?.tenantSlug
      || 'default'
  );
  return `marketplaceReportForm:${tenantSlug}:${id}`;
}

function reportFormValues(body) {
  return {
    reason: allowed(body.reason, REPORT_REASONS, ''),
    description: String(body.description || '').slice(0, 5000)
  };
}

function rememberReportForm(req, id, values, errors) {
  if (!req.session) return;
  req.session[reportFormSessionKey(req, id)] = { values, errors };
}

function apiReportError(error) {
  if (error instanceof ApiError && error.status === 422) {
    const message = trimmed(error.message, 2000);
    if (message && message !== 'API request failed') {
      return { field: 'description', text: message };
    }
  }
  return null;
}

router.post('/create', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const defaultCurrency = tenantCurrency(req);
  const payload = listingPayload(req.body, defaultCurrency);
  const values = listingFormValues(req.body, defaultCurrency);
  const validationErrors = listingValidationErrorKeys(payload);
  if (validationErrors.length > 0) {
    rememberListingForm(req, 'create', values, validationErrors);
    return redirectTo(res, '/marketplace/create?status=listing-validation');
  }

  try {
    const result = await callApi(token, 'POST', '/listings', payload);
    const id = resultId(result);
    return redirectTo(res, listingRedirect(id || 'mine', 'listing-created'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    rememberListingForm(req, 'create', values, ['govuk_alpha_commerce.listing_form.error_create']);
    return redirectTo(res, '/marketplace/create?status=listing-create-failed');
  }
}));

router.post('/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const defaultCurrency = tenantCurrency(req);
  const payload = listingPayload(req.body, defaultCurrency, { includeStatus: false });
  const values = listingFormValues(req.body, defaultCurrency);
  const validationErrors = listingValidationErrorKeys(payload);
  if (validationErrors.length > 0) {
    rememberListingForm(req, `edit:${id}`, values, validationErrors);
    return redirectTo(res, `/marketplace/${id}/edit?status=listing-validation`);
  }

  try {
    await callApi(token, 'PUT', `/listings/${id}`, payload);
    return redirectTo(res, listingRedirect(id, 'listing-saved'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    rememberListingForm(req, `edit:${id}`, values, ['govuk_alpha_commerce.listing_form.error_update']);
    return redirectTo(res, `/marketplace/${id}/edit?status=listing-save-failed`);
  }
}));

router.post('/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/listings/${id}`,
    undefined,
    mineRedirect('deleted'),
    mineRedirect('delete-failed')
  );
}));

router.post('/:id(\\d+)/renew', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const durationDays = positiveInteger(req.body.duration_days);
  const payload = durationDays === null ? undefined : { duration_days: Math.min(durationDays, 90) };
  return runAction(
    req,
    res,
    'POST',
    `/listings/${id}/renew`,
    payload,
    mineRedirect('renewed'),
    mineRedirect('renew-failed')
  );
}));

router.post('/:id(\\d+)/save', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/listings/${id}/save`,
    undefined,
    listingRedirect(id, 'saved'),
    listingRedirect(id, 'save-failed')
  );
}));

router.post('/:id(\\d+)/unsave', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const success = trimmed(req.body.redirect_to) === 'saved'
    ? '/marketplace/saved?status=unsaved'
    : listingRedirect(id, 'unsaved');
  return runAction(
    req,
    res,
    'DELETE',
    `/listings/${id}/save`,
    undefined,
    success,
    listingRedirect(id, 'unsave-failed')
  );
}));

router.post('/:id(\\d+)/buy', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const fail = (messageKey, target) => {
    req.session[directBuyErrorSessionKey(id)] = {
      messageKey,
      target,
      oldInput: {
        quantity: trimmed(req.body.quantity, 20),
        delivery_notes: trimmed(req.body.delivery_notes, 500),
        delivery_choice: trimmed(req.body.delivery_choice, 100),
        pickup_slot_id: trimmed(req.body.pickup_slot_id, 20),
        payment_method: trimmed(req.body.payment_method, 30)
      }
    };
    return redirectTo(res, `/marketplace/${id}/buy`);
  };
  const idempotencyKey = trimmed(req.body.idempotency_key, 100);
  const expectedKey = trimmed(req.session && req.session[directBuySessionKey(id)], 100);
  if (idempotencyKey.length < 16 || !expectedKey || !matchingKey(idempotencyKey, expectedKey)) {
    return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
  }

  let listing;
  let shippingOptions = [];
  let pickupSlots = [];
  try {
    const listingResult = await callApi(token, 'GET', `/listings/${id}`);
    listing = dataFrom(listingResult) || {};
    const listingPriceType = trimmed(listing.price_type);
    const listingMoney = decimalNumber(listing.price);
    const listingCredits = decimalNumber(listing.time_credit_price);
    const purchasable = trimmed(listing.status) === 'active'
      && ((listingPriceType === 'fixed' && listingMoney > 0) || listingPriceType === 'free' || listingCredits > 0);
    if (checked(listing.is_own || listing.is_owner || listing.owned_by_current_user) || !purchasable) {
      return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
    }
    const sellerId = positiveInteger(listing.user && listing.user.id) || positiveInteger(listing.user_id);
    const deliveryMethod = trimmed(listing.delivery_method) || 'pickup';
    const [shippingResult, slotsResult] = await Promise.all([
      sellerId && ['shipping', 'both'].includes(deliveryMethod)
        ? callApi(token, 'GET', `/sellers/${sellerId}/shipping-options`).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      callApi(token, 'GET', `/listings/${id}/pickup-slots`).catch(() => ({ data: [] }))
    ]);
    shippingOptions = Array.isArray(dataFrom(shippingResult)) ? dataFrom(shippingResult) : [];
    const hasCashCheckout = listingPriceType === 'fixed' && listingMoney > 0;
    if (listingPriceType === 'free' || (listingCredits > 0 && !hasCashCheckout)) {
      shippingOptions = shippingOptions.filter((row) => decimalNumber(row && row.price) <= 0);
    }
    pickupSlots = Array.isArray(dataFrom(slotsResult)) ? dataFrom(slotsResult) : [];
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
  }

  const quantity = positiveInteger(req.body.quantity) || 1;
  const priceType = trimmed(listing.price_type);
  const money = decimalNumber(listing.price);
  const credits = decimalNumber(listing.time_credit_price);
  const isHybrid = priceType === 'fixed' && money > 0 && credits > 0;
  const paymentMethod = isHybrid
    ? trimmed(req.body.payment_method)
    : (credits > 0 ? 'time_credits' : (priceType === 'free' ? 'free' : 'cash'));
  if (isHybrid && !['cash', 'time_credits'].includes(paymentMethod)) {
    return fail('govuk_alpha_commerce.buy.payment_method_required', 'payment_method');
  }
  const payload = {
    listing_id: id,
    quantity,
    idempotency_key: idempotencyKey,
    payment_method: paymentMethod
  };

  const deliveryNotes = trimmed(req.body.delivery_notes, 500);
  if (deliveryNotes !== '') {
    payload.delivery_notes = deliveryNotes;
  }

  const deliveryMethod = trimmed(listing.delivery_method) || 'pickup';
  const choice = trimmed(req.body.delivery_choice, 100);
  let isPickup = false;
  if (deliveryMethod === 'pickup') {
    payload.shipping_method = 'pickup';
    isPickup = true;
  } else if (deliveryMethod === 'both' && choice === 'pickup') {
    payload.shipping_method = 'pickup';
    isPickup = true;
  } else if (['shipping', 'both'].includes(deliveryMethod)) {
    const match = choice.match(/^shipping:(\d+)$/);
    const option = match && shippingOptions.find((row) => positiveInteger(row && row.id) === Number(match[1]));
    if (!option) return fail('govuk_alpha_commerce.buy.delivery_option_required', 'delivery_choice');
    if (paymentMethod !== 'cash' && decimalNumber(option.price) > 0) {
      return fail('govuk_alpha_commerce.buy.delivery_option_cash_only', 'delivery_choice');
    }
    payload.shipping_option_id = Number(match[1]);
  }

  const pickupSlotId = positiveInteger(req.body.pickup_slot_id);
  if (isPickup && (pickupSlots.length > 0 || pickupSlotId)) {
    const validSlot = pickupSlots.some((row) => positiveInteger(row && row.id) === pickupSlotId);
    if (!pickupSlotId || !validSlot) {
      return fail('govuk_alpha_commerce.buy.pickup_slot_required', 'pickup_slot_id');
    }
    payload.pickup_slot_id = pickupSlotId;
  }
  try {
    await callApi(token, 'POST', '/orders', payload);
    req.session[directBuyCompletedSessionKey(id)] = true;
    return redirectTo(res, '/marketplace/orders?status=ordered');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
  }
}));

router.post('/offers/:id(\\d+)/buy', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const fail = (messageKey, target = 'delivery_choice') => {
    req.session[acceptedOfferErrorSessionKey(id)] = {
      messageKey,
      target,
      oldInput: {
        delivery_notes: trimmed(req.body.delivery_notes, 500),
        delivery_choice: trimmed(req.body.delivery_choice, 100),
        pickup_slot_id: trimmed(req.body.pickup_slot_id, 20)
      }
    };
    return redirectTo(res, `/marketplace/offers/${id}/buy`);
  };
  const idempotencyKey = trimmed(req.body.idempotency_key, 100);
  const expectedKey = trimmed(req.session && req.session[acceptedOfferSessionKey(id)], 100);
  if (idempotencyKey.length < 16 || !expectedKey || !matchingKey(idempotencyKey, expectedKey)) {
    return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
  }
  let offer;
  let listing;
  let shippingOptions = [];
  let pickupSlots = [];
  try {
    const offersResult = await callApi(token, 'GET', '/my-offers/sent?per_page=50');
    const offers = Array.isArray(dataFrom(offersResult)) ? dataFrom(offersResult) : [];
    offer = offers.find((row) => positiveInteger(row && row.id) === id && trimmed(row && row.status) === 'accepted');
    if (!offer) return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
    const authoritativeListingId = positiveInteger(offer.marketplace_listing_id || offer.listing_id || (offer.listing && offer.listing.id));
    if (!authoritativeListingId) return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
    const listingResult = await callApi(token, 'GET', `/listings/${authoritativeListingId}?offer_id=${id}`);
    listing = dataFrom(listingResult) || {};
    listing.id = authoritativeListingId;
    const sellerId = positiveInteger(listing.user && listing.user.id) || positiveInteger(listing.user_id);
    const [shippingResult, slotsResult] = await Promise.all([
      sellerId && ['shipping', 'both'].includes(trimmed(listing.delivery_method) || 'pickup')
        ? callApi(token, 'GET', `/sellers/${sellerId}/shipping-options`).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      callApi(token, 'GET', `/listings/${authoritativeListingId}/pickup-slots?offer_id=${id}`).catch(() => ({ data: [] }))
    ]);
    shippingOptions = Array.isArray(dataFrom(shippingResult)) ? dataFrom(shippingResult) : [];
    pickupSlots = Array.isArray(dataFrom(slotsResult)) ? dataFrom(slotsResult) : [];
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
  }
  const listingId = listing.id;
  const payload = { listing_id: listingId, offer_id: id, quantity: 1, idempotency_key: idempotencyKey, payment_method: 'cash' };
  const notes = trimmed(req.body.delivery_notes, 500);
  if (notes) payload.delivery_notes = notes;
  const choice = trimmed(req.body.delivery_choice, 100);
  const deliveryMethod = trimmed(listing.delivery_method) || 'pickup';
  let isPickup = false;
  if (deliveryMethod === 'pickup' || (deliveryMethod === 'both' && choice === 'pickup')) {
    payload.shipping_method = 'pickup';
    isPickup = true;
  } else if (['shipping', 'both'].includes(deliveryMethod)) {
    const shippingMatch = choice.match(/^shipping:(\d+)$/);
    const validOption = shippingMatch && shippingOptions.some((row) => positiveInteger(row && row.id) === Number(shippingMatch[1]));
    if (!validOption) return fail('govuk_alpha_commerce.buy.delivery_option_required');
    payload.shipping_option_id = Number(shippingMatch[1]);
  }
  const pickupSlotId = positiveInteger(req.body.pickup_slot_id);
  if (isPickup && (pickupSlots.length > 0 || pickupSlotId)) {
    const validSlot = pickupSlots.some((row) => positiveInteger(row && row.id) === pickupSlotId);
    if (!pickupSlotId || !validSlot) return fail('govuk_alpha_commerce.buy.pickup_slot_required', 'pickup_slot_id');
    payload.pickup_slot_id = pickupSlotId;
  }
  try {
    await callApi(token, 'POST', '/orders', payload);
    req.session[acceptedOfferCompletedSessionKey(id)] = true;
    return redirectTo(res, '/marketplace/orders?status=ordered');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return fail('govuk_alpha_commerce.buy.error_generic', 'quantity');
  }
}));

router.post('/:id(\\d+)/offer', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const oldInput = {
    amount: trimmed(req.body.amount, 50),
    message: trimmed(req.body.message, 500)
  };
  const amount = decimalNumber(req.body.amount);
  if (amount <= 0) {
    req.session[offerFormSessionKey(id)] = oldInput;
    return redirectTo(res, `/marketplace/${id}/offer?status=offer-amount-invalid`);
  }

  const payload = { amount };
  const message = trimmed(req.body.message, 500);
  if (message !== '') {
    payload.message = message;
  }

  try {
    await callApi(token, 'POST', `/listings/${id}/offers`, payload);
    delete req.session[offerFormSessionKey(id)];
    return redirectTo(res, '/marketplace/offers?status=offer-sent');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    req.session[offerFormSessionKey(id)] = oldInput;
    return redirectTo(res, `/marketplace/${id}/offer?status=offer-failed`);
  }
}));

router.post('/:id(\\d+)/report', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const values = reportFormValues(req.body);
  const errors = [];
  if (values.reason === '') {
    errors.push({ field: 'reason', key: 'govuk_alpha_commerce.report.error_reason' });
  }
  if (trimmed(values.description) === '') {
    errors.push({ field: 'description', key: 'govuk_alpha_commerce.report.error_description' });
  }
  if (errors.length > 0) {
    rememberReportForm(req, id, values, errors);
    return redirectTo(res, `/marketplace/${id}/report`);
  }

  try {
    await callMarketplaceApi(token, 'POST', `/listings/${id}/report`, {
      reason: values.reason,
      description: trimmed(values.description, 5000)
    });
    delete req.session[reportFormSessionKey(req, id)];
    return redirectTo(res, listingRedirect(id, 'reported'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const validationError = apiReportError(error);
    if (validationError) {
      rememberReportForm(req, id, values, [validationError]);
      return redirectTo(res, `/marketplace/${id}/report`);
    }
    return redirectTo(res, listingRedirect(id, 'report-failed'));
  }
}));

router.post('/offers/:id(\\d+)/accept', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'PUT',
    `/offers/${id}/accept`,
    undefined,
    offersRedirect('received', 'accepted'),
    offersRedirect('received', 'accept-failed')
  );
}));

router.post('/offers/:id(\\d+)/decline', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'PUT',
    `/offers/${id}/decline`,
    undefined,
    offersRedirect('received', 'declined'),
    offersRedirect('received', 'decline-failed')
  );
}));

router.post('/offers/:id(\\d+)/withdraw', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/offers/${id}`,
    undefined,
    offersRedirect('sent', 'withdrawn'),
    offersRedirect('sent', 'withdraw-failed')
  );
}));

router.post('/orders/:id(\\d+)/ship', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const payload = {};
  const trackingNumber = trimmed(req.body.tracking_number, 255);
  if (trackingNumber !== '') {
    payload.tracking_number = trackingNumber;
  }
  const trackingUrl = trimmed(req.body.tracking_url, 500);
  if (trackingUrl !== '') {
    payload.tracking_url = trackingUrl;
  }
  const shippingMethod = trimmed(req.body.shipping_method, 100);
  if (shippingMethod !== '') {
    payload.shipping_method = shippingMethod;
  }

  return runAction(
    req,
    res,
    'PUT',
    `/orders/${id}/ship`,
    payload,
    '/marketplace/sales?status=shipped',
    '/marketplace/sales?status=ship-failed'
  );
}));

router.post('/orders/:id(\\d+)/confirm', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'PUT',
    `/orders/${id}/confirm-delivery`,
    undefined,
    '/marketplace/orders?status=confirmed',
    '/marketplace/orders?status=confirm-failed'
  );
}));

router.post('/orders/:id(\\d+)/cancel', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const reason = trimmed(req.body.reason, 500) || 'Cancelled from the accessible marketplace.';
  return runAction(
    req,
    res,
    'PUT',
    `/orders/${id}/cancel`,
    { reason },
    ordersRedirect(req, 'cancelled'),
    ordersRedirect(req, 'cancel-failed')
  );
}));

router.post('/orders/:id(\\d+)/pay', (req, res) => {
  if (!tokenFrom(req)) return redirectTo(res, loginRedirect());

  // Laravel's accessible flow creates a hosted Stripe Checkout Session and
  // 303-redirects to it. The current Laravel API only exposes PaymentIntent
  // creation, whose client_secret cannot be used by this no-JS route. Do not
  // create and discard an intent or claim that payment started. Use Laravel's
  // localized generic start failure instead of pay-unavailable, whose source
  // copy would incorrectly blame a seller who may already be fully onboarded.
  return redirectTo(res, '/marketplace/orders?status=pay-failed');
});

router.post('/orders/:id(\\d+)/rate', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const rating = positiveInteger(req.body.rating);
  if (rating === null || rating < 1 || rating > 5) {
    return redirectTo(res, ordersRedirect(req, 'rate-invalid'));
  }

  try {
    await callApi(token, 'POST', `/orders/${id}/rate`, {
      rating,
      comment: trimmed(req.body.comment, 1000),
      is_anonymous: checked(req.body.is_anonymous)
    });
    return redirectTo(res, ordersRedirect(req, 'rated'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
      return redirectTo(res, ordersRedirect(req, 'rate-safeguarding-unavailable'));
    }
    if (['SAFEGUARDING_CONTACT_RESTRICTED', 'SAFEGUARDING_INTERACTION_NOT_ALLOWED'].includes(code)) {
      return redirectTo(res, ordersRedirect(req, 'rate-safeguarding-restricted'));
    }
    return redirectTo(res, ordersRedirect(req, 'rate-failed'));
  }
}));

router.post('/onboarding', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const state = onboardingFormState(req.body);
  const { sellerType, identity, businessAddress } = onboardingPayloads(req.body);
  const errorKeys = [];
  if (sellerType === 'business' && !identity.business_name) {
    errorKeys.push('govuk_alpha_commerce.onboarding.error_business_name');
  }
  if (!identity.display_name) {
    errorKeys.push('govuk_alpha_commerce.onboarding.error_display_name');
  }
  if (errorKeys.length > 0) {
    rememberOnboardingForm(req, state, errorKeys);
    return redirectTo(res, '/marketplace/onboarding');
  }

  try {
    await callMerchantOnboardingApi(token, 'POST', '/step-1', identity);
    if (Object.keys(businessAddress).length > 0) {
      await callMerchantOnboardingApi(token, 'POST', '/step-2', { business_address: businessAddress });
    }
    await callMerchantOnboardingApi(token, 'POST', '/complete');
    delete req.session[onboardingFormSessionKey(req)];
    return redirectTo(res, '/marketplace/onboarding?status=onboarding-complete');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    rememberOnboardingForm(req, state);
    return redirectTo(res, '/marketplace/onboarding?status=onboarding-failed');
  }
}));

router.post('/slots', asyncRoute(async (req, res) => runAction(
  req,
  res,
  'POST',
  '/seller/pickup-slots',
  pickupSlotPayload(req.body),
  '/marketplace/slots?status=slot-created',
  '/marketplace/slots?status=slot-create-failed'
)));

router.post('/slots/scan', asyncRoute(async (req, res) => {
  if (!tokenFrom(req)) return redirectTo(res, loginRedirect());
  const qrCode = trimmed(req.body.qr_code, 64);
  if (qrCode === '') {
    return redirectTo(res, '/marketplace/slots?status=pickup-scan-failed');
  }

  return runAction(
    req,
    res,
    'POST',
    '/seller/pickup-scan',
    { qr_code: qrCode },
    '/marketplace/slots?status=pickup-confirmed',
    '/marketplace/slots?status=pickup-scan-failed'
  );
}));

router.post('/slots/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'PUT',
    `/seller/pickup-slots/${id}`,
    pickupSlotPayload(req.body, { defaultActive: false }),
    `/marketplace/slots/${id}/edit?status=slot-saved`,
    `/marketplace/slots/${id}/edit?status=slot-save-failed`
  );
}));

router.post('/slots/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/seller/pickup-slots/${id}`,
    undefined,
    '/marketplace/slots?status=slot-deleted',
    '/marketplace/slots?status=slot-delete-failed'
  );
}));

router.post('/coupons/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const values = couponFormValues(req.body);
  const errors = couponValidationErrors(req.body);
  const payload = couponPayload(req.body);
  if (errors.length > 0) {
    rememberCouponForm(req, 'create', values, errors);
    return redirectTo(res, '/marketplace/coupons/new');
  }

  try {
    await callApi(token, 'POST', '/seller/coupons', payload);
    delete req.session[couponFormSessionKey(req, 'create')];
    return redirectTo(res, '/marketplace/coupons?status=coupon-created');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    rememberCouponForm(req, 'create', values, [
      apiCouponError(error, 'govuk_alpha_commerce.coupons.error_create')
    ]);
    return redirectTo(res, '/marketplace/coupons/new');
  }
}));

router.post('/coupons/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const values = couponFormValues(req.body);
  const errors = couponValidationErrors(req.body);
  const payload = couponPayload(req.body);
  if (errors.length > 0) {
    rememberCouponForm(req, `edit:${id}`, values, errors);
    return redirectTo(res, `/marketplace/coupons/${id}/edit`);
  }

  try {
    await callApi(token, 'PUT', `/seller/coupons/${id}`, payload);
    delete req.session[couponFormSessionKey(req, `edit:${id}`)];
    return redirectTo(res, `/marketplace/coupons/${id}/edit?status=coupon-saved`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 422) {
      rememberCouponForm(req, `edit:${id}`, values, [
        apiCouponError(error, 'govuk_alpha_commerce.coupons.status_coupon_save_failed')
      ]);
      return redirectTo(res, `/marketplace/coupons/${id}/edit`);
    }
    rememberCouponForm(req, `edit:${id}`, values);
    return redirectTo(res, `/marketplace/coupons/${id}/edit?status=coupon-save-failed`);
  }
}));

router.post('/coupons/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/seller/coupons/${id}`,
    undefined,
    '/marketplace/coupons?status=coupon-deleted',
    '/marketplace/coupons?status=coupon-delete-failed'
  );
}));

module.exports = router;
