// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { login, register, getRegistrationInfo, getTenantBootstrap, logout, forgotPassword, resetPassword, resendVerification, verify2fa, invalidateUserCache, ApiError, ApiOfflineError } = require('../lib/api');
const { setAuthCookies, clearAuthCookies } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { createTranslator } = require('../lib/localization');

const router = express.Router();
const fallbackTranslator = createTranslator('en');

const LOGIN_SUCCESS_STATUS_KEYS = Object.freeze({
  'verification-resent': 'auth.verification_resent',
  'password-reset': 'auth.password_reset',
  'register-created': 'auth.register_created',
  'signed-out': 'auth.signed_out',
  'password-changed': 'profile_settings.password_changed',
  '2fa-disabled': 'security_2fa.disabled_success',
  'account-deletion-requested': 'delete_account.success',
  'passkey-removed': 'profile_settings.passkeys.removed'
});

const LOGIN_ERROR_STATUS_KEYS = Object.freeze({
  'auth-required': 'states.auth_required',
  'login-failed': 'auth.login_failed',
  'two-factor-required': 'auth.two_factor_required',
  'two-factor-expired': 'auth.two_factor_expired',
  'rate-limited': 'auth.rate_limited',
  'email-not-verified': 'auth.email_not_verified',
  'pending-verification': 'auth.pending_verification',
  'account-suspended': 'auth.account_suspended'
});

const TWO_FACTOR_ERROR_STATUS_KEYS = Object.freeze({
  'two-factor-code-required': 'auth.two_factor_code_required',
  'two-factor-invalid': 'auth.two_factor_invalid',
  'two-factor-failed': 'auth.two_factor_failed'
});

const TWO_FACTOR_EXPIRED_CODES = new Set([
  'AUTH_2FA_EXPIRED',
  'AUTH_2FA_MAX_ATTEMPTS',
  'AUTH_2FA_TOKEN_EXPIRED'
]);

const REGISTER_ERROR_STATUS_KEYS = Object.freeze({
  'register-failed': 'auth.register_failed',
  'register-duplicate': 'auth.register_duplicate',
  'register-password-pwned': 'auth.register_password_pwned',
  'register-password-mismatch': 'auth.register_password_mismatch',
  'register-terms-required': 'auth.register_terms_required',
  'register-invite-required': 'auth.register_invite_required',
  'register-invite-invalid': 'auth.register_invite_invalid',
  'register-location-unverified': 'auth.register_location_unverified',
  'register-email-disposable': 'auth.register_email_disposable',
  'register-email-domain-invalid': 'auth.register_email_domain_invalid',
  'register-daily-limit': 'auth.register_daily_limit',
  'register-tenant-paused': 'auth.register_tenant_paused',
  'register-closed': 'auth.register_closed',
  'register-validation': 'auth.register_validation'
});

const REGISTRATION_ERROR_STATUS_BY_CODE = Object.freeze({
  VALIDATION_DUPLICATE: 'register-duplicate',
  PASSWORD_PWNED: 'register-password-pwned',
  PASSWORD_MISMATCH: 'register-password-mismatch',
  TERMS_REQUIRED: 'register-terms-required',
  INVITE_REQUIRED: 'register-invite-required',
  INVITE_INVALID: 'register-invite-invalid',
  LOCATION_NOT_VERIFIED: 'register-location-unverified',
  EMAIL_DISPOSABLE: 'register-email-disposable',
  EMAIL_DOMAIN_INVALID: 'register-email-domain-invalid',
  REGISTRATION_DAILY_LIMIT: 'register-daily-limit',
  REGISTRATION_TENANT_PAUSED: 'register-tenant-paused',
  REGISTRATION_CLOSED: 'register-closed',
  VALIDATION_ERROR: 'register-validation'
});

const REGISTRATION_ERROR_FIELD_BY_STATUS = Object.freeze({
  'register-duplicate': 'email',
  'register-email-disposable': 'email',
  'register-email-domain-invalid': 'email',
  'register-password-pwned': 'password',
  'register-password-mismatch': 'password',
  'register-terms-required': 'terms_accepted',
  'register-invite-required': 'invite_code',
  'register-invite-invalid': 'invite_code',
  'register-location-unverified': 'location',
  'register-closed': 'main-content'
});

const REGISTRATION_INPUT_FIELDS = new Set([
  'first_name',
  'last_name',
  'email',
  'phone',
  'location',
  'profile_type',
  'organization_name',
  'invite_code',
  'password',
  'password_confirmation',
  'terms_accepted',
  'tenant_slug'
]);

const RESET_ERROR_STATUS_KEYS = Object.freeze({
  'reset-token-missing': 'auth.reset_link_invalid_title',
  'reset-token-invalid': 'auth.reset_link_invalid_title',
  'reset-weak': 'auth.reset_weak',
  'reset-pwned': 'auth.reset_pwned',
  'reset-reused': 'auth.reset_reused',
  'reset-mismatch': 'auth.reset_mismatch',
  'reset-failed': 'auth.reset_failed',
  'reset-rate-limited': 'auth.reset_rate_limited'
});

function translate(req, key, replacements = {}) {
  const requestTranslator = typeof req.t === 'function' ? req.t : fallbackTranslator;
  return requestTranslator(key, replacements);
}

function statusMessage(req, status, statusKeys) {
  const key = statusKeys[String(status || '')];
  return key ? translate(req, key) : '';
}

function firstFlashValue(req, name) {
  if (typeof req.flash !== 'function') return '';
  const values = req.flash(name);
  return Array.isArray(values) ? values[0] || '' : '';
}

function setAuthStatus(req, status) {
  if (typeof req.flash === 'function') {
    req.flash('authStatus', status);
  }
}

function errorCode(error) {
  const data = error?.data;
  const firstError = Array.isArray(data?.errors) ? data.errors[0] : null;
  return String(firstError?.code || data?.code || '').trim().toUpperCase();
}

function registrationErrorKey(error) {
  return REGISTER_ERROR_STATUS_KEYS[registrationErrorStatus(error)] || 'auth.register_failed';
}

function registrationErrorStatus(error) {
  const code = errorCode(error);
  if (REGISTRATION_ERROR_STATUS_BY_CODE[code]) {
    return REGISTRATION_ERROR_STATUS_BY_CODE[code];
  }
  if (error?.status === 409) return 'register-duplicate';
  return 'register-failed';
}

function registrationErrorField(error, status) {
  const firstError = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  const apiField = String(firstError?.field || '').trim();
  if (REGISTRATION_INPUT_FIELDS.has(apiField)) return apiField;
  return REGISTRATION_ERROR_FIELD_BY_STATUS[status];
}

function resetErrorKey(error) {
  const code = errorCode(error);
  if (code.includes('PWNED')) return 'auth.reset_pwned';
  if (code.includes('REUSED')) return 'auth.reset_reused';
  if (code.includes('WEAK')) return 'auth.reset_weak';
  if (code.includes('TOKEN') || error?.status === 400 || error?.status === 404) {
    return 'auth.reset_link_invalid_title';
  }
  if (error?.status === 429) return 'auth.reset_rate_limited';
  return 'auth.reset_failed';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function tenantSlugForRequest(req) {
  const routedTenantSlug = String(req.accessibleRouting?.tenantSlug || '').trim();
  if (routedTenantSlug) {
    return routedTenantSlug;
  }

  return String(req.body?.tenant_slug || '').trim();
}

function clearPendingTwoFactor(req) {
  if (!req.session) return;
  delete req.session.pending2faToken;
  delete req.session.pending2faTenantSlug;
  delete req.session.pending2faAllowTrustedDevice;
  delete req.session.pending2faTrustedDeviceDays;
}

function rotatingSessionFrom(result) {
  const accessToken = String(result?.access_token || '').trim();
  const refreshToken = String(result?.refresh_token || '').trim();
  const expiresIn = Number(result?.expires_in);
  const refreshExpiresIn = Number(result?.refresh_expires_in);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0
      || !Number.isFinite(refreshExpiresIn) || refreshExpiresIn <= 0) {
    throw new ApiError('Laravel did not return the complete rotating-session envelope', 502, {
      errors: [{ code: 'AUTH_SESSION_RESPONSE_INVALID' }]
    });
  }
  return { accessToken, refreshToken, expiresIn, refreshExpiresIn };
}

function pendingTwoFactorTenantSlug(req) {
  return String(req.session?.pending2faTenantSlug || tenantSlugForRequest(req)).trim();
}

router.get('/login', (req, res) => {
  const flashedStatus = firstFlashValue(req, 'authStatus');
  const legacySuccessMessage = firstFlashValue(req, 'success');
  const status = String(req.query.status || flashedStatus || '');
  res.render('login', {
    title: translate(req, 'auth.login_title'),
    loginStatus: status,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    successMessage: statusMessage(req, status, LOGIN_SUCCESS_STATUS_KEYS)
      || legacySuccessMessage
      || null,
    error: statusMessage(req, status, LOGIN_ERROR_STATUS_KEYS) || null,
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
  });
});

router.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  const tenantSlug = tenantSlugForRequest(req);

  if (!email || !password || !tenantSlug) {
    return res.render('login', {
      title: translate(req, 'auth.login_title'),
      error: 'Enter your email, password and tenant',
      values: { email, tenant_slug: tenantSlug },
      csrfToken: req.csrfToken ? req.csrfToken() : '',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
    });
  }

  // Turnstile gate intentionally removed from login (2026-05-15). It was
  // blocking legitimate members on browsers that couldn't reach
  // challenges.cloudflare.com. Express-rate-limit (10/15min on auth routes)
  // is the active defence here. Registration + contact keep Turnstile.

  clearPendingTwoFactor(req);

  try {
    const result = await login(email.toLowerCase(), password, tenantSlug);

    // Handle 2FA requirement — store pending token in session for verification
    if (result.requires_2fa) {
      const pendingToken = result.two_factor_token;
      if (!pendingToken || !req.session) {
        return redirectTo(res, '/login?status=two-factor-required');
      }

      req.session.pending2faToken = pendingToken;
      req.session.pending2faTenantSlug = tenantSlug;
      req.session.pending2faAllowTrustedDevice = result.allow_trusted_device !== false;
      const trustedDeviceDays = Number(result.trusted_device_days);
      req.session.pending2faTrustedDeviceDays = Number.isInteger(trustedDeviceDays) && trustedDeviceDays > 0
        ? trustedDeviceDays
        : 30;
      return redirectTo(res, '/login/two-factor');
    }

    const session = rotatingSessionFrom(result);
    setAuthCookies(res, session.accessToken, session.refreshToken, {
      expiresIn: session.expiresIn,
      refreshExpiresIn: session.refreshExpiresIn,
      tenantSlug
    });

    return redirectTo(res, '/dashboard');
  } catch (error) {
    // Handle ApiOfflineError specially for 503
    if (error instanceof ApiOfflineError) {
      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    }

    let loginStatus = 'login-failed';
    let errorMessage = translate(req, 'auth.login_failed');

    if (error instanceof ApiError) {
      const code = errorCode(error);
      if (error.status === 429 || ['RATE_LIMIT_EXCEEDED', 'RATE_LIMITED'].includes(code)) {
        loginStatus = 'rate-limited';
        errorMessage = translate(req, 'auth.rate_limited');
      } else if (code === 'AUTH_EMAIL_NOT_VERIFIED') {
        loginStatus = 'email-not-verified';
        errorMessage = translate(req, 'auth.email_not_verified');
      } else if (code === 'AUTH_PENDING_VERIFICATION') {
        loginStatus = 'pending-verification';
        errorMessage = translate(req, 'auth.pending_verification');
      } else if (code === 'AUTH_ACCOUNT_SUSPENDED') {
        loginStatus = 'account-suspended';
        errorMessage = translate(req, 'auth.account_suspended');
      }
    }

    res.render('login', {
      title: translate(req, 'auth.login_title'),
      loginStatus,
      error: errorMessage,
      values: { email, tenant_slug: tenantSlug },
      csrfToken: req.csrfToken ? req.csrfToken() : '',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
    });
  }
}));

// 2FA verification
async function handleTwoFactorPost(req, res) {
  const { code } = req.body;
  const pendingToken = req.session?.pending2faToken;
  const pendingTenantSlug = pendingTwoFactorTenantSlug(req);
  const allowTrustedDevice = req.session?.pending2faAllowTrustedDevice !== false;
  const trustedDeviceDays = Number(req.session?.pending2faTrustedDeviceDays) || 30;

  if (!pendingToken) {
    clearPendingTwoFactor(req);
    return redirectTo(res, '/login?status=two-factor-expired');
  }

  if (!code || !code.trim()) {
    return res.render('login', {
      title: translate(req, 'auth.two_factor_title'),
      show2fa: true,
      error: translate(req, 'auth.two_factor_code_required'),
      allowTrustedDevice,
      trustedDeviceDays,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  }

  try {
    const result = await verify2fa(pendingToken, code.trim(), pendingTenantSlug, {
      useBackupCode: checkboxValue(req.body.use_backup_code),
      trustDevice: allowTrustedDevice && checkboxValue(req.body.trust_device)
    });

    if (result?.success !== true) {
      throw new ApiError('Laravel did not return the two-factor login token envelope', 502, {
        errors: [{ code: 'AUTH_2FA_RESPONSE_INVALID' }]
      });
    }

    const session = rotatingSessionFrom(result);
    clearPendingTwoFactor(req);
    setAuthCookies(res, session.accessToken, session.refreshToken, {
      expiresIn: session.expiresIn,
      refreshExpiresIn: session.refreshExpiresIn,
      tenantSlug: pendingTenantSlug
    });

    return redirectTo(res, '/dashboard');
  } catch (error) {
    if (error instanceof ApiOfflineError) {
      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    }

    const codeValue = errorCode(error);
    if (TWO_FACTOR_EXPIRED_CODES.has(codeValue)) {
      clearPendingTwoFactor(req);
      return redirectTo(res, '/login?status=two-factor-expired');
    }

    const errorKey = codeValue === 'AUTH_2FA_RESPONSE_INVALID'
      ? 'auth.two_factor_failed'
      : 'auth.two_factor_invalid';

    res.render('login', {
      title: translate(req, 'auth.two_factor_title'),
      show2fa: true,
      error: translate(req, errorKey),
      allowTrustedDevice,
      trustedDeviceDays,
      csrfToken: req.csrfToken ? req.csrfToken() : '',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
    });
  }
}

router.get('/login/two-factor', (req, res) => {
  if (!req.session?.pending2faToken) {
    clearPendingTwoFactor(req);
    return redirectTo(res, '/login?status=two-factor-expired');
  }

  res.render('login', {
    title: translate(req, 'auth.two_factor_title'),
    show2fa: true,
    error: statusMessage(req, req.query.status, TWO_FACTOR_ERROR_STATUS_KEYS),
    allowTrustedDevice: req.session.pending2faAllowTrustedDevice !== false,
    trustedDeviceDays: Number(req.session.pending2faTrustedDeviceDays) || 30,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
  });
});

router.post('/login/two-factor', asyncRoute(handleTwoFactorPost));

router.post('/login/resend-verification', asyncRoute(async (req, res) => {
  try {
    await resendVerification(
      (req.body.email || '').trim().toLowerCase(),
      tenantSlugForRequest(req)
    );
  } catch (error) {
    if (error instanceof ApiOfflineError) {
      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    }
  }

  return redirectTo(res, '/login?status=verification-resent');
}));

function dataFrom(result) {
  return result?.data || result || {};
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function checkboxValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

function safeRegistrationValues(body = {}, tenantSlug = '') {
  return {
    first_name: String(body.first_name || '').trim(),
    last_name: String(body.last_name || '').trim(),
    email: String(body.email || '').trim(),
    phone: String(body.phone || '').trim(),
    location: String(body.location || '').trim(),
    latitude: String(body.latitude || '').trim(),
    longitude: String(body.longitude || '').trim(),
    profile_type: String(body.profile_type || 'individual').trim(),
    organization_name: String(body.organization_name || '').trim(),
    invite_code: String(body.invite_code || '').trim().toUpperCase(),
    terms_accepted: checkboxValue(body.terms_accepted),
    newsletter_opt_in: checkboxValue(body.newsletter_opt_in),
    tenant_slug: String(tenantSlug || body.tenant_slug || '').trim()
  };
}

function rememberRegistrationAttempt(req, values, fieldErrors = {}) {
  if (typeof req.flash !== 'function') return;
  req.flash('registrationValues', values);
  if (Object.keys(fieldErrors).length > 0) {
    req.flash('registrationFieldErrors', fieldErrors);
  }
}

function registrationPolicy(result) {
  const policy = asObject(dataFrom(result));
  if (!policy.registration_mode) {
    throw new Error('Registration policy response was invalid');
  }
  return policy;
}

function isRegistrationClosed(policy) {
  return policy.is_closed === true
    || policy.registration_mode === 'closed'
    || policy.can_register === false;
}

async function policyForTenant(tenantSlug) {
  return registrationPolicy(await getRegistrationInfo(tenantSlug));
}

async function validateFlatRegistrationTenant(tenantSlug) {
  const tenant = asObject(dataFrom(await getTenantBootstrap({ slug: tenantSlug })));
  if (String(tenant.slug || '').trim().toLowerCase() !== String(tenantSlug).trim().toLowerCase()) {
    throw new ApiError('Community not found', 404, {
      errors: [{ code: 'TENANT_NOT_FOUND', message: 'Community not found' }]
    });
  }
  return tenant;
}

function renderRegistrationUnavailable(res) {
  return res.status(503).render('errors/503', { title: 'Service unavailable' });
}

function registrationErrorViewState(req, status, rememberedFieldErrors) {
  const fieldErrors = asObject(rememberedFieldErrors);
  const rememberedErrors = Object.entries(fieldErrors).map(([field, text]) => ({
    text,
    href: `#${field}`
  }));
  if (rememberedErrors.length > 0) {
    return { errors: rememberedErrors, fieldErrors };
  }

  const message = statusMessage(req, status, REGISTER_ERROR_STATUS_KEYS);
  if (!message) return { errors: [], fieldErrors: {} };

  const field = REGISTRATION_ERROR_FIELD_BY_STATUS[status];
  return {
    errors: [{ text: message, href: field ? `#${field}` : '#first_name' }],
    fieldErrors: field && field !== 'main-content' ? { [field]: message } : {}
  };
}

function validateRegistrationInput(req, tenantSlug, requiresInviteCode) {
  const body = req.body || {};
  const fieldErrors = {};
  const generic = translate(req, 'auth.register_validation');
  const add = (field, message = generic) => {
    if (!fieldErrors[field]) fieldErrors[field] = message;
  };
  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const location = String(body.location || '').trim();
  const password = String(body.password || '');
  const passwordConfirmation = String(body.password_confirmation ?? body.confirm_password ?? '');
  const profileType = String(body.profile_type || 'individual').trim();
  const organizationName = String(body.organization_name || '').trim();
  const inviteCode = String(body.invite_code || '').trim();

  if (!tenantSlug) add('tenant_slug');
  if (!firstName || firstName.length > 100) add('first_name');
  if (!lastName || lastName.length > 100) add('last_name');
  if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    add('email', translate(req, 'auth.forgot_invalid'));
  }
  if (!phone || phone.length > 30 || !/^\+?\d{7,15}$/.test(phone.replace(/[\s\-().]/g, ''))) {
    add('phone');
  }
  if (!location || location.length > 255) add('location');
  if (!password || password.length < 12) add('password');
  if (password !== passwordConfirmation) {
    add('password_confirmation', translate(req, 'auth.register_password_mismatch'));
  }
  if (!['individual', 'organisation'].includes(profileType)) add('profile_type');
  if (profileType === 'organisation' && (!organizationName || organizationName.length > 255)) {
    add('organization_name');
  }
  if (!checkboxValue(body.terms_accepted)) {
    add('terms_accepted', translate(req, 'auth.register_terms_required'));
  }
  if (requiresInviteCode && !inviteCode) {
    add('invite_code', translate(req, 'auth.register_invite_required'));
  }

  const rawLatitude = String(body.latitude ?? '').trim();
  const rawLongitude = String(body.longitude ?? '').trim();
  const latitude = rawLatitude === '' ? undefined : Number(rawLatitude);
  const longitude = rawLongitude === '' ? undefined : Number(rawLongitude);
  const invalidLatitude = latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90);
  const invalidLongitude = longitude !== undefined && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180);
  const nullIsland = latitude === 0 && longitude === 0;
  if (invalidLatitude || invalidLongitude || nullIsland) {
    add('location', translate(req, 'auth.register_location_unverified'));
  }

  let status = 'register-validation';
  if (fieldErrors.terms_accepted) {
    status = 'register-terms-required';
  } else if (fieldErrors.location === translate(req, 'auth.register_location_unverified')) {
    status = 'register-location-unverified';
  } else if (Object.keys(fieldErrors).length === 1 && fieldErrors.invite_code) {
    status = 'register-invite-required';
  } else if (Object.keys(fieldErrors).length === 1 && fieldErrors.password_confirmation) {
    status = 'register-password-mismatch';
  }

  return { fieldErrors, status, latitude, longitude, passwordConfirmation };
}

// Registration
router.get('/register', asyncRoute(async (req, res) => {
  const rememberedValues = asObject(firstFlashValue(req, 'registrationValues'));
  const rememberedFieldErrors = asObject(firstFlashValue(req, 'registrationFieldErrors'));
  const tenantSlug = String(req.accessibleRouting?.tenantSlug || rememberedValues.tenant_slug || '').trim();
  const status = String(req.query.status || '');
  let policy = {};

  if (tenantSlug) {
    try {
      policy = await policyForTenant(tenantSlug);
    } catch {
      return renderRegistrationUnavailable(res);
    }
  }

  const registrationClosed = status === 'register-closed' || isRegistrationClosed(policy);
  const requiresInviteCode = policy.requires_invite_code === true
    || policy.registration_mode === 'invite_only'
    || ['register-invite-required', 'register-invite-invalid'].includes(status);
  const errorState = registrationErrorViewState(req, status, rememberedFieldErrors);

  return res.render('register', {
    title: translate(req, registrationClosed ? 'auth.registration_closed_title' : 'auth.register_title'),
    ...errorState,
    values: { ...rememberedValues, tenant_slug: tenantSlug },
    tenantSlug,
    registrationClosed,
    requiresInviteCode,
    formStartedAt: Date.now(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/register', asyncRoute(async (req, res) => {
  const tenantSlug = tenantSlugForRequest(req);
  const values = safeRegistrationValues(req.body, tenantSlug);

  if (!tenantSlug) {
    const fieldErrors = { tenant_slug: translate(req, 'auth.register_validation') };
    rememberRegistrationAttempt(req, values, fieldErrors);
    return redirectTo(res, '/register?status=register-validation');
  }

  if (!req.accessibleRouting?.tenantSlug) {
    try {
      await validateFlatRegistrationTenant(tenantSlug);
    } catch (error) {
      if (error instanceof ApiOfflineError) {
        rememberRegistrationAttempt(req, values);
        return renderRegistrationUnavailable(res);
      }
      const fieldErrors = { tenant_slug: translate(req, 'auth.register_validation') };
      rememberRegistrationAttempt(req, values, fieldErrors);
      return redirectTo(res, '/register?status=register-validation');
    }
  }

  let policy;
  try {
    policy = await policyForTenant(tenantSlug);
  } catch {
    rememberRegistrationAttempt(req, values);
    return renderRegistrationUnavailable(res);
  }

  if (isRegistrationClosed(policy)) {
    rememberRegistrationAttempt(req, values);
    return redirectTo(res, '/register?status=register-closed');
  }

  // Bot honeypot — `website` is a hidden field in register.njk that real
  // users never see or fill. Match Laravel's silent-success honeypot and five-second form-time gates.
  // Registration policy is checked first, exactly like RegistrationService.
  const honeypotValue = String(req.body?.website || req.body?.honeypot || '').trim();
  const formStartedAt = Number(req.body?.form_started_at);
  const submittedTooQuickly = Number.isFinite(formStartedAt)
    && formStartedAt > 0
    && Date.now() - formStartedAt < 5000;
  if (honeypotValue || submittedTooQuickly) {
    console.info('[security] registration.bot_gate_triggered', {
      ip: req.ip,
      ua: String(req.headers['user-agent'] || '').slice(0, 200),
      gate: honeypotValue ? 'honeypot' : 'minimum_time'
    });
    return redirectTo(res, '/login?status=register-created');
  }

  const requiresInviteCode = policy.requires_invite_code === true || policy.registration_mode === 'invite_only';
  const validation = validateRegistrationInput(req, tenantSlug, requiresInviteCode);
  if (Object.keys(validation.fieldErrors).length > 0) {
    rememberRegistrationAttempt(req, values, validation.fieldErrors);
    return redirectTo(res, `/register?status=${validation.status}`);
  }

  const body = req.body || {};
  const profileType = String(body.profile_type || 'individual').trim();

  const payload = {
    first_name: values.first_name,
    last_name: values.last_name,
    email: values.email.toLowerCase(),
    phone: values.phone,
    location: values.location,
    password: String(body.password || ''),
    password_confirmation: validation.passwordConfirmation,
    profile_type: profileType,
    terms_accepted: true,
    newsletter_opt_in: checkboxValue(body.newsletter_opt_in),
    form_started_at: Number.isFinite(formStartedAt) && formStartedAt > 0 ? formStartedAt : undefined,
    tenant_slug: tenantSlug,
    website: ''
  };
  if (profileType === 'organisation') payload.organization_name = values.organization_name;
  if (requiresInviteCode) payload.invite_code = values.invite_code;
  if (validation.latitude !== undefined) payload.latitude = validation.latitude;
  if (validation.longitude !== undefined) payload.longitude = validation.longitude;

  try {
    await register(payload, tenantSlug);
    return redirectTo(res, '/login?status=register-created');
  } catch (error) {
    if (error instanceof ApiOfflineError) {
      return renderRegistrationUnavailable(res);
    }

    if (error instanceof ApiError && errorCode(error) === 'RATE_LIMIT_EXCEEDED') {
      return res.status(429).render('errors/429', {
        title: 'Too many requests',
        retryAfter: 5
      });
    }

    const status = error instanceof ApiError ? registrationErrorStatus(error) : 'register-failed';
    const message = translate(req, registrationErrorKey(error));
    const field = registrationErrorField(error, status);
    rememberRegistrationAttempt(req, values, field && field !== 'main-content' ? { [field]: message } : {});
    return redirectTo(res, `/register?status=${status}`);
  }
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const token = req.signedCookies.token;
  const refreshToken = req.signedCookies.refresh_token;

  // Revoke the tracked refresh family even when the short access token has
  // already expired, matching Laravel's current accessible logout contract.
  if (token || refreshToken) {
    try {
      await logout(token, refreshToken);
    } catch (error) {
      // Ignore errors - we still want to clear local cookies
      console.error('Logout API error:', error.message);
    }

    // Clear cached data for this user
    if (token) invalidateUserCache(token);
  }

  // Destroy session to prevent session fixation
  if (req.session) {
    req.session.destroy((err) => { if (err) console.error('Session destroy error:', err); });
  }

  clearAuthCookies(res);
  return redirectTo(res, '/login?status=signed-out');
}));

// Forgot password
function renderForgotPassword(req, res) {
  const status = req.query.status || '';
  const invalidEmail = status === 'forgot-invalid';
  const errorKey = status === 'forgot-rate-limited'
    ? 'auth.forgot_rate_limited'
    : (invalidEmail ? 'auth.forgot_invalid' : '');
  res.render('forgot-password', {
    title: translate(req, 'auth.forgot_title'),
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    forgotSent: status === 'forgot-sent',
    errors: errorKey ? [{ text: translate(req, errorKey), href: '#email' }] : [],
    fieldErrors: invalidEmail ? { email: translate(req, errorKey) } : {},
    formAction: '/login/forgot-password',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
  });
}

router.get('/login/forgot-password', renderForgotPassword);

async function handleForgotPasswordPost(req, res) {
  const { email } = req.body;
  const tenantSlug = tenantSlugForRequest(req);
  const formAction = '/login/forgot-password';

  // Turnstile gate intentionally removed from forgot-password (2026-05-15).
  // It was silently rejecting legitimate reset requests, so users saw the
  // success page but never received an email. Always-200 + rate-limit
  // (10/15min on auth routes) remain as defences against enumeration.

  const errors = [];
  const fieldErrors = {};

  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const message = translate(req, 'auth.forgot_invalid');
    errors.push({ text: message, href: '#email' });
    fieldErrors.email = message;
  }

  if (!tenantSlug) {
    errors.push({ text: 'Enter your community code', href: '#tenant_slug' });
    fieldErrors.tenant_slug = 'Enter your community code';
  }

  if (errors.length > 0) {
    return res.render('forgot-password', {
      title: translate(req, 'auth.forgot_title'),
      errors,
      fieldErrors,
      values: { email, tenant_slug: tenantSlug },
      formAction,
      csrfToken: req.csrfToken ? req.csrfToken() : '',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
    });
  }

  try {
    await forgotPassword(normalizedEmail, tenantSlug);
  } catch (error) {
    // Handle ApiOfflineError specially for 503
    if (error instanceof ApiOfflineError) {
      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    }
    // For other errors, fall through to show success message (security: don't reveal if email exists)
  }

  // Always show success message (security: don't reveal if email exists)
  return redirectTo(res, '/login/forgot-password?status=forgot-sent');
}

router.post('/login/forgot-password', asyncRoute(handleForgotPasswordPost));

// Reset password (with token from email)
function renderResetPassword(req, res) {
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  const statusError = statusMessage(req, req.query.status, RESET_ERROR_STATUS_KEYS);
  res.render('reset-password', {
    title: translate(req, 'auth.reset_title'),
    resetToken: token,
    errors: statusError ? [{ text: statusError }] : [],
    formAction: '/password/reset',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

router.get('/password/reset', renderResetPassword);

async function handleResetPasswordPost(req, res) {
  const token = req.body.token;
  const password = req.body.password;
  const confirmPassword = req.body.password_confirmation || req.body.confirm_password;
  const formAction = '/password/reset';

  const errors = [];
  const fieldErrors = {};

  if (!token) {
    errors.push({ text: translate(req, 'auth.reset_link_invalid_title'), href: '#' });
  }

  if (!password) {
    errors.push({ text: 'Enter a new password', href: '#password' });
    fieldErrors.password = 'Enter a new password';
  } else if (password.length < 8) {
    errors.push({ text: 'Password must be at least 8 characters', href: '#password' });
    fieldErrors.password = 'Password must be at least 8 characters';
  }

  if (password !== confirmPassword) {
    const message = translate(req, 'auth.reset_mismatch');
    errors.push({ text: message, href: '#password_confirmation' });
    fieldErrors.password_confirmation = message;
  }

  if (errors.length > 0) {
    return res.render('reset-password', {
      title: translate(req, 'auth.reset_title'),
      errors,
      fieldErrors,
      resetToken: token,
      formAction,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  }

  try {
    await resetPassword(token, password, confirmPassword);

    setAuthStatus(req, 'password-reset');
    return redirectTo(res, '/login');
  } catch (error) {
    // Handle ApiOfflineError specially for 503
    if (error instanceof ApiOfflineError) {
      return res.status(503).render('errors/503', { title: 'Service unavailable' });
    }

    const errorMessage = translate(req, resetErrorKey(error));

    res.render('reset-password', {
      title: translate(req, 'auth.reset_title'),
      errors: [{ text: errorMessage }],
      fieldErrors: {},
      resetToken: token,
      formAction,
      csrfToken: req.csrfToken ? req.csrfToken() : '',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
    });
  }
}

router.post('/password/reset', asyncRoute(handleResetPasswordPost));

module.exports = router;
