// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Carry the API's own refusal message across a POST-redirect-GET.
 *
 * Some refusals cannot be told apart by their code. "Apply" answers 422
 * VALIDATION_ERROR both for "this opportunity is no longer active" and for "you run
 * this organisation" (8 Oct 2026), and an expense claim answers 403 FORBIDDEN for
 * several different reasons. The API's message says which, in the member's own
 * language (`request()` forwards the request locale as `Accept-Language`), so the
 * failing POST stashes it here and the page it redirects to shows it in place of a
 * generic "something went wrong".
 *
 * Same one-shot session stash as lib/form-replay.js: written on the failure exit,
 * read and DELETED by the matching GET, and scoped by a key so a refusal on one page
 * can never surface on another. Rendered as text only (Nunjucks autoescapes); a page
 * with nothing stashed falls back to its own translated message.
 */

const { rememberFormReplay, consumeFormReplay } = require('./form-replay');

const BUCKET = 'apiRefusal';
const MAX_LENGTH = 300;

function refusalMessageOf(error) {
  const firstError = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  const message = firstError?.message ?? error?.data?.message;
  return typeof message === 'string' ? message.trim().slice(0, MAX_LENGTH) : '';
}

/** Stash the API's message for one page. Does nothing when the API gave none. */
function rememberApiRefusal(req, key, error) {
  const message = refusalMessageOf(error);
  if (message) rememberFormReplay(req, BUCKET, key, { message });
  return message;
}

/** Read the stashed message for one page and delete it; '' when there is none. */
function consumeApiRefusal(req, key) {
  const stored = consumeFormReplay(req, BUCKET, key);
  return stored && typeof stored.message === 'string' ? stored.message : '';
}

/**
 * The first error's code and message, wherever Laravel put them
 * (`errors[0].code` from respondWithError, or the older `error`/`code` keys).
 */
function firstApiError(error) {
  const data = error && error.data && typeof error.data === 'object' ? error.data : null;
  if (!data) return { code: '', message: '' };
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const first = errors.find((item) => item && typeof item === 'object') || {};
  const nested = data.error && typeof data.error === 'object' ? data.error : {};
  return {
    code: String(first.code || nested.code || data.code || (typeof data.error === 'string' ? data.error : '') || '')
      .trim()
      .toUpperCase(),
    message: String(first.message || nested.message || data.message || '').trim()
  };
}

/**
 * As rememberApiRefusal, but only for a genuine refusal (4xx other than 401). A 5xx
 * or network failure's text is not written for members (29 Oct 2026 deep audit P1:
 * wallet, member transfer, exchanges, exchange requests, job applications).
 */
function rememberClientRefusal(req, key, error) {
  const status = Number(error && error.status);
  if (!(status >= 400 && status < 500) || status === 401) return '';
  return rememberApiRefusal(req, key, error);
}

/**
 * Page-keyed variant for areas whose failure redirects go to many different pages
 * (marketplace, listings, jobs, groups...). The failing POST stashes the refusal
 * against the page it redirects to (query and fragment ignored); that page's GET
 * picks it up with `refusalForPage` (or the router middleware below) and shows it
 * in place of its generic failure message. Only genuine 4xx refusals are kept.
 */
function pageKey(path) {
  return `page:${String(path || '').split(/[?#]/)[0]}`;
}

function rememberRefusalForPage(req, redirectPath, error) {
  return rememberClientRefusal(req, pageKey(redirectPath), error);
}

function refusalForPage(req, path) {
  return consumeApiRefusal(req, pageKey(path));
}

/**
 * Router middleware: on a GET, expose any refusal stashed for this page as
 * `res.locals.apiRefusal`. `mountPath` is the router's tenant-relative mount
 * ("/marketplace"), because req.path inside a router is relative to it.
 */
function exposePageRefusal(mountPath) {
  return (req, res, next) => {
    if (req.method === 'GET' && req.session) {
      const path = `${mountPath}${req.path === '/' ? '' : req.path}` || '/';
      const message = refusalForPage(req, path);
      if (message) res.locals.apiRefusal = message;
    }
    next();
  };
}

module.exports = {
  rememberApiRefusal,
  consumeApiRefusal,
  refusalMessageOf,
  firstApiError,
  rememberClientRefusal,
  rememberRefusalForPage,
  refusalForPage,
  exposePageRefusal
};
