// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const {
  updateProfile,
  uploadProfileAvatar,
  getOnboardingStatus,
  getOnboardingConfig,
  getOnboardingCategories,
  getOnboardingSafeguardingOptions,
  saveOnboardingSafeguarding,
  completeOnboarding,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');
const { resolveBackendAssetUrl } = require('../lib/accessible-shell');

const router = express.Router();
const SESSION_KEY = 'alphaOnboarding';
const DEFAULT_STEPS = ['welcome', 'profile', 'interests', 'skills', 'safeguarding', 'confirm'];

function getBag(req) {
  if (!req.session) return {};
  req.session[SESSION_KEY] = req.session[SESSION_KEY] || {};
  return req.session[SESSION_KEY];
}

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function dataFrom(result) {
  return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : result;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
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

function normalizeSteps(rawSteps) {
  const steps = asArray(rawSteps)
    .map((step) => {
      const item = asObject(step);
      const slug = String(item.slug || '').trim();
      if (!DEFAULT_STEPS.includes(slug)) return null;
      return {
        slug,
        label: String(item.label || slug),
        required: Object.prototype.hasOwnProperty.call(item, 'required') ? Boolean(item.required) : true
      };
    })
    .filter(Boolean);

  return steps.length
    ? steps
    : DEFAULT_STEPS.map((slug) => ({ slug, label: slug, required: true }));
}

function normalizeCategory(category) {
  const item = asObject(category);
  return {
    id: Number(item.id) || 0,
    name: String(item.name || '').trim()
  };
}

function normalizeSafeguardingOption(option) {
  const item = asObject(option);
  return {
    id: Number(item.id) || 0,
    option_key: String(item.option_key || '').trim(),
    option_type: String(item.option_type || 'checkbox').trim() || 'checkbox',
    label: String(item.label || '').trim(),
    description: String(item.description || '').trim(),
    help_url: String(item.help_url || '').trim(),
    select_options: item.select_options && typeof item.select_options === 'object' ? item.select_options : {},
    is_required: Boolean(item.is_required)
  };
}

function statusBanner(status) {
  const messages = {
    'bio-too-short': { type: 'error', anchor: 'bio', message: 'Please add a short bio before continuing.' },
    'avatar-required': { type: 'error', anchor: 'avatar', message: 'Please add a profile photo before continuing.' },
    'avatar-failed': { type: 'error', anchor: 'avatar', message: 'We could not upload that photo. Please try again.' },
    'safeguarding-failed': { type: 'error', anchor: null, message: 'We could not save your answers. Please try again.' },
    'complete-failed': { type: 'error', anchor: null, message: 'Something went wrong. Please try again.' },
    'avatar-saved': { type: 'success', message: 'Your photo has been uploaded.' }
  };

  return messages[String(status || '').trim()] || null;
}

function collectIds(value) {
  return [...new Set(asArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0))];
}

function collectSafeguarding(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];

  return Object.entries(raw)
    .map(([optionId, value]) => ({
      option_id: Number(optionId),
      value: Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim()
    }))
    .filter((preference) => Number.isInteger(preference.option_id) && preference.option_id > 0 && preference.value);
}

function collectSafeguardingFromRaw(rawBody) {
  const preferences = [];
  const params = new URLSearchParams(String(rawBody || ''));

  for (const [key, value] of params.entries()) {
    const match = key.match(/^safeguarding\[(\d+)\]$/);
    const text = String(value || '').trim();
    if (match && text) {
      preferences.push({ option_id: Number(match[1]), value: text });
    }
  }

  return preferences.filter((preference) => Number.isInteger(preference.option_id) && preference.option_id > 0);
}

function collectSafeguardingFromBody(body, rawBody) {
  const raw = collectSafeguardingFromRaw(rawBody);
  if (raw.length > 0) return raw;

  const nested = collectSafeguarding(body.safeguarding);
  if (nested.length > 0) return nested;

  const flat = {};
  for (const [key, value] of Object.entries(body)) {
    const match = key.match(/^safeguarding\[(\d+)\]$/);
    if (match) flat[match[1]] = value;
  }
  return collectSafeguarding(flat);
}

function nextStep(step) {
  const index = DEFAULT_STEPS.indexOf(step);
  if (index === -1) return '/onboarding';
  return DEFAULT_STEPS[index + 1] ? `/onboarding/${DEFAULT_STEPS[index + 1]}` : '/dashboard?status=onboarding-complete';
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function completeFailureRedirect(error) {
  if (!(error instanceof ApiError)) {
    return '/onboarding/confirm?status=complete-failed';
  }

  const field = String(error.data?.field || '');
  const message = String(error.message || '');
  if (field === 'avatar_url' || /avatar/i.test(message)) {
    return '/onboarding/profile?status=avatar-required';
  }
  if (field === 'bio' || /bio/i.test(message)) {
    return '/onboarding/profile?status=bio-too-short';
  }
  return '/onboarding/confirm?status=complete-failed';
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');

  let status;
  let configData;
  try {
    status = asObject(dataFrom(await getOnboardingStatus(token)));
    if (status.onboarding_completed) return redirectTo(res, '/dashboard');
    configData = asObject(dataFrom(await getOnboardingConfig(token)));
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, '/login?status=auth-required');
    throw error;
  }

  const steps = normalizeSteps(configData.steps);
  return redirectTo(res, `/onboarding/${steps[0]?.slug || 'confirm'}`);
}));

router.get('/:step([a-z]+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');

  const step = String(req.params.step || '');
  let status;
  let configData;
  let categories = [];
  let safeguardingOptions = [];
  let onboardingUser = {};

  try {
    status = asObject(dataFrom(await getOnboardingStatus(token)));
    if (status.onboarding_completed) return redirectTo(res, '/dashboard');

    configData = asObject(dataFrom(await getOnboardingConfig(token)));
    const steps = normalizeSteps(configData.steps);
    const slugs = steps.map((item) => item.slug);
    if (!slugs.includes(step)) {
      return redirectTo(res, '/onboarding');
    }

    if (['interests', 'skills'].includes(step)) {
      categories = asArray(dataFrom(await getOnboardingCategories(token))).map(normalizeCategory).filter((item) => item.id && item.name);
    }

    if (step === 'safeguarding') {
      safeguardingOptions = asArray(dataFrom(await getOnboardingSafeguardingOptions(token)))
        .map(normalizeSafeguardingOption)
        .filter((item) => item.id && item.label);
    }

    if (['profile', 'confirm'].includes(step)) {
      const profile = asObject(dataFrom(await getRequestProfile(req, token)));
      onboardingUser = {
        ...profile,
        avatar_url: resolveBackendAssetUrl(profile.avatar_url || profile.avatarUrl)
      };
    }

    const stepIndex = slugs.indexOf(step);
    return res.render('onboarding/index', {
      title: res.locals.t('govuk_alpha.onboarding.title'),
      activeNav: 'dashboard',
      communityName: res.locals.tenantName || res.locals.serviceName || '',
      step,
      steps,
      stepIndex,
      stepNumber: stepIndex + 1,
      totalSteps: steps.length,
      stepRequired: Boolean(steps[stepIndex]?.required),
      config: asObject(configData.config),
      bag: getBag(req),
      categories,
      safeguardingOptions,
      onboardingUser,
      statusBanner: statusBanner(req.query && req.query.status)
    });
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, '/login?status=auth-required');
    throw error;
  }
}));

router.post('/avatar', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');

  const file = uploadedFile(req, 'avatar');
  if (!file) {
    return redirectTo(res, '/onboarding/profile?status=avatar-failed');
  }

  try {
    const buffer = await fs.readFile(file.filepath);
    await uploadProfileAvatar(token, {
      file: {
        buffer,
        filename: String(file.originalFilename || '').trim() || 'avatar',
        contentType: String(file.mimetype || '').trim() || 'application/octet-stream',
        size: file.size
      }
    });
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, '/login?status=auth-required');
    return redirectTo(res, '/onboarding/profile?status=avatar-failed');
  } finally {
    await removeUploadedFile(file);
  }

  return redirectTo(res, '/onboarding/profile?status=avatar-saved');
}));

router.post('/:step([a-z]+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');
  req.token = token;

  const step = String(req.params.step || '');
  if (!DEFAULT_STEPS.includes(step)) {
    return redirectTo(res, '/onboarding');
  }

  const bag = getBag(req);

  if (step === 'profile') {
    const bio = String(req.body.bio || '').trim();
    try {
      await updateProfile(req.token, { bio: bio || null });
    } catch (error) {
      if (isAuthError(error)) throw error;
      return redirectTo(res, '/onboarding/profile?status=bio-too-short');
    }
  }

  if (step === 'interests') {
    bag.interests = collectIds(req.body.interests);
  }

  if (step === 'skills') {
    bag.offers = collectIds(req.body.offers);
    bag.needs = collectIds(req.body.needs);
  }

  if (step === 'safeguarding') {
    const preferences = collectSafeguardingFromBody(req.body, req.rawUrlencodedBody);
    if (preferences.length > 0) {
      try {
        await saveOnboardingSafeguarding(req.token, preferences);
      } catch (error) {
        if (isAuthError(error)) throw error;
        return redirectTo(res, '/onboarding/safeguarding?status=safeguarding-failed');
      }
    }
  }

  if (step === 'confirm') {
    try {
      await completeOnboarding(req.token, {
        interests: collectIds(bag.interests),
        offers: collectIds(bag.offers),
        needs: collectIds(bag.needs)
      });
      if (req.session) delete req.session[SESSION_KEY];
      return redirectTo(res, '/dashboard?status=onboarding-complete');
    } catch (error) {
      if (isAuthError(error)) throw error;
      return redirectTo(res, completeFailureRedirect(error));
    }
  }

  return redirectTo(res, nextStep(step));
}));

module.exports = router;
