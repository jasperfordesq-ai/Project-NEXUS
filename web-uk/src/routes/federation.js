// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { randomUUID } = require('crypto');
const {
  ApiError,
  ApiOfflineError,
  callFederationApi,
  getBalance
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { flagEnabled } = require('../lib/accessible-shell');

const router = express.Router();

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function tenantFeatureEnabled(req, key, fallback = true) {
  const tenant = req.accessibleRouting?.tenant;
  if (!tenant || typeof tenant !== 'object') return fallback;
  return flagEnabled(tenant, key, 'features', fallback);
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
  if (value && Array.isArray(value.partners)) return value.partners;
  if (value && Array.isArray(value.data)) return value.data;
  return [];
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function partnerHref(id) {
  const text = trimmed(id, 32);
  return text ? `/federation/partners/${encodeURIComponent(text)}` : '/federation/partners';
}

function normalizePartner(partner, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key;
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
  const formatNumber = typeof options.formatNumber === 'function' ? options.formatNumber : (value) => String(value);
  const name = trimmed(partner && partner.name) || t('federation.title');
  const id = partner && partner.id !== undefined ? partner.id : '';
  const taglineLimit = Object.prototype.hasOwnProperty.call(options, 'taglineLimit') ? options.taglineLimit : 200;
  const permissions = Array.isArray(partner && partner.permissions)
    ? partner.permissions.map((permission) => trimmed(permission)).filter(Boolean)
    : [];
  const levelName = trimmed(partner && (partner.level_name || partner.federation_level_name || partner.level));
  const knownLevels = new Set(['discovery', 'social', 'economic', 'integrated', 'external']);
  const knownPermissions = new Set(['profiles', 'listings', 'events', 'messaging', 'transactions', 'groups']);
  const partnershipSince = partner && partner.partnership_since ? partner.partnership_since : '';
  const partnershipDateOptions = options.partnershipDateOptions || {
    day: undefined,
    month: 'long',
    year: 'numeric'
  };
  const memberCount = numberOrZero(partner && partner.member_count);
  const listingCount = numberOrZero(partner && partner.listing_count);

  return {
    id,
    name,
    href: partnerHref(id),
    tagline: trimmed(partner && partner.tagline, taglineLimit),
    location: trimmed(partner && partner.location),
    country: trimmed(partner && partner.country),
    memberCount,
    memberCountLabel: formatNumber(memberCount),
    listingCount,
    listingCountLabel: formatNumber(listingCount),
    levelName,
    levelLabel: knownLevels.has(levelName) ? t(`federation.levels.${levelName}`) : levelName,
    partnershipSince,
    partnershipSinceLabel: partnershipSince
      ? formatDate(partnershipSince, partnershipDateOptions)
      : '',
    isExternal: bool(partner && partner.is_external),
    permissions,
    permissionLabels: permissions.map((permission) => (
      knownPermissions.has(permission) ? t(`federation.permissions.${permission}`) : permission
    ))
  };
}

function validPartnerId(id) {
  return /^\d+$/.test(id) || /^ext-\d+$/.test(id);
}

function isInternalPartner(partner) {
  return partner && !partner.isExternal && /^\d+$/.test(String(partner.id || ''));
}

function memberHref(member) {
  const id = trimmed(member && member.id, 32);
  const tenantId = trimmed(member && member.tenantId, 32);
  const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return id ? `/federation/members/${encodeURIComponent(id)}${query}` : '/federation/members';
}

function normalizeMember(member, options = {}) {
  const hasTranslator = typeof options.t === 'function';
  const t = hasTranslator ? options.t : (key) => key;
  const formatNumber = typeof options.formatNumber === 'function' ? options.formatNumber : (value) => String(value);
  const timebank = asObject(member && member.timebank);
  const tenantId = member && member.tenant_id !== undefined ? member.tenant_id : timebank.id;
  const name = trimmed(member && member.name)
    || trimmed(`${trimmed(member && member.first_name)} ${trimmed(member && member.last_name)}`)
    || (hasTranslator ? t('members.unknown_member') : 'Federation member');
  const bioLimit = Object.prototype.hasOwnProperty.call(options, 'bioLimit') ? options.bioLimit : 160;
  const skills = Array.isArray(member && member.skills)
    ? member.skills.map((skill) => trimmed(skill)).filter(Boolean)
    : [];
  const connectionStatus = asObject(member && member.connection_status);
  const serviceReach = trimmed(member && member.service_reach);
  const reachKeys = new Set(['local_only', 'remote_ok', 'travel_ok']);
  const reputationScore = numberOrNull(member && (member.reputation_score || member.trust_score));
  const reputationCount = numberOrZero(member && member.reputation_count);

  return {
    id: member && member.id !== undefined ? member.id : '',
    name,
    href: memberHref({ id: member && member.id, tenantId }),
    avatar: trimmed(member && member.avatar),
    bio: trimmed(member && member.bio, bioLimit),
    location: trimmed(member && member.location),
    serviceReach,
    serviceReachLabel: reachKeys.has(serviceReach) ? t(`federation.settings.reach_${serviceReach}`) : '',
    skills,
    visibleSkills: skills.slice(0, 5),
    moreSkillsLabel: skills.length > 5
      ? t('federation.members_browse.more_skills', { count: skills.length - 5 })
      : '',
    tenantId,
    tenantName: trimmed((member && member.tenant_name) || timebank.name),
    messagingEnabled: bool(member && member.messaging_enabled),
    transactionsEnabled: bool(member && member.transactions_enabled),
    showReviews: bool(member && member.show_reviews),
    reputationScore,
    reputationScoreLabel: formatNumber(reputationScore ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    reputationCount,
    reputationTagClass: reputationScore !== null && reputationScore >= 4.5
      ? 'govuk-tag--green'
      : (reputationScore !== null && reputationScore >= 3.5 ? 'govuk-tag--blue' : 'govuk-tag--yellow'),
    reputationCountLabel: hasTranslator
      ? t('fed2.reviews.reputation_count', { count: reputationCount })
      : String(reputationCount),
    connectionStatus: trimmed(connectionStatus.status || 'none'),
    connectionId: connectionStatus.connection_id || null
  };
}

function normalizeReview(review, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key;
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
  const reviewer = asObject(review && review.reviewer);
  const partner = asObject(review && review.partner);
  const createdAt = review && review.created_at ? review.created_at : '';

  return {
    id: review && review.id,
    rating: numberOrZero(review && review.rating),
    comment: trimmed(review && review.comment),
    createdAt,
    createdAtLabel: createdAt ? formatDate(createdAt, { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    reviewerName: trimmed((review && review.reviewer_name) || reviewer.name) || t('fed2.reviews.anonymous'),
    partnerName: trimmed((review && review.partner_name) || partner.name),
    verified: bool(review && review.verified)
  };
}

function connectionHref(connection) {
  const id = trimmed(connection && connection.userId, 32);
  const tenantId = trimmed(connection && connection.tenantId, 32);
  const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return id ? `/federation/members/${encodeURIComponent(id)}${query}` : '/federation/members';
}

function normalizeConnection(connection, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key;
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
  const createdAt = connection && connection.created_at ? connection.created_at : '';
  const normalized = {
    id: connection && connection.id,
    userId: connection && (connection.user_id || connection.userId),
    name: trimmed(connection && connection.name) || t('members.unknown_member'),
    tenantId: connection && (connection.tenant_id || connection.tenantId),
    tenantName: trimmed(connection && (connection.tenant_name || connection.tenantName)),
    status: trimmed(connection && connection.status),
    direction: trimmed(connection && connection.direction),
    message: trimmed(connection && connection.message, 500),
    createdAt,
    createdAtLabel: createdAt ? formatDate(createdAt, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  };

  normalized.href = connectionHref(normalized);
  normalized.isReceived = normalized.status === 'pending' && normalized.direction === 'incoming';
  normalized.isSent = normalized.status === 'pending' && normalized.direction === 'outgoing';
  normalized.isAccepted = normalized.status === 'accepted';
  return normalized;
}

function normalizeGroup(group, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key;
  const formatNumber = typeof options.formatNumber === 'function' ? options.formatNumber : (value) => String(value);
  const timebank = asObject(group && group.timebank);
  const tenantId = group && group.tenant_id !== undefined ? group.tenant_id : timebank.id;
  const memberCount = numberOrZero(group && group.member_count);

  return {
    id: group && group.id,
    name: trimmed(group && group.name) || t('polish_federation.groups_title'),
    description: trimmed(group && group.description, 200),
    privacy: trimmed(group && group.privacy),
    memberCount,
    memberCountLabel: formatNumber(memberCount),
    coverImage: trimmed(group && group.cover_image),
    tenantId,
    tenantName: trimmed((group && group.tenant_name) || timebank.name),
    createdAt: group && group.created_at ? group.created_at : ''
  };
}

function normalizeEvent(event, upcoming = true, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key;
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
  const formatNumber = typeof options.formatNumber === 'function' ? options.formatNumber : (value) => String(value);
  const timebank = asObject(event && event.timebank);
  const organizer = asObject(event && (event.organizer || event.organiser));
  const tenantId = event && event.tenant_id !== undefined ? event.tenant_id : timebank.id;
  const startDate = event && (event.start_date || event.startDate || event.created_at) ? (event.start_date || event.startDate || event.created_at) : '';
  const timestamp = startDate ? Date.parse(startDate) : Number.NaN;

  const normalized = {
    id: event && event.id,
    title: trimmed(event && event.title) || t('federation.events_browse.title'),
    description: trimmed(event && event.description, 160),
    startDate,
    endDate: event && (event.end_date || event.endDate) ? (event.end_date || event.endDate) : '',
    location: trimmed(event && event.location),
    isOnline: bool(event && event.is_online),
    coverImage: trimmed(event && event.cover_image),
    attendeesCount: numberOrZero(event && event.attendees_count),
    maxAttendees: numberOrNull(event && event.max_attendees),
    organiserName: trimmed(
      (event && event.organiser_name)
      || organizer.name
      || `${trimmed(event && event.first_name)} ${trimmed(event && event.last_name)}`
    ),
    tenantId,
    tenantName: trimmed((event && event.tenant_name) || timebank.name),
    isPast: !upcoming && Number.isFinite(timestamp) && timestamp < Date.now()
  };
  normalized.startDateLabel = startDate
    ? formatDate(startDate, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  normalized.attendeesCountLabel = t('federation.events_browse.attendees_count', { count: formatNumber(normalized.attendeesCount) });
  return normalized;
}

function listingHref(listing) {
  const tenantId = trimmed(listing && listing.tenantId, 32);
  const id = trimmed(listing && listing.id, 32);
  return tenantId && id ? `/federation/listings/${encodeURIComponent(tenantId)}/${encodeURIComponent(id)}` : '';
}

function normalizeListing(listing, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key;
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
  const formatNumber = typeof options.formatNumber === 'function' ? options.formatNumber : (value) => String(value);
  const author = asObject(listing && (listing.author || listing.owner));
  const timebank = asObject(listing && listing.timebank);
  const tenantId = listing && listing.tenant_id !== undefined ? listing.tenant_id : timebank.id;
  const type = trimmed(listing && listing.type) === 'request' ? 'request' : 'offer';
  const descriptionLimit = Object.prototype.hasOwnProperty.call(options, 'descriptionLimit') ? options.descriptionLimit : 160;
  const normalized = {
    id: listing && listing.id,
    title: trimmed(listing && listing.title) || t('federation.listings_browse.title'),
    description: trimmed(listing && listing.description, descriptionLimit),
    type,
    categoryName: trimmed((listing && listing.category_name) || (listing && listing.category)),
    imageUrl: trimmed(listing && listing.image_url),
    estimatedHours: numberOrNull(listing && (listing.estimated_hours || listing.rate || listing.price)),
    location: trimmed(listing && listing.location),
    authorId: listing && listing.user_id !== undefined ? listing.user_id : author.id,
    authorName: trimmed(
      (listing && listing.author_name)
      || author.name
      || `${trimmed(listing && listing.first_name)} ${trimmed(listing && listing.last_name)}`
    ) || t('federation.listings_browse.anonymous_user'),
    tenantId,
    tenantName: trimmed((listing && listing.tenant_name) || timebank.name),
    createdAt: listing && listing.created_at ? listing.created_at : '',
    isExternal: bool(listing && listing.is_external)
  };
  normalized.typeLabel = t(`federation.listings_browse.type_${type}`);
  normalized.estimatedHoursLabel = normalized.estimatedHours !== null
    ? t('federation.listings_browse.hours_estimated', { hours: formatNumber(normalized.estimatedHours) })
    : '';
  normalized.createdAtLabel = normalized.createdAt
    ? formatDate(normalized.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  normalized.href = listingHref(normalized);
  return normalized;
}

function listingMemberHref(listing) {
  const authorId = trimmed(listing && listing.authorId, 32);
  const tenantId = trimmed(listing && listing.tenantId, 32);
  const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return authorId ? `/federation/members/${encodeURIComponent(authorId)}${query}` : '';
}

function participantName(participant, t = (key) => key) {
  return trimmed(participant && participant.name)
    || trimmed(`${trimmed(participant && participant.first_name)} ${trimmed(participant && participant.last_name)}`)
    || t('fed2.messages.someone');
}

function threadHref(thread) {
  const id = trimmed(thread && thread.partnerUserId, 32);
  const tenantId = trimmed(thread && thread.partnerTenantId, 32);
  const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return id ? `/federation/messages/conversation/${encodeURIComponent(id)}${query}` : '/federation/messages';
}

function normalizeMessageThreads(messages, query = '', options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key;
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
  const byThread = new Map();

  asList(messages).forEach((message) => {
    const sender = asObject(message && message.sender);
    const receiver = asObject(message && message.receiver);
    const outbound = trimmed(message && message.direction) === 'outbound';
    const partner = outbound ? receiver : sender;
    const partnerUserId = partner.id !== undefined ? partner.id : '';
    const partnerTenantId = partner.tenant_id !== undefined ? partner.tenant_id : partner.tenantId;
    const key = `${partnerUserId}-${partnerTenantId}`;
    const body = trimmed(message && message.body, 120);

    if (!byThread.has(key)) {
      byThread.set(key, {
        partnerUserId,
        partnerTenantId,
        partnerName: participantName(partner, t),
        partnerTenantName: trimmed(partner.tenant_name || partner.tenantName),
        lastSubject: trimmed(message && message.subject),
        lastPreview: body,
        lastCreatedAt: message && message.created_at ? message.created_at : '',
        lastCreatedAtLabel: message && message.created_at
          ? formatDate(message.created_at, { day: 'numeric', month: 'long', year: 'numeric' })
          : '',
        lastOutbound: outbound,
        unreadCount: 0
      });
    }

    const thread = byThread.get(key);
    const unreadInbound = !outbound && trimmed(message && message.status) !== 'read' && !message.read_at;
    if (unreadInbound) {
      thread.unreadCount += 1;
    }
  });

  const needle = trimmed(query).toLowerCase();
  return Array.from(byThread.values())
    .map((thread) => ({ ...thread, href: threadHref(thread) }))
    .filter((thread) => {
      if (!needle) return true;
      return [thread.partnerName, thread.partnerTenantName, thread.lastSubject]
        .some((value) => trimmed(value).toLowerCase().includes(needle));
    });
}

function normalizeConversation(messages, partnerId, partnerTenantId, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key;
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
  const partnerIdText = trimmed(partnerId);
  const partnerTenantIdText = trimmed(partnerTenantId);
  const conversationMessages = [];
  const unreadIds = [];
  let partnerName = '';
  let partnerTenantName = '';

  asList(messages).forEach((message) => {
    const sender = asObject(message && message.sender);
    const receiver = asObject(message && message.receiver);
    const outbound = trimmed(message && message.direction) === 'outbound';
    const partner = outbound ? receiver : sender;
    const userMatches = trimmed(partner.id) === partnerIdText;
    const tenantMatches = trimmed(partner.tenant_id !== undefined ? partner.tenant_id : partner.tenantId) === partnerTenantIdText;
    if (!userMatches || !tenantMatches) return;

    if (!partnerName) {
      partnerName = participantName(partner, t);
      partnerTenantName = trimmed(partner.tenant_name || partner.tenantName);
    }

    const read = trimmed(message && message.status) === 'read' || Boolean(message && message.read_at);
    const id = message && message.id;
    if (!outbound && !read && id !== undefined) {
      unreadIds.push(Number(id));
    }

    conversationMessages.push({
      id,
      subject: trimmed(message && message.subject),
      body: trimmed(message && message.body, 10000),
      outbound,
      read,
      createdAt: message && message.created_at ? message.created_at : '',
      createdAtLabel: message && message.created_at
        ? formatDate(message.created_at, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })
        : ''
    });
  });

  conversationMessages.sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime() || 0;
    const bTime = new Date(b.createdAt).getTime() || 0;
    if (aTime !== bTime) return aTime - bTime;
    return numberOrZero(a.id) - numberOrZero(b.id);
  });

  return {
    partnerId: partnerIdText,
    partnerTenantId: partnerTenantIdText,
    partnerName: partnerName || t('fed2.messages.someone'),
    partnerTenantName,
    messages: conversationMessages,
    unreadIds: unreadIds.filter((id) => Number.isFinite(id) && id > 0).slice(0, 100),
    referenceMessageId: conversationMessages.length ? conversationMessages[conversationMessages.length - 1].id : ''
  };
}

function federationQuery(req, keys) {
  const params = new URLSearchParams();
  keys.forEach((key) => {
    const value = trimmed(req.query && req.query[key]);
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

function loadMoreHref(basePath, req, cursor) {
  const params = new URLSearchParams();
  ['q', 'skills', 'partner_id', 'service_reach'].forEach((key) => {
    const value = trimmed(req.query && req.query[key]);
    if (value) params.set(key, value);
  });
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function eventsFilters(req) {
  return {
    q: trimmed(req.query && req.query.q),
    partnerId: trimmed(req.query && req.query.partner_id),
    upcoming: trimmed(req.query && req.query.upcoming) !== 'false',
    cursor: trimmed(req.query && req.query.cursor)
  };
}

function eventsApiQuery(filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.partnerId) params.set('partner_id', filters.partnerId);
  params.set('upcoming', filters.upcoming ? '1' : 'false');
  if (filters.cursor) params.set('cursor', filters.cursor);
  return `?${params.toString()}`;
}

function eventsLoadMoreHref(filters, cursor) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.partnerId) params.set('partner_id', filters.partnerId);
  if (!filters.upcoming) params.set('upcoming', 'false');
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `/federation/events?${query}` : '/federation/events';
}

function listingsFilters(req) {
  const type = trimmed(req.query && req.query.type);
  return {
    q: trimmed(req.query && req.query.q),
    type: type === 'offer' || type === 'request' ? type : '',
    partnerId: trimmed(req.query && req.query.partner_id),
    cursor: trimmed(req.query && req.query.cursor)
  };
}

function listingsQuery(filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.type) params.set('type', filters.type);
  if (filters.partnerId) params.set('partner_id', filters.partnerId);
  if (filters.cursor) params.set('cursor', filters.cursor);
  const query = params.toString();
  return query ? `?${query}` : '';
}

function listingsLoadMoreHref(filters, cursor) {
  return `/federation/listings${listingsQuery({ ...filters, cursor })}`;
}

function listingDetailQuery(tenantId, cursor = '') {
  const params = new URLSearchParams();
  params.set('partner_id', tenantId);
  params.set('per_page', '100');
  if (cursor) params.set('cursor', cursor);
  return `?${params.toString()}`;
}

async function loadFederatedListing(token, tenantId, id, options = {}) {
  let cursor = '';

  for (let page = 0; page < 10; page += 1) {
    const result = await callFederationApi(token, 'GET', `/listings${listingDetailQuery(tenantId, cursor)}`);
    const listing = asList(dataFrom(result))
      .map((item) => normalizeListing(item, { ...options, descriptionLimit: null }))
      .find((item) => trimmed(item.id) === id && trimmed(item.tenantId) === tenantId);

    if (listing) {
      return listing;
    }

    const meta = metaFrom(result);
    const nextCursor = trimmed(meta.cursor || meta.next_cursor);
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return null;
}

function normalizeActivity(item) {
  const actor = asObject(item && item.actor);

  return {
    title: trimmed(item && item.title) || 'Federation activity',
    description: trimmed(item && item.description),
    community: trimmed(actor.tenant_name || actor.name || item && item.community),
    createdAt: item && item.created_at ? item.created_at : ''
  };
}

function statusBanner(status) {
  const banners = {
    'opted-in': { type: 'success', message: 'You are connected to the federation network.' },
    'opted-out': { type: 'success', message: 'You have left the federation network.' },
    'optin-failed': { type: 'error', message: 'We could not turn on federation. Please try again.' },
    'optout-failed': { type: 'error', message: 'We could not turn off federation. Please try again.' }
  };

  return banners[trimmed(status)] || null;
}

function memberStatusBanner(status) {
  const banners = {
    'connect-sent': { type: 'success', message: 'Connection request sent' },
    'connect-failed': { type: 'error', message: 'Connection request failed' },
    'message-sent': { type: 'success', message: 'Message sent' },
    'message-empty': { type: 'error', message: 'Enter a message before sending' },
    'message-too-long': { type: 'error', message: 'Message is too long' },
    'message-failed': { type: 'error', message: 'Message could not be sent' },
    'message-not-enabled': { type: 'error', message: 'Messaging is not enabled' },
    'message-recipient-unavailable': { type: 'error', message: 'This member cannot receive federation messages' },
    'transfer-sent': { type: 'success', message: 'Transfer sent' }
  };

  return banners[trimmed(status)] || null;
}

function transferStatusBanner(status, t = (key) => key) {
  const allowed = new Set([
    'transfer-sent', 'transfer-not-enabled', 'transfer-amount-invalid',
    'transfer-description-required', 'transfer-description-too-long',
    'transfer-recipient-unavailable', 'transfer-self', 'transfer-insufficient',
    'transfer-failed', 'transfer-safeguarding-restricted', 'transfer-safeguarding-unavailable'
  ]);
  const normalized = trimmed(status);

  return allowed.has(normalized) ? {
    type: normalized === 'transfer-sent' ? 'success' : 'error',
    message: t(`fed2.transfer.status.${normalized}`)
  } : null;
}

function settingsStatusBanner(status, t = (key) => key) {
  const banners = {
    'settings-saved': { type: 'success', message: t('federation.settings.saved') },
    'settings-failed': { type: 'error', message: t('federation.settings.failed') }
  };

  return banners[trimmed(status)] || null;
}

function optInStatusBanner(status, t = (key) => key) {
  const banners = {
    'optin-failed': { type: 'error', message: t('federation.optin.failed') },
    unavailable: { type: 'error', message: t('federation.optin.unavailable') }
  };

  return banners[trimmed(status)] || null;
}

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

function onboardingTenantKey(req) {
  const tenant = req.accessibleRouting?.tenant;
  const tenantId = trimmed(tenant && tenant.id, 64);
  if (tenantId) return `id:${tenantId}`;

  const tenantSlug = trimmed(req.accessibleRouting?.tenantSlug || (tenant && tenant.slug), 128).toLowerCase();
  return `slug:${tenantSlug || 'default'}`;
}

function onboardingSessionStore(req) {
  if (!req.session) return null;

  const existing = req.session[FEDERATION_ONBOARDING_SESSION_KEY];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    req.session[FEDERATION_ONBOARDING_SESSION_KEY] = {};
  }

  return req.session[FEDERATION_ONBOARDING_SESSION_KEY];
}

function onboardingSessionBag(req) {
  const store = onboardingSessionStore(req);
  return store ? asObject(store[onboardingTenantKey(req)]) : {};
}

function saveOnboardingSessionBag(req, settings) {
  const store = onboardingSessionStore(req);
  if (!store) return;
  store[onboardingTenantKey(req)] = { ...settings };
}

function onboardingStep(value) {
  const step = trimmed(value);
  return FEDERATION_ONBOARDING_STEPS.includes(step) ? step : 'welcome';
}

function onboardingBool(settings, key) {
  return Object.prototype.hasOwnProperty.call(settings, key)
    ? bool(settings[key])
    : Boolean(FEDERATION_ONBOARDING_DEFAULTS[key]);
}

function normalizeOnboardingSettings(rawSettings, t = (key) => key) {
  const settings = asObject(rawSettings);
  const reach = trimmed(settings.service_reach);
  const travelRadius = numberOrZero(settings.travel_radius_km);
  const normalized = {
    profile_visible_federated: onboardingBool(settings, 'profile_visible_federated'),
    appear_in_federated_search: onboardingBool(settings, 'appear_in_federated_search'),
    show_skills_federated: onboardingBool(settings, 'show_skills_federated'),
    show_location_federated: onboardingBool(settings, 'show_location_federated'),
    show_reviews_federated: onboardingBool(settings, 'show_reviews_federated'),
    messaging_enabled_federated: onboardingBool(settings, 'messaging_enabled_federated'),
    transactions_enabled_federated: onboardingBool(settings, 'transactions_enabled_federated'),
    email_notifications: onboardingBool(settings, 'email_notifications'),
    service_reach: ['local_only', 'remote_ok', 'travel_ok'].includes(reach) ? reach : FEDERATION_ONBOARDING_DEFAULTS.service_reach,
    travel_radius_km: Math.min(500, Math.max(0, travelRadius || FEDERATION_ONBOARDING_DEFAULTS.travel_radius_km))
  };

  normalized.reachSummary = normalized.service_reach === 'travel_ok'
    ? t('govuk_alpha_federation.onboarding.reach_summary_travel_ok', { km: normalized.travel_radius_km })
    : normalized.service_reach === 'remote_ok'
      ? t('govuk_alpha_federation.onboarding.reach_summary_remote_ok')
      : t('govuk_alpha_federation.onboarding.reach_summary_local_only');
  return normalized;
}

function onboardingStatusBanner(status, t = (key) => key) {
  const banners = {
    unavailable: t('govuk_alpha_federation.onboarding.unavailable'),
    'optin-failed': t('govuk_alpha_federation.onboarding.optin_failed')
  };

  const message = banners[trimmed(status)];
  return message ? { type: 'error', message } : null;
}

function connectionStatusBanner(status, t = (key) => key) {
  const normalized = trimmed(status);
  const allowed = new Set(['connection-accepted', 'connection-rejected', 'connection-removed', 'connection-action-failed']);
  return allowed.has(normalized) ? {
    type: normalized === 'connection-action-failed' ? 'error' : 'success',
    message: t(`fed2.connections.status.${normalized}`)
  } : null;
}

function messagesStatusBanner(status, t = (key) => key) {
  const normalized = trimmed(status);
  const allowed = new Set([
    'message-sent', 'message-empty', 'message-too-long', 'message-failed',
    'message-not-enabled', 'message-recipient-unavailable', 'message-unavailable',
    'message-safeguarding-restricted', 'message-safeguarding-unavailable',
    'translate-unavailable', 'translate-failed'
  ]);
  return allowed.has(normalized) ? {
    type: normalized === 'message-sent' ? 'success' : 'error',
    message: t(`fed2.messages.status.${normalized}`)
  } : null;
}

function renderFederationError(error, res) {
  if (error instanceof ApiError && error.status === 401) {
    redirectTo(res, '/login?status=auth-required');
    return true;
  }

  const errorCodes = error instanceof ApiError && Array.isArray(error.data && error.data.errors)
    ? error.data.errors.map((item) => trimmed(item && item.code)).filter(Boolean)
    : [];
  if (error instanceof ApiError && error.status === 403 && errorCodes.includes('FEDERATION_NOT_ENABLED')) {
    redirectTo(res, '/federation/opt-in');
    return true;
  }

  if (error instanceof ApiOfflineError || error instanceof ApiError) {
    res.status(503).render('errors/503', { title: 'Federation' });
    return true;
  }

  return false;
}

async function optionalFederationActivity(token) {
  try {
    return await callFederationApi(token, 'GET', '/activity');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { data: [] };
    }
    throw error;
  }
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let statusResult;
  let partnersResult;
  let activityResult;
  try {
    statusResult = await callFederationApi(token, 'GET', '/status');
    partnersResult = await callFederationApi(token, 'GET', '/partners');
    activityResult = await optionalFederationActivity(token);
  } catch (error) {
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const stats = asObject(dataFrom(statusResult));
  const partnerData = dataFrom(partnersResult);
  const partners = asList(partnerData).map(normalizePartner).slice(0, 6);
  const activity = asList(dataFrom(activityResult)).map(normalizeActivity).slice(0, 5);
  const partnerMeta = metaFrom(partnersResult);
  const partnerTotal = numberOrZero(partnerMeta.total || (partnerData && partnerData.total) || partners.length);

  return res.render('federation/index', {
    title: 'Federation',
    activeNav: 'explore',
    federationActiveTab: 'overview',
    stats: {
      tenantEnabled: bool(stats.tenant_federation_enabled),
      optedIn: bool(stats.federation_optin),
      partnershipsCount: numberOrZero(stats.partnerships_count),
      messagesCount: numberOrZero(stats.messages_count),
      transactionsCount: numberOrZero(stats.transactions_count)
    },
    partners,
    partnerTotal,
    activity,
    statusBanner: statusBanner(req.query.status)
  });
}));

router.get('/opt-in', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let settingsResult;
  let partnersResult;
  try {
    settingsResult = await callFederationApi(token, 'GET', '/settings');
    const settingsData = asObject(dataFrom(settingsResult));
    const settings = asObject(settingsData.settings);
    if (bool(settings.federation_optin)) {
      return redirectTo(res, '/federation/settings');
    }

    partnersResult = await callFederationApi(token, 'GET', '/partners');
  } catch (error) {
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const partners = asList(dataFrom(partnersResult)).map((partner) => normalizePartner(partner, {
    t: res.locals.t,
    formatNumber: res.locals.formatLocaleNumber
  })).slice(0, 5);

  return res.render('federation/opt-in', {
    title: res.locals.t('federation.optin.title'),
    activeNav: 'explore',
    federationActiveTab: 'overview',
    partners,
    statusBanner: optInStatusBanner(req.query.status, res.locals.t)
  });
}));

router.get('/opt-out', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  return res.render('federation/opt-out', {
    title: res.locals.t('federation.optout.title'),
    activeNav: 'explore',
    federationActiveTab: 'overview'
  });
}));

router.get('/onboarding', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const step = onboardingStep(req.query && req.query.step);
  let settingsResult;
  let partnersResult = { data: [] };
  try {
    settingsResult = await callFederationApi(token, 'GET', '/settings');
    const settingsData = asObject(dataFrom(settingsResult));
    const settings = asObject(settingsData.settings);
    if (bool(settings.federation_optin) || bool(settingsData.federation_optin)) {
      return redirectTo(res, '/federation');
    }

    if (step === 'confirm') {
      partnersResult = await callFederationApi(token, 'GET', '/partners');
    }
  } catch (error) {
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const settingsData = asObject(dataFrom(settingsResult));
  const settings = normalizeOnboardingSettings({
    ...asObject(settingsData.settings),
    ...onboardingSessionBag(req)
  }, res.locals.t);
  saveOnboardingSessionBag(req, settings);
  const stepNumber = FEDERATION_ONBOARDING_STEPS.indexOf(step) + 1;
  const partners = asList(dataFrom(partnersResult)).map((partner) => normalizePartner(partner, {
    t: res.locals.t,
    formatNumber: res.locals.formatLocaleNumber
  })).filter(isInternalPartner).slice(0, 5);

  return res.render('federation/onboarding', {
    title: res.locals.t('govuk_alpha_federation.onboarding.page_title'),
    activeNav: 'explore',
    federationActiveTab: 'overview',
    step,
    stepNumber,
    totalSteps: FEDERATION_ONBOARDING_STEPS.length,
    progressValue: Math.round((stepNumber / FEDERATION_ONBOARDING_STEPS.length) * 100),
    settings,
    partners,
    statusBanner: onboardingStatusBanner(req.query && req.query.status, res.locals.t)
  });
}));

router.get('/groups', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let groupsResult;
  let partnersResult;
  let allowed = true;
  let loadError = false;
  try {
    groupsResult = await callFederationApi(token, 'GET', `/groups${federationQuery(req, ['q', 'partner_id', 'cursor'])}`);
    partnersResult = await callFederationApi(token, 'GET', '/partners');
  } catch (error) {
    const errorCodes = error instanceof ApiError && Array.isArray(error.data && error.data.errors)
      ? error.data.errors.map((item) => trimmed(item && item.code)).filter(Boolean)
      : [];
    if (error instanceof ApiError && error.status === 403 && errorCodes.includes('FEDERATION_NOT_ENABLED')) {
      return redirectTo(res, '/federation/opt-in');
    }
    if (error instanceof ApiError && error.status === 401) {
      return redirectTo(res, '/login?status=auth-required');
    }
    if (error instanceof ApiError && error.status === 403) {
      allowed = false;
    } else if (error instanceof ApiError || error instanceof ApiOfflineError) {
      loadError = true;
    } else {
      throw error;
    }
    groupsResult = { data: [] };
    partnersResult = { data: [] };
  }

  const groups = asList(dataFrom(groupsResult)).map((group) => normalizeGroup(group, {
    t: res.locals.t,
    formatNumber: res.locals.formatLocaleNumber
  }));
  const partnerOptions = asList(dataFrom(partnersResult)).map((partner) => normalizePartner(partner, {
    t: res.locals.t,
    formatNumber: res.locals.formatLocaleNumber
  })).filter(isInternalPartner);
  const meta = metaFrom(groupsResult);
  const nextCursor = trimmed(meta.cursor || meta.next_cursor);

  return res.render('federation/groups', {
    title: res.locals.t('polish_federation.groups_title'),
    activeNav: 'explore',
    federationActiveTab: 'groups',
    allowed,
    groups,
    partnerOptions,
    filters: {
      q: trimmed(req.query.q),
      partnerId: trimmed(req.query.partner_id)
    },
    loadError,
    loadMoreHref: nextCursor ? loadMoreHref('/federation/groups', req, nextCursor) : ''
  });
}));

router.get('/listings', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const filters = listingsFilters(req);
  let listingsResult;
  let partnersResult;
  try {
    listingsResult = await callFederationApi(token, 'GET', `/listings${listingsQuery(filters)}`);
    partnersResult = await callFederationApi(token, 'GET', '/partners');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return res.render('federation/listings', {
        title: res.locals.t('federation.listings_browse.title'),
        activeNav: 'explore',
        federationActiveTab: 'listings',
        allowed: false,
        listings: [],
        partnerOptions: [],
        filters,
        loadError: false,
        loadMoreHref: ''
      });
    }
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const listings = asList(dataFrom(listingsResult)).map((listing) => normalizeListing(listing, {
    t: res.locals.t,
    formatDate: res.locals.formatLocaleDate,
    formatNumber: res.locals.formatLocaleNumber
  }));
  const partnerOptions = asList(dataFrom(partnersResult)).map((partner) => normalizePartner(partner, {
    t: res.locals.t,
    formatNumber: res.locals.formatLocaleNumber
  })).filter(isInternalPartner);
  const meta = metaFrom(listingsResult);
  const nextCursor = trimmed(meta.cursor || meta.next_cursor);

  return res.render('federation/listings', {
    title: res.locals.t('federation.listings_browse.title'),
    activeNav: 'explore',
    federationActiveTab: 'listings',
    allowed: true,
    listings,
    partnerOptions,
    filters,
    loadError: false,
    loadMoreHref: nextCursor ? listingsLoadMoreHref(filters, nextCursor) : ''
  });
}));

router.get('/listings/:tenantId/:id', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const tenantId = trimmed(req.params.tenantId, 32);
  const id = trimmed(req.params.id, 32);
  if (!/^\d+$/.test(tenantId) || !/^\d+$/.test(id)) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  let listing;
  let member = null;
  let settingsData = {};
  try {
    listing = await loadFederatedListing(token, tenantId, id, {
      t: res.locals.t,
      formatDate: res.locals.formatLocaleDate,
      formatNumber: res.locals.formatLocaleNumber
    });
    if (!listing) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }

    if (listing.authorId) {
      try {
        const tenantQuery = `?tenant_id=${encodeURIComponent(tenantId)}`;
        const memberResult = await callFederationApi(token, 'GET', `/members/${encodeURIComponent(listing.authorId)}${tenantQuery}`);
        member = normalizeMember(asObject(dataFrom(memberResult)), { bioLimit: null, t: res.locals.t });
        const settingsResult = await callFederationApi(token, 'GET', '/settings');
        settingsData = asObject(dataFrom(settingsResult));
      } catch (error) {
        if (!(error instanceof ApiError && [403, 404].includes(error.status))) {
          throw error;
        }
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const settings = asObject(settingsData.settings);
  listing.memberHref = listingMemberHref(listing);
  listing.canContact = Boolean(member && member.messagingEnabled)
    && (bool(settings.federation_optin) || bool(settingsData.enabled))
    && bool(settings.messaging_enabled_federated);

  return res.render('federation/listing-show', {
    title: listing.title,
    activeNav: 'explore',
    federationActiveTab: 'listings',
    listing
  });
}));

router.get('/events', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const filters = eventsFilters(req);
  let eventsResult;
  let partnersResult;
  let allowed = true;
  let loadError = false;
  try {
    eventsResult = await callFederationApi(token, 'GET', `/events${eventsApiQuery(filters)}`);
    partnersResult = await callFederationApi(token, 'GET', '/partners');
  } catch (error) {
    const errorCodes = error instanceof ApiError && Array.isArray(error.data && error.data.errors)
      ? error.data.errors.map((item) => trimmed(item && item.code)).filter(Boolean)
      : [];
    if (error instanceof ApiError && error.status === 403 && errorCodes.includes('FEDERATION_NOT_ENABLED')) {
      return redirectTo(res, '/federation/opt-in');
    }
    if (error instanceof ApiError && error.status === 401) {
      return redirectTo(res, '/login?status=auth-required');
    }
    if (error instanceof ApiError && error.status === 403) {
      allowed = false;
    } else if (error instanceof ApiError || error instanceof ApiOfflineError) {
      loadError = true;
    } else {
      throw error;
    }
    eventsResult = { data: [] };
    partnersResult = { data: [] };
  }

  const events = asList(dataFrom(eventsResult)).map((event) => normalizeEvent(event, filters.upcoming, {
    t: res.locals.t,
    formatDate: res.locals.formatLocaleDate,
    formatNumber: res.locals.formatLocaleNumber
  }));
  const partnerOptions = asList(dataFrom(partnersResult)).map((partner) => normalizePartner(partner, {
    t: res.locals.t,
    formatNumber: res.locals.formatLocaleNumber
  })).filter(isInternalPartner);
  const meta = metaFrom(eventsResult);
  const nextCursor = trimmed(meta.cursor || meta.next_cursor);

  return res.render('federation/events', {
    title: res.locals.t('federation.events_browse.title'),
    activeNav: 'explore',
    federationActiveTab: 'events',
    allowed,
    events,
    partnerOptions,
    filters,
    loadError,
    loadMoreHref: nextCursor ? eventsLoadMoreHref(filters, nextCursor) : ''
  });
}));

router.get('/partners', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let partnersResult;
  try {
    partnersResult = await callFederationApi(token, 'GET', '/partners');
  } catch (error) {
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const partners = asList(dataFrom(partnersResult)).map((partner) => normalizePartner(partner, {
    t: res.locals.t,
    formatDate: res.locals.formatLocaleDate,
    formatNumber: res.locals.formatLocaleNumber
  }));

  return res.render('federation/partners', {
    title: res.locals.t('federation.partners_list.title'),
    activeNav: 'explore',
    federationActiveTab: 'partners',
    partners
  });
}));

router.get('/partners/:id', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const id = trimmed(req.params.id, 32);
  if (!validPartnerId(id)) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  let partnerResult;
  try {
    partnerResult = await callFederationApi(token, 'GET', `/partners/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const partner = normalizePartner(asObject(dataFrom(partnerResult)), {
    taglineLimit: null,
    t: res.locals.t,
    formatDate: res.locals.formatLocaleDate,
    formatNumber: res.locals.formatLocaleNumber,
    partnershipDateOptions: { day: 'numeric', month: 'long', year: 'numeric' }
  });
  partner.id = id;
  partner.href = partnerHref(id);
  partner.isInternal = isInternalPartner(partner);

  return res.render('federation/partner', {
    title: partner.name,
    activeNav: 'explore',
    federationActiveTab: 'partners',
    partner
  });
}));

router.get('/members', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let membersResult;
  let partnersResult;
  try {
    partnersResult = await callFederationApi(token, 'GET', '/partners');
    membersResult = await callFederationApi(token, 'GET', `/members${federationQuery(req, ['q', 'skills', 'partner_id', 'service_reach', 'cursor'])}`);
  } catch (error) {
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const members = asList(dataFrom(membersResult)).map((member) => normalizeMember(member, { t: res.locals.t }));
  const meta = metaFrom(membersResult);
  const partnerOptions = asList(dataFrom(partnersResult))
    .map((partner) => normalizePartner(partner, { t: res.locals.t }))
    .filter(isInternalPartner);
  const nextCursor = trimmed(meta.cursor);

  return res.render('federation/members', {
    title: res.locals.t('federation.members_browse.title'),
    activeNav: 'explore',
    federationActiveTab: 'members',
    members,
    partnerOptions,
    total: meta.total_items !== undefined ? numberOrZero(meta.total_items) : null,
    nextCursor,
    loadMoreHref: nextCursor ? loadMoreHref('/federation/members', req, nextCursor) : '',
    filters: {
      q: trimmed(req.query.q),
      skills: trimmed(req.query.skills),
      partnerId: trimmed(req.query.partner_id),
      serviceReach: trimmed(req.query.service_reach)
    }
  });
}));

router.get('/settings', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let settingsResult;
  try {
    settingsResult = await callFederationApi(token, 'GET', '/settings');
  } catch (error) {
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const settingsData = asObject(dataFrom(settingsResult));
  const settings = asObject(settingsData.settings);

  return res.render('federation/settings', {
    title: res.locals.t('federation.settings.title'),
    activeNav: 'explore',
    federationActiveTab: 'settings',
    optedIn: bool(settings.federation_optin) || bool(settingsData.enabled),
    settings: {
      profileVisibleFederated: bool(settings.profile_visible_federated),
      appearInFederatedSearch: bool(settings.appear_in_federated_search),
      showSkillsFederated: bool(settings.show_skills_federated),
      showLocationFederated: bool(settings.show_location_federated),
      showReviewsFederated: bool(settings.show_reviews_federated),
      emailNotifications: bool(settings.email_notifications),
      messagingEnabledFederated: bool(settings.messaging_enabled_federated),
      transactionsEnabledFederated: bool(settings.transactions_enabled_federated),
      serviceReach: trimmed(settings.service_reach) || 'local_only',
      travelRadiusKm: numberOrZero(settings.travel_radius_km || 25)
    },
    statusBanner: settingsStatusBanner(req.query.status, res.locals.t)
  });
}));

router.get('/connections', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let activeTab = trimmed(req.query.tab) || 'accepted';
  if (!['accepted', 'received', 'sent'].includes(activeTab)) {
    activeTab = 'accepted';
  }

  const statusFilter = {
    accepted: 'accepted',
    received: 'pending_received',
    sent: 'pending_sent'
  }[activeTab];
  const page = Math.max(1, numberOrZero(req.query.page) || 1);
  const perPage = 50;

  let connectionsResult;
  let allowed = true;
  let loadError = false;
  try {
    connectionsResult = await callFederationApi(token, 'GET', `/connections?status=${statusFilter}&limit=${perPage + 1}&offset=${(page - 1) * perPage}`);
  } catch (error) {
    const errorCodes = error instanceof ApiError && Array.isArray(error.data && error.data.errors)
      ? error.data.errors.map((item) => trimmed(item && item.code)).filter(Boolean)
      : [];
    if (error instanceof ApiError && error.status === 403 && errorCodes.includes('FEDERATION_NOT_ENABLED')) {
      return redirectTo(res, '/federation/opt-in');
    }
    if (error instanceof ApiError && error.status === 401) {
      return redirectTo(res, '/login?status=auth-required');
    }
    if (error instanceof ApiError && error.status === 403) {
      allowed = false;
      connectionsResult = { data: [] };
    } else if (error instanceof ApiError || error instanceof ApiOfflineError) {
      loadError = true;
      connectionsResult = { data: [] };
    } else {
      throw error;
    }
  }

  const rows = asList(dataFrom(connectionsResult));
  const hasMore = rows.length > perPage;
  const connections = rows.slice(0, perPage).map((connection) => normalizeConnection(connection, {
    t: res.locals.t,
    formatDate: res.locals.formatLocaleDate
  }));

  return res.render('federation/connections', {
    title: res.locals.t('fed2.connections.title'),
    activeNav: 'explore',
    federationActiveTab: 'connections',
    activeTab,
    allowed,
    loadError,
    page,
    hasMore,
    connections,
    statusBanner: connectionStatusBanner(req.query.status, res.locals.t)
  });
}));

router.get('/messages', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let settingsResult;
  let messagesResult = { data: [] };
  try {
    settingsResult = await callFederationApi(token, 'GET', '/settings');
  } catch (error) {
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  let allowed = true;
  let loadError = false;
  try {
    messagesResult = await callFederationApi(token, 'GET', '/messages');
  } catch (error) {
    const errorCodes = error instanceof ApiError && Array.isArray(error.data && error.data.errors)
      ? error.data.errors.map((item) => trimmed(item && item.code)).filter(Boolean)
      : [];
    if (error instanceof ApiError && error.status === 403 && errorCodes.includes('FEDERATION_NOT_ENABLED')) {
      return redirectTo(res, '/federation/opt-in');
    }
    if (error instanceof ApiError && error.status === 401) {
      return redirectTo(res, '/login?status=auth-required');
    }
    if (error instanceof ApiError && error.status === 403) {
      allowed = false;
    } else if (error instanceof ApiError || error instanceof ApiOfflineError) {
      loadError = true;
    } else {
      throw error;
    }
  }

  const settingsData = asObject(dataFrom(settingsResult));
  const settings = asObject(settingsData.settings);
  const query = trimmed(req.query.q);
  const threads = normalizeMessageThreads(dataFrom(messagesResult), query, {
    t: res.locals.t,
    formatDate: res.locals.formatLocaleDate
  });
  const optedIn = bool(settings.federation_optin) || bool(settingsData.enabled);

  return res.render('federation/messages', {
    title: res.locals.t('fed2.messages.title'),
    activeNav: 'explore',
    federationActiveTab: 'messages',
    query,
    threads,
    allowed,
    loadError,
    viewerOptedIn: optedIn,
    viewerCanMessage: optedIn && bool(settings.messaging_enabled_federated),
    statusBanner: messagesStatusBanner(req.query.status, res.locals.t)
  });
}));

router.get('/messages/conversation/:partnerId', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const partnerId = trimmed(req.params.partnerId, 32);
  const partnerTenantId = trimmed(req.query.tenant_id, 32);
  if (!/^\d+$/.test(partnerId) || !/^\d+$/.test(partnerTenantId)) {
    return redirectTo(res, '/federation/messages');
  }

  let settingsResult;
  let messagesResult;
  try {
    settingsResult = await callFederationApi(token, 'GET', '/settings');
    messagesResult = await callFederationApi(token, 'GET', '/messages');
  } catch (error) {
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const conversation = normalizeConversation(dataFrom(messagesResult), partnerId, partnerTenantId, {
    t: res.locals.t,
    formatDate: res.locals.formatLocaleDate
  });
  if (conversation.messages.length === 0) {
    return redirectTo(res, '/federation/messages');
  }

  if (conversation.unreadIds.length > 0) {
    try {
      await callFederationApi(token, 'POST', '/messages/mark-read-batch', { ids: conversation.unreadIds });
    } catch (error) {
      if (!(error instanceof ApiError || error instanceof ApiOfflineError)) {
        throw error;
      }
    }
  }

  const settingsData = asObject(dataFrom(settingsResult));
  const settings = asObject(settingsData.settings);
  const optedIn = bool(settings.federation_optin) || bool(settingsData.enabled);
  const flashedTranslation = req.session && req.session.federationTranslation;
  const translation = flashedTranslation
    && trimmed(flashedTranslation.partnerId) === partnerId
    && trimmed(flashedTranslation.partnerTenantId) === partnerTenantId
    ? { id: numberOrZero(flashedTranslation.id), text: trimmed(flashedTranslation.text, 10000) }
    : null;
  if (req.session && req.session.federationTranslation) delete req.session.federationTranslation;

  return res.render('federation/conversation', {
    title: conversation.partnerName,
    activeNav: 'explore',
    federationActiveTab: 'messages',
    conversation,
    translation,
    canReply: optedIn && bool(settings.messaging_enabled_federated),
    translateEnabled: tenantFeatureEnabled(req, 'message_translation', true),
    statusBanner: messagesStatusBanner(req.query.status, res.locals.t)
  });
}));

router.get('/members/:id/transfer', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const id = trimmed(req.params.id, 32);
  if (!/^\d+$/.test(id)) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  const tenantId = trimmed(req.query.tenant_id, 32);
  const tenantQuery = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';

  let memberResult;
  let settingsResult;
  let balanceResult;
  try {
    memberResult = await callFederationApi(token, 'GET', `/members/${id}${tenantQuery}`);
    settingsResult = await callFederationApi(token, 'GET', '/settings');
    balanceResult = await getBalance(token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const member = normalizeMember(asObject(dataFrom(memberResult)), {
    bioLimit: null,
    t: res.locals.t,
    formatNumber: res.locals.formatLocaleNumber
  });
  if (!member.transactionsEnabled) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  const settingsData = asObject(dataFrom(settingsResult));
  const settings = asObject(settingsData.settings);
  const balanceData = dataFrom(balanceResult);
  const balanceObject = asObject(balanceData);
  const balance = numberOrZero(balanceObject.balance !== undefined ? balanceObject.balance : balanceData);

  return res.render('federation/transfer', {
    title: res.locals.t('fed2.transfer.title'),
    activeNav: 'explore',
    federationActiveTab: 'members',
    member,
    balance,
    transferIdempotencyKey: randomUUID(),
    viewerEnabled: (bool(settings.federation_optin) || bool(settingsData.enabled)) && bool(settings.transactions_enabled_federated),
    statusBanner: transferStatusBanner(req.query.status, res.locals.t)
  });
}));

router.get('/members/:id', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const id = trimmed(req.params.id, 32);
  if (!/^\d+$/.test(id)) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  const tenantId = trimmed(req.query.tenant_id, 32);
  const tenantQuery = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';

  let memberResult;
  let settingsResult;
  try {
    memberResult = await callFederationApi(token, 'GET', `/members/${id}${tenantQuery}`);
    settingsResult = await callFederationApi(token, 'GET', '/settings');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (renderFederationError(error, res)) return undefined;
    throw error;
  }

  const member = normalizeMember(asObject(dataFrom(memberResult)), {
    bioLimit: null,
    t: res.locals.t,
    formatNumber: res.locals.formatLocaleNumber
  });
  const settingsData = asObject(dataFrom(settingsResult));
  const settings = asObject(settingsData.settings);
  let reviews = [];

  if (member.showReviews) {
    try {
      const reviewsResult = await callFederationApi(token, 'GET', `/members/${id}/reviews${tenantQuery}`);
      reviews = asList(dataFrom(reviewsResult)).map((review) => normalizeReview(review, {
        t: res.locals.t,
        formatDate: res.locals.formatLocaleDate
      }));
    } catch (error) {
      if (!(error instanceof ApiError && [403, 404].includes(error.status))) {
        throw error;
      }
    }
  }

  return res.render('federation/member', {
    title: member.name,
    activeNav: 'explore',
    federationActiveTab: 'members',
    member,
    reviews,
    viewer: {
      optedIn: bool(settings.federation_optin) || bool(settingsData.enabled),
      messagingEnabled: bool(settings.messaging_enabled_federated),
      transactionsEnabled: bool(settings.transactions_enabled_federated)
    },
    statusBanner: memberStatusBanner(req.query.status)
  });
}));

module.exports = router;
