// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { submitContact, submitSupportReport, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { validateReturnUrl } = require('../lib/urlValidator');
const { isValidEmail } = require('../lib/inputValidator');
const {
  prepareScreenshots,
  removeScreenshotFiles,
  screenshotErrorMessage,
  uploadedScreenshots
} = require('../lib/support-screenshots');

const router = express.Router();

const CONTACT_PATH = '/contact';
const REPORT_PROBLEM_PATH = '/report-a-problem';
const LOGIN_AUTH_REQUIRED_PATH = '/login?status=auth-required';

const SUPPORT_IMPACTS = ['blocked', 'major', 'minor', 'cosmetic'];
// The four kinds of "Help & support" request — the same list as the React form
// and SupportReportController::REQUEST_TYPES. Only 'broken' asks how much the
// problem affects the member; the API ignores impact for the other three.
const SUPPORT_REQUEST_TYPES = ['broken', 'how_to', 'account', 'suggestion'];

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validEmail(value) {
  return isValidEmail(value);
}

function consumeSessionValue(req, key) {
  if (!req.session || !req.session[key]) {
    return {};
  }

  const value = req.session[key];
  delete req.session[key];
  return value;
}

function buildQuery(path, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function contactStatusFromError(error) {
  if (error instanceof ApiError && error.status === 429) {
    return 'contact-rate-limited';
  }

  const code = String(error?.data?.code || error?.data?.error || error?.message || '').toLowerCase();
  if (code.includes('turnstile')) {
    return 'contact-turnstile-failed';
  }

  return 'contact-failed';
}

function contactValidationErrors(t) {
  return {
    name: t('contact.errors.name_required'),
    email: t('contact.errors.email_required'),
    message: t('contact.errors.message_required')
  };
}

function contactStatusMessages(t) {
  return {
    'contact-failed': t('contact.error_fallback'),
    'contact-rate-limited': t('contact.rate_limited'),
    'contact-turnstile-failed': t('contact.turnstile_failed')
  };
}

function supportValidationErrors(t) {
  return {
    request_type: t('report_problem.errors.type'),
    summary: t('report_problem.errors.summary'),
    description: t('report_problem.errors.description'),
    impact: t('report_problem.errors.impact')
  };
}

router.get('/contact', (req, res) => {
  const stored = consumeSessionValue(req, 'contactForm');
  const problemUrl = validateReturnUrl(req.query.problem_url, '');
  const status = asString(req.query.status);
  const values = {
    name: '',
    email: '',
    subject: problemUrl ? 'technical' : '',
    message: problemUrl ? `${res.locals.t('report_problem.contact_prefill', { url: problemUrl })}\n\n` : '',
    ...(stored.values || {})
  };

  res.render('contact', {
    title: res.locals.t('contact.title'),
    titleKey: 'contact.title',
    activeNav: 'contact',
    status,
    values,
    errors: status === 'contact-validation'
      ? { ...contactValidationErrors(res.locals.t), ...(stored.errors || {}) }
      : (stored.errors || {}),
    statusMessage: contactStatusMessages(res.locals.t)[status] || '',
    // 🔴 `POST /api/v2/contact` is the ONE Laravel endpoint that enforces
    // Turnstile (CoreController::apiSubmit → 422 TURNSTILE_FAILED). This view had
    // no widget and the key was being passed to five views that deliberately
    // removed Turnstile on 2026-05-16, so every submission would have failed the
    // moment TURNSTILE_SECRET_KEY was set in production. TurnstileService fails
    // OPEN when the secret is unset, which is why nothing looked broken.
    turnstileSiteKey: String(process.env.TURNSTILE_SITE_KEY || ''),
    // The tenant's real contact address, so the page always offers a route that
    // does not depend on JavaScript. Same address the API routes the form to.
    contactEmail: String(req.accessibleRouting?.tenant?.contact?.email
      || req.accessibleRouting?.tenant?.contact_email
      || '')
  });
});

router.post('/contact', asyncRoute(async (req, res) => {
  const values = {
    name: asString(req.body.name),
    email: asString(req.body.email),
    subject: asString(req.body.subject) || 'general',
    message: asString(req.body.message)
  };

  const errors = {};
  const validationErrors = contactValidationErrors(res.locals.t);
  if (!values.name) {
    errors.name = validationErrors.name;
  }
  if (!values.email || !validEmail(values.email)) {
    errors.email = validationErrors.email;
  }
  if (!values.message) {
    errors.message = validationErrors.message;
  }

  if (Object.keys(errors).length > 0) {
    if (req.session) {
      req.session.contactForm = { values, errors };
    }
    return redirectTo(res, `${CONTACT_PATH}?status=contact-validation`);
  }

  try {
    await submitContact({
      ...values,
      turnstile_token: asString(req.body['cf-turnstile-response'] || req.body.turnstile_token)
    });
  } catch (error) {
    if (req.session) {
      req.session.contactForm = { values };
    }
    return redirectTo(res, `${CONTACT_PATH}?status=${contactStatusFromError(error)}`);
  }

  return redirectTo(res, `${CONTACT_PATH}?status=contact-sent`);
}));

// The session normally carries exactly the fields that failed. If it has been
// lost, fall back to the fields that are always required: impact is required
// only for "Something isn't working", so it is not assumed.
function invalidStatusErrors(t, storedErrors) {
  if (storedErrors && Object.keys(storedErrors).length > 0) {
    return storedErrors;
  }
  const generic = supportValidationErrors(t);
  return {
    request_type: generic.request_type,
    summary: generic.summary,
    description: generic.description
  };
}

router.get('/report-a-problem', (req, res) => {
  const pageUrl = validateReturnUrl(req.query.return, '/');
  if (!req.signedCookies.token) {
    return redirectTo(res, buildQuery(CONTACT_PATH, { problem_url: pageUrl }));
  }

  const stored = consumeSessionValue(req, 'reportProblemForm');
  const status = asString(req.query.status);

  return res.render('report-problem', {
    title: res.locals.t('report_problem.title'),
    activeNav: '',
    pageUrl,
    impacts: SUPPORT_IMPACTS,
    requestTypes: SUPPORT_REQUEST_TYPES,
    status,
    reference: asString(req.query.ref),
    values: stored.values || {},
    errors: status === 'invalid'
      ? invalidStatusErrors(res.locals.t, stored.errors)
      : (stored.errors || {})
  });
});

// A Laravel 422 names the field that failed (`screenshots.0`, `screenshots`,
// `summary` …) with a message already translated for the member's language.
// Map the ones this form shows so the message lands next to the right field.
const SUPPORT_API_FIELDS = ['request_type', 'summary', 'description', 'impact'];

function supportApiFieldErrors(error) {
  if (!(error instanceof ApiError) || error.status !== 422) return {};
  const list = Array.isArray(error.data?.errors) ? error.data.errors : [];
  const errors = {};
  for (const item of list) {
    const field = asString(item?.field);
    const message = asString(item?.message);
    if (!field || !message) continue;
    const key = field === 'screenshots' || field.startsWith('screenshots.') ? 'screenshots' : field;
    if ((key === 'screenshots' || SUPPORT_API_FIELDS.includes(key)) && !errors[key]) {
      errors[key] = message;
    }
  }
  return errors;
}

router.post('/report-a-problem', asyncRoute(async (req, res) => {
  const files = uploadedScreenshots(req);
  try {
    return await submitReportProblem(req, res, files);
  } finally {
    await removeScreenshotFiles(files);
  }
}));

async function submitReportProblem(req, res, files) {
  const token = req.signedCookies.token;
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const pageUrl = validateReturnUrl(req.body.page_url, '/');
  const values = {
    request_type: asString(req.body.request_type),
    summary: asString(req.body.summary),
    description: asString(req.body.description),
    impact: asString(req.body.impact)
  };
  const isBroken = values.request_type === 'broken';

  const errors = {};
  const validationErrors = supportValidationErrors(res.locals.t);
  if (!SUPPORT_REQUEST_TYPES.includes(values.request_type)) {
    errors.request_type = validationErrors.request_type;
  }
  if (values.summary.length < 3 || values.summary.length > 180) {
    errors.summary = validationErrors.summary;
  }
  if (values.description.length < 10 || values.description.length > 5000) {
    errors.description = validationErrors.description;
  }
  if (isBroken && !SUPPORT_IMPACTS.includes(values.impact)) {
    errors.impact = validationErrors.impact;
  }

  const prepared = await prepareScreenshots(files);
  if (prepared.error) {
    errors.screenshots = screenshotErrorMessage(res.locals.t, prepared.error);
  }

  if (Object.keys(errors).length > 0) {
    if (req.session) {
      req.session.reportProblemForm = { values, errors };
    }
    return redirectTo(res, buildQuery(REPORT_PROBLEM_PATH, {
      return: pageUrl,
      status: 'invalid'
    }));
  }

  try {
    const report = {
      request_type: values.request_type,
      summary: values.summary,
      description: values.description,
      // Only "Something isn't working" carries an impact (the API excludes it otherwise).
      ...(isBroken ? { impact: values.impact } : {}),
      source: 'accessible',
      page_url: pageUrl,
      route: '/report-a-problem'
    };
    // Screenshots switch the request to multipart; without them the call is
    // exactly the JSON request it was before screenshots existed.
    const result = prepared.screenshots.length > 0
      ? await submitSupportReport(token, report, prepared.screenshots)
      : await submitSupportReport(token, report);
    const reference = asString(result?.data?.report?.reference || result?.report?.reference);
    return redirectTo(res, buildQuery(REPORT_PROBLEM_PATH, {
      return: pageUrl,
      status: 'sent',
      ref: reference
    }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }

    const apiErrors = supportApiFieldErrors(error);
    if (Object.keys(apiErrors).length > 0) {
      if (req.session) {
        req.session.reportProblemForm = { values, errors: apiErrors };
      }
      return redirectTo(res, buildQuery(REPORT_PROBLEM_PATH, {
        return: pageUrl,
        status: 'invalid'
      }));
    }

    if (req.session) {
      req.session.reportProblemForm = { values };
    }
    return redirectTo(res, buildQuery(REPORT_PROBLEM_PATH, {
      return: pageUrl,
      status: 'failed'
    }));
  }
}

module.exports = router;
