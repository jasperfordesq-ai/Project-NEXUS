// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  getConnections,
  getConnectionPendingCountsV2,
  acceptMemberConnection,
  declineMemberConnection,
  removeMemberConnection,
  ApiError
} = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const NETWORK_TABS = new Set(['accepted', 'pending_received', 'pending_sent']);
const NETWORK_STATUSES = new Set(['connection-accepted', 'connection-declined', 'connection-removed', 'connection-failed']);

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function dataFrom(result) {
  return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : result;
}

function metaFrom(result) {
  return result && typeof result === 'object' && result.meta && typeof result.meta === 'object'
    ? result.meta
    : {};
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.data)) return value.data;
  return [];
}

function trimmed(value, limit = null) {
  const text = String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (limit === null || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function allowed(value, choices, fallback) {
  const text = String(value || '').trim();
  return choices.has(text) ? text : fallback;
}

function memberName(member, t = (key) => key) {
  const profileType = trimmed(member.profile_type);
  const organisationName = trimmed(member.organization_name);
  if (profileType === 'organisation' && organisationName) return organisationName;

  const name = trimmed(member.name);
  if (name) return name;

  const fullName = trimmed(`${trimmed(member.first_name)} ${trimmed(member.last_name)}`);
  return fullName || t('govuk_alpha_connections.common.unknown_member');
}

function formatCount(value) {
  return new Intl.NumberFormat(getRequestIntlLocale(), { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatMonthYear(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), { month: 'long', year: 'numeric' }).format(date);
}

function normaliseConnection(connection, t) {
  const row = asObject(connection);
  const partner = asObject(row.partner || row.user || row.other_user || row.otherUser);
  const partnerId = partner.id || row.user_id || row.userId || '';
  const connectionId = row.connection_id || row.id || '';
  const createdMonth = formatMonthYear(row.created_at || row.createdAt);

  return {
    id: connectionId,
    partnerId,
    name: memberName(partner, t),
    location: trimmed(partner.location),
    bio: trimmed(partner.bio, 160),
    createdMonth,
    messageHref: partnerId ? `/messages/new/${encodeURIComponent(partnerId)}` : '',
    profileHref: partnerId ? `/members/${encodeURIComponent(partnerId)}` : '',
    removeAction: connectionId ? `/connections/${encodeURIComponent(connectionId)}/remove` : '',
    acceptAction: connectionId ? `/connections/${encodeURIComponent(connectionId)}/accept` : '',
    declineAction: connectionId ? `/connections/${encodeURIComponent(connectionId)}/decline` : ''
  };
}

function connectionMatchesSearch(connection, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return connection.name.toLowerCase().includes(needle) || connection.location.toLowerCase().includes(needle);
}

function networkHref(tab, q = '', cursor = '') {
  const query = new URLSearchParams();
  query.set('tab', tab);
  if (q) query.set('q', q);
  if (cursor) query.set('cursor', cursor);
  const queryString = query.toString();
  return `/connections/network${queryString ? `?${queryString}` : ''}`;
}

async function loadNetworkSection(token, status, activeTab, cursor, t) {
  const params = { status, per_page: 20 };
  if (cursor && status === activeTab) {
    params.cursor = cursor;
  }

  const result = await getConnections(token, params);
  const meta = metaFrom(result);
  return {
    items: asList(dataFrom(result)).map((connection) => normaliseConnection(connection, t)),
    cursor: trimmed(meta.cursor),
    hasMore: meta.has_more === true || meta.has_more === 1 || meta.has_more === '1'
  };
}

function countsFrom(result) {
  const data = asObject(dataFrom(result));
  return {
    received: Number.parseInt(data.received, 10) || 0,
    sent: Number.parseInt(data.sent, 10) || 0,
    total_friends: Number.parseInt(data.total_friends, 10) || 0
  };
}

function emptyNetworkSection() {
  return {
    items: [],
    cursor: '',
    hasMore: false
  };
}

function connectionActionUrl(status) {
  return `/connections?status=${encodeURIComponent(status)}#connections-top`;
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

router.get('/network', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const activeTab = allowed(req.query.tab, NETWORK_TABS, 'accepted');
  const connSearch = trimmed(req.query.q, 120);
  const cursor = trimmed(req.query.cursor, 512);
  const status = allowed(req.query.status, NETWORK_STATUSES, '');
  const t = res.locals.t;

  let counts = { received: 0, sent: 0, total_friends: 0 };
  const sections = {
    accepted: emptyNetworkSection(),
    pending_received: emptyNetworkSection(),
    pending_sent: emptyNetworkSection()
  };
  try {
    const [countsResult, accepted, received, sent] = await Promise.all([
      getConnectionPendingCountsV2(token),
      loadNetworkSection(token, 'accepted', activeTab, cursor, t),
      loadNetworkSection(token, 'pending_received', activeTab, cursor, t),
      loadNetworkSection(token, 'pending_sent', activeTab, cursor, t)
    ]);

    counts = countsFrom(countsResult);
    sections.accepted = accepted;
    sections.pending_received = received;
    sections.pending_sent = sent;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    // Laravel reports the failure and renders the canonical empty sections.
  }

  if (connSearch) {
    for (const section of Object.values(sections)) {
      section.items = section.items.filter((item) => connectionMatchesSearch(item, connSearch));
      section.cursor = '';
      section.hasMore = false;
    }
  }

  res.render('connections/network', {
    title: t('govuk_alpha_connections.network.title'),
    activeNav: 'connections',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    activeTab,
    sections,
    counts,
    connSearch,
    status,
    countLabels: {
      accepted: formatCount(counts.total_friends),
      received: formatCount(counts.received),
      sent: formatCount(counts.sent)
    },
    hasSearch: connSearch !== '',
    tabHrefs: {
      accepted: networkHref('accepted', connSearch),
      pending_received: networkHref('pending_received', connSearch),
      pending_sent: networkHref('pending_sent', connSearch)
    },
    loadMoreHrefs: {
      accepted: sections.accepted.hasMore && sections.accepted.cursor ? `${networkHref('accepted', '', sections.accepted.cursor)}#net-accepted-heading` : '',
      pending_received: sections.pending_received.hasMore && sections.pending_received.cursor ? `${networkHref('pending_received', '', sections.pending_received.cursor)}#net-received-heading` : '',
      pending_sent: sections.pending_sent.hasMore && sections.pending_sent.cursor ? `${networkHref('pending_sent', '', sections.pending_sent.cursor)}#net-sent-heading` : ''
    }
  });
}, { redirectOn401: '/login?status=auth-required' }));

router.use(requireAuth);

// Laravel-style connections inbox: accepted, received, and sent together.
router.get('/', asyncRoute(async (req, res) => {
  const requestedStatus = String(req.query.status || '').trim();
  const actionStatus = NETWORK_STATUSES.has(requestedStatus) ? requestedStatus : '';
  const connSearch = trimmed(req.query.q, 120);
  const t = res.locals.t;
  let counts = { received: 0, sent: 0, total_friends: 0 };
  let acceptedConnections = [];
  let receivedRequests = [];
  let sentRequests = [];

  try {
    const [countsResult, accepted, received, sent] = await Promise.all([
      getConnectionPendingCountsV2(req.token),
      getConnections(req.token, { status: 'accepted', per_page: 50 }),
      getConnections(req.token, { status: 'pending_received', per_page: 50 }),
      getConnections(req.token, { status: 'pending_sent', per_page: 50 })
    ]);
    counts = countsFrom(countsResult);
    acceptedConnections = asList(dataFrom(accepted)).map((row) => normaliseConnection(row, t));
    receivedRequests = asList(dataFrom(received)).map((row) => normaliseConnection(row, t));
    sentRequests = asList(dataFrom(sent)).map((row) => normaliseConnection(row, t));

    if (connSearch) {
      acceptedConnections = acceptedConnections.filter((row) => connectionMatchesSearch(row, connSearch));
      receivedRequests = receivedRequests.filter((row) => connectionMatchesSearch(row, connSearch));
      sentRequests = sentRequests.filter((row) => connectionMatchesSearch(row, connSearch));
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    // Laravel reports the failure and renders the canonical empty sections.
  }

  res.render('connections/index', {
    title: res.locals.t('connections.title'),
    communityName: res.locals.tenantName || res.locals.serviceName || '',
    acceptedConnections,
    receivedRequests,
    sentRequests,
    counts,
    countLabels: {
      accepted: formatCount(counts.total_friends),
      received: formatCount(counts.received),
      sent: formatCount(counts.sent)
    },
    connSearch,
    status: actionStatus,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
  });
}, { redirectOn401: '/login?status=auth-required' }));

// Accept connection request
router.post('/:id/accept', asyncRoute(async (req, res) => {
  const { id } = req.params;

  try {
    await acceptMemberConnection(req.token, id);
    return redirectTo(res, connectionActionUrl('connection-accepted'));
  } catch (error) {
    // Handle non-401 API errors with flash message
    if (error instanceof ApiError && error.status !== 401) {
      return redirectTo(res, connectionActionUrl('connection-failed'));
    }
    throw error; // Re-throw for asyncRoute to handle 401/503
  }
}));

// Decline connection request
router.post('/:id/decline', asyncRoute(async (req, res) => {
  const { id } = req.params;

  try {
    await declineMemberConnection(req.token, id);
    return redirectTo(res, connectionActionUrl('connection-declined'));
  } catch (error) {
    // Handle non-401 API errors with flash message
    if (error instanceof ApiError && error.status !== 401) {
      return redirectTo(res, connectionActionUrl('connection-failed'));
    }
    throw error; // Re-throw for asyncRoute to handle 401/503
  }
}));

// Remove connection or cancel pending request
router.post('/:id/remove', asyncRoute(async (req, res) => {
  const { id } = req.params;

  try {
    await removeMemberConnection(req.token, id);
    return redirectTo(res, connectionActionUrl('connection-removed'));
  } catch (error) {
    // Handle non-401 API errors with flash message
    if (error instanceof ApiError && error.status !== 401) {
      return redirectTo(res, connectionActionUrl('connection-failed'));
    }
    throw error; // Re-throw for asyncRoute to handle 401/503
  }
}));

module.exports = router;
