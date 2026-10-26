// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const { URL } = require('node:url');
const {
  updateProfile,
  uploadProfileAvatar,
  getOnboardingStatus,
  getOnboardingConfig,
  getOnboardingCategories,
  getOnboardingSafeguardingOptions,
  saveOnboardingSafeguarding,
  completeOnboarding,
  getUserSkills,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');
const { resolveBackendMediaUrl } = require('../lib/accessible-shell');

const router = express.Router();
const SESSION_KEY = 'alphaOnboarding';
// The "What are you interested in?" step was retired on 2026-10-02 (React
// 8578ce739): nothing on the platform read its answers, and the API now accepts
// and DROPS `interests`. A stale tenant config that still lists the slug is
// filtered out by normalizeSteps, so a member is never shown it.
const DEFAULT_STEPS = ['welcome', 'profile', 'skills', 'safeguarding', 'confirm'];

// Mirrors OnboardingService::SKILL_NAME_MAX / SKILLS_PER_DIRECTION_MAX. The
// server re-normalises; trimming here keeps the session bag small.
const SKILL_NAME_MAX = 100;
const SKILLS_PER_DIRECTION_MAX = 50;

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

// F-253 (F-207 residual): a help link becomes an `href` on the page every new
// member sees. Mirror the API's rule (SafeguardingPreferenceService::validateUrl):
// only a well-formed https:// URL on a dotted host is kept; anything else —
// javascript:, data:, http:, scheme-relative, control characters — is dropped.
function safeHelpUrl(value) {
  const raw = String(value || '').trim();
  // eslint-disable-next-line no-control-regex
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw) || !/^https:\/\//i.test(raw)) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) return '';
  return raw;
}

function normalizeSafeguardingOption(option) {
  const item = asObject(option);
  return {
    id: Number(item.id) || 0,
    option_key: String(item.option_key || '').trim(),
    option_type: String(item.option_type || 'checkbox').trim() || 'checkbox',
    label: String(item.label || '').trim(),
    description: String(item.description || '').trim(),
    help_url: safeHelpUrl(item.help_url),
    select_options: item.select_options && typeof item.select_options === 'object' ? item.select_options : {},
    is_required: Boolean(item.is_required),
    // Plain-language sentences, already translated by the API, saying what
    // choosing this option actually does. Rendered verbatim (autoescaped).
    effects: Array.isArray(item.effects)
      ? item.effects.filter((effect) => typeof effect === 'string').map((effect) => effect.trim()).filter(Boolean)
      : []
  };
}

/**
 * 🔴 The message comes from the CATALOGUE, not from a literal here.
 *
 * All six of these strings have existed under `govuk_alpha.onboarding.states.*`
 * — translated into all eleven languages — for as long as this wizard has. The
 * English literals that stood here were rendered straight into the page, so a
 * member setting up their account in Irish, Polish or Arabic met English error
 * messages on the very first thing they do here. Follows the same shape as
 * statusBanner() in blog-posts.js and federation.js.
 */
function statusBanner(status, t) {
  const banners = {
    'bio-too-short': { type: 'error', anchor: 'bio' },
    'location-required': { type: 'error', anchor: 'location' },
    'location-invalid': { type: 'error', anchor: 'location' },
    'avatar-required': { type: 'error', anchor: 'avatar' },
    'avatar-failed': { type: 'error', anchor: 'avatar' },
    'safeguarding-failed': { type: 'error', anchor: null },
    'complete-failed': { type: 'error', anchor: null },
    'avatar-saved': { type: 'success' }
  };

  const statusKey = String(status || '').trim();
  const banner = banners[statusKey];
  return banner
    ? { ...banner, message: t(`govuk_alpha.onboarding.states.${statusKey}`) }
    : null;
}

// Skill NAMES, as the member's skills are now stored (user_skills, which
// matching, Explore and the personalised feed read). Ticked suggestions arrive
// as `offers[]`/`needs[]`; the free-text "other" field is comma-separated.
// Case-insensitive de-duplication, first spelling kept — the server's rule.
function collectSkillNames(checked, other) {
  const names = [
    ...asArray(checked).map((item) => String(item || '')),
    // Latin, Arabic (U+060C) and Japanese (U+3001) commas, or new lines.
    ...String(other || '').split(/[,\n،、]/)
  ];
  const seen = new Map();
  for (const raw of names) {
    const clean = raw.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > SKILL_NAME_MAX) continue;
    const key = clean.toLocaleLowerCase();
    if (!seen.has(key)) seen.set(key, clean);
    if (seen.size >= SKILLS_PER_DIRECTION_MAX) break;
  }
  return [...seen.values()];
}

function skillFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

// Load the member's existing skills into the bag once, exactly as the React
// wizard pre-selects them. `skillsPrefilled` is what later allows the server to
// treat the submitted lists as the member's WHOLE set (replace=true); when the
// load fails we send replace=false so a failed read can never wipe skills.
async function prefillSkills(bag, token) {
  if (bag.skillsLoaded) return;
  bag.skillsLoaded = true;
  try {
    const mine = asArray(dataFrom(await getUserSkills(token, 'me'))).map(asObject);
    bag.offerSkills = collectSkillNames(mine.filter((item) => skillFlag(item.is_offering)).map((item) => item.skill_name));
    bag.needSkills = collectSkillNames(mine.filter((item) => skillFlag(item.is_requesting)).map((item) => item.skill_name));
    bag.skillsPrefilled = true;
  } catch (error) {
    if (isAuthError(error)) throw error;
    bag.offerSkills = bag.offerSkills || [];
    bag.needSkills = bag.needSkills || [];
    bag.skillsPrefilled = false;
  }
}

// Suggestions are the community's listing categories (by NAME), followed by any
// skill the member already has that is not a category, so they can untick it.
function skillChoices(categories, bag) {
  const choices = collectSkillNames([
    ...categories.map((category) => category.name),
    ...asArray(bag.offerSkills),
    ...asArray(bag.needSkills)
  ]);
  return choices.map((name, index) => ({ id: index + 1, name }));
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

// v2 endpoints nest the field at `data.errors[].field`; some older paths put it
// at `data.field`. Read both (see the note in completeFailureRedirect).
function apiErrorFields(error) {
  if (!(error instanceof ApiError)) return [];
  const fields = Array.isArray(error.data?.errors)
    ? error.data.errors.map((item) => String(item?.field || '')).filter(Boolean)
    : [];
  if (error.data?.field) fields.push(String(error.data.field));
  return fields;
}

function completeFailureRedirect(error) {
  if (!(error instanceof ApiError)) {
    return '/onboarding/confirm?status=complete-failed';
  }

  // 🔴 The field lives at `data.errors[0].field`, NOT `data.field` — that is the
  // shape every v2 endpoint returns and the shape ApiError is handed. Reading
  // the wrong level meant neither branch below could ever match.
  //
  // The message fallbacks could not save it either: the API says "Profile photo
  // is required to complete onboarding" and "Tell us a little about yourself",
  // neither of which contains "avatar" or "bio".
  //
  // The result was that a member who had not uploaded a photo pressed "Finish"
  // on the last step, was told "Something went wrong. Please try again.", and
  // had no way to discover that a photo was the thing missing. Retrying could
  // never work. And onboarding that never completes is not cosmetic: it is what
  // keeps a member's profile out of the member directory.
  const fields = Array.isArray(error.data?.errors)
    ? error.data.errors.map((item) => String(item?.field || '')).filter(Boolean)
    : [];
  if (error.data?.field) fields.push(String(error.data.field));
  const message = String(error.message || '');

  if (fields.includes('avatar_url') || fields.includes('avatar') || /avatar|profile photo/i.test(message)) {
    return '/onboarding/profile?status=avatar-required';
  }
  if (fields.includes('bio') || /(^|\W)bio(\W|$)|about yourself/i.test(message)) {
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

    if (step === 'skills') {
      categories = asArray(dataFrom(await getOnboardingCategories(token))).map(normalizeCategory).filter((item) => item.id && item.name);
    }

    if (['skills', 'confirm'].includes(step)) {
      await prefillSkills(getBag(req), token);
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
        avatar_url: resolveBackendMediaUrl(profile.avatar_url || profile.avatarUrl)
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
      skillChoices: step === 'skills' ? skillChoices(categories, getBag(req)) : [],
      safeguardingOptions,
      onboardingUser,
      statusBanner: statusBanner(req.query && req.query.status, res.locals.t)
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
    const payload = { bio: bio || null };

    // "Where are you based?" is only on the form for a member whose location is
    // empty (the server says so with `location_missing`), so the field being
    // posted at all is how we know it was asked. A blank answer is refused here
    // in the browser flow; the SERVER never forces a location, so older clients
    // and the API keep working without one.
    const locationAsked = Object.prototype.hasOwnProperty.call(req.body, 'location');
    const location = locationAsked ? String(req.body.location || '').trim().slice(0, 255) : '';
    if (location) payload.location = location;

    try {
      await updateProfile(req.token, payload);
    } catch (error) {
      if (isAuthError(error)) throw error;
      const fields = apiErrorFields(error);
      const message = error instanceof ApiError ? String(error.message || '') : '';
      // Our own translated message, keyed off the field — never the server's English.
      if (fields.includes('location')) {
        return redirectTo(res, '/onboarding/profile?status=location-invalid');
      }
      if (fields.includes('bio') || /bio/i.test(message)) {
        return redirectTo(res, '/onboarding/profile?status=bio-too-short');
      }
      return redirectTo(res, '/onboarding/profile?status=complete-failed');
    }

    // The bio above is saved first so a member who forgot the town does not lose
    // what they typed.
    if (locationAsked && !location) {
      return redirectTo(res, '/onboarding/profile?status=location-required');
    }
  }

  if (step === 'skills') {
    bag.offerSkills = collectSkillNames(req.body.offers, req.body.offers_other);
    bag.needSkills = collectSkillNames(req.body.needs, req.body.needs_other);
    bag.skillsSubmitted = true;
  }

  if (step === 'safeguarding') {
    // The template's "Skip" submit button posts skip=1. Honour it: skipping must
    // not persist any safeguarding selection the member may have ticked first —
    // this is sensitive, GDPR-noticed data, and "Skip" is a withdrawal of it.
    const preferences = req.body.skip
      ? []
      : collectSafeguardingFromBody(req.body, req.rawUrlencodedBody);
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
      // React sends `skills: {offer, need, replace}` and no interests. Skills
      // are only sent when the member actually answered the skills step; with
      // nothing to say, an empty body changes none of their skills.
      await completeOnboarding(req.token, bag.skillsSubmitted
        ? {
          skills: {
            offer: collectSkillNames(bag.offerSkills),
            need: collectSkillNames(bag.needSkills),
            replace: bag.skillsPrefilled === true
          }
        }
        : {});
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
// Exported for its own test: the message must come from the catalogue, and
// a wrong lookup path renders a raw key at a member.
module.exports.onboardingStatusBanner = statusBanner;

// Exported for its test (F-253): help links must be https before they reach href.
module.exports.normalizeSafeguardingOption = normalizeSafeguardingOption;
module.exports.collectSkillNames = collectSkillNames;
