// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const { requireAuth } = require('../middleware/auth');
const {
  getConversations,
  getUnreadCount,
  getUser,
  searchUsers,
  callMessageApi,
  uploadVoiceMessage,
  uploadMessageAttachments,
  callConversationApi,
  callListingApi,
  ApiError
} = require('../lib/api');
const { asyncRoute, handleApiError } = require('../lib/routeHelpers');
const { flagEnabled, resolveBackendAssetUrl } = require('../lib/accessible-shell');
const { audit } = require('../lib/auditLogger');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function urlFor(res, pathname) {
  const helper = res?.locals && typeof res.locals.urlFor === 'function'
    ? res.locals.urlFor
    : (value) => value;
  return helper(pathname);
}

function redirectTo(res, pathname) {
  return res.redirect(urlFor(res, pathname));
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function bladeLimit(value, limit = 180) {
  const characters = Array.from(trimmed(value));
  if (characters.length <= limit) return characters.join('');
  return `${characters.slice(0, Math.max(0, limit - 3)).join('')}...`;
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function messageSearchSegments(value, query) {
  const text = String(value || '');
  const needle = trimmed(query);
  if (!needle) return [{ text, match: false }];

  const matcher = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const segments = [];
  let offset = 0;
  let match = matcher.exec(text);

  while (match) {
    if (match.index > offset) segments.push({ text: text.slice(offset, match.index), match: false });
    segments.push({ text: match[0], match: true });
    offset = match.index + match[0].length;
    match = matcher.exec(text);
  }

  if (offset < text.length) segments.push({ text: text.slice(offset), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function uploadedFile(req, fieldName) {
  const file = req.files && req.files[fieldName];
  return file && typeof file === 'object' ? file : null;
}

function uploadedFiles(req, fieldName) {
  const files = req.files || {};
  const value = files[fieldName] || files[`${fieldName}[]`];
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(file => file && typeof file === 'object');
}

async function removeUploadedFile(file) {
  if (!file || !file.filepath) return;
  try {
    await fs.unlink(file.filepath);
  } catch {
    // Temporary upload cleanup is best-effort only.
  }
}

async function removeUploadedFiles(files) {
  await Promise.all(files.map(removeUploadedFile));
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function apiErrorCode(error) {
  const data = error && error.data && typeof error.data === 'object' ? error.data : {};
  const errors = Array.isArray(data.errors) ? data.errors : [];
  return String(data.code || data.error || (errors[0] && errors[0].code) || '').toUpperCase();
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function redirectOnAuthError(error, req, res) {
  if (!isAuthError(error)) return false;
  return handleApiError(error, req, res, { redirectOn401: loginRedirect() });
}

async function callMessage(token, method, path, data = undefined) {
  if (data === undefined) {
    return callMessageApi(token, method, path);
  }

  return callMessageApi(token, method, path, data);
}

async function callConversation(token, method, path, data = undefined) {
  if (data === undefined) {
    return callConversationApi(token, method, path);
  }

  return callConversationApi(token, method, path, data);
}

function statusRedirect(path, status, fragment = '') {
  return `${path}?status=${encodeURIComponent(status)}${fragment}`;
}

function messageRedirect(userId, status, fragment = '') {
  return statusRedirect(`/messages/${userId}`, status, fragment);
}

function groupRedirect(conversationId, status, fragment = '') {
  return statusRedirect(`/messages/groups/${conversationId}`, status, fragment);
}

function groupCreateRedirect(name, memberIds, status) {
  const search = new URLSearchParams();
  if (name) search.set('name', name);
  memberIds.forEach(id => search.append('members[]', String(id)));
  search.set('status', status);
  return `/messages/groups/new?${search.toString()}`;
}

async function messageRestriction(req) {
  try {
    return dataFrom(await callMessage(req.token, 'GET', '/restriction-status')) || {};
  } catch (error) {
    if (isAuthError(error)) throw error;
    return {};
  }
}

function messageAccess(req, restriction) {
  const directMessagingEnabled = tenantFeatureEnabled(
    req,
    'direct_messaging',
    restriction.direct_messaging_enabled !== false && restriction.messaging_enabled !== false
  );
  const restricted = Boolean(
    restriction.restricted
    || restriction.is_restricted
    || restriction.broker_messaging_only
    || restriction.messaging_disabled
  );
  return { directMessagingEnabled, restricted, canSend: directMessagingEnabled && !restricted };
}

function tenantFeatureEnabled(req, key, fallback = true) {
  const tenant = req.accessibleRouting?.tenant;
  if (!tenant || typeof tenant !== 'object') return fallback;
  return flagEnabled(tenant, key, 'features', fallback);
}

function requireConnectionsFeature(req, res, next) {
  if (!tenantFeatureEnabled(req, 'connections', true)) {
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }
  return next();
}

function memberIdsFrom(raw) {
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const seen = new Set();
  values.forEach((value) => {
    const id = positiveInteger(value);
    if (id !== null) seen.add(id);
  });
  return Array.from(seen);
}

function listFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.users)) return value.users;
  return [];
}

function selectedGroupMemberIds(query) {
  return memberIdsFrom(query.members || query['members[]']);
}

const GROUP_SUCCESS_STATUSES = new Set([
  'group-created',
  'group-message-sent',
  'group-member-added',
  'group-member-removed',
  'group-left',
  'reaction-added',
  'reaction-removed'
]);

const GROUP_ERROR_STATUSES = new Set([
  'group-disabled',
  'group-create-failed',
  'group-message-empty',
  'group-message-too-long',
  'group-message-failed',
  'group-message-forbidden',
  'group-member-invalid',
  'group-member-forbidden',
  'group-member-not-found',
  'group-member-limit',
  'group-member-failed',
  'group-leave-failed',
  'group-vetting-required',
  'group-contact-restricted',
  'group-policy-unavailable',
  'reaction-invalid',
  'reaction-forbidden',
  'reaction-failed'
]);

function groupStatus(status, t) {
  const value = trimmed(status);
  if (!GROUP_SUCCESS_STATUSES.has(value) && !GROUP_ERROR_STATUSES.has(value)) return null;
  const safeguardingKey = {
    'group-vetting-required': 'safeguarding.errors.vetting_required_title',
    'group-contact-restricted': 'safeguarding.errors.contact_restricted_title',
    'group-policy-unavailable': 'safeguarding.errors.policy_unavailable_title'
  }[value];
  return {
    type: GROUP_SUCCESS_STATUSES.has(value) ? 'success' : 'error',
    message: t(safeguardingKey || `govuk_alpha_messages.status.${value.replaceAll('-', '_')}`)
  };
}

const DIRECT_SUCCESS_STATUS_KEYS = {
  'message-sent': 'govuk_alpha.messages.sent',
  'message-edited': 'govuk_alpha.messages.edited_success',
  'message-deleted': 'govuk_alpha.messages.deleted_success',
  'translate-done': 'govuk_alpha_messages.translate.done'
};

const DIRECT_ERROR_STATUS_KEYS = {
  'message-empty': 'govuk_alpha.messages.empty_message',
  'message-disabled': 'govuk_alpha.messages.disabled_detail',
  'message-failed': 'govuk_alpha.messages.failed',
  'message-edit-forbidden': 'govuk_alpha.messages.edit_forbidden',
  'message-edit-expired': 'govuk_alpha.messages.edit_expired',
  'message-edit-failed': 'govuk_alpha.messages.edit_failed',
  'message-delete-failed': 'govuk_alpha.messages.delete_failed',
  'translate-failed': 'govuk_alpha_messages.translate.failed',
  'translate-unavailable': 'govuk_alpha_messages.translate.unavailable',
  'translate-empty': 'govuk_alpha_messages.translate.empty',
  'attachment-too-many': 'govuk_alpha_messages.attachments.error_too_many',
  'attachment-failed': 'govuk_alpha_messages.attachments.error_failed',
  'attachment-invalid': 'govuk_alpha_messages.attachments.error_invalid',
  'voice-required': 'govuk_alpha_messages.voice.error_required',
  'voice-failed': 'govuk_alpha_messages.voice.error_failed',
  'message-vetting-required': 'safeguarding.errors.vetting_required_title',
  'message-contact-restricted': 'safeguarding.errors.contact_restricted_title',
  'message-policy-unavailable': 'safeguarding.errors.policy_unavailable_title'
};

function directStatus(status, t) {
  const value = trimmed(status);
  const successKey = DIRECT_SUCCESS_STATUS_KEYS[value];
  if (successKey) return { type: 'success', message: t(successKey) };
  const errorKey = DIRECT_ERROR_STATUS_KEYS[value];
  return errorKey ? {
    type: 'error',
    message: t(errorKey),
    href: value.startsWith('message-') && [
      'message-vetting-required', 'message-contact-restricted', 'message-policy-unavailable'
    ].includes(value) ? '#safeguarding-notice' : '#body'
  } : null;
}

function groupName(group, t = null) {
  return trimmed(group && (group.group_name || group.groupName || group.name))
    || (t ? t('govuk_alpha_messages.groups.untitled') : 'Group conversation');
}

function memberName(member, t = null) {
  return trimmed(member && (member.name || member.full_name || member.fullName))
    || (t ? t('govuk_alpha.members.unknown_member') : 'Unknown member');
}

function senderName(message, currentUserId, t = null) {
  const senderId = positiveInteger(message && message.sender_id);
  if (senderId !== null && currentUserId !== null && senderId === currentUserId) {
    return t ? t('govuk_alpha_messages.conversation.sent_by_you') : 'You';
  }
  const sender = message && message.sender && typeof message.sender === 'object' ? message.sender : {};
  return trimmed(sender.name || sender.full_name || sender.fullName)
    || trimmed(message && (message.sender_name || message.senderName))
    || (t ? t('govuk_alpha.members.unknown_member') : 'Unknown member');
}

function conversationOtherUser(conversation, fallbackId, t = null) {
  const otherUser = conversation && typeof conversation.other_user === 'object'
    ? conversation.other_user
    : (conversation && typeof conversation.otherUser === 'object' ? conversation.otherUser : {});
  return {
    id: positiveInteger(otherUser.id) || positiveInteger(conversation && conversation.other_user_id) || fallbackId,
    name: trimmed(otherUser.name || otherUser.full_name || otherUser.fullName)
      || trimmed(conversation && (conversation.other_user_name || conversation.otherUserName))
      || (t ? t('govuk_alpha.members.unknown_member') : `Member ${fallbackId}`)
  };
}

function conversationQuery(query) {
  const search = new URLSearchParams();
  search.set('per_page', '50');
  search.set('direction', 'older');
  if (query.cursor) search.set('cursor', String(query.cursor));
  return search.toString();
}

function directConversationApiPath(userId, query) {
  const search = new URLSearchParams();
  search.set('per_page', '50');
  search.set('direction', 'older');
  if (query.cursor) search.set('cursor', String(query.cursor));
  return `/${userId}?${search.toString()}`;
}

function messageMediaProjection(message) {
  const source = message && typeof message === 'object' ? message : {};
  const sender = source.sender && typeof source.sender === 'object' ? source.sender : {};
  const attachments = Array.isArray(source.attachments) ? source.attachments : [];
  return {
    ...source,
    sender: {
      ...sender,
      avatarAssetUrl: resolveBackendAssetUrl(sender.avatar_url || sender.avatarUrl)
    },
    audioAssetUrl: resolveBackendAssetUrl(source.audio_url || source.audioUrl),
    attachments: attachments.map(attachment => ({
      ...attachment,
      assetUrl: resolveBackendAssetUrl(
        attachment?.url || attachment?.file_url || attachment?.download_url || attachment?.path
      )
    }))
  };
}

function directConversationFrom(result, userId, currentUserId, t = null) {
  const data = dataFrom(result);
  const meta = (result && result.meta) || (data && data.meta) || {};
  const rawConversation = meta.conversation || (data && data.conversation) || {};
  const otherUser = conversationOtherUser(rawConversation, userId, t);
  const editCutoff = Date.now() - (24 * 60 * 60 * 1000);
  const messages = listFrom(data).map(rawMessage => {
    const message = messageMediaProjection(rawMessage);
    const messageId = positiveInteger(message && message.id);
    const senderId = positiveInteger(message && message.sender_id);
    const isOwn = senderId !== null && senderId === currentUserId;
    const isDeleted = checked(message && (message.is_deleted ?? message.isDeleted));
    const createdTime = Date.parse(message && (message.created_at || message.createdAt));
    const canManage = isOwn && !isDeleted && messageId !== null;

    return {
      ...message,
      id: messageId || message.id,
      body: String(message.body || message.content || '').slice(0, 10000),
      displaySenderName: senderName(message, currentUserId, t),
      isOwn,
      isDeleted,
      canManage,
      canEdit: canManage && Number.isFinite(createdTime) && createdTime > editCutoff
    };
  }).reverse();

  return {
    conversation: {
      ...rawConversation,
      id: userId,
      otherUser
    },
    messages,
    meta: {
      hasMore: Boolean(meta.has_more),
      cursor: trimmed(meta.cursor)
    }
  };
}

function normalizeInboxConversation(conversation, currentUserId, t) {
  const source = conversation && typeof conversation === 'object' ? conversation : {};
  const otherUser = source.other_user && typeof source.other_user === 'object'
    ? source.other_user
    : (source.otherUser && typeof source.otherUser === 'object' ? source.otherUser : {});
  const combinedName = `${trimmed(otherUser.first_name)} ${trimmed(otherUser.last_name)}`.trim();
  const sourceName = otherUser.name ?? '';
  const filterName = sourceName !== '' ? trimmed(sourceName) : combinedName;
  const displayName = trimmed(otherUser.name || otherUser.full_name || otherUser.fullName)
    || combinedName
    || trimmed(source.other_user_name || source.otherUserName)
    || t('members.unknown_member');
  const rawLastMessage = source.last_message ?? source.lastMessage ?? {};
  const lastMessage = rawLastMessage && typeof rawLastMessage === 'object' ? rawLastMessage : {};
  const lastMessageText = typeof rawLastMessage === 'string'
    ? trimmed(rawLastMessage)
    : trimmed(lastMessage.body || lastMessage.content);
  const lastMessageSenderId = positiveInteger(lastMessage.sender_id ?? lastMessage.senderId);

  return {
    ...source,
    id: positiveInteger(source.id) || source.id,
    otherUser: {
      ...otherUser,
      avatarAssetUrl: resolveBackendAssetUrl(otherUser.avatar_url || otherUser.avatarUrl)
    },
    displayName,
    filterName,
    unreadCount: Number(source.unread_count ?? source.unreadCount ?? 0) || 0,
    lastMessageText: bladeLimit(lastMessageText),
    lastMessageSenderLabel: lastMessageSenderId !== null && lastMessageSenderId === currentUserId
      ? t('govuk_alpha.messages.sent_by_you')
      : displayName,
    lastMessageAt: lastMessage.created_at || lastMessage.createdAt || source.created_at || source.createdAt || null
  };
}

function messageTranslationFromFlash(req) {
  if (!req.flash) return null;
  const raw = req.flash('messagesTranslation')[0];
  if (!raw) return null;
  if (raw && typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function renderDirectConversation(req, res, userId) {
  const listingId = positiveInteger(req.query.listing);
  const [messagesResult, profileResult, restrictionResult, listingResult] = await Promise.all([
    callMessage(req.token, 'GET', directConversationApiPath(userId, req.query)),
    getRequestProfile(req, req.token).catch(() => null),
    callMessage(req.token, 'GET', '/restriction-status').catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: {} };
    }),
    listingId === null ? Promise.resolve(null) : callListingApi(req.token, 'GET', `/${listingId}`).catch((error) => {
      if (isAuthError(error)) throw error;
      return null;
    })
  ]);

  const profile = dataFrom(profileResult);
  const currentUserId = positiveInteger(profile && profile.id);
  const normalized = directConversationFrom(messagesResult, userId, currentUserId, res.locals.t);
  const restriction = dataFrom(restrictionResult) || {};
  const listing = listingResult ? dataFrom(listingResult) : null;
  const query = trimmed(req.query.q);
  const olderParams = new URLSearchParams();
  if (listingId !== null) olderParams.set('listing', String(listingId));
  if (query !== '') olderParams.set('q', query);
  if (normalized.meta.cursor) olderParams.set('cursor', normalized.meta.cursor);
  const olderHref = normalized.meta.hasMore && normalized.meta.cursor
    ? `/messages/${userId}?${olderParams.toString()}`
    : '';
  const directMessagingEnabled = tenantFeatureEnabled(
    req,
    'direct_messaging',
    restriction.direct_messaging_enabled !== false && restriction.messaging_enabled !== false
  );
  const restricted = Boolean(
    restriction.restricted
    || restriction.is_restricted
    || restriction.broker_messaging_only
    || restriction.messaging_disabled
  );
  const safeguarding = normalized.conversation.safeguarding
    && typeof normalized.conversation.safeguarding === 'object'
    ? normalized.conversation.safeguarding
    : null;
  const safeguardingRestricted = Boolean(safeguarding && safeguarding.restricted);

  return res.render('messages/direct-conversation', {
    title: res.locals.t('govuk_alpha.messages.conversation_title', { name: normalized.conversation.otherUser.name }),
    conversation: normalized.conversation,
    messages: normalized.messages,
    meta: normalized.meta,
    olderHref,
    listing,
    listingId,
    query,
    directStatus: directStatus(req.query.status, res.locals.t),
    currentUser: profile,
    currentUserId,
    directMessagingEnabled,
    restricted,
    safeguarding,
    canSend: directMessagingEnabled && !restricted && !safeguardingRestricted,
    translationEnabled: tenantFeatureEnabled(req, 'message_translation', true),
    translation: messageTranslationFromFlash(req),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

function editFailureStatus(error) {
  const code = apiErrorCode(error);
  if (code.includes('FORBIDDEN')) return 'message-edit-forbidden';
  if (code.includes('EDIT_EXPIRED')) return 'message-edit-expired';
  return 'message-edit-failed';
}

function groupMemberFailureStatus(error) {
  const code = apiErrorCode(error);
  if (code.includes('FORBIDDEN')) return 'group-member-forbidden';
  if (code.includes('NOT_FOUND')) return 'group-member-not-found';
  if (code.includes('LIMIT')) return 'group-member-limit';
  return 'group-member-failed';
}

function directSafeguardingFailureStatus(error) {
  return {
    SAFEGUARDING_POLICY_UNAVAILABLE: 'message-policy-unavailable',
    VETTING_REQUIRED: 'message-vetting-required',
    SAFEGUARDING_CONTACT_RESTRICTED: 'message-contact-restricted'
  }[apiErrorCode(error)] || null;
}

function groupSafeguardingFailureStatus(error) {
  return {
    SAFEGUARDING_POLICY_UNAVAILABLE: 'group-policy-unavailable',
    VETTING_REQUIRED: 'group-vetting-required',
    SAFEGUARDING_CONTACT_RESTRICTED: 'group-contact-restricted'
  }[apiErrorCode(error)] || null;
}

function groupCreateFailureStatus(error) {
  if (apiErrorCode(error) === 'MESSAGING_DISABLED') return 'group-disabled';
  return groupSafeguardingFailureStatus(error) || 'group-create-failed';
}

function translateFailureStatus(error) {
  const code = apiErrorCode(error);
  if (code.includes('FEATURE_DISABLED')) return 'translate-unavailable';
  if (code.includes('NO_CONTENT')) return 'translate-empty';
  return 'translate-failed';
}

router.post('/:id(\\d+)/archive', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'conversation-archived';
  try {
    await callMessage(token, 'DELETE', `/conversations/${id}`, { scope: 'self' });
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = 'conversation-archive-failed';
  }

  return redirectTo(res, statusRedirect('/messages', status));
}));

router.post('/:id(\\d+)/restore', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'conversation-restored';
  try {
    await callMessage(token, 'POST', `/conversations/${id}/restore`);
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = 'conversation-restore-failed';
  }

  return redirectTo(res, `/messages?archived=1&status=${encodeURIComponent(status)}`);
}));

router.post('/:userId(\\d+)/m/:messageId(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const userId = Number(req.params.userId);
  const messageId = Number(req.params.messageId);
  const body = trimmed(req.body.body, 10000);
  if (body === '') {
    return redirectTo(res, messageRedirect(userId, 'message-empty'));
  }

  let status = 'message-edited';
  try {
    await callMessage(token, 'PUT', `/${messageId}`, { body });
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = editFailureStatus(error);
  }

  return redirectTo(res, messageRedirect(userId, status));
}));

router.post('/:userId(\\d+)/m/:messageId(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const userId = Number(req.params.userId);
  const messageId = Number(req.params.messageId);
  const scope = ['self', 'everyone'].includes(req.body.scope) ? req.body.scope : 'self';
  let status = 'message-deleted';
  try {
    await callMessage(token, 'DELETE', `/${messageId}`, { scope });
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = 'message-delete-failed';
  }

  return redirectTo(res, messageRedirect(userId, status));
}));

router.post('/:userId(\\d+)/m/:messageId(\\d+)/translate', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const userId = Number(req.params.userId);
  const messageId = Number(req.params.messageId);
  if (!tenantFeatureEnabled(req, 'message_translation', true)) {
    return redirectTo(res, messageRedirect(userId, 'translate-unavailable', `#m-${messageId}`));
  }

  const requestedLanguage = trimmed(req.body.target_language || req.body.target_locale || req.locale || 'en', 10);
  const targetLanguage = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(requestedLanguage)
    ? requestedLanguage
    : 'en';
  let status = 'translate-done';
  try {
    const result = await callMessage(token, 'POST', `/${messageId}/translate`, {
      target_language: targetLanguage
    });
    const translated = dataFrom(result) || {};
    const translatedText = trimmed(translated.translated_text || translated.translatedText);
    if (!translatedText) {
      status = 'translate-failed';
    } else if (req.flash) {
      req.flash('messagesTranslation', JSON.stringify({
        id: messageId,
        text: translatedText,
        target: targetLanguage
      }));
    }
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = translateFailureStatus(error);
  }

  return redirectTo(res, messageRedirect(userId, status, `#m-${messageId}`));
}));

router.post('/:userId(\\d+)/voice', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const userId = Number(req.params.userId);
  const file = uploadedFile(req, 'voice');
  if (!file) {
    return redirectTo(res, messageRedirect(userId, 'voice-required'));
  }

  try {
    const buffer = await fs.readFile(file.filepath);
    await uploadVoiceMessage(token, {
      recipient_id: userId,
      file: {
        buffer,
        filename: trimmed(file.originalFilename) || 'voice-message',
        contentType: trimmed(file.mimetype) || 'application/octet-stream',
        size: file.size
      }
    });
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    return redirectTo(res, messageRedirect(userId, directSafeguardingFailureStatus(error) || 'voice-failed'));
  } finally {
    await removeUploadedFile(file);
  }

  return redirectTo(res, messageRedirect(userId, 'message-sent'));
}));

router.post('/groups', requireConnectionsFeature, asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const name = trimmed(req.body.name);
  const memberIds = memberIdsFrom(req.body.member_ids || req.body.members);
  const payload = {
    name,
    member_ids: memberIds
  };

  try {
    const result = await callConversation(token, 'POST', '/groups', payload);
    const data = dataFrom(result);
    const conversationId = positiveInteger(data && (data.id || data.conversation_id || (data.conversation && data.conversation.id)));
    if (conversationId !== null) {
      return redirectTo(res, groupRedirect(conversationId, 'group-created'));
    }
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    return redirectTo(res, groupCreateRedirect(name, memberIds, groupCreateFailureStatus(error)));
  }

  return redirectTo(res, groupCreateRedirect(name, memberIds, 'group-create-failed'));
}));

router.post('/groups/:conversationId(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const conversationId = Number(req.params.conversationId);
  const body = trimmed(req.body.body, 10000);
  if (body === '') return redirectTo(res, groupRedirect(conversationId, 'group-message-empty'));
  if (String(req.body.body || '').length > 10000) return redirectTo(res, groupRedirect(conversationId, 'group-message-too-long'));

  let status = 'group-message-sent';
  try {
    await callConversation(token, 'POST', `/${conversationId}/messages`, { body });
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = groupSafeguardingFailureStatus(error)
      || (error instanceof ApiError && error.status === 403 ? 'group-message-forbidden' : 'group-message-failed');
  }

  return redirectTo(res, groupRedirect(conversationId, status));
}));

router.post('/groups/:conversationId(\\d+)/members', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const conversationId = Number(req.params.conversationId);
  const userId = positiveInteger(req.body.user_id);
  if (userId === null) return redirectTo(res, groupRedirect(conversationId, 'group-member-invalid'));

  let status = 'group-member-added';
  try {
    await callConversation(token, 'POST', `/${conversationId}/participants`, { user_id: userId });
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = groupSafeguardingFailureStatus(error) || groupMemberFailureStatus(error);
  }

  return redirectTo(res, groupRedirect(conversationId, status));
}));

router.post('/groups/:conversationId(\\d+)/members/:targetUserId(\\d+)/remove', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const conversationId = Number(req.params.conversationId);
  const targetUserId = Number(req.params.targetUserId);
  const selfLeave = checked(req.body.self_leave);
  let status = selfLeave ? 'group-left' : 'group-member-removed';
  try {
    await callConversation(token, 'DELETE', `/${conversationId}/participants/${targetUserId}`);
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = selfLeave ? 'group-leave-failed' : groupMemberFailureStatus(error);
  }

  return selfLeave
    ? redirectTo(res, statusRedirect('/messages/groups', status))
    : redirectTo(res, groupRedirect(conversationId, status));
}));

router.post('/groups/:conversationId(\\d+)/m/:messageId(\\d+)/react', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const conversationId = Number(req.params.conversationId);
  const messageId = Number(req.params.messageId);
  const emoji = trimmed(req.body.emoji, 16);
  if (emoji === '') return redirectTo(res, groupRedirect(conversationId, 'reaction-invalid', `#m-${messageId}`));

  let status = 'reaction-added';
  try {
    const result = await callMessage(token, 'POST', `/${messageId}/reactions`, { emoji });
    const data = dataFrom(result);
    status = data && data.action === 'removed' ? 'reaction-removed' : 'reaction-added';
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    status = error instanceof ApiError && error.status === 403 ? 'reaction-forbidden' : 'reaction-failed';
  }

  return redirectTo(res, groupRedirect(conversationId, status, `#m-${messageId}`));
}));

router.get('/groups', requireAuth, asyncRoute(async (req, res) => {
  let groups = [];
  let error = '';
  const restriction = await messageRestriction(req);
  const access = messageAccess(req, restriction);
  try {
    const result = await callConversation(req.token, 'GET', '/groups');
    groups = listFrom(dataFrom(result));
  } catch {
    error = res.locals.t('govuk_alpha.states.error_title');
  }

  res.render('messages/groups', {
    title: res.locals.t('govuk_alpha_messages.groups.title'),
    groups: groups.map(group => ({
      ...group,
      displayName: groupName(group, res.locals.t),
      avatarAssetUrl: resolveBackendAssetUrl(group.group_avatar_url || group.groupAvatarUrl)
    })),
    groupStatus: groupStatus(req.query.status, res.locals.t),
    ...access,
    canStart: access.canSend && tenantFeatureEnabled(req, 'connections', true),
    error
  });
}));

router.get('/groups/new', requireConnectionsFeature, requireAuth, asyncRoute(async (req, res) => {
  const restriction = await messageRestriction(req);
  const access = messageAccess(req, restriction);
  const query = trimmed(req.query.q);
  const selectedIds = selectedGroupMemberIds(req.query);
  const selected = new Set(selectedIds);
  let searchResults = [];
  let rawSearchResults = [];
  if (query !== '') {
    const result = await searchUsers(req.token, query, { limit: 10 });
    rawSearchResults = listFrom(dataFrom(result))
      .map(member => ({
        ...member,
        displayName: memberName(member, res.locals.t),
        id: positiveInteger(member.id)
      }))
      .filter(member => member.id !== null);
    searchResults = rawSearchResults.filter(member => !selected.has(member.id));
  }
  const namedSelected = new Map(rawSearchResults.map(member => [member.id, member.displayName]));
  await Promise.all(selectedIds
    .filter(id => !namedSelected.has(id))
    .map(async (id) => {
      try {
        const member = dataFrom(await getUser(req.token, id));
        namedSelected.set(id, memberName(member, res.locals.t));
      } catch {
        // Preserve the selected id and use Blade's unknown-member fallback below.
      }
    }));

  res.render('messages/group-create', {
    title: res.locals.t('govuk_alpha_messages.create.title'),
    query,
    groupName: trimmed(req.query.name, 100),
    selectedIds,
    selectedMembers: selectedIds.map(id => ({
      id,
      displayName: namedSelected.get(id) || res.locals.t('govuk_alpha.members.unknown_member'),
      remainingIds: selectedIds.filter(selectedId => selectedId !== id)
    })),
    searchResults,
    canCreate: selectedIds.length >= 2,
    ...access,
    canStart: access.canSend && tenantFeatureEnabled(req, 'connections', true),
    groupStatus: groupStatus(req.query.status, res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/groups/:conversationId(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const [messagesResult, participantsResult, profileResult, restriction] = await Promise.all([
    callConversation(req.token, 'GET', `/${conversationId}/messages?${conversationQuery(req.query)}`),
    callConversation(req.token, 'GET', `/${conversationId}/participants`),
    getRequestProfile(req, req.token).catch(() => null),
    messageRestriction(req)
  ]);

  const profile = dataFrom(profileResult);
  const currentUserId = positiveInteger(profile && profile.id);
  const meta = (messagesResult && messagesResult.meta) || {};
  const conversation = meta.conversation || { id: conversationId };
  const participants = listFrom(dataFrom(participantsResult)).map(member => ({
    ...member,
    id: positiveInteger(member.id),
    displayName: memberName(member, res.locals.t)
  }));
  const viewer = participants.find(member => member.id !== null && member.id === currentUserId);
  const viewerRole = trimmed(viewer && viewer.role) || 'member';
  const searchQuery = trimmed(req.query.q);
  const messages = listFrom(dataFrom(messagesResult)).map(rawMessage => {
    const message = messageMediaProjection(rawMessage);
    return {
      ...message,
      displaySenderName: senderName(message, currentUserId, res.locals.t)
    };
  }).reverse();
  const messageIds = messages
    .map(message => positiveInteger(message.id))
    .filter(messageId => messageId !== null);
  let reactionsByMessage = {};
  if (messageIds.length) {
    try {
      const reactionsResult = await callMessage(
        req.token,
        'GET',
        `/reactions/batch?ids=${messageIds.join(',')}`
      );
      const reactionData = dataFrom(reactionsResult);
      reactionsByMessage = reactionData && reactionData.reactions && typeof reactionData.reactions === 'object'
        ? reactionData.reactions
        : {};
    } catch {
      reactionsByMessage = {};
    }
  }
  const visibleMessages = searchQuery
    ? messages.filter(message => String(message.body || message.content || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;
  const groupReactionEmojis = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];
  const renderedMessages = visibleMessages.map(message => {
    const reactionEntries = listFrom(reactionsByMessage[String(message.id)] || reactionsByMessage[message.id]);
    const reactionCounts = [];
    const myEmojis = [];
    reactionEntries.forEach(reaction => {
      const emoji = trimmed(reaction && reaction.emoji, 16);
      const count = Math.trunc(Number(reaction && reaction.count) || 0);
      const userIds = listFrom(reaction && reaction.user_ids)
        .map(userId => positiveInteger(userId))
        .filter(userId => userId !== null);
      if (emoji && count > 0) {
        reactionCounts.push({ emoji, count });
      }
      if (emoji && currentUserId !== null && userIds.includes(currentUserId) && !myEmojis.includes(emoji)) {
        myEmojis.push(emoji);
      }
    });
    return {
      ...message,
      reactionCounts,
      reactionOptions: groupReactionEmojis.map(emoji => ({
        emoji,
        mine: myEmojis.includes(emoji)
      })),
      searchSegments: searchQuery
        ? messageSearchSegments(message.body || message.content, searchQuery)
        : []
    };
  });

  const access = messageAccess(req, restriction);
  const safeguarding = meta.safeguarding && typeof meta.safeguarding === 'object'
    ? meta.safeguarding
    : null;
  const canSend = access.canSend && !(safeguarding && safeguarding.restricted);
  res.render('messages/group-conversation', {
    title: groupName(conversation, res.locals.t),
    conversation: {
      ...conversation,
      id: conversationId,
      displayName: groupName(conversation, res.locals.t)
    },
    messages: renderedMessages,
    participants,
    currentUserId,
    viewerRole,
    isAdmin: viewerRole === 'admin',
    ...access,
    safeguarding,
    canSend,
    searchQuery,
    meta: {
      hasMore: Boolean(meta.has_more),
      cursor: meta.cursor || ''
    },
    groupStatus: groupStatus(req.query.status, res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Group conversation not found' }));

// List conversations
router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const showArchived = checked(req.query.archived);
  const cursor = trimmed(req.query.cursor);
  const filter = trimmed(req.query.filter);
  const searchQuery = trimmed(req.query.q);
  const restriction = await messageRestriction(req);
  const access = messageAccess(req, restriction);
  const canStart = access.canSend && tenantFeatureEnabled(req, 'connections', true);
  const [conversationsData, unreadData, searchData, profile] = await Promise.all([
    getConversations(req.token, {
      per_page: 20,
      archived: showArchived,
      ...(cursor ? { cursor } : {})
    }),
    getUnreadCount(req.token).catch(() => ({ data: { count: 0 } })),
    canStart && searchQuery
      ? searchUsers(req.token, searchQuery, { limit: 10 }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    getRequestProfile(req, req.token).catch(() => null)
  ]);
  const inboxProfile = dataFrom(profile);
  const currentUserId = positiveInteger(inboxProfile && inboxProfile.id);
  const conversations = listFrom(dataFrom(conversationsData))
    .map((conversation) => normalizeInboxConversation(conversation, currentUserId, res.locals.t));
  const normalizedFilter = filter.toLowerCase();
  const visibleConversations = normalizedFilter
    ? conversations.filter((conversation) => {
      const filterName = conversation.filterName.toLowerCase();
      return filterName === '' || filterName.includes(normalizedFilter);
    })
    : conversations;
  const meta = conversationsData?.meta || {};
  const unread = dataFrom(unreadData) || {};

  res.render('messages/index', {
    title: res.locals.t('messages.title'),
    communityName: res.locals.tenantName || res.locals.serviceName || '',
    conversations: visibleConversations,
    unreadCount: unread.unread_count ?? unread.unreadCount ?? unread.count ?? 0,
    ...access,
    canStart,
    searchQuery,
    searchResults: listFrom(dataFrom(searchData)).map(member => ({
      ...member,
      id: positiveInteger(member.id),
      displayName: memberName(member, res.locals.t)
    })).filter(member => member.id !== null),
    showArchived,
    filter,
    meta: {
      hasMore: Boolean(meta.has_more),
      cursor: trimmed(meta.cursor || meta.next_cursor)
    },
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    status: trimmed(req.query.status)
  });
}));

router.get('/new/:userId(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  return renderDirectConversation(req, res, Number(req.params.userId));
}, { notFoundTitle: 'Conversation not found' }));

// View conversation
router.get('/:id(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  return renderDirectConversation(req, res, Number(req.params.id));
}, { notFoundTitle: 'Conversation not found' }));

// Send message
router.post('/:id(\\d+)', requireAuth, audit.messageSend(), asyncRoute(async (req, res) => {
  const content = trimmed(req.body.body || req.body.content, 10000);
  const conversationId = req.params.id;
  const recipientId = Number(conversationId);
  const attachments = uploadedFiles(req, 'attachments');
  const contextType = trimmed(req.body.context_type, 50) === 'listing' ? 'listing' : '';
  const contextId = contextType ? positiveInteger(req.body.context_id) : null;

  if (!content && attachments.length === 0) {
    return redirectTo(res, messageRedirect(recipientId, 'message-empty'));
  }

  try {
    if (attachments.length > 0) {
      const files = await Promise.all(attachments.map(async (file) => ({
        buffer: await fs.readFile(file.filepath),
        filename: trimmed(file.originalFilename) || 'attachment',
        contentType: trimmed(file.mimetype) || 'application/octet-stream',
        size: file.size
      })));
      await uploadMessageAttachments(tokenFrom(req), {
        recipient_id: recipientId,
        body: content,
        context_type: contextType || undefined,
        context_id: contextId || undefined,
        files
      });
    } else {
      await callMessage(req.token, 'POST', '', {
        recipient_id: recipientId,
        body: content,
        ...(contextType && contextId ? { context_type: contextType, context_id: contextId } : {})
      });
    }

    return redirectTo(res, messageRedirect(recipientId, 'message-sent'));
  } catch (error) {
    if (redirectOnAuthError(error, req, res)) return undefined;
    if (apiErrorCode(error) === 'ONBOARDING_REQUIRED') {
      return redirectTo(res, '/onboarding');
    }
    if (error instanceof ApiError && error.status !== 401) {
      const code = apiErrorCode(error);
      const status = directSafeguardingFailureStatus(error)
        || (code.includes('FEATURE_DISABLED') || code.includes('MESSAGING_DISABLED')
        ? 'message-disabled'
        : (code.includes('ATTACHMENT') ? 'attachment-failed' : 'message-failed'));
      return redirectTo(res, messageRedirect(recipientId, status));
    }
    throw error;
  } finally {
    await removeUploadedFiles(attachments);
  }
}));

module.exports = router;
