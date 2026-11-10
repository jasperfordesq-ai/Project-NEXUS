// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * "Translate" only when a text is in another language than the reader's —
 * the server half of the rule (owner, 9 Nov 2026: "if my language is set to
 * English and the text is English, there's no need for a translate button").
 *
 * The word check (./index.js, shared with React and the phone app) settles
 * most texts. When it cannot be sure — short texts such as "Media Test Group" —
 * the React site asks the community's language service
 * (POST /api/v2/ugc-language, App\Services\Translation\ContentLanguageDetector;
 * react-frontend/src/lib/textLanguage/detectLanguage.ts). This module does the
 * same on the server, so the accessible site decides alike:
 *
 *  - Asked with the member's own token, never for a signed-out visitor, and
 *    never when the community has switched translation off.
 *  - 🔴 PRIVATE MESSAGES ARE NEVER SENT. Direct messages, group conversations,
 *    federated conversations and group channel rooms render with the word
 *    check only (PRIVATE_VIEWS), as React does for its message screens.
 *  - One request per page (up to 50 texts; at most MAX_TEXTS_PER_PAGE). Pages
 *    are rendered once while noting which texts the word check could not
 *    settle; only when the server's answers remove a button is the page
 *    rendered again.
 *  - Answers are remembered here per community (the server remembers them for
 *    months), so a text is normally asked about once.
 *  - Anything not known — no answer, a failure, a timeout — keeps the button,
 *    exactly as before this existed. Hiding by mistake is the only failure
 *    that matters: a reader who cannot read a text would have no way in.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { translationNeeded, vocabularyFor } = require('./index');
const { isMostlyEverydayWords } = require('./textLanguage');

/** At or above this, the service's answer is taken as it is; below it, the words must agree (React: SURE_CONFIDENCE). */
const SURE_CONFIDENCE = 0.7;
const BATCH_SIZE = 50;
const MAX_TEXTS_PER_PAGE = 100;
/** The server looks at the first 300 characters; there is no need to send more. */
const MAX_TEXT_LENGTH = 1000;
const TIMEOUT_MS = 2500;
const CACHE_LIMIT = 5000;
const ANSWER_TTL_MS = 6 * 60 * 60 * 1000;
/** "Not known" from the server (no Google engine, nothing to tell by) is asked again sooner. */
const UNKNOWN_TTL_MS = 10 * 60 * 1000;
/** Views whose texts are private messages: the word check only. */
const PRIVATE_VIEWS = /^\/?(?:messages\/|federation\/conversation|groups\/channels\/)/;

const pageState = new AsyncLocalStorage();
const remembered = new Map();

function keyOf(text) {
  return String(text).trim().slice(0, MAX_TEXT_LENGTH);
}

function partsOf(parts) {
  return (Array.isArray(parts) ? parts.flat(Infinity) : [parts])
    .map((part) => (part === null || part === undefined ? '' : keyOf(part)))
    .filter((part) => part !== '');
}

function tenantKeyOf(req) {
  const routing = req && req.accessibleRouting;
  const tenant = routing && routing.tenant;
  return String((tenant && (tenant.id || tenant.slug)) || (routing && routing.tenantSlug) || '');
}

function cacheKey(tenantKey, text) {
  return `${tenantKey}\u0000${createHash('sha256').update(text).digest('hex')}`;
}

/** The remembered answer: undefined when not known here, null when the server could not tell. */
function rememberedAnswer(tenantKey, text, now = Date.now()) {
  const key = cacheKey(tenantKey, text);
  const entry = remembered.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    remembered.delete(key);
    return undefined;
  }
  return entry.answer;
}

function remember(tenantKey, text, answer, now = Date.now()) {
  const key = cacheKey(tenantKey, text);
  remembered.delete(key);
  remembered.set(key, { answer, expires: now + (answer ? ANSWER_TTL_MS : UNKNOWN_TTL_MS) });
  while (remembered.size > CACHE_LIMIT) remembered.delete(remembered.keys().next().value);
}

function toAnswer(value) {
  if (!value || typeof value !== 'object') return null;
  const language = typeof value.language === 'string' ? value.language.trim().toLowerCase() : '';
  if (!language) return null;
  return { language, confidence: Number(value.confidence) || 0 };
}

/**
 * Ask the server about `texts`. One entry per text: an answer, null when the
 * server could not tell, or undefined when the request failed (not remembered).
 */
async function askServer(token, texts) {
  const { detectContentLanguages } = require('../api');
  const answers = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    let detections = null;
    try {
      const response = await detectContentLanguages(token, batch, { signal: globalThis.AbortSignal.timeout(TIMEOUT_MS) });
      const data = response && typeof response === 'object' ? (response.data || response) : null;
      detections = data && Array.isArray(data.detections) ? data.detections : null;
    } catch {
      detections = null;
    }
    batch.forEach((text, index) => answers.push(detections ? toAnswer(detections[index]) : undefined));
  }
  return answers;
}

/** Fill `answers` (text → answer|null) for `texts`, from memory first, then one request. */
async function resolveTexts(token, tenantKey, texts, answers) {
  const missing = [];
  for (const text of texts) {
    if (answers.has(text)) continue;
    const known = rememberedAnswer(tenantKey, text);
    if (known !== undefined) answers.set(text, known);
    else missing.push(text);
  }
  const asking = missing.slice(0, MAX_TEXTS_PER_PAGE);
  const asked = asking.length > 0 ? await askServer(token, asking) : [];
  asking.forEach((text, index) => {
    const answer = asked[index];
    answers.set(text, answer === undefined ? null : answer);
    if (answer !== undefined) remember(tenantKey, text, answer);
  });
  for (const text of missing) if (!answers.has(text)) answers.set(text, null);
}

function baseLanguage(code) {
  return String(code || '').trim().slice(0, 2).toLowerCase();
}

/**
 * Is everything shown written in the reader's language? Only when every part
 * has an answer in that language — sure enough, or unsure but made of the
 * reader's everyday words. Anything not known answers false (React:
 * writtenInReaderLanguage).
 */
function writtenInReaderLanguage(parts, answers, readerLocale) {
  const reader = baseLanguage(readerLocale);
  if (!reader || parts.length === 0 || answers.length < parts.length) return false;
  const vocabulary = vocabularyFor(readerLocale);
  return parts.every((part, index) => {
    const answer = answers[index];
    if (!answer || baseLanguage(answer.language) !== reader) return false;
    return answer.confidence >= SURE_CONFIDENCE || isMostlyEverydayWords(part, vocabulary);
  });
}

/** The member's token when this page may ask the server; null otherwise. */
function askingToken(req, res, view) {
  if (view && PRIVATE_VIEWS.test(String(view))) return null;
  const token = (req && (req.token || (req.signedCookies && req.signedCookies.token))) || null;
  if (!token) return null;
  const tenant = (req.accessibleRouting && req.accessibleRouting.tenant) || (res && res.locals && res.locals.tenant);
  if (tenant && tenant.translation && tenant.translation.enabled === false) return null;
  return token;
}

/**
 * The template global `needsTranslation(parts, locale)`. Outside a page that
 * may ask (tests, private views, signed-out visitors) it is the word check.
 */
function needsTranslation(parts, locale) {
  if (!translationNeeded(parts, locale)) return false;
  const state = pageState.getStore();
  if (!state) return true;
  const list = partsOf(parts);
  if (list.length === 0) return true;
  for (const text of list) {
    if (state.answers.has(text)) continue;
    const known = rememberedAnswer(state.tenantKey, text);
    if (known !== undefined) state.answers.set(text, known);
  }
  if (list.every((text) => state.answers.has(text))) {
    return !writtenInReaderLanguage(list, list.map((text) => state.answers.get(text)), locale);
  }
  if (state.collecting) {
    state.calls.push({ list, locale });
    for (const text of list) if (!state.answers.has(text)) state.pending.add(text);
  }
  return true;
}

/**
 * The same decision for code that settles it before rendering (detail pages:
 * events, groups, profiles, blog, jobs…, and every question on a help page),
 * for several items with one request: `items` is [{ parts, locale }], the
 * answer one boolean per item.
 */
async function needsTranslationForItems(req, res, items) {
  const decisions = items.map(({ parts, locale }) => translationNeeded(parts, locale));
  const token = askingToken(req, res, null);
  if (!token) return decisions;
  const lists = items.map(({ parts }, index) => (decisions[index] ? partsOf(parts) : []));
  const texts = [...new Set(lists.flat())];
  if (texts.length === 0) return decisions;
  const answers = new Map();
  await resolveTexts(token, tenantKeyOf(req), texts, answers);
  return items.map(({ locale }, index) => decisions[index] && !(lists[index].length > 0
    && writtenInReaderLanguage(lists[index], lists[index].map((text) => answers.get(text)), locale)));
}

/** One item: should this page offer "Translate" for these parts? */
async function needsTranslationForRequest(req, res, parts, locale) {
  return (await needsTranslationForItems(req, res, [{ parts, locale }]))[0];
}

/**
 * Wrap res.render so the template global can use the server's answers. Called
 * once per request (server.js), after any other res.render wrapper.
 */
function installTextLanguageRender(req, res) {
  const render = res.render.bind(res);
  res.render = (view, options, callback) => {
    let locals = options;
    let done = callback;
    if (typeof locals === 'function') {
      done = locals;
      locals = {};
    }
    const token = askingToken(req, res, view);
    if (!token) return render(view, locals, done);

    const finish = (error, html) => {
      if (done) return done(error, html);
      if (error) return req.next(error);
      return res.send(html);
    };
    const state = { tenantKey: tenantKeyOf(req), answers: new Map(), pending: new Set(), calls: [], collecting: true };
    return pageState.run(state, () => render(view, locals, (error, html) => {
      if (error || state.pending.size === 0) return finish(error, html);
      resolveTexts(token, state.tenantKey, [...state.pending], state.answers).then(() => {
        state.collecting = false;
        const removesAButton = state.calls.some(({ list, locale }) => (
          writtenInReaderLanguage(list, list.map((text) => state.answers.get(text)), locale)
        ));
        if (!removesAButton) return finish(null, html);
        return pageState.run(state, () => render(view, locals, finish));
      }, () => finish(null, html));
    }));
  };
}

/** For tests. */
function forgetTextLanguages() {
  remembered.clear();
}

module.exports = {
  PRIVATE_VIEWS,
  SURE_CONFIDENCE,
  MAX_TEXTS_PER_PAGE,
  askingToken,
  forgetTextLanguages,
  installTextLanguageRender,
  needsTranslation,
  needsTranslationForItems,
  needsTranslationForRequest,
  writtenInReaderLanguage
};
