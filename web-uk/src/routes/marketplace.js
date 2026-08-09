// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { randomUUID } = require('node:crypto');
const { ApiError, callMarketplaceApi, callMerchantOnboardingApi } = require('../lib/api');
const { flagEnabled } = require('../lib/accessible-shell');
const { createTranslator } = require('../lib/localization');
const { getRequestProfile } = require('../lib/request-profile');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();
const fallbackTranslator = createTranslator('en');

router.use((req, res, next) => {
  const tenant = req.accessibleRouting?.tenant;
  res.locals.marketplaceCouponsEnabled = tenant && typeof tenant === 'object'
    ? flagEnabled(tenant, 'merchant_coupons', 'features', true)
    : true;
  next();
});

const PRICE_TYPES = ['fixed', 'negotiable', 'free', 'contact'];
const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor'];
const DELIVERY_METHODS = ['pickup', 'shipping', 'both', 'community_delivery'];
const REPORT_REASONS = ['counterfeit', 'illegal', 'unsafe', 'misleading', 'discrimination', 'ip_violation', 'other'];
const SELLER_TYPES = ['private', 'business'];
const COUPON_DISCOUNT_TYPES = ['percent', 'fixed', 'bogo'];
const COUPON_STATUSES = ['draft', 'active', 'paused', 'expired'];
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
]);

const PRICE_TYPE_LABELS = {
  fixed: 'Fixed price',
  negotiable: 'Open to offers',
  free: 'Free to a good home',
  contact: 'Contact for price'
};
const CONDITION_LABELS = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor'
};
const DELIVERY_METHOD_LABELS = {
  pickup: 'Local pickup',
  shipping: 'Shipping',
  both: 'Pickup or shipping',
  community_delivery: 'Community delivery'
};
const REPORT_REASON_LABELS = {
  counterfeit: 'Counterfeit or fake goods',
  illegal: 'Illegal item or activity',
  unsafe: 'Unsafe or dangerous',
  misleading: 'Misleading or a scam',
  discrimination: 'Discriminatory content',
  ip_violation: 'Copies someone else without permission',
  other: 'Something else'
};
const MARKETPLACE_SUCCESS_MESSAGES = {
  saved: 'This item has been saved.',
  unsaved: 'Item removed from your saved list.',
  reported: 'Thank you. Your report has been sent to our team.',
  'listing-created': 'Your listing has been published.',
  'listing-saved': 'Your changes were saved.',
  deleted: 'Your listing was deleted.',
  renewed: 'Your listing was renewed.',
  accepted: 'You accepted the offer.',
  declined: 'You declined the offer.',
  withdrawn: 'You withdrew your offer.',
  'offer-sent': 'Your offer was sent to the seller.',
  ordered: 'Your order was placed.',
  'payment-submitted': 'Thank you. Your payment is being confirmed - your order will update to paid shortly.',
  'payment-cancelled': 'Your card payment was cancelled. Your order is still awaiting payment.',
  shipped: 'The order was marked as shipped.',
  confirmed: 'Delivery confirmed. Thank you.',
  cancelled: 'The order was cancelled.',
  rated: 'Thank you for your rating.',
  'onboarding-complete': 'Your seller details were saved. You can now start selling.',
  'slot-created': 'Pickup slot added.',
  'slot-saved': 'Pickup slot updated.',
  'slot-deleted': 'Pickup slot deleted.',
  'pickup-confirmed': 'Collection confirmed. The order is marked as collected.',
  'coupon-created': 'Your coupon was created.',
  'coupon-saved': 'Your changes were saved.',
  'coupon-deleted': 'Your coupon was deleted.'
};
const MARKETPLACE_SUCCESS_MESSAGE_KEYS = {
  unsaved: 'govuk_alpha_commerce.saved.status_unsaved',
  reported: 'govuk_alpha_commerce.report.status_reported',
  'listing-created': 'listings.create.created',
  deleted: 'govuk_alpha_commerce.my_listings.status_deleted',
  renewed: 'govuk_alpha_commerce.my_listings.status_renewed',
  accepted: 'govuk_alpha_commerce.offers.status_accepted_done',
  declined: 'govuk_alpha_commerce.offers.status_declined_done',
  withdrawn: 'govuk_alpha_commerce.offers.status_withdrawn_done',
  'offer-sent': 'govuk_alpha_commerce.offers.status_offer_sent',
  ordered: 'govuk_alpha_commerce.orders.status_ordered',
  'payment-submitted': 'govuk_alpha_commerce.orders.status_payment_submitted',
  'payment-cancelled': 'govuk_alpha_commerce.orders.status_payment_cancelled',
  shipped: 'govuk_alpha_commerce.orders.status_shipped_done',
  confirmed: 'govuk_alpha_commerce.orders.status_confirmed',
  cancelled: 'govuk_alpha_commerce.orders.status_cancelled_done',
  rated: 'govuk_alpha_commerce.orders.status_rated',
  'onboarding-complete': 'govuk_alpha_commerce.onboarding.status_complete',
  'slot-created': 'govuk_alpha_commerce.slots.status_slot_created',
  'slot-saved': 'govuk_alpha_commerce.slots.status_slot_saved',
  'slot-deleted': 'govuk_alpha_commerce.slots.status_slot_deleted',
  'pickup-confirmed': 'govuk_alpha_commerce.slots.status_pickup_confirmed',
  'coupon-created': 'govuk_alpha_commerce.coupons.status_coupon_created',
  'coupon-saved': 'govuk_alpha_commerce.coupons.status_coupon_saved',
  'coupon-deleted': 'govuk_alpha_commerce.coupons.status_coupon_deleted'
};
const MARKETPLACE_ERROR_MESSAGES = {
  'listing-validation': 'Check the listing details and try again.',
  'listing-create-failed': 'Sorry, your listing could not be created. Please try again.',
  'listing-save-failed': 'Sorry, your changes could not be saved. Please try again.',
  'save-failed': 'Sorry, this item could not be saved. Please try again.',
  'unsave-failed': 'Sorry, this item could not be removed from your saved list. Please try again.',
  'delete-failed': 'Sorry, the listing could not be deleted.',
  'renew-failed': 'Sorry, the listing could not be renewed.',
  'order-failed': 'Sorry, your order could not be placed. Please try again.',
  'offer-amount-invalid': 'Enter an offer amount greater than zero',
  'offer-failed': 'Sorry, your offer could not be sent. Please try again.',
  'report-failed': 'Sorry, your report could not be sent.',
  'accept-failed': 'Sorry, that action could not be completed.',
  'decline-failed': 'Sorry, that action could not be completed.',
  'withdraw-failed': 'Sorry, that action could not be completed.',
  'pay-not-pending': 'This order is not awaiting payment.',
  'pay-not-required': 'This order does not require a card payment.',
  'pay-unavailable': 'Card payment is not available for this order yet - the seller has not finished setting up payments.',
  'pay-failed': 'Sorry, we could not start your card payment. Please try again.',
  'ship-failed': 'Sorry, the order could not be marked as shipped.',
  'confirm-failed': 'Sorry, delivery could not be confirmed.',
  'cancel-failed': 'Sorry, the order could not be cancelled.',
  'rate-failed': 'Sorry, your rating could not be saved.',
  'rate-invalid': 'Choose a rating between 1 and 5 stars.',
  'rate-safeguarding-restricted': 'The recipient’s community safeguarding policy does not allow this direct interaction. Ask a coordinator for help.',
  'rate-safeguarding-unavailable': 'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.',
  'business-name-required': 'Enter your business name',
  'display-name-required': 'Enter a display name',
  'onboarding-failed': 'Sorry, your details could not be saved. Please try again.',
  'slot-create-failed': 'The pickup slot could not be added. Please try again.',
  'slot-save-failed': 'The pickup slot could not be updated. Please try again.',
  'slot-delete-failed': 'The pickup slot could not be deleted. Please try again.',
  'pickup-scan-failed': 'That collection code could not be confirmed. Check the code and try again.',
  'coupon-title-required': 'Enter a coupon title',
  'coupon-create-failed': 'Sorry, your coupon could not be created. Please try again.',
  'coupon-save-failed': 'Sorry, your changes could not be saved. Please try again.',
  'coupon-delete-failed': 'Sorry, your coupon could not be deleted. Please try again.'
};
const MARKETPLACE_ERROR_MESSAGE_KEYS = {
  'listing-create-failed': 'govuk_alpha_commerce.listing_form.error_create',
  'listing-save-failed': 'govuk_alpha_commerce.listing_form.error_update',
  'delete-failed': 'govuk_alpha_commerce.my_listings.status_delete_failed',
  'renew-failed': 'govuk_alpha_commerce.my_listings.status_renew_failed',
  'order-failed': 'govuk_alpha_commerce.buy.error_generic',
  'offer-amount-invalid': 'govuk_alpha_commerce.offer.error_amount',
  'offer-failed': 'govuk_alpha_commerce.offer.error_generic',
  'report-failed': 'govuk_alpha_commerce.report.status_report_failed',
  'accept-failed': 'govuk_alpha_commerce.offers.status_action_failed',
  'decline-failed': 'govuk_alpha_commerce.offers.status_action_failed',
  'withdraw-failed': 'govuk_alpha_commerce.offers.status_action_failed',
  'pay-not-pending': 'govuk_alpha_commerce.orders.status_pay_not_pending',
  'pay-not-required': 'govuk_alpha_commerce.orders.status_pay_not_required',
  'pay-unavailable': 'govuk_alpha_commerce.orders.status_pay_unavailable',
  'pay-failed': 'govuk_alpha_commerce.orders.status_pay_failed',
  'ship-failed': 'govuk_alpha_commerce.orders.status_ship_failed',
  'confirm-failed': 'govuk_alpha_commerce.orders.status_confirm_failed',
  'cancel-failed': 'govuk_alpha_commerce.orders.status_cancel_failed',
  'rate-failed': 'govuk_alpha_commerce.orders.status_rate_failed',
  'rate-invalid': 'govuk_alpha_commerce.orders.status_rate_invalid',
  'rate-safeguarding-restricted': 'safeguarding.errors.interaction_not_allowed',
  'rate-safeguarding-unavailable': 'safeguarding.errors.policy_unavailable',
  'business-name-required': 'govuk_alpha_commerce.onboarding.error_business_name',
  'display-name-required': 'govuk_alpha_commerce.onboarding.error_display_name',
  'onboarding-failed': 'govuk_alpha_commerce.onboarding.status_failed',
  'slot-create-failed': 'govuk_alpha_commerce.slots.status_slot_create_failed',
  'slot-save-failed': 'govuk_alpha_commerce.slots.status_slot_save_failed',
  'slot-delete-failed': 'govuk_alpha_commerce.slots.status_slot_delete_failed',
  'pickup-scan-failed': 'govuk_alpha_commerce.slots.status_pickup_scan_failed',
  'coupon-title-required': 'govuk_alpha_commerce.coupons.error_title',
  'coupon-create-failed': 'govuk_alpha_commerce.coupons.error_create',
  'coupon-save-failed': 'govuk_alpha_commerce.coupons.status_coupon_save_failed',
  'coupon-delete-failed': 'govuk_alpha_commerce.coupons.status_coupon_delete_failed'
};
const LISTING_STATUS_TABS = ['active', 'draft', 'sold', 'expired'];
const OFFER_TABS = ['received', 'sent'];
const BUYER_ORDER_TABS = ['all', 'active', 'completed', 'cancelled'];
const SELLER_ORDER_TABS = ['all', 'paid', 'shipped', 'completed'];
const LISTING_STATUS_LABELS = {
  active: 'Active',
  draft: 'Draft',
  sold: 'Sold',
  expired: 'Expired'
};
const OFFER_STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  countered: 'Countered',
  withdrawn: 'Withdrawn',
  expired: 'Expired'
};
const ORDER_STATUS_LABELS = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled'
};
const PICKUP_STATUS_LABELS = {
  reserved: 'Reserved',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
  no_show: 'No show'
};
const SELLER_TYPE_LABELS = {
  private: 'Individual',
  business: 'Business'
};
const COUPON_DISCOUNT_LABELS = {
  percent: 'Percentage off',
  fixed: 'Fixed amount off',
  bogo: 'Buy one get one'
};
const COUPON_STATUS_LABELS = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired'
};
const COUPON_STATUS_TAGS = {
  draft: 'govuk-tag--grey',
  active: 'govuk-tag--green',
  paused: 'govuk-tag--yellow',
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

function requireToken(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, loginRedirect());
    return null;
  }
  return token;
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '');
}

function limitText(value, limit = 160) {
  const text = stripHtml(value).trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function decimalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function booleanValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function allowed(value, choices, fallback) {
  const text = trimmed(value);
  return choices.includes(text) ? text : fallback;
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function appendText(params, key, value) {
  const text = trimmed(value);
  if (text) params.append(key, text);
}

function appendPositive(params, key, value) {
  const number = positiveInteger(value);
  if (number !== null) params.append(key, String(number));
}

function appendDecimal(params, key, value) {
  const text = trimmed(value);
  if (text === '') return;
  const number = Number(text);
  if (Number.isFinite(number) && number >= 0) params.append(key, String(number));
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function rowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function objectFrom(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

function metaFrom(result) {
  return result && typeof result === 'object' && result.meta && typeof result.meta === 'object'
    ? result.meta
    : {};
}

async function callMarketplace(token, method, path) {
  return callMarketplaceApi(token, method, path);
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function isForbidden(error) {
  return error instanceof ApiError && error.status === 403;
}

function isNotFound(error) {
  return error instanceof ApiError && error.status === 404;
}

function renderMarketplaceError(error, res, title = 'Marketplace') {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }
  if (isForbidden(error)) {
    res.status(403).render('errors/403', { title: 'Access denied' });
    return true;
  }
  if (isNotFound(error)) {
    res.status(404).render('errors/404', { title: 'Page not found' });
    return true;
  }

  res.status(503).render('static-page', {
    title,
    body: 'Marketplace information could not be loaded. Please try again shortly.'
  });
  return true;
}

function safeRelativeOrAbsoluteUrl(value) {
  const url = trimmed(value);
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')
    ? url
    : '';
}

function formatMoney(amount, currency = '') {
  const number = Number(amount);
  if (!Number.isFinite(number)) return '';
  const code = trimmed(currency, 3).toUpperCase();
  const precision = ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    useGrouping: true
  }).format(number);
  return `${code} ${formatted}`.trim();
}

function formatCredits(amount) {
  const number = Number(amount);
  if (!Number.isFinite(number)) return '';
  return `${number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')} time credits`;
}

function formatCompactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function dateTimeInput(value) {
  const text = trimmed(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function dateInput(value) {
  const text = trimmed(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function formatDateTimeLabel(value) {
  const text = trimmed(value);
  if (!text) return 'Not set';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(date);
}

function objectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function priceLabel(row) {
  const credits = decimalNumber(row.time_credit_price);
  const money = decimalNumber(row.price);
  if (credits > 0 && money > 0) {
    return fallbackTranslator('govuk_alpha_commerce.buy.hybrid_price', {
      money: formatMoney(money, row.price_currency),
      credits: formatCompactNumber(credits)
    });
  }
  if (credits > 0) return formatCredits(credits);
  if (money > 0) return formatMoney(money, row.price_currency);
  return 'Free';
}

function formatMonthYearLabel(value) {
  const text = trimmed(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function priceTagClass(row) {
  const credits = decimalNumber(row.time_credit_price);
  const money = decimalNumber(row.price);
  if (credits <= 0 && money <= 0) return 'govuk-tag--green';
  if (credits > 0 && money > 0) return 'govuk-tag--purple';
  if (credits > 0) return 'govuk-tag--blue';
  return 'govuk-tag--grey';
}

function cardPriceLabel(row) {
  const credits = decimalNumber(row.time_credit_price);
  const money = decimalNumber(row.price);
  if (credits > 0) return formatCredits(credits);
  if (money > 0) return formatMoney(money, row.price_currency);
  return 'Free';
}

function cardPriceTagClass(row) {
  const credits = decimalNumber(row.time_credit_price);
  const money = decimalNumber(row.price);
  if (credits > 0) return 'govuk-tag--blue';
  if (money > 0) return 'govuk-tag--grey';
  return 'govuk-tag--green';
}

function cardImageUrl(row) {
  const image = row && row.image;
  const value = typeof image === 'string'
    ? image
    : (image && (image.thumbnail_url || image.url));
  return safeRelativeOrAbsoluteUrl(value);
}

function imageUrls(row) {
  const urls = [];
  const images = Array.isArray(row.images) ? row.images : [];
  images.forEach((image) => {
    const value = typeof image === 'string' ? image : (image && (image.url || image.thumbnail_url));
    const url = safeRelativeOrAbsoluteUrl(value);
    if (url) urls.push(url);
  });

  const single = row.image && typeof row.image === 'object'
    ? (row.image.url || row.image.thumbnail_url)
    : row.image;
  const singleUrl = safeRelativeOrAbsoluteUrl(single);
  if (singleUrl && !urls.includes(singleUrl)) urls.push(singleUrl);

  return urls;
}

function decorateCategory(category) {
  const row = category && typeof category === 'object' ? category : {};
  const name = trimmed(row.name) || 'Category';
  const slug = trimmed(row.slug);
  return {
    ...row,
    id: positiveInteger(row.id),
    name,
    slug,
    href: slug ? `/marketplace/category/${encodeURIComponent(slug)}` : ''
  };
}

function decorateListing(listing) {
  const row = listing && typeof listing === 'object' ? listing : {};
  const id = positiveInteger(row.id);
  const title = trimmed(row.title) || 'Marketplace';
  const images = imageUrls(row);
  const seller = row.user && typeof row.user === 'object' ? row.user : {};
  const sellerId = positiveInteger(seller.id) || positiveInteger(row.user_id);
  const sellerName = trimmed(seller.name || row.seller_name || row.seller_type);
  const priceType = allowed(row.price_type, PRICE_TYPES, decimalNumber(row.price) > 0 ? 'fixed' : 'free');
  const money = decimalNumber(row.price);
  const credits = decimalNumber(row.time_credit_price);
  const condition = trimmed(row.condition);
  const deliveryMethod = trimmed(row.delivery_method);

  return {
    ...row,
    id,
    title,
    tagline: stripHtml(row.tagline || ''),
    summary: limitText(row.tagline || row.description || ''),
    description: stripHtml(row.description || ''),
    priceType,
    priceTypeLabel: PRICE_TYPE_LABELS[priceType] || priceType,
    priceLabel: priceLabel(row),
    cardPriceLabel: cardPriceLabel(row),
    moneyLabel: formatMoney(money, row.price_currency),
    askingPriceLabel: money > 0 ? formatMoney(money, row.price_currency) : '',
    priceTagClass: priceTagClass(row),
    cardPriceTagClass: cardPriceTagClass(row),
    price: row.price ?? '',
    priceCurrency: trimmed(row.price_currency || 'EUR', 3).toUpperCase() || 'EUR',
    timeCreditPrice: row.time_credit_price ?? '',
    canBuy: trimmed(row.status) === 'active'
      && ((priceType === 'fixed' && money > 0) || priceType === 'free' || credits > 0),
    condition,
    conditionLabel: condition ? (CONDITION_LABELS[condition] || condition) : '',
    deliveryMethod,
    deliveryLabel: deliveryMethod ? (DELIVERY_METHOD_LABELS[deliveryMethod] || deliveryMethod) : '',
    categoryId: positiveInteger(row.category_id),
    location: trimmed(row.location),
    quantity: positiveInteger(row.quantity) || 1,
    sellerId,
    sellerName,
    images,
    primaryImage: images[0] || '',
    cardImage: cardImageUrl(row),
    isOwnItem: Boolean(row.is_own || row.is_owner || row.owned_by_current_user),
    href: id ? `/marketplace/${id}` : '/marketplace'
  };
}

function decorateSeller(seller, translate = fallbackTranslator) {
  const row = seller && typeof seller === 'object' ? seller : {};
  const user = row.user && typeof row.user === 'object' ? row.user : {};
  const name = trimmed(row.display_name || row.name || user.name || row.seller_name)
    || translate('govuk_alpha_commerce.seller.title');
  const ratings = positiveInteger(row.total_ratings) || positiveInteger(row.rating_count) || 0;
  const averageRating = Number(row.avg_rating ?? row.average_rating ?? 0);
  const totalSales = positiveInteger(row.total_sales) || 0;
  const createdAt = formatMonthYearLabel(row.member_since || row.created_at || user.created_at);
  const verified = booleanValue(row.identity_verified || row.id_verified);
  const averageRatingLabel = Number.isFinite(averageRating) ? averageRating.toFixed(1) : '0.0';

  return {
    ...row,
    id: positiveInteger(row.user_id) || positiveInteger(row.id),
    name,
    avatarUrl: safeRelativeOrAbsoluteUrl(row.avatar_url || user.avatar_url),
    verified,
    createdAt,
    averageRating: Number.isFinite(averageRating) ? averageRating : 0,
    averageRatingLabel,
    totalRatings: ratings,
    totalSales,
    ratingText: ratings > 0
      ? translate('govuk_alpha_commerce.seller.rating', { rating: averageRatingLabel, count: ratings })
      : translate('govuk_alpha_commerce.seller.no_ratings'),
    memberSinceText: createdAt
      ? translate('govuk_alpha_commerce.seller.member_since', { date: createdAt })
      : '',
    totalSalesText: translate('govuk_alpha_commerce.seller.total_sales', { count: totalSales })
  };
}

function decorateOffer(offer, tab, translate = fallbackTranslator) {
  const row = offer && typeof offer === 'object' ? offer : {};
  const listing = row.listing && typeof row.listing === 'object' ? row.listing : {};
  const buyer = row.buyer && typeof row.buyer === 'object' ? row.buyer : {};
  const seller = row.seller && typeof row.seller === 'object' ? row.seller : {};
  const status = trimmed(row.status) || 'pending';
  const listingId = positiveInteger(listing.id) || positiveInteger(row.listing_id);
  const counterparty = tab === 'sent'
    ? trimmed(seller.name || row.seller_name)
    : trimmed(buyer.name || row.buyer_name);

  return {
    ...row,
    id: positiveInteger(row.id),
    listingId,
    listingTitle: trimmed(listing.title || row.listing_title) || translate('marketplace.title'),
    href: listingId ? `/marketplace/${listingId}` : '',
    amountLabel: formatMoney(row.amount, row.currency || row.price_currency || 'EUR'),
    status,
    statusLabel: Object.hasOwn(OFFER_STATUS_LABELS, status)
      ? translate(`govuk_alpha_commerce.offers.status_${status}`)
      : status,
    statusTagClass: status === 'accepted' ? 'govuk-tag--green' : (status === 'pending' ? 'govuk-tag--blue' : 'govuk-tag--grey'),
    counterparty,
    counterpartyLabel: translate(`govuk_alpha_commerce.offers.${tab === 'sent' ? 'to_label' : 'from_label'}`),
    message: limitText(row.message || '', 200),
    canAct: status === 'pending' || status === 'countered',
    canPurchase: tab === 'sent' && status === 'accepted'
  };
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

function shippingOptionsForItem(item, rows) {
  if (!['shipping', 'both'].includes(item.deliveryMethod)) return [];
  const cashCheckout = item.priceType === 'fixed' && decimalNumber(item.price) > 0;
  const requiresFreeShipping = item.priceType === 'free'
    || (decimalNumber(item.timeCreditPrice) > 0 && !cashCheckout);
  return rows
    .filter((row) => !requiresFreeShipping || decimalNumber(row && row.price) <= 0)
    .map((row) => ({
      ...row,
      id: positiveInteger(row && row.id),
      priceLabel: formatMoney(row && row.price, row && row.currency)
    }))
    .filter((row) => row.id);
}

function pickupSlotsForView(rows) {
  return rows.map((row) => ({
    ...row,
    id: positiveInteger(row && row.id),
    startLabel: formatDateTimeLabel(row && row.slot_start),
    endLabel: formatDateTimeLabel(row && row.slot_end),
    remaining: Math.max(0, Number(row && row.remaining) || 0)
  })).filter((row) => row.id);
}

async function directBuyCheckout(token, id) {
  const item = await loadListing(token, id);
  if (item.isOwnItem) throw new ApiError('Cannot buy own listing', 403);
  if (!item.canBuy) throw new ApiError('Listing is not available to buy', 404);
  const [shippingResult, slotsResult] = await Promise.all([
    item.sellerId && ['shipping', 'both'].includes(item.deliveryMethod)
      ? callMarketplace(token, 'GET', `/sellers/${item.sellerId}/shipping-options`).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    callMarketplace(token, 'GET', `/listings/${id}/pickup-slots`).catch(() => ({ data: [] }))
  ]);
  return {
    item,
    shippingOptions: shippingOptionsForItem(item, rowsFrom(shippingResult)),
    pickupSlots: pickupSlotsForView(rowsFrom(slotsResult))
  };
}

async function acceptedOfferCheckout(token, id) {
  const [offersResult, ordersResult] = await Promise.all([
    callMarketplace(token, 'GET', '/my-offers/sent?per_page=50'),
    callMarketplace(token, 'GET', `/orders/purchases?${ordersQuery('all')}`).catch(() => ({ data: [] }))
  ]);
  const offer = rowsFrom(offersResult).find((row) => positiveInteger(row && row.id) === id);
  if (!offer || trimmed(offer.status) !== 'accepted') throw new ApiError('Accepted offer not found', 404);
  if (rowsFrom(ordersResult).some((row) => positiveInteger(row && row.marketplace_offer_id) === id)) {
    return { existingOrder: true };
  }

  const listingId = positiveInteger(offer.marketplace_listing_id || offer.listing_id || offer.listing?.id);
  if (!listingId) throw new ApiError('Accepted offer listing not found', 404);
  const listingResult = await callMarketplace(token, 'GET', `/listings/${listingId}?offer_id=${id}`);
  const listingRow = objectFrom(listingResult);
  if (!listingRow) throw new ApiError('Accepted offer listing not found', 404);
  const item = decorateListing({
    ...listingRow,
    price_type: 'fixed',
    price: offer.amount,
    price_currency: offer.currency,
    time_credit_price: 0
  });
  const [shippingResult, slotsResult] = await Promise.all([
    item.sellerId
      ? callMarketplace(token, 'GET', `/sellers/${item.sellerId}/shipping-options`).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    callMarketplace(token, 'GET', `/listings/${listingId}/pickup-slots?offer_id=${id}`).catch(() => ({ data: [] }))
  ]);
  return {
    offer,
    item,
    shippingOptions: shippingOptionsForItem(item, rowsFrom(shippingResult)),
    pickupSlots: pickupSlotsForView(rowsFrom(slotsResult))
  };
}

function decorateOrder(order, role, translate = fallbackTranslator) {
  const row = order && typeof order === 'object' ? order : {};
  const listing = row.listing && typeof row.listing === 'object' ? row.listing : {};
  const buyer = row.buyer && typeof row.buyer === 'object' ? row.buyer : {};
  const seller = row.seller && typeof row.seller === 'object' ? row.seller : {};
  const status = trimmed(row.status);
  const orderId = positiveInteger(row.id);
  const number = trimmed(row.order_number || row.number || row.id);
  const isSeller = role === 'seller';
  const counterparty = isSeller
    ? trimmed(buyer.name || row.buyer_name)
    : trimmed(seller.name || row.seller_name);
  const ratings = Array.isArray(row.ratings) ? row.ratings : [];
  const alreadyRated = ratings.some((rating) => rating && rating.rater_role === role);

  return {
    ...row,
    id: orderId,
    number,
    orderNumberLabel: translate('govuk_alpha_commerce.orders.order_number', { number }),
    listingTitle: trimmed(listing.title || row.listing_title) || translate('marketplace.title'),
    status,
    statusLabel: Object.hasOwn(ORDER_STATUS_LABELS, status)
      ? translate(`govuk_alpha_commerce.orders.status_${status}`)
      : status,
    statusTagClass: ['completed', 'delivered'].includes(status)
      ? 'govuk-tag--green'
      : (status === 'cancelled' ? 'govuk-tag--red' : 'govuk-tag--blue'),
    totalLabel: formatMoney(row.total_price ?? row.total ?? row.amount, row.currency || row.price_currency || 'EUR'),
    counterparty,
    counterpartyLabel: translate(`govuk_alpha_commerce.orders.${isSeller ? 'buyer_label' : 'seller_label'}`),
    trackingNumber: trimmed(row.tracking_number),
    canShip: isSeller && ['paid', 'shipped'].includes(status),
    canConfirm: !isSeller && ['shipped', 'paid', 'delivered'].includes(status),
    canPay: !isSeller && status === 'pending_payment' && decimalNumber(row.total_price ?? row.total) > 0,
    canCancel: status === 'pending_payment',
    canRate: ['completed', 'delivered'].includes(status) && !alreadyRated
  };
}

function decorateReservation(reservation, t = null) {
  const row = reservation && typeof reservation === 'object' ? reservation : {};
  const slot = row.slot && typeof row.slot === 'object' ? row.slot : {};
  const status = trimmed(row.status) || 'reserved';
  return {
    ...row,
    id: positiveInteger(row.id),
    orderId: positiveInteger(row.order_id),
    title: trimmed(row.listing_title || row.listing?.title) || (t ? t('govuk_alpha_commerce.pickups.order_label', { id: positiveInteger(row.order_id) || 0 }) : `Order ${positiveInteger(row.order_id) || 0}`),
    status,
    statusLabel: t && Object.hasOwn(PICKUP_STATUS_LABELS, status)
      ? t(`govuk_alpha_commerce.pickups.status_${status}`)
      : (PICKUP_STATUS_LABELS[status] || status),
    statusTagClass: status === 'picked_up'
      ? 'govuk-tag--green'
      : (status === 'cancelled' ? 'govuk-tag--red' : (status === 'reserved' ? 'govuk-tag--blue' : 'govuk-tag--yellow')),
    qrCode: trimmed(row.qr_code),
    slotStartLabel: formatDateTimeLabel(slot.slot_start || row.slot_start || row.reserved_at)
  };
}

function decoratePickupSlot(slot) {
  const row = slot && typeof slot === 'object' ? slot : {};
  const capacity = positiveInteger(row.capacity) || 0;
  const booked = Number.isFinite(Number(row.booked_count)) ? Math.max(0, Number(row.booked_count)) : 0;
  const remaining = Number.isFinite(Number(row.remaining))
    ? Math.max(0, Number(row.remaining))
    : Math.max(0, capacity - booked);
  const isActive = row.is_active === undefined ? true : booleanValue(row.is_active);

  return {
    ...row,
    id: positiveInteger(row.id),
    slotStart: trimmed(row.slot_start),
    slotEnd: trimmed(row.slot_end),
    slotStartInput: dateTimeInput(row.slot_start),
    slotEndInput: dateTimeInput(row.slot_end),
    slotStartLabel: formatDateTimeLabel(row.slot_start),
    slotEndLabel: formatDateTimeLabel(row.slot_end),
    capacity,
    booked,
    remaining,
    capacityLabel: `${booked} of ${capacity} booked`,
    remainingLabel: `${remaining} remaining`,
    isRecurring: booleanValue(row.is_recurring),
    isActive
  };
}

function discountLabel(coupon, req) {
  const type = trimmed(coupon.discount_type) || 'percent';
  const value = Number(coupon.discount_value);
  const safeValue = Number.isFinite(value) ? value : 0;
  if (type === 'percent') {
    return `${safeValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
  }
  if (type === 'bogo') {
    return translateMarketplaceMessage(
      req,
      'govuk_alpha_commerce.coupons.discount_type_bogo',
      COUPON_DISCOUNT_LABELS.bogo
    );
  }
  return safeValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function decorateCoupon(coupon, req) {
  const row = coupon && typeof coupon === 'object' ? coupon : {};
  const status = trimmed(row.status) || 'draft';
  const discountType = allowed(row.discount_type, COUPON_DISCOUNT_TYPES, 'percent');

  return {
    ...row,
    id: positiveInteger(row.id),
    title: trimmed(row.title),
    code: trimmed(row.code),
    description: trimmed(row.description),
    discountType,
    discountTypeLabel: translateMarketplaceMessage(
      req,
      `govuk_alpha_commerce.coupons.discount_type_${discountType}`,
      COUPON_DISCOUNT_LABELS[discountType] || discountType
    ),
    discountValue: row.discount_value ?? '',
    discountLabel: discountLabel({ ...row, discount_type: discountType }, req),
    minOrderCents: row.min_order_cents ?? '',
    maxUses: row.max_uses ?? '',
    usageCount: Number.isFinite(Number(row.usage_count)) ? Number(row.usage_count) : 0,
    validUntil: dateInput(row.valid_until),
    status,
    statusLabel: COUPON_STATUS_LABELS[status]
      ? translateMarketplaceMessage(
        req,
        `govuk_alpha_commerce.coupons.status_${status}`,
        COUPON_STATUS_LABELS[status]
      )
      : status,
    statusTagClass: COUPON_STATUS_TAGS[status] || 'govuk-tag--grey'
  };
}

function onboardingProfile(statusResult) {
  const data = objectFrom(statusResult) || {};
  const profile = objectValue(data.profile);
  let address = objectValue(profile.business_address);
  if (typeof profile.business_address === 'string' && profile.business_address.trim() !== '') {
    try {
      address = objectValue(JSON.parse(profile.business_address));
    } catch {
      address = {};
    }
  }
  return {
    completed: Boolean(data.onboarding_completed),
    profile: {
      business_name: trimmed(profile.business_name),
      display_name: trimmed(profile.display_name),
      bio: trimmed(profile.bio),
      seller_type: allowed(profile.seller_type, SELLER_TYPES, 'business'),
      business_registration: trimmed(profile.business_registration)
    },
    address: {
      street: trimmed(address.street),
      city: trimmed(address.city),
      postal_code: trimmed(address.postal_code),
      country: trimmed(address.country)
    }
  };
}

async function loadPickupSlots(token) {
  const result = await callMarketplace(token, 'GET', '/seller/pickup-slots');
  return rowsFrom(result).map(decoratePickupSlot);
}

async function loadPickupSlot(token, id) {
  const slotId = positiveInteger(id);
  const slots = await loadPickupSlots(token);
  const slot = slots.find((item) => item.id === slotId);
  if (!slot) throw new ApiError('Pickup slot not found.', 404);
  return slot;
}

async function loadSellerCoupons(token, req) {
  const result = await callMarketplace(token, 'GET', '/seller/coupons');
  return rowsFrom(result).map((coupon) => decorateCoupon(coupon, req));
}

async function loadSellerCoupon(token, id, req) {
  const couponId = positiveInteger(id);
  const coupons = await loadSellerCoupons(token, req);
  const coupon = coupons.find((item) => item.id === couponId);
  if (!coupon) throw new ApiError('Coupon not found.', 404);
  return coupon;
}

function listingTabs(req, activeTab, counts) {
  return LISTING_STATUS_TABS.map((value) => ({
    value,
    label: translateMarketplaceMessage(
      req,
      `govuk_alpha_commerce.my_listings.tab_${value}`,
      LISTING_STATUS_LABELS[value]
    ),
    href: `/marketplace/mine?tab=${value}`,
    count: counts[value] || 0,
    active: activeTab === value
  }));
}

function indexQuery(query) {
  const params = new URLSearchParams();
  params.set('limit', '30');

  const search = trimmed(query.q);
  if (search) params.set('q', search);

  const categoryId = positiveInteger(query.category_id);
  if (categoryId !== null) params.set('category_id', String(categoryId));

  const cursor = trimmed(query.cursor);
  if (cursor) params.set('cursor', cursor);

  return params.toString();
}

function myListingsQuery(userId) {
  return `limit=100&user_id=${userId}`;
}

function categoryListingsQuery(categoryId, query) {
  const params = new URLSearchParams();
  params.set('limit', '30');
  appendText(params, 'q', query.q);
  params.set('category_id', String(categoryId));
  return params.toString();
}

function advancedSearchQuery(query) {
  const params = new URLSearchParams();
  params.set('limit', '30');
  appendText(params, 'q', query.q);
  appendPositive(params, 'category_id', query.category_id);
  appendDecimal(params, 'price_min', query.price_min);
  appendDecimal(params, 'price_max', query.price_max);
  arrayFrom(query.condition)
    .map((value) => allowed(value, CONDITIONS, ''))
    .filter(Boolean)
    .forEach((value) => params.append('condition', value));
  appendText(params, 'seller_type', allowed(query.seller_type, ['private', 'business'], ''));
  appendText(params, 'delivery_method', allowed(query.delivery_method, DELIVERY_METHODS, ''));
  const postedWithin = allowed(query.posted_within, ['1', '7', '30', '90'], '');
  appendText(params, 'posted_within', postedWithin);
  const sort = allowed(query.sort, ['newest', 'price_asc', 'price_desc', 'popular'], 'newest');
  if (sort !== 'newest') params.append('sort', sort);
  appendText(params, 'cursor', query.cursor);
  return params.toString();
}

function ordersQuery(tab) {
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (tab !== 'all') params.set('status', tab);
  return params.toString();
}

function translateMarketplaceMessage(req, translationKey, fallbackMessage) {
  if (!translationKey) return fallbackMessage;

  const requestTranslator = typeof req?.t === 'function'
    ? req.t
    : fallbackTranslator;
  const translated = requestTranslator(translationKey);
  return typeof translated === 'string' && translated !== '' && translated !== translationKey
    ? translated
    : fallbackMessage;
}

function statusEntry(req, status) {
  const key = trimmed(status);
  if (MARKETPLACE_SUCCESS_MESSAGES[key]) {
    return {
      type: 'success',
      message: translateMarketplaceMessage(
        req,
        MARKETPLACE_SUCCESS_MESSAGE_KEYS[key],
        MARKETPLACE_SUCCESS_MESSAGES[key]
      )
    };
  }
  if (MARKETPLACE_ERROR_MESSAGES[key]) {
    return {
      type: 'error',
      message: translateMarketplaceMessage(
        req,
        MARKETPLACE_ERROR_MESSAGE_KEYS[key],
        MARKETPLACE_ERROR_MESSAGES[key]
      )
    };
  }
  return null;
}

function formOptions() {
  return {
    priceTypes: PRICE_TYPES.map((value) => ({
      value,
      label: PRICE_TYPE_LABELS[value],
      labelKey: `govuk_alpha_commerce.listing_form.price_type_${value}`
    })),
    conditions: CONDITIONS.map((value) => ({
      value,
      label: CONDITION_LABELS[value],
      labelKey: `govuk_alpha_commerce.listing_form.condition_${value}`
    })),
    deliveryMethods: DELIVERY_METHODS.map((value) => ({
      value,
      label: DELIVERY_METHOD_LABELS[value],
      labelKey: `govuk_alpha_commerce.listing_form.delivery_${value}`
    }))
  };
}

function reportReasons(req) {
  return REPORT_REASONS.map((value) => ({
    value,
    label: translateMarketplaceMessage(
      req,
      `govuk_alpha_commerce.report.reason_${value}`,
      REPORT_REASON_LABELS[value]
    )
  }));
}

async function loadCategories(token) {
  const result = await callMarketplace(token, 'GET', '/categories');
  return rowsFrom(result).map(decorateCategory);
}

async function loadListing(token, id) {
  const result = await callMarketplace(token, 'GET', `/listings/${id}`);
  const listing = objectFrom(result);
  if (!listing) {
    throw new ApiError('Listing not found', 404);
  }
  return decorateListing(listing);
}

function listingRowsFrom(result) {
  return {
    rows: rowsFrom(result).map(decorateListing),
    meta: metaFrom(result)
  };
}

function countsByStatus(listings) {
  return listings.reduce((counts, listing) => {
    const status = trimmed(listing.status);
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    return counts;
  }, { active: 0, draft: 0, sold: 0, expired: 0 });
}

function advancedSearchState(query) {
  const selectedConditions = arrayFrom(query.condition)
    .map((value) => allowed(value, CONDITIONS, ''))
    .filter(Boolean);
  return {
    query: trimmed(query.q),
    categoryId: positiveInteger(query.category_id),
    priceMin: trimmed(query.price_min),
    priceMax: trimmed(query.price_max),
    selectedConditions,
    sellerType: allowed(query.seller_type, ['private', 'business'], ''),
    deliveryMethod: allowed(query.delivery_method, DELIVERY_METHODS, ''),
    postedWithin: allowed(query.posted_within, ['1', '7', '30', '90'], ''),
    sort: allowed(query.sort, ['newest', 'price_asc', 'price_desc', 'popular'], 'newest')
  };
}

function advancedSearchOptions() {
  return {
    conditionOptions: CONDITIONS.map((value) => ({ value, label: CONDITION_LABELS[value] })),
    deliveryOptions: [
      { value: '', label: 'Any' },
      { value: 'pickup', label: 'Collection only' },
      { value: 'shipping', label: 'Postage' },
      { value: 'both', label: 'Collection or postage' },
      { value: 'community_delivery', label: 'Community delivery' }
    ],
    sellerTypeOptions: [
      { value: '', label: 'Any' },
      { value: 'private', label: 'Private seller' },
      { value: 'business', label: 'Business' }
    ],
    postedWithinOptions: [
      { value: '', label: 'Any time' },
      { value: '1', label: 'Last 24 hours' },
      { value: '7', label: 'Last 7 days' },
      { value: '30', label: 'Last 30 days' },
      { value: '90', label: 'Last 90 days' }
    ],
    sortOptions: [
      { value: 'newest', label: 'Newest first' },
      { value: 'price_asc', label: 'Price: low to high' },
      { value: 'price_desc', label: 'Price: high to low' },
      { value: 'popular', label: 'Most popular' }
    ]
  };
}

function tenantCurrency(req) {
  const configuredCurrency = trimmed(req.accessibleRouting?.tenant?.settings?.default_currency).toUpperCase();
  return /^[A-Z]{3}$/.test(configuredCurrency) ? configuredCurrency : 'EUR';
}

function blankListing(defaultCurrency = 'EUR') {
  return decorateListing({
    price_type: 'fixed',
    price_currency: defaultCurrency,
    delivery_method: 'pickup',
    quantity: 1
  });
}

function consumeListingFormState(req, key) {
  const state = req.session?.marketplaceListingForms?.[key];
  if (state && req.session?.marketplaceListingForms) {
    delete req.session.marketplaceListingForms[key];
  }
  return state && typeof state === 'object' ? state : null;
}

function couponFormSessionKey(req, key) {
  const tenantSlug = trimmed(
    req.accessibleRouting?.tenant?.slug
      || req.accessibleRouting?.tenantSlug
      || 'default'
  );
  return `marketplaceCouponForm:${tenantSlug}:${key}`;
}

function consumeCouponFormState(req, key) {
  const sessionKey = couponFormSessionKey(req, key);
  const state = req.session?.[sessionKey];
  if (state && req.session) delete req.session[sessionKey];
  return state && typeof state === 'object' ? state : null;
}

function couponFormErrors(req, state) {
  if (!Array.isArray(state?.errors)) return [];
  return state.errors.map((error) => {
    if (error && typeof error === 'object' && error.key) {
      return translateMarketplaceMessage(req, error.key, error.key);
    }
    if (error && typeof error === 'object') return trimmed(error.text, 2000);
    return trimmed(error, 2000);
  }).filter(Boolean);
}

function couponDiscountTypeOptions(req) {
  return COUPON_DISCOUNT_TYPES.map((value) => ({
    value,
    label: translateMarketplaceMessage(
      req,
      `govuk_alpha_commerce.coupons.discount_type_${value}`,
      COUPON_DISCOUNT_LABELS[value]
    )
  }));
}

function couponStatusOptions(req) {
  return COUPON_STATUSES.map((value) => ({
    value,
    label: translateMarketplaceMessage(
      req,
      `govuk_alpha_commerce.coupons.status_${value}`,
      COUPON_STATUS_LABELS[value]
    )
  }));
}

function onboardingFormSessionKey(req) {
  const tenantSlug = trimmed(
    req.accessibleRouting?.tenant?.slug
      || req.accessibleRouting?.tenantSlug
      || 'default'
  );
  return `marketplaceOnboardingForm:${tenantSlug}`;
}

function consumeOnboardingFormState(req) {
  const sessionKey = onboardingFormSessionKey(req);
  const state = req.session?.[sessionKey];
  if (state && req.session) delete req.session[sessionKey];
  return state && typeof state === 'object' ? state : null;
}

function onboardingFormErrors(req, state) {
  if (!Array.isArray(state?.errorKeys)) return [];
  return state.errorKeys
    .map((key) => translateMarketplaceMessage(req, key, key))
    .filter(Boolean);
}

function reportFormSessionKey(req, id) {
  const tenantSlug = trimmed(
    req.accessibleRouting?.tenant?.slug
      || req.accessibleRouting?.tenantSlug
      || 'default'
  );
  return `marketplaceReportForm:${tenantSlug}:${id}`;
}

function consumeReportFormState(req, id) {
  const sessionKey = reportFormSessionKey(req, id);
  const state = req.session?.[sessionKey];
  if (state && req.session) delete req.session[sessionKey];
  return state && typeof state === 'object' ? state : null;
}

function reportFormErrors(req, state) {
  if (!Array.isArray(state?.errors)) return [];
  return state.errors.map((error) => ({
    field: error.field === 'reason' ? 'reason' : 'description',
    message: error.text || translateMarketplaceMessage(req, error.key, error.key)
  }));
}

function listingFormErrors(req, state, status) {
  if (Array.isArray(state?.errorKeys) && state.errorKeys.length > 0) {
    return state.errorKeys.map((key) => translateMarketplaceMessage(req, key, key));
  }
  const entry = statusEntry(req, status);
  return entry?.type === 'error' ? [entry.message] : [];
}

router.get('/', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const [listingResult, categories] = await Promise.all([
      callMarketplace(token, 'GET', `/listings?${indexQuery(req.query)}`),
      loadCategories(token)
    ]);
    return res.render('marketplace/index', {
      title: 'Marketplace',
      titleKey: 'marketplace.title',
      activeNav: 'explore',
      activeTab: 'browse',
      listings: rowsFrom(listingResult).map(decorateListing),
      categories,
      query: trimmed(req.query.q),
      categoryId: positiveInteger(req.query.category_id),
      status: statusEntry(req, req.query.status)
    });
  } catch (error) {
    return renderMarketplaceError(error, res);
  }
}));

router.get('/create', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const categories = await loadCategories(token);
    const defaultCurrency = tenantCurrency(req);
    const formState = consumeListingFormState(req, 'create');
    return res.render('marketplace/form', {
      title: 'Create a listing',
      titleKey: 'govuk_alpha_commerce.listing_form.title_create',
      activeNav: 'explore',
      activeTab: 'mine',
      mode: 'create',
      isEdit: false,
      listing: { ...blankListing(defaultCurrency), ...(formState?.values || {}) },
      categories,
      action: '/marketplace/create',
      formErrors: listingFormErrors(req, formState, req.query.status),
      ...formOptions()
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Create a listing');
  }
}));

router.get('/mine', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const profile = dataFrom(await getRequestProfile(req, token)) || {};
    const currentUserId = positiveInteger(profile.id ?? profile.user_id);
    if (currentUserId === null) {
      throw new ApiError('Authenticated marketplace profile is missing an id.', 502);
    }
    const listingResult = await callMarketplace(
      token,
      'GET',
      `/listings?${myListingsQuery(currentUserId)}`
    );
    const allListings = rowsFrom(listingResult).map(decorateListing);
    const tab = allowed(req.query.tab, LISTING_STATUS_TABS, 'active');
    const counts = countsByStatus(allListings);
    return res.render('marketplace/manage', {
      title: 'My listings',
      titleKey: 'govuk_alpha_commerce.my_listings.title',
      activeNav: 'explore',
      activeTab: 'mine',
      listings: allListings.filter((listing) => trimmed(listing.status) === tab),
      tab,
      tabs: listingTabs(req, tab, counts),
      status: statusEntry(req, req.query.status)
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'My listings');
  }
}));

router.get('/saved', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const listingResult = await callMarketplace(token, 'GET', '/listings/saved?limit=50');
    const { rows: listings } = listingRowsFrom(listingResult);
    return res.render('marketplace/listing-list', {
      title: 'Saved items',
      titleKey: 'govuk_alpha_commerce.saved.title',
      activeNav: 'explore',
      activeTab: 'saved',
      listings,
      mode: 'saved',
      status: trimmed(req.query.status) === 'unsaved' ? statusEntry(req, 'unsaved') : null
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Saved items');
  }
}));

router.get('/free', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const listingResult = await callMarketplace(token, 'GET', '/listings/free?limit=50');
    const { rows: listings } = listingRowsFrom(listingResult);
    return res.render('marketplace/listing-list', {
      title: 'Free items',
      titleKey: 'govuk_alpha_commerce.free_items.title',
      activeNav: 'explore',
      activeTab: 'free',
      listings,
      mode: 'free',
      status: null
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Free items');
  }
}));

router.get('/category/:slug([A-Za-z0-9_-]+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const slug = trimmed(req.params.slug, 120);
  try {
    const categories = await loadCategories(token);
    const category = categories.find((item) => item.slug === slug);
    if (!category) throw new ApiError('Category not found', 404);
    const result = await callMarketplace(
      token,
      'GET',
      `/listings?${categoryListingsQuery(category.id, req.query)}`
    );
    const listingResult = listingRowsFrom(result);
    return res.render('marketplace/listing-list', {
      title: category.name,
      activeNav: 'explore',
      activeTab: 'browse',
      backHref: '/marketplace',
      listings: listingResult.rows,
      mode: 'category',
      query: trimmed(req.query.q),
      category,
      status: null
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Marketplace category');
  }
}));

router.get('/search', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const [listingResult, categories] = await Promise.all([
      callMarketplace(token, 'GET', `/listings?${advancedSearchQuery(req.query)}`),
      loadCategories(token)
    ]);
    const listings = listingRowsFrom(listingResult);
    return res.render('marketplace/search', {
      title: 'Advanced search',
      titleKey: 'govuk_alpha_commerce.marketplace_advanced.title',
      activeNav: 'explore',
      activeTab: 'browse',
      listings: listings.rows,
      categories,
      state: advancedSearchState(req.query),
      ...advancedSearchOptions()
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Advanced search');
  }
}));

router.get('/seller/:sellerId(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const [sellerResult, listingResult] = await Promise.all([
      callMarketplace(token, 'GET', `/sellers/${req.params.sellerId}`),
      callMarketplace(token, 'GET', `/sellers/${req.params.sellerId}/listings?per_page=50`)
    ]);
    const translate = typeof res.locals.t === 'function' ? res.locals.t : fallbackTranslator;
    const seller = decorateSeller(objectFrom(sellerResult), translate);
    return res.render('marketplace/seller', {
      title: seller.name,
      activeNav: 'explore',
      seller,
      listings: listingRowsFrom(listingResult).rows
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Seller profile');
  }
}));

router.get('/offers', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const tab = allowed(req.query.tab, OFFER_TABS, 'received');
  try {
    const result = tab === 'sent'
      ? await callMarketplace(token, 'GET', '/my-offers/sent?per_page=50')
      : await callMarketplace(token, 'GET', '/my-offers/received?per_page=50');
    return res.render('marketplace/offers', {
      title: 'My offers',
      titleKey: 'govuk_alpha_commerce.offers.title',
      activeNav: 'explore',
      activeTab: 'offers',
      tab,
      offers: rowsFrom(result).map((offer) => decorateOffer(offer, tab, res.locals.t)),
      status: statusEntry(req, req.query.status)
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'My offers');
  }
}));

router.get('/offers/:id(\\d+)/buy', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;
  const id = Number(req.params.id);
  try {
    const checkout = await acceptedOfferCheckout(token, id);
    if (checkout.existingOrder) return redirectTo(res, '/marketplace/orders?status=ordered');
    let idempotencyKey = trimmed(req.session[acceptedOfferSessionKey(id)], 100);
    if (idempotencyKey.length < 16 || req.session[acceptedOfferCompletedSessionKey(id)]) {
      idempotencyKey = `accessible-marketplace-offer-${randomUUID()}`;
      req.session[acceptedOfferSessionKey(id)] = idempotencyKey;
      req.session[acceptedOfferCompletedSessionKey(id)] = false;
    }
    const buyError = req.session[acceptedOfferErrorSessionKey(id)] || null;
    delete req.session[acceptedOfferErrorSessionKey(id)];
    return res.render('marketplace/buy', {
      title: res.locals.t('govuk_alpha_commerce.buy.accepted_offer_title'),
      activeNav: 'explore',
      item: checkout.item,
      acceptedOfferCheckout: true,
      shippingOptions: checkout.shippingOptions,
      pickupSlots: checkout.pickupSlots,
      idempotencyKey,
      buyError,
      oldInput: buyError?.oldInput || {},
      formAction: `/marketplace/offers/${id}/buy`,
      backUrl: '/marketplace/offers?tab=sent',
      backLabel: res.locals.t('govuk_alpha_commerce.common.back_to_offers'),
      cancelUrl: '/marketplace/offers?tab=sent'
    });
  } catch (error) {
    return renderMarketplaceError(error, res, res.locals.t('govuk_alpha_commerce.buy.accepted_offer_title'));
  }
}));

async function ordersViewModel(req, res, role) {
  const token = requireToken(req, res);
  if (!token) return null;

  const isSeller = role === 'seller';
  const allowedTabs = isSeller ? SELLER_ORDER_TABS : BUYER_ORDER_TABS;
  const tab = allowed(req.query.tab, allowedTabs, 'all');
  const translate = typeof res.locals.t === 'function' ? res.locals.t : fallbackTranslator;
  try {
    const result = isSeller
      ? await callMarketplace(token, 'GET', `/orders/sales?${ordersQuery(tab)}`)
      : await callMarketplace(token, 'GET', `/orders/purchases?${ordersQuery(tab)}`);
    return {
      title: isSeller ? 'Sales' : 'My orders',
      titleKey: isSeller
        ? 'govuk_alpha_commerce.orders_seller.title'
        : 'govuk_alpha_commerce.orders_buyer.title',
      activeNav: 'explore',
      activeTab: isSeller ? 'sales' : 'orders',
      role,
      isSeller,
      tab,
      tabs: allowedTabs.map((value) => ({
        value,
        label: translate(`govuk_alpha_commerce.orders.tab_${value}`),
        href: `${isSeller ? '/marketplace/sales' : '/marketplace/orders'}?tab=${value}`,
        active: value === tab
      })),
      orders: rowsFrom(result).map((order) => decorateOrder(order, role, translate)),
      status: statusEntry(req, req.query.status)
    };
  } catch (error) {
    renderMarketplaceError(error, res, isSeller ? 'Sales' : 'My orders');
    return null;
  }
}

router.get('/orders', asyncRoute(async (req, res) => {
  const viewModel = await ordersViewModel(req, res, 'buyer');
  return viewModel ? res.render('marketplace/orders', viewModel) : undefined;
}));
router.get('/sales', asyncRoute(async (req, res) => {
  const viewModel = await ordersViewModel(req, res, 'seller');
  return viewModel ? res.render('marketplace/orders', viewModel) : undefined;
}));

router.get('/pickups', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const result = await callMarketplace(token, 'GET', '/me/pickups');
    return res.render('marketplace/pickups', {
      title: 'My collections',
      titleKey: 'govuk_alpha_commerce.pickups.title',
      activeNav: 'explore',
      activeTab: 'orders',
      reservations: rowsFrom(result).map((reservation) => decorateReservation(reservation, res.locals.t))
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'My collections');
  }
}));

router.get('/onboarding', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const result = await callMerchantOnboardingApi(token, 'GET', '/status').catch((error) => {
      if (isAuthError(error)) {
        throw error;
      }
      return {};
    });
    const onboarding = onboardingProfile(result);
    const formState = consumeOnboardingFormState(req);
    const statusKey = trimmed(req.query.status);
    return res.render('marketplace/onboarding', {
      title: 'Become a seller',
      titleKey: 'govuk_alpha_commerce.onboarding.title',
      activeNav: 'explore',
      activeTab: 'sell',
      sellerTypes: SELLER_TYPES.map((value) => ({
        value,
        label: translateMarketplaceMessage(
          req,
          `govuk_alpha_commerce.onboarding.seller_type_${value}`,
          SELLER_TYPE_LABELS[value]
        )
      })),
      ...onboarding,
      profile: { ...onboarding.profile, ...(formState?.profile || {}) },
      address: { ...onboarding.address, ...(formState?.address || {}) },
      formErrors: onboardingFormErrors(req, formState),
      status: ['onboarding-complete', 'onboarding-failed'].includes(statusKey)
        ? statusEntry(req, statusKey)
        : null
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Become a seller');
  }
}));

router.get('/slots', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const slots = await loadPickupSlots(token);
    return res.render('marketplace/slots', {
      title: 'Pickup slots',
      titleKey: 'govuk_alpha_commerce.slots.title',
      activeNav: 'explore',
      activeTab: 'slots',
      slots,
      emptySlot: {
        slotStartInput: '',
        slotEndInput: '',
        capacity: 5,
        isRecurring: false,
        isActive: true
      },
      status: statusEntry(req, req.query.status),
      orderReference: positiveInteger(req.query.order_id)
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Pickup slots');
  }
}));

router.get('/slots/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const slot = await loadPickupSlot(token, req.params.id);
    return res.render('marketplace/slot-form', {
      title: 'Edit pickup slot',
      titleKey: 'govuk_alpha_commerce.slots.title_edit',
      activeNav: 'explore',
      activeTab: 'slots',
      slot,
      action: `/marketplace/slots/${slot.id}/update`,
      submitLabel: 'Save changes',
      status: statusEntry(req, req.query.status)
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Edit pickup slot');
  }
}));

router.get('/coupons', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const coupons = await loadSellerCoupons(token, req);
    const statusKey = trimmed(req.query.status);
    return res.render('marketplace/coupons', {
      title: 'My coupons',
      titleKey: 'govuk_alpha_commerce.coupons.title',
      activeNav: 'explore',
      activeTab: 'sell',
      coupons,
      status: ['coupon-created', 'coupon-deleted', 'coupon-delete-failed'].includes(statusKey)
        ? statusEntry(req, statusKey)
        : null
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'My coupons');
  }
}));

router.get('/coupons/new', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const formState = consumeCouponFormState(req, 'create');
  return res.render('marketplace/coupon-form', {
    title: 'Create a coupon',
    titleKey: 'govuk_alpha_commerce.coupons.title_create',
    activeNav: 'explore',
    activeTab: 'sell',
    mode: 'create',
    isEdit: false,
    coupon: {
      ...decorateCoupon({ discount_type: 'percent', status: 'draft' }, req),
      ...(formState?.values || {})
    },
    action: '/marketplace/coupons/new',
    discountTypes: couponDiscountTypeOptions(req),
    statuses: couponStatusOptions(req),
    formErrors: couponFormErrors(req, formState),
    status: null
  });
}));

router.get('/coupons/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const coupon = await loadSellerCoupon(token, req.params.id, req);
    const formState = consumeCouponFormState(req, `edit:${coupon.id}`);
    const statusKey = trimmed(req.query.status);
    return res.render('marketplace/coupon-form', {
      title: 'Edit your coupon',
      titleKey: 'govuk_alpha_commerce.coupons.title_edit',
      activeNav: 'explore',
      activeTab: 'sell',
      mode: 'edit',
      isEdit: true,
      coupon: { ...coupon, ...(formState?.values || {}) },
      action: `/marketplace/coupons/${coupon.id}/update`,
      discountTypes: couponDiscountTypeOptions(req),
      statuses: couponStatusOptions(req),
      formErrors: couponFormErrors(req, formState),
      status: ['coupon-saved', 'coupon-save-failed'].includes(statusKey)
        ? statusEntry(req, statusKey)
        : null
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Edit your coupon');
  }
}));

router.get('/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const [listing, categories] = await Promise.all([
      loadListing(token, req.params.id),
      loadCategories(token)
    ]);
    const formState = consumeListingFormState(req, `edit:${listing.id}`);
    return res.render('marketplace/form', {
      title: 'Edit your listing',
      titleKey: 'govuk_alpha_commerce.listing_form.title_edit',
      activeNav: 'explore',
      activeTab: 'mine',
      mode: 'edit',
      isEdit: true,
      listing: { ...listing, ...(formState?.values || {}) },
      categories,
      action: `/marketplace/${listing.id}/update`,
      formErrors: listingFormErrors(req, formState, req.query.status),
      ...formOptions()
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Edit your listing');
  }
}));

router.get('/:id(\\d+)/buy', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const id = Number(req.params.id);
    const checkout = await directBuyCheckout(token, id);
    let idempotencyKey = trimmed(req.session[directBuySessionKey(id)], 100);
    if (idempotencyKey.length < 16 || req.session[directBuyCompletedSessionKey(id)]) {
      idempotencyKey = `accessible-marketplace-${randomUUID()}`;
      req.session[directBuySessionKey(id)] = idempotencyKey;
      req.session[directBuyCompletedSessionKey(id)] = false;
    }
    const buyError = req.session[directBuyErrorSessionKey(id)] || null;
    delete req.session[directBuyErrorSessionKey(id)];
    return res.render('marketplace/buy', {
      title: 'Confirm your purchase',
      titleKey: 'govuk_alpha_commerce.buy.title',
      activeNav: 'explore',
      item: checkout.item,
      shippingOptions: checkout.shippingOptions,
      pickupSlots: checkout.pickupSlots,
      idempotencyKey,
      buyError,
      oldInput: buyError?.oldInput || {},
      status: buyError ? null : statusEntry(req, req.query.status)
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Confirm your purchase');
  }
}));

router.get('/:id(\\d+)/offer', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const listing = await loadListing(token, req.params.id);
    if (listing.isOwnItem) throw new ApiError('Cannot offer on own listing', 403);
    const replay = req.session?.[offerFormSessionKey(listing.id)] || null;
    if (req.session) delete req.session[offerFormSessionKey(listing.id)];
    const status = statusEntry(req, req.query.status);
    return res.render('marketplace/offer', {
      title: 'Make an offer',
      titleKey: 'govuk_alpha_commerce.offer.title',
      activeNav: 'explore',
      item: listing,
      offerErrors: status?.type === 'error' ? [status.message] : [],
      oldInput: replay || {}
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Make an offer');
  }
}));

router.get('/:id(\\d+)/report', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const listing = await loadListing(token, req.params.id);
    const formState = consumeReportFormState(req, listing.id);
    const errors = reportFormErrors(req, formState);
    return res.render('marketplace/report', {
      title: 'Report a listing',
      titleKey: 'govuk_alpha_commerce.report.title',
      activeNav: 'explore',
      item: listing,
      reasons: reportReasons(req),
      oldInput: formState?.values || {},
      reportErrors: errors,
      reasonError: errors.find((error) => error.field === 'reason') || null,
      descriptionError: errors.find((error) => error.field === 'description') || null
    });
  } catch (error) {
    return renderMarketplaceError(error, res, 'Report a listing');
  }
}));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const listing = await loadListing(token, req.params.id);
    return res.render('marketplace/detail', {
      title: listing.title,
      activeNav: 'explore',
      item: listing,
      status: statusEntry(req, req.query.status)
    });
  } catch (error) {
    return renderMarketplaceError(error, res);
  }
}));

module.exports = router;
