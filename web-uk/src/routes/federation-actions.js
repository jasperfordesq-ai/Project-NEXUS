// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callFederationApi, ApiError } = require('../lib/api');
const { flagEnabled } = require('../lib/accessible-shell');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

const FEDERATION_ONBOARDING_STEPS = ['welcome', 'privacy', 'communication', 'confirm'];
const FEDERATION_ONBOARDING_SESSION_KEY = 'alphaFederationOnboarding';
const FEDERATION_ONBOARDING_DEFAULTS = {
  profile_visible_federated: true,
  appear_in_federated_search: true,
  show_skills_federated: true,
  show_location_federated: false,
  show_reviews_federated: true,
  messaging_enabled_federated: true,
  transactions_enabled_federated: true,
  email_notifications: true,
  service_reach: 'local_only',
  travel_radius_km: 25
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

function tenantFeatureEnabled(req, key, fallback = true) {
  const tenant = req.accessibleRouting?.tenant;
  if (!tenant || typeof tenant !== 'object') return fallback;
  return flagEnabled(tenant, key, 'features', fallback);
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function federationTenantId(value) {
  const text = trimmed(value, 32);
  if (/^ext-\d+$/i.test(text)) return text;
  return positiveInteger(text);
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

function onboardingStep(value) {
  const step = trimmed(value);
  return FEDERATION_ONBOARDING_STEPS.includes(step) ? step : 'welcome';
}

function onboardingTenantKey(req) {
  const tenant = req.accessibleRouting?.tenant;
  const tenantId = trimmed(tenant && tenant.id, 64);
  if (tenantId) return `id:${tenantId}`;

  const tenantSlug = trimmed(req.accessibleRouting?.tenantSlug || (tenant && tenant.slug), 128).toLowerCase();
  return `slug:${tenantSlug || 'default'}`;
}

function onboardingSessionStore(req, create = true) {
  if (!req.session) return null;

  const existing = req.session[FEDERATION_ONBOARDING_SESSION_KEY];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    if (!create) return null;
    req.session[FEDERATION_ONBOARDING_SESSION_KEY] = {};
  }

  return req.session[FEDERATION_ONBOARDING_SESSION_KEY];
}

function storedOnboardingSessionBag(req) {
  const store = onboardingSessionStore(req, false);
  if (!store) return null;

  const bag = store[onboardingTenantKey(req)];
  return bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : null;
}

function onboardingSessionBag(req) {
  return {
    ...FEDERATION_ONBOARDING_DEFAULTS,
    ...(storedOnboardingSessionBag(req) || {})
  };
}

function saveOnboardingSessionBag(req, settings) {
  const store = onboardingSessionStore(req);
  if (!store) return;
  store[onboardingTenantKey(req)] = { ...settings };
}

function clearOnboardingSessionBag(req) {
  const store = onboardingSessionStore(req, false);
  if (!store) return;

  delete store[onboardingTenantKey(req)];
  if (Object.keys(store).length === 0) {
    delete req.session[FEDERATION_ONBOARDING_SESSION_KEY];
  }
}

function legacyConfirmSettings(body, settings) {
  const keys = Object.keys(FEDERATION_ONBOARDING_DEFAULTS);
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(body, key))) return settings;

  const merged = { ...settings };
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (key === 'service_reach') {
      merged[key] = allowedServiceReach(body[key]);
    } else if (key === 'travel_radius_km') {
      merged[key] = boundedInteger(body[key], 0, 500, 25);
    } else {
      merged[key] = checked(body[key]);
    }
  }
  return merged;
}

async function callFederation(token, method, path, data = undefined) {
  if (data === undefined) {
    return callFederationApi(token, method, path);
  }

  return callFederationApi(token, method, path, data);
}

function statusRedirect(path, status) {
  return `${path}?status=${encodeURIComponent(status)}`;
}

function memberRedirect(memberId, tenantId, status) {
  return `/federation/members/${encodeURIComponent(memberId)}?tenant_id=${encodeURIComponent(tenantId)}&status=${encodeURIComponent(status)}`;
}

function transferRedirect(memberId, tenantId, status) {
  return `/federation/members/${encodeURIComponent(memberId)}/transfer?tenant_id=${encodeURIComponent(tenantId)}&status=${encodeURIComponent(status)}`;
}

function conversationRedirect(partnerId, tenantId, status, fragment = '') {
  return `/federation/messages/conversation/${encodeURIComponent(partnerId)}?tenant_id=${encodeURIComponent(tenantId)}&status=${encodeURIComponent(status)}${fragment}`;
}

function connectionListRedirect(tab, status) {
  return `/federation/connections?tab=${encodeURIComponent(tab)}&status=${encodeURIComponent(status)}`;
}

function allowedServiceReach(value) {
  const reach = trimmed(value);
  return ['local_only', 'remote_ok', 'travel_ok'].includes(reach) ? reach : 'local_only';
}

function federationSettingsPayload(body) {
  return {
    federation_optin: true,
    profile_visible_federated: checked(body.profile_visible_federated),
    appear_in_federated_search: checked(body.appear_in_federated_search),
    show_skills_federated: checked(body.show_skills_federated),
    show_location_federated: checked(body.show_location_federated),
    show_reviews_federated: checked(body.show_reviews_federated),
    messaging_enabled_federated: checked(body.messaging_enabled_federated),
    transactions_enabled_federated: checked(body.transactions_enabled_federated),
    email_notifications: checked(body.email_notifications),
    service_reach: allowedServiceReach(body.service_reach),
    travel_radius_km: boundedInteger(body.travel_radius_km, 0, 500, 25)
  };
}

function referenceMessageId(value) {
  const id = positiveInteger(value);
  return id === null ? undefined : id;
}

router.post('/connections', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const receiverId = positiveInteger(req.body.receiver_id);
  const receiverTenantId = federationTenantId(req.body.receiver_tenant_id);
  if (receiverId === null || receiverTenantId === null) {
    return redirectTo(res, statusRedirect('/federation/members', 'connect-failed'));
  }

  let status = 'connect-sent';
  try {
    await callFederation(token, 'POST', '/connections', {
      receiver_id: receiverId,
      receiver_tenant_id: receiverTenantId,
      message: trimmed(req.body.message, 1000)
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'connect-failed';
  }

  return redirectTo(res, memberRedirect(receiverId, receiverTenantId, status));
}));

router.post('/connections/:id(\\d+)/accept', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'connection-accepted';
  try {
    await callFederation(token, 'POST', `/connections/${id}/accept`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'connection-action-failed';
  }

  return redirectTo(res, connectionListRedirect('received', status));
}));

router.post('/connections/:id(\\d+)/reject', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'connection-rejected';
  try {
    await callFederation(token, 'POST', `/connections/${id}/reject`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'connection-action-failed';
  }

  return redirectTo(res, connectionListRedirect('received', status));
}));

router.post('/connections/:id(\\d+)/remove', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'connection-removed';
  try {
    await callFederation(token, 'DELETE', `/connections/${id}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'connection-action-failed';
  }

  return redirectTo(res, connectionListRedirect('accepted', status));
}));

router.post('/messages/translate/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const partnerId = positiveInteger(req.body.partner_id);
  const partnerTenantId = federationTenantId(req.body.partner_tenant_id);
  const back = partnerId === null || partnerTenantId === null
    ? statusRedirect('/federation/messages', 'translate-failed')
    : conversationRedirect(partnerId, partnerTenantId, 'translate-failed', `#message-${id}`);

  if (partnerId === null || partnerTenantId === null) return redirectTo(res, back);
  if (!tenantFeatureEnabled(req, 'message_translation', true)) {
    return redirectTo(res, conversationRedirect(partnerId, partnerTenantId, 'translate-unavailable', `#message-${id}`));
  }

  const targetLanguage = trimmed(req.body.target_language || req.body.target_locale || 'en', 10) || 'en';
  let status = 'translate-done';
  try {
    const result = await callFederation(token, 'POST', `/messages/${id}/translate`, {
      target_language: targetLanguage
    });
    const translatedText = trimmed((result && result.data && result.data.translated_text) || (result && result.translated_text), 10000);
    if (!translatedText) throw new Error('Translation response did not include translated text');
    if (req.session) req.session.federationTranslation = { id, text: translatedText, partnerId, partnerTenantId };
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'translate-failed';
  }

  return redirectTo(res, conversationRedirect(partnerId, partnerTenantId, status, `#message-${id}`));
}));

router.post('/messages', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const receiverId = positiveInteger(req.body.receiver_id);
  const receiverTenantId = federationTenantId(req.body.receiver_tenant_id);
  if (receiverId === null || receiverTenantId === null) {
    return redirectTo(res, statusRedirect('/federation/members', 'message-failed'));
  }

  const body = trimmed(req.body.body, 10000);
  const context = trimmed(req.body.context);
  const backPath = context === 'conversation'
    ? (status) => conversationRedirect(receiverId, receiverTenantId, status)
    : (status) => memberRedirect(receiverId, receiverTenantId, status);

  if (body === '') return redirectTo(res, backPath('message-empty'));

  const payload = {
    receiver_id: receiverId,
    receiver_tenant_id: receiverTenantId,
    subject: trimmed(req.body.subject, 255),
    body
  };
  const referenceId = referenceMessageId(req.body.reference_message_id);
  if (referenceId !== undefined) {
    payload.reference_message_id = referenceId;
  }

  let status = 'message-sent';
  try {
    await callFederation(token, 'POST', '/messages', payload);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = error instanceof ApiError && error.status === 422 ? 'message-too-long' : 'message-failed';
  }

  return redirectTo(res, backPath(status));
}));

router.post('/members/:id(\\d+)/transfer', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const receiverId = Number(req.params.id);
  const receiverTenantId = federationTenantId(req.body.receiver_tenant_id);
  if (receiverTenantId === null) {
    return redirectTo(res, statusRedirect('/federation/members', 'transfer-recipient-unavailable'));
  }

  const amount = positiveInteger(req.body.amount);
  if (amount === null || amount > 100) {
    return redirectTo(res, transferRedirect(receiverId, receiverTenantId, 'transfer-amount-invalid'));
  }

  const description = trimmed(req.body.description, 500);
  if (description === '') {
    return redirectTo(res, transferRedirect(receiverId, receiverTenantId, 'transfer-description-required'));
  }

  const idempotencyKey = trimmed(req.body.idempotency_key, 64);
  const payload = {
    receiver_id: receiverId,
    receiver_tenant_id: receiverTenantId,
    amount,
    description
  };
  if (idempotencyKey !== '') payload.idempotency_key = idempotencyKey;

  let status = 'transfer-sent';
  try {
    await callFederation(token, 'POST', '/transactions', payload);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'transfer-failed';
  }

  return redirectTo(res, memberRedirect(receiverId, receiverTenantId, status));
}));

router.post('/onboarding', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const step = onboardingStep(req.body.step);
  const nextSteps = {
    welcome: 'privacy',
    privacy: 'communication',
    communication: 'confirm'
  };
  const storedBag = storedOnboardingSessionBag(req);
  let settings = onboardingSessionBag(req);

  if (step === 'privacy') {
    for (const key of [
      'profile_visible_federated',
      'appear_in_federated_search',
      'show_skills_federated',
      'show_location_federated',
      'show_reviews_federated'
    ]) {
      settings[key] = checked(req.body[key]);
    }
  } else if (step === 'communication') {
    for (const key of [
      'messaging_enabled_federated',
      'transactions_enabled_federated',
      'email_notifications'
    ]) {
      settings[key] = checked(req.body[key]);
    }
    settings.service_reach = allowedServiceReach(req.body.service_reach);
    settings.travel_radius_km = boundedInteger(req.body.travel_radius_km, 0, 500, 25);
  } else if (step === 'confirm' && !storedBag) {
    // Keep compatibility with the former single-request form while the
    // multi-step wizard uses the tenant-scoped session bag as its authority.
    settings = legacyConfirmSettings(req.body, settings);
  }

  saveOnboardingSessionBag(req, settings);

  if (step !== 'confirm') {
    return redirectTo(res, `/federation/onboarding?step=${encodeURIComponent(nextSteps[step])}`);
  }

  try {
    await callFederation(token, 'POST', '/setup', federationSettingsPayload(settings));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, '/federation/onboarding?step=confirm&status=optin-failed');
  }

  clearOnboardingSessionBag(req);
  return redirectTo(res, statusRedirect('/federation', 'opted-in'));
}));

router.post('/opt-in', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const submittedPreferences = checked(req.body.preferences_submitted);
  const payload = submittedPreferences
    ? federationSettingsPayload(req.body)
    : {
        federation_optin: true,
        profile_visible_federated: true,
        appear_in_federated_search: true,
        show_skills_federated: true,
        show_location_federated: false,
        show_reviews_federated: true,
        messaging_enabled_federated: true,
        transactions_enabled_federated: true,
        email_notifications: true,
        service_reach: 'local_only',
        travel_radius_km: 25
      };

  let status = 'opted-in';
  try {
    await callFederation(token, 'POST', '/setup', payload);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'optin-failed';
  }

  return redirectTo(res, statusRedirect('/federation', status));
}));

router.post('/opt-out', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let status = 'opted-out';
  try {
    await callFederation(token, 'POST', '/opt-out');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'optout-failed';
  }

  return redirectTo(res, statusRedirect('/federation', status));
}));

router.post('/settings', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  let status = 'settings-saved';
  try {
    await callFederation(token, 'PUT', '/settings', federationSettingsPayload(req.body));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'settings-failed';
  }

  return redirectTo(res, statusRedirect('/federation/settings', status));
}));

module.exports = router;
