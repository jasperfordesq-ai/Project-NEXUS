// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { submitContact, submitSupportReport, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { validateReturnUrl } = require('../lib/urlValidator');

const router = express.Router();

const CONTACT_PATH = '/contact';
const REPORT_PROBLEM_PATH = '/report-a-problem';
const LOGIN_AUTH_REQUIRED_PATH = '/login?status=auth-required';

const SUPPORT_IMPACTS = ['blocked', 'major', 'minor', 'cosmetic'];

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    statusMessage: contactStatusMessages(res.locals.t)[status] || ''
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
    status,
    reference: asString(req.query.ref),
    values: stored.values || {},
    errors: status === 'invalid'
      ? { ...supportValidationErrors(res.locals.t), ...(stored.errors || {}) }
      : (stored.errors || {})
  });
});

router.post('/report-a-problem', asyncRoute(async (req, res) => {
  const token = req.signedCookies.token;
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const pageUrl = validateReturnUrl(req.body.page_url, '/');
  const values = {
    summary: asString(req.body.summary),
    description: asString(req.body.description),
    impact: asString(req.body.impact)
  };

  const errors = {};
  const validationErrors = supportValidationErrors(res.locals.t);
  if (values.summary.length < 3 || values.summary.length > 180) {
    errors.summary = validationErrors.summary;
  }
  if (values.description.length < 10 || values.description.length > 5000) {
    errors.description = validationErrors.description;
  }
  if (!SUPPORT_IMPACTS.includes(values.impact)) {
    errors.impact = validationErrors.impact;
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
    const result = await submitSupportReport(token, {
      ...values,
      source: 'accessible',
      page_url: pageUrl,
      route: '/report-a-problem'
    });
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

    if (req.session) {
      req.session.reportProblemForm = { values };
    }
    return redirectTo(res, buildQuery(REPORT_PROBLEM_PATH, {
      return: pageUrl,
      status: 'failed'
    }));
  }
}));

module.exports = router;
