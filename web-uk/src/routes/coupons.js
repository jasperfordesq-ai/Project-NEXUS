// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callCouponApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

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

function trimmed(value) {
  return String(value || '').trim();
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function itemFrom(result) {
  const data = dataFrom(result);
  if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  return {};
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function discountLabel(coupon, t) {
  const value = formatNumber(coupon.discount_value ?? coupon.discountValue);
  if (value === '') return '';
  const type = trimmed(coupon.discount_type ?? coupon.discountType).toLowerCase();
  return ['percentage', 'percent'].includes(type)
    ? t('coupons.percent_off', { value })
    : t('coupons.amount_off', { value });
}

function formatDate(value) {
  const text = trimmed(value);
  if (text === '') return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function merchantName(coupon) {
  const merchant = coupon.merchant && typeof coupon.merchant === 'object' ? coupon.merchant : {};
  return trimmed(merchant.name || coupon.merchant_name || coupon.merchantName);
}

function normalizeCoupon(item, t) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const code = trimmed(row.code);
  return {
    ...row,
    id,
    code,
    title: trimmed(row.title) || code || t('coupons.title'),
    description: trimmed(row.description),
    discountLabel: discountLabel(row, t),
    validUntilText: formatDate(row.valid_until ?? row.validUntil),
    merchantName: merchantName(row)
  };
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const result = await callCouponApi(token, 'GET', '');
  const coupons = collectionFrom(result)
    .map((coupon) => normalizeCoupon(coupon, res.locals.t)).filter((coupon) => coupon.id !== null);

  return res.render('coupons/index', {
    title: res.locals.t('coupons.title'),
    activeNav: 'explore',
    coupons
  });
}, { redirectOn401: loginRedirect() }));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const result = await callCouponApi(token, 'GET', `/${id}`);
  const coupon = normalizeCoupon(itemFrom(result), res.locals.t);

  return res.render('coupons/detail', {
    title: coupon.title,
    activeNav: 'explore',
    coupon
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Coupon not found' }));

module.exports = router;
