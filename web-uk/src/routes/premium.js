// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  getMemberPremiumTiers,
  getMemberPremiumMe,
  createMemberPremiumCheckout,
  createMemberPremiumPortal,
  cancelMemberPremium,
  ApiError,
  ApiOfflineError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function localUrl(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return urlFor(pathname);
}

function redirectTo(res, pathname) {
  return res.redirect(localUrl(res, pathname));
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function requireToken(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, loginRedirect());
    return null;
  }

  return token;
}

function redirectAuthIfNeeded(error, res) {
  if (error instanceof ApiError && error.status === 401) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

function renderPremiumError(error, res, title = 'Donate') {
  if (redirectAuthIfNeeded(error, res)) return true;

  if (error instanceof ApiError && error.status === 404) {
    res.status(404).render('errors/404', { title: 'Page not found' });
    return true;
  }

  if (error instanceof ApiOfflineError || error instanceof ApiError) {
    res.status(503).render('errors/503', { title });
    return true;
  }

  return false;
}

function normaliseInterval(value) {
  const raw = String(value || '').trim();
  return raw === 'yearly' || raw === 'year' ? 'yearly' : 'monthly';
}

function positiveInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data && typeof result.data === 'object'
    ? result.data
    : result;
}

function listTiers(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.tiers)) return data.tiers;
  if (result && Array.isArray(result.tiers)) return result.tiers;
  return [];
}

function trimmed(value) {
  return String(value || '').trim();
}

function tenantCurrency(req) {
  const configured = trimmed(req.accessibleRouting?.tenant?.settings?.default_currency).toUpperCase();
  return /^[A-Z]{3}$/.test(configured) ? configured : 'EUR';
}

function priceFromCents(value, currency) {
  const cents = Number(value || 0);
  if (!Number.isFinite(cents) || cents <= 0) return '';
  const prefix = {
    EUR: '\u20ac',
    USD: '$',
    GBP: '\u00a3'
  }[currency] || `${currency} `;
  return `${prefix}${(cents / 100).toFixed(2)}`;
}

function normalizeTier(tier, t, currency) {
  return {
    ...tier,
    id: positiveInteger(tier.id) || 0,
    name: trimmed(tier.name) || t('premium.title'),
    description: trimmed(tier.description),
    monthlyPrice: priceFromCents(tier.monthly_price_cents, currency),
    yearlyPrice: priceFromCents(tier.yearly_price_cents, currency),
    defaultInterval: Number(tier.yearly_price_cents || 0) > 0 && Number(tier.monthly_price_cents || 0) <= 0 ? 'yearly' : 'monthly',
    features: Array.isArray(tier.features) ? tier.features.map(trimmed).filter(Boolean) : []
  };
}

function premiumMe(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' ? data : {};
}

function currentTierName(me) {
  const tier = me.entitled_tier && typeof me.entitled_tier === 'object' ? me.entitled_tier : {};
  const subscription = me.subscription && typeof me.subscription === 'object' ? me.subscription : {};
  return trimmed(tier.tier_name || tier.name || subscription.tier_name || subscription.name);
}

function normalizeSubscription(subscription, t) {
  if (!subscription || typeof subscription !== 'object') return null;

  const rawStatus = trimmed(subscription.status) || 'unknown';
  const interval = trimmed(subscription.billing_interval || subscription.interval);
  return {
    ...subscription,
    tierName: trimmed(subscription.tier_name || subscription.name) || t('premium.title'),
    status: rawStatus,
    statusLabel: {
      active: t('govuk_alpha_commerce.premium_manage.status_active'),
      cancelled: t('govuk_alpha_commerce.premium_manage.status_cancelled'),
      canceled: t('govuk_alpha_commerce.premium_manage.status_cancelled'),
      past_due: t('govuk_alpha_commerce.premium_manage.status_past_due')
    }[rawStatus] || rawStatus,
    statusClass: rawStatus === 'active' ? 'govuk-tag--green' : 'govuk-tag--grey',
    intervalLabel: interval === 'yearly' || interval === 'year'
      ? t('govuk_alpha_commerce.premium_manage.interval_yearly')
      : t('govuk_alpha_commerce.premium_manage.interval_monthly'),
    currentPeriodEnd: trimmed(subscription.current_period_end),
    canceledAt: trimmed(subscription.canceled_at),
    features: Array.isArray(subscription.features) ? subscription.features.map(trimmed).filter(Boolean) : []
  };
}

const PRICING_STATUS_MESSAGES = {
  'subscribe-failed': { type: 'error', messageKey: 'premium.states.subscribe-failed' }
};

const MANAGE_STATUS_MESSAGES = {
  'cancel-scheduled': { type: 'success', messageKey: 'govuk_alpha_commerce.premium_manage.status_cancel_scheduled' },
  'cancel-failed': { type: 'error', messageKey: 'govuk_alpha_commerce.premium_manage.status_cancel_failed' },
  'portal-failed': { type: 'error', messageKey: 'govuk_alpha_commerce.premium_manage.status_portal_failed' }
};

function routeStatus(query, map, t) {
  const key = typeof query.status === 'string' ? query.status : '';
  return map[key] ? { key, type: map[key].type, message: t(map[key].messageKey) } : null;
}

function externalUrlFrom(result, key) {
  const value = dataFrom(result) && dataFrom(result)[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '';
}

router.get('/', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const [tiersResult, meResult] = await Promise.all([
      getMemberPremiumTiers(token),
      getMemberPremiumMe(token).catch((error) => {
        if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
        return { data: { subscription: null, entitled_tier: null, unlocked_features: [] } };
      })
    ]);
    const me = premiumMe(meResult);

    return res.render('premium/index', {
      title: res.locals.t('premium.title'),
      activeNav: 'explore',
      tiers: listTiers(tiersResult)
        .map((tier) => normalizeTier(tier, res.locals.t, tenantCurrency(req))).filter((tier) => tier.id > 0),
      currentTierName: currentTierName(me),
      status: routeStatus(req.query, PRICING_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (renderPremiumError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/manage', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const me = premiumMe(await getMemberPremiumMe(token));
    const subscription = normalizeSubscription(me.subscription, res.locals.t);
    if (subscription === null) {
      return redirectTo(res, '/premium?status=no-subscription');
    }

    return res.render('premium/manage', {
      title: res.locals.t('govuk_alpha_commerce.premium_manage.title'),
      activeNav: 'explore',
      subscription,
      status: routeStatus(req.query, MANAGE_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (renderPremiumError(error, res, 'Manage your support')) return undefined;
    throw error;
  }
}));

router.get('/return', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  let returnStatus = typeof req.query.status === 'string' ? req.query.status : '';
  if (!['success', 'pending', 'failed'].includes(returnStatus)) {
    returnStatus = 'failed';
  }

  try {
    const me = returnStatus === 'success' ? premiumMe(await getMemberPremiumMe(token)) : {};
    return res.render('premium/return', {
      title: res.locals.t('premium.title'),
      activeNav: 'explore',
      returnStatus,
      tierName: currentTierName(me)
    });
  } catch (error) {
    if (renderPremiumError(error, res, 'Support confirmation')) return undefined;
    throw error;
  }
}));

router.post('/subscribe', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const tierId = positiveInteger(req.body.tier_id);
  if (tierId === null) {
    return redirectTo(res, '/premium?status=subscribe-failed');
  }

  try {
    const result = await createMemberPremiumCheckout(token, {
      tier_id: tierId,
      interval: normaliseInterval(req.body.interval),
      return_url: localUrl(res, '/premium/return?status=success')
    });
    const checkoutUrl = externalUrlFrom(result, 'checkout_url');
    if (checkoutUrl !== '') {
      return res.redirect(checkoutUrl);
    }
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
  }

  return redirectTo(res, '/premium?status=subscribe-failed');
}));

router.post('/portal', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    const result = await createMemberPremiumPortal(token, {
      return_url: localUrl(res, '/premium/manage')
    });
    const portalUrl = externalUrlFrom(result, 'portal_url');
    if (portalUrl !== '') {
      return res.redirect(portalUrl);
    }
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
  }

  return redirectTo(res, '/premium/manage?status=portal-failed');
}));

router.post('/cancel', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let status = 'cancel-scheduled';
  try {
    await cancelMemberPremium(token);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'cancel-failed';
  }

  return redirectTo(res, `/premium/manage?status=${status}`);
}));

module.exports = router;
