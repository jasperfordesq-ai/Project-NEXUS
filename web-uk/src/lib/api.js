// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const TENANT_ID = process.env.TENANT_ID || '';
const ACCESSIBLE_TENANT_SLUG = process.env.ACCESSIBLE_TENANT_SLUG || '';
const { cache } = require('./cache');
const { getApiBaseUrl } = require('./backend-contract');
const { getRequestLocale } = require('./request-locale-context');
const { getRequestTenantSlug, normalizeTenantSlug } = require('./request-tenant-context');

const API_BASE_URL = getApiBaseUrl();
const DEFAULT_API_REQUEST_TIMEOUT_MS = 15000;
const MIN_API_REQUEST_TIMEOUT_MS = 1000;
const MAX_API_REQUEST_TIMEOUT_MS = 120000;

// Cache TTL for different types of data (in milliseconds)
const CACHE_TTL = {
  COUNTS: 15000,    // 15 seconds for notification/message counts
  PROFILE: 60000    // 1 minute for user profile data
};

// Helper to create a cache key from token
function cacheKey(token, suffix) {
  // Use first 40 chars of token as user identifier to avoid collisions
  return `${token.substring(0, 40)}:${suffix}`;
}

class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

class ApiOfflineError extends Error {
  constructor(message = 'Unable to connect to the service') {
    super(message);
    this.name = 'ApiOfflineError';
    this.status = 503;
  }
}

function apiRequestTimeoutMs() {
  const configured = Number.parseInt(process.env.API_REQUEST_TIMEOUT_MS || '', 10);
  if (!Number.isFinite(configured)) return DEFAULT_API_REQUEST_TIMEOUT_MS;
  return Math.min(MAX_API_REQUEST_TIMEOUT_MS, Math.max(MIN_API_REQUEST_TIMEOUT_MS, configured));
}

function withRequestTimeout(options, headers) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timedOut = false;

  const abortFromCaller = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromCaller();
    } else {
      externalSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, apiRequestTimeoutMs());
  if (typeof timeout.unref === 'function') timeout.unref();

  return {
    config: {
      ...options,
      headers,
      signal: controller.signal
    },
    didTimeOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener('abort', abortFromCaller);
    }
  };
}

function connectionError(error, timedOut) {
  if (timedOut || (error && error.name === 'AbortError')) {
    return new ApiOfflineError('The service took too long to respond');
  }

  const message = error && typeof error.message === 'string' ? error.message : '';
  if (error && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND')) {
    return new ApiOfflineError();
  }
  return message.includes('fetch failed') ? new ApiOfflineError() : null;
}

function hasHeader(headers, expectedName) {
  const normalizedExpected = expectedName.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === normalizedExpected);
}

function headerValue(headers, expectedName) {
  const normalizedExpected = expectedName.toLowerCase();
  const key = Object.keys(headers).find((name) => name.toLowerCase() === normalizedExpected);
  return key ? String(headers[key] || '').trim() : '';
}

function hasHostTenantContext(headers) {
  return Boolean(headerValue(headers, 'Host') || headerValue(headers, 'Origin'));
}

function hasExplicitTenantContext(headers) {
  return Boolean(headerValue(headers, 'X-Tenant-Slug') || headerValue(headers, 'X-Tenant-ID'));
}

function hasBearerAuth(headers) {
  return /^Bearer\s+\S+/i.test(headerValue(headers, 'Authorization'));
}

function addRequestTenantHeader(headers) {
  if (hasBearerAuth(headers) || hasExplicitTenantContext(headers) || hasHostTenantContext(headers)) {
    return headers;
  }

  const tenantSlug = getRequestTenantSlug() || normalizeTenantSlug(ACCESSIBLE_TENANT_SLUG);
  if (tenantSlug) {
    headers['X-Tenant-Slug'] = tenantSlug;
  } else if (TENANT_ID) {
    headers['X-Tenant-ID'] = TENANT_ID;
  }
  return headers;
}

function addRequestLocaleHeader(headers) {
  const locale = getRequestLocale();
  if (locale && !hasHeader(headers, 'Accept-Language')) {
    headers['Accept-Language'] = locale;
  }
  return headers;
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const isFormData = typeof globalThis.FormData !== 'undefined' && options.body instanceof globalThis.FormData;

  const headers = addRequestTenantHeader(addRequestLocaleHeader({
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers
  }));

  const timedRequest = withRequestTimeout(options, headers);

  try {
    const response = await fetch(url, timedRequest.config);
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMessage = Array.isArray(data.errors)
        ? data.errors.map(error => error && error.message).filter(Boolean).join('; ')
        : '';
      throw new ApiError(
        errorMessage || data.error || data.message || data.title || 'API request failed',
        response.status,
        data
      );
    }

    return data;
  } catch (error) {
    const mappedError = connectionError(error, timedRequest.didTimeOut());
    if (mappedError) throw mappedError;
    throw error;
  } finally {
    timedRequest.cleanup();
  }
}

async function downloadRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers = addRequestTenantHeader(addRequestLocaleHeader({
    ...options.headers
  }));

  const timedRequest = withRequestTimeout(options, headers);

  try {
    const response = await fetch(url, timedRequest.config);
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      let data;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      throw new ApiError(
        data.error || data.message || data.title || 'API request failed',
        response.status,
        data
      );
    }

    return {
      status: response.status,
      body: Buffer.from(await response.arrayBuffer()),
      headers: {
        'content-type': contentType,
        'content-disposition': response.headers.get('content-disposition') || '',
        'content-length': response.headers.get('content-length') || '',
        'cache-control': response.headers.get('cache-control') || '',
        pragma: response.headers.get('pragma') || '',
        expires: response.headers.get('expires') || '',
        etag: response.headers.get('etag') || '',
        'last-modified': response.headers.get('last-modified') || ''
      }
    };
  } catch (error) {
    const mappedError = connectionError(error, timedRequest.didTimeOut());
    if (mappedError) throw mappedError;
    throw error;
  } finally {
    timedRequest.cleanup();
  }
}

// Auth
async function login(email, password, tenantSlug) {
  const headers = tenantSlugHeaders(tenantSlug);
  return request('/api/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      tenant_slug: tenantSlug
    })
  });
}

async function validateToken(token) {
  return request('/api/auth/validate-token', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function tenantSlugHeaders(tenantSlug) {
  const slug = String(tenantSlug || '').trim();
  return slug ? { 'X-Tenant-Slug': slug } : {};
}

async function register(data, tenantSlug) {
  return request('/api/v2/auth/register', {
    method: 'POST',
    headers: tenantSlugHeaders(tenantSlug),
    body: JSON.stringify(data)
  });
}

async function getRegistrationInfo(tenantSlug) {
  return request('/api/v2/auth/registration-info', {
    headers: tenantSlugHeaders(tenantSlug)
  });
}

async function validateRegistrationInvite(tenantSlug, code) {
  return request('/api/v2/auth/validate-invite', {
    method: 'POST',
    headers: tenantSlugHeaders(tenantSlug),
    body: JSON.stringify({ code })
  });
}

async function refreshToken(refreshToken, tenantSlug = '') {
  return request('/api/auth/refresh-token', {
    method: 'POST',
    headers: tenantSlugHeaders(tenantSlug),
    body: JSON.stringify({ refresh_token: refreshToken })
  });
}

async function logout(token, refreshTokenValue = '') {
  return request('/api/auth/logout', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(refreshTokenValue ? { refresh_token: refreshTokenValue } : {})
  });
}

async function submitContact(data) {
  return request('/api/v2/contact', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

async function getTenants(options = {}) {
  const query = new URLSearchParams();
  if (options.includeMaster) {
    query.set('include_master', '1');
  }

  const queryString = query.toString();
  return request(`/api/v2/tenants${queryString ? `?${queryString}` : ''}`);
}

function normalizeTenantHost(host) {
  const raw = String(host || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }

  const withoutProtocol = raw.replace(/^https?:\/\//, '');
  const withoutPath = withoutProtocol.split('/')[0];
  const withoutPort = withoutPath.includes(':') ? withoutPath.split(':')[0] : withoutPath;
  return withoutPort.replace(/^www\./, '');
}

function tenantHostHeaders(host) {
  const normalizedHost = normalizeTenantHost(host);
  return normalizedHost ? {
    Host: normalizedHost,
    Origin: `https://${normalizedHost}`
  } : {};
}

async function getTenantBootstrap(options = {}) {
  const query = new URLSearchParams();
  if (options.slug) {
    query.set('slug', String(options.slug));
  }

  const queryString = query.toString();
  const endpoint = `/api/v2/tenant/bootstrap${queryString ? `?${queryString}` : ''}`;
  const headers = options.slug ? tenantSlugHeaders(options.slug) : tenantHostHeaders(options.host);

  return request(endpoint, { headers });
}

async function getPlatformStats(options = {}) {
  const slug = options.slug ? String(options.slug).trim() : '';
  const headers = {};

  if (slug) {
    headers['X-Tenant-Slug'] = slug;
  } else {
    Object.assign(headers, tenantHostHeaders(options.host));
  }

  return request('/api/v2/platform/stats', { headers });
}

async function verify2fa(twoFactorToken, code, tenantSlug, options = {}) {
  return request('/api/totp/verify', {
    method: 'POST',
    headers: tenantSlugHeaders(tenantSlug),
    body: JSON.stringify({
      two_factor_token: twoFactorToken,
      code,
      use_backup_code: options.useBackupCode === true,
      trust_device: options.trustDevice === true
    })
  });
}

async function forgotPassword(email, tenantSlug) {
  return request('/api/auth/forgot-password', {
    method: 'POST',
    headers: tenantSlugHeaders(tenantSlug),
    body: JSON.stringify({ email })
  });
}

async function resetPassword(token, password, passwordConfirmation = password) {
  return request('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({
      token,
      password,
      password_confirmation: passwordConfirmation
    })
  });
}

async function resendVerification(email, tenantSlug) {
  return request('/api/auth/resend-verification-by-email', {
    method: 'POST',
    headers: tenantSlugHeaders(tenantSlug),
    body: JSON.stringify({ email })
  });
}

async function verifyEmail(token, tenantSlug) {
  return request('/api/auth/verify-email', {
    method: 'POST',
    headers: tenantSlugHeaders(tenantSlug),
    body: JSON.stringify({ token })
  });
}

async function changePassword(token, currentPassword, newPassword) {
  return request('/api/v2/users/me/password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword
    })
  });
}

// Users / Profile
async function getProfile(token) {
  return request('/api/v2/users/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function updateProfile(token, data) {
  return request('/api/v2/users/me', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function uploadProfileAvatar(token, data) {
  const form = new globalThis.FormData();
  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('avatar', blob, data.file.filename || 'avatar');
  }

  return request('/api/v2/users/me/avatar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function uploadInsuranceCertificate(token, data) {
  const form = new globalThis.FormData();
  form.append('insurance_type', data.insurance_type || '');
  form.append('provider_name', data.provider_name || '');
  form.append('policy_number', data.policy_number || '');
  form.append('coverage_amount', data.coverage_amount || '');
  form.append('start_date', data.start_date || '');
  form.append('expiry_date', data.expiry_date || '');
  form.append('notes', data.notes || '');

  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('certificate_file', blob, data.file.filename || 'certificate');
  }

  return request('/api/v2/users/me/insurance', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function getOnboardingStatus(token) {
  return request('/api/v2/onboarding/status', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getOnboardingConfig(token) {
  return request('/api/v2/onboarding/config', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getOnboardingCategories(token) {
  return request('/api/v2/onboarding/categories', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getOnboardingSafeguardingOptions(token) {
  return request('/api/v2/onboarding/safeguarding-options', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function saveOnboardingSafeguarding(token, preferences) {
  return request('/api/v2/onboarding/safeguarding', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ preferences })
  });
}

async function completeOnboarding(token, data) {
  return request('/api/v2/onboarding/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function getUsers(token, params = {}) {
  const query = new URLSearchParams();
  if (params.q || params.search) query.set('q', params.q || params.search);
  if (params.sort) query.set('sort', params.sort);
  if (params.order) query.set('order', params.order);
  if (params.limit) query.set('limit', params.limit);
  if (params.offset !== undefined && params.offset !== null) query.set('offset', params.offset);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request(`/api/v2/users${suffix}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function searchUsers(token, query, params = {}) {
  const search = new URLSearchParams();
  search.set('q', query || '');
  if (params.limit) search.set('limit', params.limit);

  return request(`/api/v2/users/search?${search.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUser(token, id) {
  return request(`/api/v2/users/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUserV2(token, id) {
  return getUser(token, id);
}

async function getMemberVerificationBadges(token, id) {
  return request(`/api/v2/users/${encodeURIComponent(id)}/verification-badges`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUserListings(token, id, params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.type) query.set('type', params.type);
  if (params.cursor) query.set('cursor', params.cursor);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request(`/api/v2/users/${encodeURIComponent(id)}/listings${suffix}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUserSkills(token, id) {
  return request(`/api/v2/users/${encodeURIComponent(id)}/skills`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUserAvailability(token, id) {
  return request(`/api/v2/users/${encodeURIComponent(id)}/availability`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUserActivityDashboard(token, id) {
  return request(`/api/v2/users/${encodeURIComponent(id)}/activity/dashboard`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUserBlockStatus(token, id) {
  return request(`/api/v2/users/${encodeURIComponent(id)}/block-status`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Listings
async function getListings(token, params = {}) {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  if (params.user_id) query.set('user_id', params.user_id);
  if (params.search || params.q) query.set('q', params.q || params.search);
  if (params.category_id) query.set('category_id', params.category_id);
  if (params.skills) query.set('skills', params.skills);
  if (params.featured_first) query.set('featured_first', 'true');
  if (params.min_hours) query.set('min_hours', params.min_hours);
  if (params.max_hours) query.set('max_hours', params.max_hours);
  if (params.service_type) query.set('service_type', params.service_type);
  if (params.posted_within) query.set('posted_within', params.posted_within);
  if (params.near_lat) query.set('near_lat', params.near_lat);
  if (params.near_lng) query.set('near_lng', params.near_lng);
  if (params.radius_km) query.set('radius_km', params.radius_km);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit || params.per_page) query.set('per_page', params.per_page || params.limit);

  const queryString = query.toString();
  const endpoint = `/api/v2/listings${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function getListing(token, id) {
  return request(`/api/v2/listings/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function getPublicListing(id, tenantSlug) {
  const headers = tenantSlug ? { 'X-Tenant-Slug': tenantSlug } : {};
  return request(`/api/v2/listings/${encodeURIComponent(id)}`, { headers });
}

async function createListing(token, data) {
  return request('/api/v2/listings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function updateListing(token, id, data) {
  return request(`/api/v2/listings/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function deleteListing(token, id) {
  return request(`/api/v2/listings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getListingCategories(token) {
  return request('/api/v2/categories?type=listing', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getPopularListingTags(token, limit = 10) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request(`/api/v2/listings/tags/popular?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function setListingSkillTags(token, id, tags) {
  return request(`/api/v2/listings/${encodeURIComponent(id)}/tags`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tags })
  });
}

async function uploadListingImage(token, id, data) {
  const form = new globalThis.FormData();
  const file = data && (data.file || data.image);
  if (file && file.buffer) {
    const blob = new globalThis.Blob([file.buffer], {
      type: file.contentType || 'application/octet-stream'
    });
    form.append('image', blob, file.filename || 'listing-image');
  }

  return request(`/api/v2/listings/${encodeURIComponent(id)}/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function callListingApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/listings${normalizedPath}`, options);
}

// Laravel volunteering API
async function getVolunteerOrganisations(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.per_page) query.set('per_page', params.per_page);
  if (params.cursor) query.set('cursor', params.cursor);

  const queryString = query.toString();
  const endpoint = `/api/v2/volunteering/organisations${queryString ? `?${queryString}` : ''}`;

  return request(endpoint);
}

async function getClubs(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', params.page);
  if (params.per_page) query.set('per_page', params.per_page);

  const queryString = query.toString();
  const endpoint = `/api/v2/clubs${queryString ? `?${queryString}` : ''}`;

  return request(endpoint);
}

async function getVolunteeringOpportunities(params = {}, token = '') {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.category_id) query.set('category_id', params.category_id);
  if (params.is_remote) query.set('is_remote', params.is_remote);
  if (params.per_page) query.set('per_page', params.per_page);
  if (params.cursor) query.set('cursor', params.cursor);

  const queryString = query.toString();
  const endpoint = `/api/v2/volunteering/opportunities${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, token ? {
    headers: { Authorization: `Bearer ${token}` }
  } : {});
}

async function getVolunteerOrganisation(id, token = '') {
  return request(`/api/v2/volunteering/organisations/${encodeURIComponent(id)}?include=public_contract`, token ? {
    headers: { Authorization: `Bearer ${token}` }
  } : {});
}

async function getVolunteerOpportunity(id, token = '') {
  const options = token
    ? { headers: { Authorization: `Bearer ${token}` } }
    : {};

  return request(`/api/v2/volunteering/opportunities/${encodeURIComponent(id)}`, options);
}

async function getOrganisationOpportunities(organisationId, params = {}) {
  const query = new URLSearchParams();
  query.set('organization_id', organisationId);
  if (params.per_page) query.set('per_page', params.per_page);
  if (params.cursor) query.set('cursor', params.cursor);

  return request(`/api/v2/volunteering/opportunities?${query.toString()}`);
}

async function getOrganisationReviews(organisationId) {
  return request(`/api/v2/volunteering/reviews/organization/${encodeURIComponent(organisationId)}`);
}

async function getKnowledgeBaseArticles(token = '', params = {}) {
  const query = new URLSearchParams();
  const options = token
    ? { headers: { Authorization: `Bearer ${token}` } }
    : {};

  if (params.q) {
    query.set('q', params.q);
    if (params.limit) query.set('limit', params.limit);
    return request(`/api/v2/kb/search?${query.toString()}`, options);
  }

  if (params.per_page) query.set('per_page', params.per_page);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.category_id) query.set('category_id', params.category_id);

  const queryString = query.toString();
  return request(`/api/v2/kb${queryString ? `?${queryString}` : ''}`, options);
}

async function getKnowledgeBaseArticle(token = '', id) {
  const options = token
    ? { headers: { Authorization: `Bearer ${token}` } }
    : {};
  return request(`/api/v2/kb/${encodeURIComponent(id)}`, options);
}

async function getHelpFaqs(params = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.category_id) query.set('category_id', params.category_id);

  const queryString = query.toString();
  return request(`/api/v2/help/faqs${queryString ? `?${queryString}` : ''}`);
}

async function getLegalDocument(type) {
  return request(`/api/v2/legal/${encodeURIComponent(type)}`);
}

async function callNewsletterApi(method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') || path.startsWith('?') ? path : `/${path}`) : '';
  const options = { method };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/newsletter/unsubscribe${normalizedPath}`, options);
}

async function getMyVolunteerOrganisations(token, params = {}) {
  const query = new URLSearchParams();
  if (params.per_page) query.set('per_page', params.per_page);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.status) query.set('status', params.status);

  const queryString = query.toString();
  const endpoint = `/api/v2/volunteering/my-organisations${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function createVolunteerOrganisation(token, data) {
  return request('/api/v2/volunteering/organisations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function callVolunteeringApi(token, method, path, data = undefined) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/volunteering${normalizedPath}`, options);
}

async function uploadVolunteerCredential(token, data) {
  const form = new globalThis.FormData();
  form.append('credential_type', data.credential_type || data.type || '');
  if (data.expires_at) {
    form.append('expires_at', data.expires_at);
  }

  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('file', blob, data.file.filename || 'credential');
  }

  return request('/api/v2/volunteering/credentials', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function callMarketplaceApi(token, method, path, data = undefined) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/marketplace${normalizedPath}`, options);
}

async function callMerchantOnboardingApi(token, method, path = '', data = undefined) {
  const normalizedPath = path === '' ? '' : (path.startsWith('/') ? path : `/${path}`);
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/merchant-onboarding${normalizedPath}`, options);
}

async function callCouponApi(token, method, path = '', data = undefined) {
  const normalizedPath = path === '' ? '' : (path.startsWith('/') ? path : `/${path}`);
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/coupons${normalizedPath}`, options);
}

async function uploadMarketplaceListingImages(token, listingId, data) {
  const form = new globalThis.FormData();
  const files = Array.isArray(data.files) ? data.files : [data.file || data.image].filter(Boolean);
  for (const file of files) {
    if (!file || !file.buffer) continue;
    const blob = new globalThis.Blob([file.buffer], {
      type: file.contentType || 'application/octet-stream'
    });
    form.append('image', blob, file.filename || 'marketplace-image');
  }

  return request(`/api/v2/marketplace/listings/${listingId}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function uploadEventImage(token, eventId, data) {
  const form = new globalThis.FormData();
  const file = data.file || data.image;
  if (file && file.buffer) {
    const blob = new globalThis.Blob([file.buffer], {
      type: file.contentType || 'application/octet-stream'
    });
    form.append('image', blob, file.filename || 'event-image');
  }

  return request(`/api/v2/events/${eventId}/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function callIdeationApi(token, method, path, data = undefined) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2${normalizedPath}`, options);
}

async function callGroupExchangeApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/group-exchanges${normalizedPath}`, options);
}

async function callEventApi(token, method, path = '', data = undefined, requestOptions = {}) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(requestOptions.headers || {}) }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/events${normalizedPath}`, options);
}

async function callEventBroadcastApi(token, method, path = '', data = undefined, requestOptions = {}) {
  const normalizedPath = path ? (path.startsWith('/') || path.startsWith('?') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(requestOptions.headers || {}) }
  };
  if (data !== undefined) options.body = JSON.stringify(data);
  return request(`/api/v2/event-broadcasts${normalizedPath}`, options);
}

async function callAdminEventApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') || path.startsWith('?') ? path : `/${path}`) : '';
  const options = { method, headers: { Authorization: `Bearer ${token}` } };
  if (data !== undefined) options.body = JSON.stringify(data);
  return request(`/api/v2/admin/events${normalizedPath}`, options);
}

async function callEventTemplateApi(token, method, path = '', data = undefined, requestOptions = {}) {
  const normalizedPath = path ? (path.startsWith('/') || path.startsWith('?') ? path : `/${path}`) : '';
  const options = { method, headers: { Authorization: `Bearer ${token}`, ...(requestOptions.headers || {}) } };
  if (data !== undefined) options.body = JSON.stringify(data);
  return request(`/api/v2/event-templates${normalizedPath}`, options);
}

async function getEventCategories(token) {
  return request('/api/v2/categories?type=event', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function downloadEventApi(token, path = '', requestOptions = {}) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = { method: requestOptions.method || 'GET', headers: { Authorization: `Bearer ${token}`, ...(requestOptions.headers || {}) } };
  if (requestOptions.body !== undefined) options.body = JSON.stringify(requestOptions.body);
  return downloadRequest(`/api/v2/events${normalizedPath}`, {
    ...options
  });
}

async function downloadEventRegistrationSubmissions(token, eventId, data) {
  return downloadRequest(`/api/v2/events/${encodeURIComponent(eventId)}/registration-product/submissions/export`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function downloadVolunteerCredential(token, id) {
  return downloadRequest(`/api/v2/volunteering/credentials/${encodeURIComponent(id)}/download`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getVolunteeringCategories(token = '') {
  const options = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  const results = await Promise.all([
    request('/api/v2/categories?type=volunteering', options),
    request('/api/v2/categories?type=volunteer', options)
  ]);
  const categories = [];
  const seen = new Set();

  const rowsFrom = (result) => {
    const data = result && typeof result === 'object' && result.data !== undefined ? result.data : result;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  };

  for (const result of results) {
    for (const category of rowsFrom(result)) {
      const id = Number(category?.id);
      if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      categories.push(category);
    }
  }

  return { data: categories };
}

async function getGoals(token, params = {}) {
  const query = new URLSearchParams();
  if (params.user_id) query.set('user_id', params.user_id);
  if (params.status) query.set('status', params.status);
  if (params.visibility) query.set('visibility', params.visibility);
  if (params.per_page || params.limit) query.set('per_page', params.per_page || params.limit);
  if (params.cursor) query.set('cursor', params.cursor);

  const queryString = query.toString();
  const endpoint = `/api/v2/goals${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getGoal(token, id) {
  return request(`/api/v2/goals/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function callGoalApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/goals${normalizedPath}`, options);
}

async function callCourseApi(token, method, path = '', data = undefined) {
  const normalizedPath = path
    ? (path.startsWith('/') || path.startsWith('?') ? path : `/${path}`)
    : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/courses${normalizedPath}`, options);
}

async function getMyCourses(token) {
  return request('/api/v2/me/courses', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function callGroupApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/groups${normalizedPath}`, options);
}

async function uploadGroupImage(token, groupId, data) {
  const type = data.type === 'cover' ? 'cover' : 'avatar';
  const form = new globalThis.FormData();
  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('image', blob, data.file.filename || 'group-image');
  }

  return request(`/api/v2/groups/${encodeURIComponent(groupId)}/image?type=${encodeURIComponent(type)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function uploadGroupFile(token, groupId, data) {
  const form = new globalThis.FormData();
  form.append('folder', data.folder || '');
  form.append('description', data.description || '');

  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('file', blob, data.file.filename || 'group-file');
  }

  return request(`/api/v2/groups/${encodeURIComponent(groupId)}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function downloadGroupFile(token, path = '') {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  return downloadRequest(`/api/v2/groups${normalizedPath}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function callJobApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/jobs${normalizedPath}`, options);
}

async function uploadJobApplication(token, jobId, data) {
  const form = new globalThis.FormData();
  form.append('message', data.message || '');

  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('cv', blob, data.file.filename || 'cv');
  }

  return request(`/api/v2/jobs/${encodeURIComponent(jobId)}/apply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function callAdminJobApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/admin/jobs${normalizedPath}`, options);
}

async function callJobDownload(token, path = '') {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';

  return downloadRequest(`/api/v2/jobs${normalizedPath}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function callUgcTranslateApi(token, data) {
  return request('/api/v2/ugc-translate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function callUserSettingsApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/users/me${normalizedPath}`, options);
}

async function requestAccountDeletion(token, data) {
  return request('/api/gdpr/delete-account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function callProfileApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2${normalizedPath}`, options);
}

async function callWebAuthnApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/webauthn${normalizedPath}`, options);
}

async function getOrganisationJobs(organisationId, token, params = {}) {
  const query = new URLSearchParams();
  query.set('organization_id', organisationId);
  query.set('status', params.status || 'open');
  if (params.limit) query.set('limit', params.limit);
  if (params.cursor) query.set('cursor', params.cursor);

  const endpoint = `/api/v2/jobs?${query.toString()}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getJobs(token, params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.offset !== undefined && params.offset !== null) query.set('offset', params.offset);
  if (params.status) query.set('status', params.status);
  if (params.sort) query.set('sort', params.sort);
  if (params.search) query.set('search', params.search);
  if (params.type) query.set('type', params.type);
  if (params.commitment) query.set('commitment', params.commitment);
  if (params.is_remote) query.set('is_remote', params.is_remote);
  if (params.organization_id) query.set('organization_id', params.organization_id);
  if (params.cursor) query.set('cursor', params.cursor);

  const endpoint = `/api/v2/jobs${query.toString() ? `?${query.toString()}` : ''}`;

  return request(endpoint, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function getJob(token, id) {
  return request(`/api/v2/jobs/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

// Wallet
async function getBalance(token) {
  return request('/api/v2/wallet/balance', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getTransactions(token, params = {}) {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.per_page || params.limit) query.set('per_page', params.per_page || params.limit);

  const queryString = query.toString();
  const endpoint = `/api/v2/wallet/transactions${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getTransaction(token, id) {
  return request(`/api/v2/wallet/transactions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function transferWalletCredits(token, data) {
  return request('/api/v2/wallet/transfer', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function donateCredits(token, data) {
  return request('/api/v2/wallet/donate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function callWalletApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/wallet${normalizedPath}`, options);
}

async function callWalletDownload(token, path = '') {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  return downloadRequest(`/api/v2/wallet${normalizedPath}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getBookmarks(token, params = {}) {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  if (params.collection_id) query.set('collection_id', params.collection_id);
  if (params.page) query.set('page', params.page);
  if (params.per_page) query.set('per_page', params.per_page);
  const queryString = query.toString();

  return request(`/api/v2/bookmarks${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function unsaveSavedItem(token, itemType, itemId) {
  const query = new URLSearchParams();
  query.set('item_type', itemType);
  query.set('item_id', itemId);

  return request(`/api/v2/me/saved-items?${query.toString()}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function saveSavedItem(token, data) {
  return request('/api/v2/me/saved-items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function checkSavedItem(token, itemType, itemId) {
  const query = new URLSearchParams();
  query.set('item_type', itemType);
  query.set('item_id', itemId);

  return request(`/api/v2/me/saved-items/check?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getSavedCollections(token) {
  return request('/api/v2/me/collections', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getSavedCollectionItems(token, id, params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.per_page) query.set('per_page', params.per_page);
  const queryString = query.toString();

  return request(`/api/v2/me/collections/${encodeURIComponent(id)}/items${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUserPublicCollections(token, userId) {
  return request(`/api/v2/users/${encodeURIComponent(userId)}/public-collections`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUserAppreciations(token, userId, params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.per_page) query.set('per_page', params.per_page);
  const queryString = query.toString();

  return request(`/api/v2/users/${encodeURIComponent(userId)}/appreciations${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function sendAppreciation(token, data) {
  return request('/api/v2/appreciations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function reactToAppreciation(token, id, reactionType) {
  return request(`/api/v2/appreciations/${encodeURIComponent(id)}/react`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reaction_type: reactionType })
  });
}

async function getResources(token, params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.category_id) query.set('category_id', params.category_id);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.per_page) query.set('per_page', params.per_page);

  const queryString = query.toString();
  const endpoint = `/api/v2/resources${queryString ? `?${queryString}` : ''}`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  return request(endpoint, { headers });
}

async function getResourceCategories(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request('/api/v2/resources/categories', { headers });
}

async function getResourceCategoryTree(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request('/api/v2/resources/categories/tree', { headers });
}

async function getSkillCategories(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request('/api/v2/skills/categories', { headers });
}

async function getSkillCategory(token, id) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request(`/api/v2/skills/categories/${encodeURIComponent(id)}`, { headers });
}

async function getSkillMembers(token, skill, params = {}) {
  const query = new URLSearchParams();
  query.set('skill', skill);
  if (params.limit) query.set('limit', params.limit);

  return request(`/api/v2/skills/members?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function downloadResource(token, id) {
  return downloadRequest(`/api/v2/resources/${encodeURIComponent(id)}/download`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function uploadResource(token, data) {
  const form = new globalThis.FormData();
  form.append('title', data.title || '');
  form.append('description', data.description || '');
  if (data.category_id) {
    form.append('category_id', data.category_id);
  }

  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('file', blob, data.file.filename || 'resource');
  }

  return request('/api/v2/resources', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function deleteResource(token, id) {
  return request(`/api/v2/resources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function reorderResources(token, data) {
  return request('/api/v2/resources/reorder', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function createSavedCollection(token, data) {
  return request('/api/v2/me/collections', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function updateSavedCollection(token, id, data) {
  return request(`/api/v2/me/collections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function deleteSavedCollection(token, id) {
  return request(`/api/v2/me/collections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function deleteSavedItem(token, id) {
  return request(`/api/v2/me/saved-items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getBlogPosts(token = '', params = {}) {
  const query = new URLSearchParams();
  if (params.search || params.q) query.set('search', params.search || params.q);
  if (params.category_id || params.category) query.set('category_id', params.category_id || params.category);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.per_page || params.limit) query.set('per_page', params.per_page || params.limit);

  const queryString = query.toString();
  const endpoint = `/api/v2/blog${queryString ? `?${queryString}` : ''}`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  return request(endpoint, { headers });
}

async function getBlogPost(token = '', slug) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request(`/api/v2/blog/${encodeURIComponent(slug)}`, { headers });
}

async function getComments(token = '', params = {}) {
  const query = new URLSearchParams();
  if (params.target_type) query.set('target_type', params.target_type);
  if (params.target_id) query.set('target_id', params.target_id);

  const queryString = query.toString();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request(`/api/v2/comments${queryString ? `?${queryString}` : ''}`, { headers });
}

async function getReactionSummary(token = '', type, id) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request(`/api/v2/reactions/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { headers });
}

async function getReactors(token = '', type, id, reactionType, params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.per_page) query.set('per_page', params.per_page);

  const queryString = query.toString();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request(`/api/v2/reactions/${encodeURIComponent(type)}/${encodeURIComponent(id)}/users/${encodeURIComponent(reactionType)}${queryString ? `?${queryString}` : ''}`, { headers });
}

async function getPolls(token, params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.per_page || params.limit) query.set('per_page', params.per_page || params.limit);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.user_id) query.set('user_id', params.user_id);
  if (params.mine) query.set('mine', '1');
  if (params.category) query.set('category', params.category);
  if (params.event_id) query.set('event_id', params.event_id);

  const queryString = query.toString();
  return request(`/api/v2/polls${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getPoll(token, id) {
  return request(`/api/v2/polls/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getPollCategories(token) {
  return request('/api/v2/polls/categories', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getPollRankedResults(token, id) {
  return request(`/api/v2/polls/${encodeURIComponent(id)}/ranked-results`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getPollExport(token, id) {
  return downloadRequest(`/api/v2/polls/${encodeURIComponent(id)}/export`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function createPoll(token, data) {
  return request('/api/v2/polls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function deletePoll(token, id) {
  return request(`/api/v2/polls/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function votePoll(token, id, data) {
  return request(`/api/v2/polls/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function rankPoll(token, id, data) {
  return request(`/api/v2/polls/${encodeURIComponent(id)}/rank`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function callMatchesApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/matches${normalizedPath}`, options);
}

async function dismissMatch(token, id, reason) {
  return request(`/api/v2/matches/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason })
  });
}

async function performExchangeAction(token, id, action, data = {}) {
  switch (action) {
    case 'accept': return acceptExchange(token, id);
    case 'decline': return declineExchange(token, id, data);
    case 'start': return startExchange(token, id);
    case 'complete': return completeExchange(token, id);
    case 'confirm': return confirmExchange(token, id, data);
    case 'cancel': return cancelExchange(token, id, data);
    default: throw new TypeError('Unsupported exchange action');
  }
}

async function getExchangeConfig(token) {
  return request('/api/v2/exchanges/config', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getExchangeAttentionCount(token) {
  return request('/api/v2/exchanges/needs-attention-count', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function toggleBookmark(token, type, id, collectionId = null) {
  const body = { type, id };
  if (collectionId !== null && collectionId !== undefined) {
    body.collection_id = collectionId;
  }

  return request('/api/v2/bookmarks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
}

async function checkExchangeForListing(token, listingId) {
  return request(`/api/v2/exchanges/check?listing_id=${encodeURIComponent(listingId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getExchanges(token, params = {}) {
  const query = new URLSearchParams();
  if (params.per_page) query.set('per_page', params.per_page);
  if (params.status) query.set('status', params.status);
  if (params.cursor) query.set('cursor', params.cursor);

  const queryString = query.toString();
  return request(`/api/v2/exchanges${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getExchange(token, id) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getExchangeRatings(token, id) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}/ratings`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function createExchangeRequest(token, listingIdOrData, maybeData) {
  const data = maybeData === undefined
    ? listingIdOrData
    : { listing_id: listingIdOrData, ...maybeData };

  return request('/api/v2/exchanges', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function acceptExchange(token, id) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
}

async function declineExchange(token, id, data = {}) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}/decline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function startExchange(token, id) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
}

async function completeExchange(token, id) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
}

async function confirmExchange(token, id, data = {}) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function cancelExchange(token, id, data = {}) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function rateExchange(token, id, data) {
  return request(`/api/v2/exchanges/${encodeURIComponent(id)}/rate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function sendAiChat(token, data) {
  return request('/api/ai/chat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function getAiChatStarters(token) {
  return request('/api/ai/chat/starters', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function sendAiChatMessage(token, data = {}) {
  return sendAiChat(token, data);
}

async function sendAiChatFeedback(token, data = {}) {
  return request('/api/ai/chat/feedback', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function getAiConversations(token, params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.offset) query.set('offset', params.offset);
  const queryString = query.toString();

  return request(`/api/ai/conversations${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getAiConversation(token, id) {
  return request(`/api/ai/conversations/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function createAiConversation(token, data = {}) {
  return request('/api/ai/conversations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function deleteAiConversation(token, id) {
  return request(`/api/ai/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getAiProviders(token) {
  return request('/api/ai/providers', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getAiLimits(token) {
  return request('/api/ai/limits', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getExplore(token) {
  return request('/api/v2/explore', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getMemberPremiumTiers(token) {
  return request('/api/v2/member-premium/tiers', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getMemberPremiumMe(token) {
  return request('/api/v2/member-premium/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function createMemberPremiumCheckout(token, data) {
  return request('/api/v2/member-premium/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function createMemberPremiumPortal(token, data) {
  return request('/api/v2/member-premium/billing-portal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function cancelMemberPremium(token) {
  return request('/api/v2/member-premium/cancel', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Messages
async function callMessageApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/messages${normalizedPath}`, options);
}

async function uploadVoiceMessage(token, data) {
  const form = new globalThis.FormData();
  form.append('recipient_id', String(data.recipient_id || data.recipientId || ''));

  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('voice_message', blob, data.file.filename || 'voice-message');
  }

  return request('/api/v2/messages/voice', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function uploadMessageAttachments(token, data) {
  const form = new globalThis.FormData();
  form.append('recipient_id', String(data.recipient_id || data.recipientId || ''));

  if (data.body !== undefined && data.body !== null) {
    form.append('body', String(data.body));
  }

  if (data.context_type) {
    form.append('context_type', String(data.context_type));
  }

  if (data.context_id !== undefined && data.context_id !== null && data.context_id !== '') {
    form.append('context_id', String(data.context_id));
  }

  const files = Array.isArray(data.files) ? data.files : [data.file].filter(Boolean);
  files.forEach((file) => {
    if (!file || !file.buffer) return;
    const blob = new globalThis.Blob([file.buffer], {
      type: file.contentType || 'application/octet-stream'
    });
    form.append('attachments[]', blob, file.filename || 'attachment');
  });

  return request('/api/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function callConversationApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/conversations${normalizedPath}`, options);
}

async function callPodcastApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/podcasts${normalizedPath}`, options);
}

async function uploadPodcastArtwork(token, showId, file) {
  const form = new globalThis.FormData();
  const blob = new globalThis.Blob([file.buffer], {
    type: file.contentType || 'application/octet-stream'
  });
  form.append('image', blob, file.filename || 'podcast-artwork');

  return request(`/api/v2/podcasts/${encodeURIComponent(showId)}/artwork`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

function appendPodcastEpisodeFields(form, data) {
  const fields = [
    'title', 'slug', 'summary', 'description', 'audio_url', 'audio_mime',
    'audio_bytes', 'duration_seconds', 'episode_number', 'season_number',
    'episode_type', 'visibility', 'transcript', 'transcript_language',
    'scheduled_for'
  ];
  fields.forEach((field) => {
    if (data[field] !== undefined && data[field] !== null) {
      form.append(field, String(data[field]));
    }
  });
  form.append('explicit', data.explicit ? '1' : '0');
  if (data.chapters !== undefined) {
    form.append('chapters', JSON.stringify(data.chapters));
  }
}

async function uploadPodcastEpisode(token, showId, data) {
  const form = new globalThis.FormData();
  appendPodcastEpisodeFields(form, data);

  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('audio', blob, data.file.filename || 'podcast-audio');
  }

  return request(`/api/v2/podcasts/${encodeURIComponent(showId)}/episodes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function callFederationApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/federation${normalizedPath}`, options);
}

async function getConversations(token, params = {}) {
  const query = new URLSearchParams();
  if (params.per_page) query.set('per_page', params.per_page);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.archived !== undefined) query.set('archived', params.archived ? 'true' : 'false');
  const suffix = query.size ? `?${query.toString()}` : '';
  return request(`/api/v2/messages${suffix}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getConversation(token, id, params = {}) {
  const query = new URLSearchParams();
  if (params.cursor) {
    query.set('per_page', String(params.per_page || 50));
    query.set('direction', String(params.direction || 'older'));
    query.set('cursor', String(params.cursor));
  }
  const suffix = query.size ? `?${query.toString()}` : '';
  return request(`/api/v2/messages/${encodeURIComponent(id)}${suffix}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getUnreadCount(token) {
  // Check cache first
  const key = cacheKey(token, 'msg-unread');
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = await request('/api/v2/messages/unread-count', {
    headers: { Authorization: `Bearer ${token}` }
  });

  cache.set(key, result, CACHE_TTL.COUNTS);
  return result;
}

async function sendMessage(token, recipientId, content) {
  return request('/api/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient_id: recipientId, body: content })
  });
}

async function updatePodcastEpisode(token, showId, episodeId, data) {
  const form = new globalThis.FormData();
  form.append('_method', 'PUT');
  appendPodcastEpisodeFields(form, data);

  if (data.file && data.file.buffer) {
    const blob = new globalThis.Blob([data.file.buffer], {
      type: data.file.contentType || 'application/octet-stream'
    });
    form.append('audio', blob, data.file.filename || 'podcast-audio');
  }

  return request(`/api/v2/podcasts/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function uploadPodcastEpisodeCover(token, showId, episodeId, file) {
  const form = new globalThis.FormData();
  const blob = new globalThis.Blob([file.buffer], {
    type: file.contentType || 'application/octet-stream'
  });
  form.append('image', blob, file.filename || 'podcast-episode-cover');

  return request(`/api/v2/podcasts/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}/cover`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function replyToConversation(token, conversationId, content) {
  return request('/api/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient_id: conversationId, body: content })
  });
}

// Alias for sendMessage — kept for backward compatibility with callers
const startConversation = sendMessage;

async function markConversationRead(token, conversationId) {
  const result = await request(`/api/v2/messages/${encodeURIComponent(conversationId)}/read`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  });

  // Invalidate message unread count cache
  cache.delete(cacheKey(token, 'msg-unread'));

  return result;
}

// Connections
async function getConnections(token, params = {}) {
  const filters = typeof params === 'string' ? { status: params } : (params || {});
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.per_page || filters.limit) query.set('per_page', filters.per_page || filters.limit);
  if (filters.cursor) query.set('cursor', filters.cursor);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return request(`/api/v2/connections${suffix}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getPendingConnections(token) {
  return request('/api/v2/connections/pending', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getConnectionsV2(token, params = {}) {
  return getConnections(token, params);
}

async function getConnectionPendingCountsV2(token) {
  return request('/api/v2/connections/pending', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function sendConnectionRequest(token, userId) {
  return request('/api/v2/connections/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: parseInt(userId, 10) })
  });
}

async function getConnectionStatus(token, userId) {
  return getMemberConnectionStatus(token, userId);
}

async function getMemberConnectionStatus(token, userId) {
  return request(`/api/v2/connections/status/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function sendMemberConnectionRequest(token, userId) {
  return request('/api/v2/connections/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: parseInt(userId, 10) })
  });
}

async function acceptMemberConnection(token, connectionId) {
  return request(`/api/v2/connections/${encodeURIComponent(connectionId)}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function declineMemberConnection(token, connectionId) {
  return request(`/api/v2/connections/${encodeURIComponent(connectionId)}/decline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function removeMemberConnection(token, connectionId) {
  return request(`/api/v2/connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function blockMember(token, userId, reason = '') {
  return request(`/api/v2/users/${encodeURIComponent(userId)}/block`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason })
  });
}

async function unblockMember(token, userId) {
  return request(`/api/v2/users/${encodeURIComponent(userId)}/block`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function endorseMemberSkill(token, userId, data) {
  return request(`/api/v2/members/${encodeURIComponent(userId)}/endorse`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function removeMemberEndorsement(token, userId, skillName) {
  return request(`/api/v2/members/${encodeURIComponent(userId)}/endorse`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ skill_name: skillName })
  });
}

async function getMemberEndorsements(token, userId) {
  return request(`/api/v2/members/${encodeURIComponent(userId)}/endorsements`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function acceptConnection(token, connectionId) {
  return request(`/api/v2/connections/${encodeURIComponent(connectionId)}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function declineConnection(token, connectionId) {
  return request(`/api/v2/connections/${encodeURIComponent(connectionId)}/decline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function removeConnection(token, connectionId) {
  return request(`/api/v2/connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Notifications
async function getNotifications(token, params = {}) {
  const query = new URLSearchParams();
  if (params.per_page || params.limit) query.set('per_page', params.per_page || params.limit);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.type) query.set('type', params.type);
  if (params.unread_only) query.set('unread_only', 'true');

  const queryString = query.toString();
  const endpoint = `/api/v2/notifications${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getGroupedNotifications(token, params = {}) {
  const query = new URLSearchParams();
  if (params.per_page || params.limit) query.set('per_page', params.per_page || params.limit);
  if (params.cursor) query.set('cursor', params.cursor);

  const queryString = query.toString();
  const endpoint = `/api/v2/notifications/grouped${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getNotification(token, id) {
  return request(`/api/v2/notifications/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getNotificationUnreadCount(token) {
  // Check cache first
  const key = cacheKey(token, 'notif-unread');
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = await request('/api/v2/notifications/counts', {
    headers: { Authorization: `Bearer ${token}` }
  });

  cache.set(key, result, CACHE_TTL.COUNTS);
  return result;
}

async function markNotificationRead(token, id) {
  const result = await request(`/api/v2/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });

  // Invalidate notification unread count cache
  cache.delete(cacheKey(token, 'notif-unread'));

  return result;
}

async function markAllNotificationsRead(token) {
  const result = await request('/api/v2/notifications/read-all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });

  // Invalidate notification unread count cache
  cache.delete(cacheKey(token, 'notif-unread'));

  return result;
}

async function markNotificationGroupRead(token, groupKey) {
  const result = await request('/api/v2/notifications/group/read', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ group_key: groupKey })
  });

  cache.delete(cacheKey(token, 'notif-unread'));
  return result;
}

async function deleteAllNotifications(token) {
  const result = await request('/api/v2/notifications', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });

  cache.delete(cacheKey(token, 'notif-unread'));
  return result;
}

async function deleteNotification(token, id) {
  const result = await request(`/api/v2/notifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });

  // Invalidate notification unread count cache (deleting unread notification changes count)
  cache.delete(cacheKey(token, 'notif-unread'));

  return result;
}

// Groups
async function getGroups(token, params = {}) {
  const query = new URLSearchParams();
  const perPage = params.per_page || params.limit;
  const search = params.q || params.search;
  if (params.member) query.set('member', params.member);
  if (perPage) query.set('per_page', perPage);
  if (params.cursor) query.set('cursor', params.cursor);
  if (search) query.set('q', search);
  if (params.type) query.set('type', params.type);
  if (params.type_id) query.set('type_id', params.type_id);
  if (params.visibility) query.set('visibility', params.visibility);
  if (params.user_id) query.set('user_id', params.user_id);

  const queryString = query.toString();
  const endpoint = `/api/v2/groups${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getMyGroups(token, params = {}) {
  return getGroups(token, {
    ...params,
    member: 'me',
    per_page: params.per_page || params.limit || 100
  });
}

async function getGroup(token, id) {
  return request(`/api/v2/groups/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function createGroup(token, data) {
  return request('/api/v2/groups', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function updateGroup(token, id, data) {
  return request(`/api/v2/groups/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function deleteGroup(token, id) {
  return request(`/api/v2/groups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getGroupMembers(token, groupId, params = {}) {
  const query = new URLSearchParams();
  const perPage = params.per_page || params.limit;
  if (perPage) query.set('per_page', perPage);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.role) query.set('role', params.role);

  const queryString = query.toString();
  const endpoint = `/api/v2/groups/${encodeURIComponent(groupId)}/members${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function joinGroup(token, groupId) {
  return request(`/api/v2/groups/${encodeURIComponent(groupId)}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function leaveGroup(token, groupId) {
  return request(`/api/v2/groups/${encodeURIComponent(groupId)}/membership`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function removeGroupMember(token, groupId, memberId) {
  return request(`/api/v2/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function updateGroupMemberRole(token, groupId, memberId, role) {
  return request(`/api/v2/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role })
  });
}

// Events
async function getEvents(token, params = {}) {
  const query = new URLSearchParams();
  const perPage = params.per_page || params.limit;
  if (perPage) query.set('per_page', perPage);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.group_id) query.set('group_id', params.group_id);
  if (params.user_id) query.set('user_id', params.user_id);
  if (params.category_id) query.set('category_id', params.category_id);
  if (params.category) query.set('category', params.category);
  if (params.near_lat !== undefined && params.near_lat !== null) query.set('near_lat', params.near_lat);
  if (params.near_lng !== undefined && params.near_lng !== null) query.set('near_lng', params.near_lng);
  if (params.radius_km) query.set('radius_km', params.radius_km);
  if (params.step_free && params.step_free !== 'any') query.set('step_free', params.step_free);
  if (params.when) {
    query.set('when', params.when);
  } else if (params.upcoming_only === false) {
    query.set('when', 'all');
  } else if (params.upcoming_only === true) {
    query.set('when', 'upcoming');
  }
  const search = params.q || params.search;
  if (search) query.set('q', search);

  const queryString = query.toString();
  const endpoint = `/api/v2/events${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function getMyEvents(token) {
  return getEvents(token, { when: 'upcoming', per_page: 3 });
}

async function getEvent(token, id) {
  return request(`/api/v2/events/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function createEvent(token, data) {
  return request('/api/v2/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function updateEvent(token, id, data) {
  return request(`/api/v2/events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function cancelEvent(token, id, data = {}) {
  const idempotencyKey = data.idempotency_key || data.idempotencyKey;
  return request(`/api/v2/events/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify(data)
  });
}

async function deleteEvent(token, id, data = {}) {
  const idempotencyKey = data.idempotency_key || data.idempotencyKey;
  return request(`/api/v2/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify({
      reason: data.reason,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {})
    })
  });
}

async function getEventRsvps(token, eventId, options = 'all') {
  const parameters = options && typeof options === 'object'
    ? options
    : { status: options };
  const query = new URLSearchParams();
  if (parameters.status) query.set('status', parameters.status);
  query.set('per_page', parameters.perPage || parameters.per_page || 20);
  if (parameters.cursor) query.set('cursor', parameters.cursor);
  return request(`/api/v2/events/${encodeURIComponent(eventId)}/attendees?${query.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function rsvpToEvent(token, eventId, status) {
  return request(`/api/v2/events/${encodeURIComponent(eventId)}/rsvp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status })
  });
}

async function removeEventRsvp(token, eventId) {
  return request(`/api/v2/events/${encodeURIComponent(eventId)}/rsvp`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Feed
async function getFeedPosts(token, params = {}) {
  const query = new URLSearchParams();
  if (params.per_page) query.set('per_page', params.per_page);
  if (params.type) query.set('type', params.type);
  if (params.mode) query.set('mode', params.mode);
  if (params.subtype) query.set('subtype', params.subtype);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.group_id) query.set('group_id', params.group_id);
  if (params.user_id) query.set('user_id', params.user_id);
  if (params.personalised !== undefined) query.set('personalised', params.personalised ? 'true' : 'false');
  if (params.tz) query.set('tz', params.tz);

  const queryString = query.toString();
  const endpoint = `/api/v2/feed${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getFeedPostV2(token = '', id) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request(`/api/v2/feed/posts/${encodeURIComponent(id)}`, { headers });
}

async function getFeedItemV2(token = '', type, id) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return request(`/api/v2/feed/items/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { headers });
}

async function getFeedHashtags(token = '', params = {}) {
  const query = new URLSearchParams();
  const searchQuery = params.q !== undefined && params.q !== null ? String(params.q).trim() : '';

  if (searchQuery) query.set('q', searchQuery);
  if (params.limit) query.set('limit', params.limit);
  if (!searchQuery && params.days) query.set('days', params.days);

  const queryString = query.toString();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  if (searchQuery) {
    return request(`/api/v2/feed/hashtags/search${queryString ? `?${queryString}` : ''}`, { headers });
  }
  return request(`/api/v2/feed/hashtags/trending${queryString ? `?${queryString}` : ''}`, { headers });
}

async function getFeedHashtagPosts(token = '', tag, params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.cursor) query.set('cursor', params.cursor);

  const queryString = query.toString();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  return request(`/api/v2/feed/hashtags/${encodeURIComponent(tag)}${queryString ? `?${queryString}` : ''}`, { headers });
}

async function createFeedPostV2(token, data) {
  const file = data.file || data.image;
  if (file && file.buffer) {
    const form = new globalThis.FormData();
    for (const [key, value] of Object.entries(data)) {
      if (['file', 'image', 'image_alt'].includes(key) || value === undefined || value === null) continue;
      form.append(key, String(value));
    }
    const blob = new globalThis.Blob([file.buffer], {
      type: file.contentType || 'application/octet-stream'
    });
    form.append('media[]', blob, file.filename || 'feed-image');
    form.append('alt_texts[]', String(data.image_alt || ''));

    return request('/api/v2/feed/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
  }

  return request('/api/v2/feed/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function updateFeedPostV2(token, id, data) {
  return request(`/api/v2/feed/posts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function deleteFeedPostV2(token, id) {
  return request(`/api/v2/feed/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function toggleFeedLike(token, data) {
  return request('/api/v2/feed/like', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function markFeedItemNotInterested(token, id, data = {}) {
  return request(`/api/v2/feed/posts/${encodeURIComponent(id)}/not-interested`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function hideFeedItem(token, id, data = {}) {
  return request(`/api/v2/feed/posts/${encodeURIComponent(id)}/hide`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function reportFeedItem(token, type, id, data = {}) {
  return request(`/api/v2/feed/items/${encodeURIComponent(type)}/${encodeURIComponent(id)}/report`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function muteFeedUser(token, id) {
  return request(`/api/v2/feed/users/${encodeURIComponent(id)}/mute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function shareFeedItem(token, data) {
  return request('/api/v2/shares', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function voteFeedPoll(token, id, data) {
  return request(`/api/v2/feed/polls/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

// Reports
async function submitReport(token, data) {
  return request('/api/reports', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function submitSupportReport(token, data) {
  return request('/api/v2/support/reports', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function getMyReports(token, params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.limit) query.set('limit', params.limit);
  if (params.status) query.set('status', params.status);

  const queryString = query.toString();
  const endpoint = `/api/reports/my${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Gamification
async function getGamificationProfile(token, userId = null) {
  const query = userId !== null && userId !== undefined
    ? `?user_id=${encodeURIComponent(userId)}`
    : '';
  return request(`/api/v2/gamification/profile${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getSocialLikers(token, data) {
  return request('/api/social/likers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function getGamificationProfileByUserId(token, userId) {
  return getGamificationProfile(token, userId);
}

async function getAllBadges(token, params = {}) {
  const query = new URLSearchParams();
  if (params.user_id !== undefined && params.user_id !== null) query.set('user_id', params.user_id);
  if (params.type) query.set('type', params.type);
  if (params.showcased !== undefined) query.set('showcased', params.showcased ? 'true' : 'false');
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return request(`/api/v2/gamification/badges${suffix}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getMyBadges(token) {
  return getAllBadges(token);
}

async function getLeaderboard(token, params = {}) {
  const query = new URLSearchParams();
  if (params.period) query.set('period', params.period);
  if (params.page) query.set('page', params.page);
  if (params.limit) query.set('limit', params.limit);

  const queryString = query.toString();
  const endpoint = `/api/gamification/leaderboard${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getXpHistory(token, params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.limit) query.set('limit', params.limit);

  const queryString = query.toString();
  const endpoint = `/api/gamification/xp-history${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function gamificationEndpoint(pathValue) {
  const path = String(pathValue || '').trim();
  if (path.startsWith('/achievements/')) {
    return `/api${path}`;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `/api/v2/gamification${normalized}`;
}

async function callGamificationApi(token, method = 'GET', pathValue = '', body = null) {
  return request(gamificationEndpoint(pathValue), {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(body === null ? {} : { body: JSON.stringify(body) })
  });
}

async function claimDailyReward(token) {
  return request('/api/v2/gamification/daily-reward', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function claimGamificationChallenge(token, id) {
  return request(`/api/v2/gamification/challenges/${encodeURIComponent(id)}/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function purchaseGamificationShopItem(token, itemId) {
  return request('/api/v2/gamification/shop/purchase', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ item_id: itemId })
  });
}

async function updateGamificationShowcase(token, badgeKeys) {
  return request('/api/v2/gamification/showcase', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ badge_keys: badgeKeys })
  });
}

// Search
async function searchSuggestions(token, query, limit = 5) {
  const params = new URLSearchParams();
  params.set('q', query);
  if (limit) params.set('limit', limit);

  return request(`/api/v2/search/suggestions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function searchV2(token, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  return request(`/api/v2/search?${query.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getSavedSearches(token) {
  return request('/api/v2/search/saved', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function saveSavedSearch(token, data) {
  return request('/api/v2/search/saved', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function deleteSavedSearch(token, id) {
  return request(`/api/v2/search/saved/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function runSavedSearch(token, id, data = {}) {
  return request(`/api/v2/search/saved/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function getMembers(token, query = '', page = 1, limit = 20) {
  if (query && typeof query === 'object') {
    return getMembersV2(token, query);
  }

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (page) params.set('page', page);
  if (limit) params.set('limit', limit);

  const queryString = params.toString();
  return request(`/api/v2/users${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getMembersV2(token, params = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.sort) query.set('sort', params.sort);
  if (params.order) query.set('order', params.order);
  if (params.limit) query.set('limit', params.limit);
  if (params.offset !== undefined && params.offset !== null) query.set('offset', params.offset);

  const queryString = query.toString();
  return request(`/api/v2/users${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function getMembersNearby(token, params = {}) {
  const query = new URLSearchParams();
  if (params.lat !== undefined && params.lat !== null) query.set('lat', params.lat);
  if (params.lon !== undefined && params.lon !== null) query.set('lon', params.lon);
  if (params.radius_km) query.set('radius_km', params.radius_km);
  if (params.q) query.set('q', params.q);
  if (params.limit) query.set('limit', params.limit);
  if (params.offset !== undefined && params.offset !== null) query.set('offset', params.offset);

  const queryString = query.toString();
  return request(`/api/v2/members/nearby${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Reviews
async function getUserReviews(token, userId, _page = 1, limit = 20) {
  const params = new URLSearchParams();
  if (limit) params.set('per_page', limit);

  const queryString = params.toString();
  return request(`/api/v2/reviews/user/${encodeURIComponent(userId)}${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function createUserReview(token, userId, data) {
  return request('/api/v2/reviews', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receiver_id: userId, ...data })
  });
}

async function getReview(token, reviewId) {
  return request(`/api/v2/reviews/${encodeURIComponent(reviewId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function deleteReview(token, reviewId) {
  return request(`/api/v2/reviews/${encodeURIComponent(reviewId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function callReviewApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };

  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }

  return request(`/api/v2/reviews${normalizedPath}`, options);
}

async function createReview(token, data) {
  return request('/api/v2/reviews', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function createComment(token, data) {
  return request('/api/v2/comments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function updateComment(token, id, data) {
  return request(`/api/v2/comments/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function deleteComment(token, id) {
  return request(`/api/v2/comments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function toggleReaction(token, data) {
  return request('/api/v2/reactions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

// Helper to invalidate all cached data for a user (e.g., on logout)
function invalidateUserCache(token) {
  const prefix = token.substring(0, 40);
  for (const key of cache.cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

// ============================================================================
// Admin API - Requires admin role
// ============================================================================

async function adminGetDashboard(token) {
  return request('/api/admin/dashboard', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminGetUsers(token, params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.limit) query.set('limit', params.limit);
  if (params.role) query.set('role', params.role);
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);

  const queryString = query.toString();
  const endpoint = `/api/admin/users${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminGetUser(token, id) {
  return request(`/api/admin/users/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminUpdateUser(token, id, data) {
  return request(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function adminSuspendUser(token, id, reason = null) {
  return request(`/api/admin/users/${encodeURIComponent(id)}/suspend`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason })
  });
}

async function adminActivateUser(token, id) {
  return request(`/api/admin/users/${encodeURIComponent(id)}/activate`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminGetPendingListings(token, params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.limit) query.set('limit', params.limit);

  const queryString = query.toString();
  const endpoint = `/api/admin/listings/pending${queryString ? `?${queryString}` : ''}`;

  return request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminApproveListing(token, id) {
  return request(`/api/admin/listings/${encodeURIComponent(id)}/approve`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminRejectListing(token, id, reason) {
  return request(`/api/admin/listings/${encodeURIComponent(id)}/reject`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason })
  });
}

async function adminGetCategories(token) {
  return request('/api/admin/categories', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminCreateCategory(token, data) {
  return request('/api/admin/categories', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function adminUpdateCategory(token, id, data) {
  return request(`/api/admin/categories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function adminDeleteCategory(token, id) {
  return request(`/api/admin/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminGetConfig(token) {
  return request('/api/admin/config', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminUpdateConfig(token, config) {
  return request('/api/admin/config', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(config)
  });
}

async function adminGetRoles(token) {
  return request('/api/admin/roles', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function adminCreateRole(token, data) {
  return request('/api/admin/roles', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function adminUpdateRole(token, id, data) {
  return request(`/api/admin/roles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function adminDeleteRole(token, id) {
  return request(`/api/admin/roles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Preferences
async function getPreferences(token) {
  return request('/api/preferences', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function updatePreferences(token, data) {
  return request('/api/preferences', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function getNotificationPreferences(token) {
  return request('/api/preferences/notifications', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function updateNotificationPreference(token, data) {
  return request('/api/preferences/notifications', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

async function getPrivacyPreferences(token) {
  return request('/api/preferences/privacy', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function updatePrivacyPreferences(token, data) {
  return request('/api/preferences/privacy', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
}

module.exports = {
  ApiError,
  ApiOfflineError,
  // Cache
  invalidateUserCache,
  // Auth
  login,
  register,
  getRegistrationInfo,
  validateRegistrationInvite,
  refreshToken,
  logout,
  submitContact,
  getTenants,
  getTenantBootstrap,
  getPlatformStats,
  forgotPassword,
  resetPassword,
  resendVerification,
  verifyEmail,
  changePassword,
  validateToken,
  verify2fa,
  // Users
  getProfile,
  updateProfile,
  uploadProfileAvatar,
  uploadInsuranceCertificate,
  getOnboardingStatus,
  getOnboardingConfig,
  getOnboardingCategories,
  getOnboardingSafeguardingOptions,
  saveOnboardingSafeguarding,
  completeOnboarding,
  getUsers,
  searchUsers,
  getUser,
  getUserV2,
  getMemberVerificationBadges,
  getUserListings,
  getUserSkills,
  getUserAvailability,
  getUserActivityDashboard,
  getUserBlockStatus,
  // Listings
  getListings,
  getListing,
  getPublicListing,
  createListing,
  updateListing,
  deleteListing,
  getListingCategories,
  getPopularListingTags,
  setListingSkillTags,
  uploadListingImage,
  callListingApi,
  // Laravel volunteering
  getVolunteerOrganisations,
  getClubs,
  getVolunteeringOpportunities,
  getVolunteerOrganisation,
  getVolunteerOpportunity,
  getOrganisationOpportunities,
  getOrganisationReviews,
  getKnowledgeBaseArticles,
  getKnowledgeBaseArticle,
  getHelpFaqs,
  getLegalDocument,
  callNewsletterApi,
  getMyVolunteerOrganisations,
  createVolunteerOrganisation,
  callVolunteeringApi,
  uploadVolunteerCredential,
  downloadVolunteerCredential,
  callMarketplaceApi,
  callMerchantOnboardingApi,
  callCouponApi,
  uploadMarketplaceListingImages,
  callCourseApi,
  getMyCourses,
  callGroupApi,
  uploadGroupImage,
  uploadGroupFile,
  downloadGroupFile,
  callIdeationApi,
  callGroupExchangeApi,
  callEventApi,
  callEventBroadcastApi,
  callAdminEventApi,
  callEventTemplateApi,
  downloadEventApi,
  downloadEventRegistrationSubmissions,
  getEventCategories,
  getVolunteeringCategories,
  uploadEventImage,
  getGoals,
  getGoal,
  callGoalApi,
  callUgcTranslateApi,
  callUserSettingsApi,
  requestAccountDeletion,
  callProfileApi,
  callWebAuthnApi,
  getOrganisationJobs,
  getJobs,
  getJob,
  callJobApi,
  uploadJobApplication,
  callAdminJobApi,
  callJobDownload,
  // Wallet
  getBalance,
  getTransactions,
  getTransaction,
  transferWalletCredits,
  donateCredits,
  callWalletApi,
  callWalletDownload,
  getBookmarks,
  saveSavedItem,
  toggleBookmark,
  checkSavedItem,
  unsaveSavedItem,
  getSavedCollections,
  getSavedCollectionItems,
  getUserPublicCollections,
  getUserAppreciations,
  sendAppreciation,
  reactToAppreciation,
  getResources,
  getResourceCategories,
  getResourceCategoryTree,
  getSkillCategories,
  getSkillCategory,
  getSkillMembers,
  uploadResource,
  downloadResource,
  deleteResource,
  reorderResources,
  createSavedCollection,
  updateSavedCollection,
  deleteSavedCollection,
  deleteSavedItem,
  getBlogPosts,
  getBlogPost,
  getComments,
  getReactionSummary,
  getReactors,
  getPolls,
  getPoll,
  getPollCategories,
  getPollRankedResults,
  getPollExport,
  createPoll,
  deletePoll,
  votePoll,
  rankPoll,
  callMatchesApi,
  dismissMatch,
  getExchangeConfig,
  getExchangeAttentionCount,
  checkExchangeForListing,
  getExchanges,
  getExchange,
  getExchangeRatings,
  performExchangeAction,
  createExchangeRequest,
  acceptExchange,
  declineExchange,
  startExchange,
  completeExchange,
  confirmExchange,
  cancelExchange,
  rateExchange,
  sendAiChat,
  getAiChatStarters,
  sendAiChatMessage,
  sendAiChatFeedback,
  getAiConversations,
  getAiConversation,
  createAiConversation,
  deleteAiConversation,
  getAiProviders,
  getAiLimits,
  getExplore,
  getMemberPremiumTiers,
  getMemberPremiumMe,
  createMemberPremiumCheckout,
  createMemberPremiumPortal,
  cancelMemberPremium,
  // Messages
  callMessageApi,
  uploadVoiceMessage,
  uploadMessageAttachments,
  callConversationApi,
  callPodcastApi,
  uploadPodcastArtwork,
  uploadPodcastEpisode,
  updatePodcastEpisode,
  uploadPodcastEpisodeCover,
  callFederationApi,
  getConversations,
  getConversation,
  getUnreadCount,
  sendMessage,
  replyToConversation,
  startConversation,
  markConversationRead,
  // Connections
  getConnections,
  getPendingConnections,
  getConnectionsV2,
  getConnectionPendingCountsV2,
  getConnectionStatus,
  sendConnectionRequest,
  getMemberConnectionStatus,
  sendMemberConnectionRequest,
  acceptMemberConnection,
  declineMemberConnection,
  removeMemberConnection,
  blockMember,
  unblockMember,
  endorseMemberSkill,
  removeMemberEndorsement,
  getMemberEndorsements,
  acceptConnection,
  declineConnection,
  removeConnection,
  // Notifications
  getNotifications,
  getGroupedNotifications,
  getNotification,
  getNotificationUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  markNotificationGroupRead,
  deleteAllNotifications,
  deleteNotification,
  // Groups
  getGroups,
  getMyGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  getGroupMembers,
  joinGroup,
  leaveGroup,
  removeGroupMember,
  updateGroupMemberRole,
  // Events
  getEvents,
  getMyEvents,
  getEvent,
  createEvent,
  updateEvent,
  cancelEvent,
  deleteEvent,
  getEventRsvps,
  rsvpToEvent,
  removeEventRsvp,
  // Feed
  getFeedPosts,
  getFeedPostV2,
  getFeedItemV2,
  getFeedHashtags,
  getFeedHashtagPosts,
  createFeedPostV2,
  updateFeedPostV2,
  deleteFeedPostV2,
  toggleFeedLike,
  getSocialLikers,
  markFeedItemNotInterested,
  hideFeedItem,
  reportFeedItem,
  muteFeedUser,
  shareFeedItem,
  voteFeedPoll,
  // Reports
  submitReport,
  submitSupportReport,
  getMyReports,
  // Gamification
  getGamificationProfile,
  getGamificationProfileByUserId,
  getAllBadges,
  getMyBadges,
  getLeaderboard,
  getXpHistory,
  callGamificationApi,
  claimDailyReward,
  claimGamificationChallenge,
  purchaseGamificationShopItem,
  updateGamificationShowcase,
  // Search
  searchSuggestions,
  searchV2,
  getSavedSearches,
  saveSavedSearch,
  deleteSavedSearch,
  runSavedSearch,
  getMembers,
  getMembersV2,
  getMembersNearby,
  // Reviews
  getUserReviews,
  createUserReview,
  getReview,
  deleteReview,
  callReviewApi,
  createReview,
  createComment,
  updateComment,
  deleteComment,
  toggleReaction,
  // Admin
  adminGetDashboard,
  adminGetUsers,
  adminGetUser,
  adminUpdateUser,
  adminSuspendUser,
  adminActivateUser,
  adminGetPendingListings,
  adminApproveListing,
  adminRejectListing,
  adminGetCategories,
  adminCreateCategory,
  adminUpdateCategory,
  adminDeleteCategory,
  adminGetConfig,
  adminUpdateConfig,
  adminGetRoles,
  adminCreateRole,
  adminUpdateRole,
  adminDeleteRole,
  // Preferences
  getPreferences,
  updatePreferences,
  getNotificationPreferences,
  updateNotificationPreference,
  getPrivacyPreferences,
  updatePrivacyPreferences
};
