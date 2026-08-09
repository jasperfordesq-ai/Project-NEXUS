// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const {
  getGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  getGroupMembers,
  joinGroup,
  leaveGroup,
  callGroupApi,
  uploadGroupImage,
  uploadGroupFile,
  downloadGroupFile,
  getFeedPosts,
  createFeedPostV2,
  getEvents,
  ApiError
} = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { audit } = require('../lib/auditLogger');
const { resolveBackendAssetUrl } = require('../lib/accessible-shell');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();

const GROUP_NOTIFICATION_FREQUENCIES = ['instant', 'digest', 'muted'];
const DOWNLOAD_HEADER_NAMES = [
  'content-type',
  'content-disposition',
  'content-length',
  'cache-control',
  'pragma',
  'expires',
  'etag',
  'last-modified'
];
const GROUP_INVITE_SUCCESS_STATES = new Set(['invite-link-created', 'invite-emails-sent', 'invite-revoked']);
const GROUP_INVITE_ERROR_STATES = new Set([
  'invite-link-failed',
  'invite-emails-required',
  'invite-emails-too-many',
  'invite-email-failed',
  'invite-revoke-failed',
  'invite-forbidden',
  'invite-safeguarding-restricted',
  'invite-safeguarding-unavailable'
]);
const GROUP_IMAGE_SUCCESS_STATES = new Set(['avatar-updated', 'cover-updated']);
const GROUP_IMAGE_ERROR_STATES = new Set(['image-missing', 'image-failed']);
const GROUP_ANNOUNCEMENT_SUCCESS_STATES = new Set([
  'ann-created', 'ann-updated', 'ann-deleted', 'ann-pinned', 'ann-unpinned'
]);
const GROUP_ANNOUNCEMENT_ERROR_STATES = new Set([
  'ann-create-failed', 'ann-update-failed', 'ann-delete-failed', 'ann-pin-failed',
  'ann-forbidden', 'ann-not-found', 'ann-title-required', 'ann-content-required'
]);
const GROUP_DISCUSSION_SUCCESS_MESSAGES = {
  'discussion-created': 'Your discussion has been posted.',
  'reply-posted': 'Your reply has been posted.'
};
const GROUP_DISCUSSION_ERROR_MESSAGES = {
  'discussion-failed': 'Your discussion could not be posted. Please try again.',
  'reply-failed': 'Your reply could not be posted. Please try again.'
};
const GROUP_FILE_SUCCESS_STATES = new Set(['file-uploaded', 'file-deleted']);
const GROUP_FILE_ERROR_STATES = new Set([
  'file-upload-failed', 'file-too-large', 'file-type-invalid', 'file-missing',
  'file-delete-failed', 'file-forbidden', 'file-not-found'
]);
const GROUP_FILE_FIELD_ERROR_STATES = new Set([
  'file-upload-failed', 'file-too-large', 'file-type-invalid', 'file-missing'
]);
const GROUP_FILE_MAX_SIZE = 25 * 1024 * 1024;
const GROUP_FILE_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'text/markdown',
  'application/zip', 'application/x-rar-compressed',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav', 'audio/ogg'
]);
const GROUP_MANAGE_SUCCESS_STATES = new Set([
  'member-promoted', 'member-demoted', 'member-removed', 'request-approved', 'request-rejected'
]);
const GROUP_MANAGE_ERROR_STATES = new Set([
  'member-failed', 'request-failed', 'request-safeguarding-restricted',
  'request-safeguarding-unavailable'
]);
function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function optionalText(value, limit = null) {
  const text = trimmed(value, limit);
  return text === '' ? null : text;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function allowed(value, choices, fallback) {
  const text = trimmed(value);
  return choices.includes(text) ? text : fallback;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function objectFrom(result) {
  const data = dataFrom(result);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  if (data.user && typeof data.user === 'object') return data.user;
  if (data.profile && typeof data.profile === 'object') return data.profile;
  return data;
}

function urlFor(res, path) {
  return typeof res?.locals?.urlFor === 'function' ? res.locals.urlFor(path) : path;
}

function redirectTo(res, pathname) {
  const target = typeof pathname === 'string' && pathname ? pathname : '/';
  const activePrefix = typeof res?.locals?.accessibleRoutePrefix === 'string'
    ? res.locals.accessibleRoutePrefix
    : '';
  if (
    activePrefix
    && (
      target === activePrefix
      || target.startsWith(`${activePrefix}/`)
      || target.startsWith(`${activePrefix}?`)
      || target.startsWith(`${activePrefix}#`)
    )
  ) {
    return res.redirect(target);
  }
  return res.redirect(urlFor(res, target));
}

function statusRedirect(res, path, status, fragment = '') {
  return `${urlFor(res, path)}?status=${encodeURIComponent(status)}${fragment}`;
}

function groupRedirect(res, id, status, fragment = '') {
  return statusRedirect(res, `/groups/${id}`, status, fragment);
}

function groupSubpageRedirect(res, id, segment, status, fragment = '') {
  return statusRedirect(res, `/groups/${id}/${segment}`, status, fragment);
}

function announcementEditRedirect(res, id, annId, status) {
  return statusRedirect(res, `/groups/${id}/announcements/${annId}/edit`, status);
}

function discussionRedirect(res, id, discussionId, status, fragment = '') {
  return statusRedirect(res, `/groups/${id}/discussions/${discussionId}`, status, fragment);
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function apiErrorEntries(error) {
  return error instanceof ApiError && Array.isArray(error.data?.errors)
    ? error.data.errors.filter((entry) => entry && typeof entry === 'object')
    : [];
}

function apiErrorCode(error) {
  const first = apiErrorEntries(error)[0] || {};
  return trimmed(first.code || error?.data?.code || error?.data?.error).toUpperCase();
}

function groupFormErrors(error, fallback) {
  const entries = apiErrorEntries(error);
  if (entries.length === 0) {
    return [{ text: error instanceof Error && error.message ? error.message : fallback }];
  }
  return entries.map((entry) => ({
    text: trimmed(entry.message) || fallback,
    ...(trimmed(entry.field) ? { href: `#${trimmed(entry.field)}` } : {})
  }));
}

function groupFieldErrors(errors) {
  return Object.fromEntries((Array.isArray(errors) ? errors : [])
    .filter((error) => /^#[a-z][a-z0-9_]*$/i.test(trimmed(error?.href)))
    .map((error) => [trimmed(error.href).slice(1), trimmed(error.text)]));
}

function groupTags(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return raw.map((tag) => trimmed(tag)).filter(Boolean);
}

async function uploadGroupCover(token, groupId, file) {
  if (!file) return;
  const buffer = await fs.readFile(file.filepath);
  await uploadGroupImage(token, groupId, {
    type: 'cover',
    file: {
      buffer,
      filename: trimmed(file.originalFilename) || 'group-cover',
      contentType: trimmed(file.mimetype) || 'application/octet-stream',
      size: file.size
    }
  });
}

function applyDownloadHeaders(res, headers = {}) {
  DOWNLOAD_HEADER_NAMES.forEach((name) => {
    if (headers[name]) {
      res.set(name, headers[name]);
    }
  });
}

async function callGroup(token, method, path, data = undefined) {
  if (data === undefined) {
    return callGroupApi(token, method, path);
  }

  return callGroupApi(token, method, path, data);
}

async function requireGroupAction(req, res, failureRedirect, action) {
  if (!req.token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    return await action(req.token);
  } catch (error) {
    if (isAuthError(error)) {
      return redirectTo(res, loginRedirect());
    }

    const failurePath = typeof failureRedirect === 'function' ? failureRedirect(error) : failureRedirect;
    return redirectTo(res, failurePath);
  }
}

function resultId(result) {
  return positiveInteger(result?.data?.id)
    || positiveInteger(result?.discussion?.id)
    || positiveInteger(result?.id);
}

function dateLabel(value) {
  const text = trimmed(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function dateInputValue(value) {
  const text = trimmed(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function normalizeGroup(item, fallbackId = null) {
  const raw = item && typeof item === 'object' ? item : {};
  const viewerMembership = raw.viewer_membership || raw.viewerMembership;
  const flatMembershipKnown = ['my_role', 'myRole', 'my_status', 'myStatus']
    .some((key) => Object.prototype.hasOwnProperty.call(raw, key));
  const flatMembership = flatMembershipKnown
    ? {
      role: raw.my_role ?? raw.myRole ?? null,
      status: raw.my_status ?? raw.myStatus ?? null
    }
    : null;
  const membership = raw.my_membership || raw.myMembership || raw.membership || viewerMembership || flatMembership;
  const viewerMembershipKnown = ['my_membership', 'myMembership', 'viewer_membership', 'viewerMembership', 'membership', 'my_role', 'myRole', 'my_status', 'myStatus']
    .some((key) => Object.prototype.hasOwnProperty.call(raw, key));
  return {
    ...raw,
    id: positiveInteger(raw.id) || fallbackId,
    name: trimmed(raw.name || raw.title) || 'Group',
    imageUrl: resolveBackendAssetUrl(raw.image_url || raw.imageUrl || raw.avatar_url || raw.avatarUrl),
    coverImageUrl: resolveBackendAssetUrl(raw.cover_image_url || raw.coverImageUrl || raw.cover_url || raw.coverUrl),
    createdAtLabel: dateLabel(raw.created_at || raw.createdAt),
    tagsText: groupTags(raw.tags).join(', '),
    my_membership: membership || null,
    myMembership: membership || null,
    viewerMembershipKnown
  };
}

function isoDateTime(value) {
  const text = trimmed(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function bladeDateTime24Label(value) {
  const text = trimmed(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  const hour = part('hour') === '24' ? '00' : part('hour');
  return `${part('day')} ${part('month')} ${part('year')}, ${hour}:${part('minute')}`;
}

function normalizeAnnouncement(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const author = raw.author && typeof raw.author === 'object' ? raw.author : {};
  return {
    id: positiveInteger(raw.id),
    title: trimmed(raw.title || '') || 'Announcement',
    content: trimmed(raw.content || ''),
    isPinned: checked(raw.is_pinned ?? raw.isPinned),
    isExpired: checked(raw.is_expired ?? raw.isExpired),
    authorName: trimmed(author.name || raw.author_name || raw.authorName || ''),
    postedAtLabel: dateLabel(raw.created_at || raw.createdAt || raw.posted_at || raw.postedAt),
    expiresAtInput: dateInputValue(raw.expires_at || raw.expiresAt)
  };
}

function normalizeDiscussion(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const author = raw.author && typeof raw.author === 'object' ? raw.author : {};
  const createdAt = raw.created_at || raw.createdAt || raw.posted_at || raw.postedAt;
  return {
    id: positiveInteger(raw.id),
    title: trimmed(raw.title || '') || 'View discussion',
    content: trimmed(raw.content || ''),
    authorName: trimmed(author.name || raw.author_name || raw.authorName || ''),
    replyCount: Number(raw.reply_count ?? raw.replyCount ?? raw.replies_count ?? raw.repliesCount ?? 0) || 0,
    isPinned: checked(raw.is_pinned ?? raw.isPinned),
    createdAt: isoDateTime(createdAt),
    createdAtLabel: dateLabel(createdAt)
  };
}

function normalizeInvite(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const type = trimmed(raw.invite_type || raw.inviteType || raw.type) === 'email' ? 'email' : 'link';
  return {
    id: positiveInteger(raw.id),
    type,
    email: trimmed(raw.email || ''),
    inviterName: trimmed(raw.inviter_name || raw.inviterName || raw.created_by_name || raw.createdByName || '') || '—',
    expiresAtLabel: dateLabel(raw.expires_at || raw.expiresAt) || '-'
  };
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1048576) return `${Math.round((bytes / 1048576) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function normalizeGroupFile(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const fileName = trimmed(raw.file_name || raw.fileName || raw.name || raw.filename || '') || 'File';
  return {
    id: positiveInteger(raw.id),
    fileName,
    sizeLabel: formatBytes(raw.file_size || raw.fileSize || raw.size),
    uploaderName: trimmed(raw.uploader_name || raw.uploaderName || raw.uploaded_by_name || raw.uploadedByName || '') || '-',
    uploadedBy: positiveInteger(raw.uploaded_by || raw.uploadedBy || raw.user_id || raw.userId),
    uploadedAtLabel: dateLabel(raw.created_at || raw.createdAt || raw.uploaded_at || raw.uploadedAt) || '-'
  };
}

function normalizeGroupMember(item, ownerId = null, t = (key) => key) {
  const raw = item && typeof item === 'object' ? item : {};
  const user = raw.user && typeof raw.user === 'object' ? raw.user : {};
  const id = positiveInteger(raw.id) || positiveInteger(raw.user_id) || positiveInteger(raw.userId) || positiveInteger(user.id);
  const role = ['owner', 'admin', 'member'].includes(trimmed(raw.role)) ? trimmed(raw.role) : 'member';
  const isOwner = (id !== null && id === ownerId) || role === 'owner';
  const normalizedRole = isOwner ? 'owner' : role;

  return {
    id,
    name: trimmed(raw.name || raw.display_name || raw.displayName || user.name || user.display_name || user.displayName || '') || (id ? `#${id}` : 'Member'),
    role: normalizedRole,
    roleLabel: t(`groups.manage.role_${normalizedRole}`),
    roleClass: normalizedRole === 'owner' || normalizedRole === 'admin' ? 'govuk-tag--blue' : 'govuk-tag--grey',
    isOwner
  };
}

function normalizeJoinRequest(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const user = raw.user && typeof raw.user === 'object' ? raw.user : {};
  const id = positiveInteger(raw.id)
    || positiveInteger(raw.user_id)
    || positiveInteger(raw.userId)
    || positiveInteger(raw.requester_id)
    || positiveInteger(raw.requesterId)
    || positiveInteger(user.id);

  return {
    id,
    name: trimmed(raw.name || raw.display_name || raw.displayName || user.name || user.display_name || user.displayName || '') || (id ? `#${id}` : 'Member')
  };
}

function groupMembership(group) {
  return group?.my_membership
    || group?.myMembership
    || group?.viewer_membership
    || group?.viewerMembership
    || group?.membership
    || null;
}

function plainParagraphs(value) {
  const text = String(value || '')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();

  if (!text) return [];
  return text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function normalizeGroupFeedPost(item, unknownAuthor) {
  const raw = item && typeof item === 'object' ? item : {};
  const author = raw.author && typeof raw.author === 'object' ? raw.author : {};
  const mediaRows = Array.isArray(raw.media) && raw.media.length > 0
    ? raw.media
    : (raw.image_url ? [{ file_url: raw.image_url }] : []);
  const createdAt = trimmed(raw.created_at || raw.createdAt);
  const createdDate = createdAt ? new Date(createdAt) : null;

  return {
    authorName: trimmed(author.name || raw.author_name || raw.authorName) || unknownAuthor,
    authorAvatar: resolveBackendAssetUrl(author.avatar_url || author.avatarUrl || raw.author_avatar_url || raw.authorAvatarUrl),
    createdAt: createdDate && !Number.isNaN(createdDate.getTime()) ? createdDate.toISOString() : '',
    createdAtLabel: createdDate && !Number.isNaN(createdDate.getTime())
      ? bladeDateTime24Label(createdAt)
      : '',
    contentParagraphs: plainParagraphs(raw.content),
    media: mediaRows.slice(0, 4).map((media) => {
      const fullUrl = resolveBackendAssetUrl(media?.file_url || media?.fileUrl || media?.url);
      return {
        fullUrl,
        thumbnailUrl: resolveBackendAssetUrl(media?.thumbnail_url || media?.thumbnailUrl) || fullUrl,
        altText: trimmed(media?.alt_text || media?.altText, 500)
      };
    }).filter((media) => media.fullUrl)
  };
}

function isPlatformAdmin(profile) {
  const role = trimmed(profile?.role || profile?.user_role || profile?.account_role || '');
  return ['admin', 'tenant_admin', 'super_admin', 'god'].includes(role)
    || checked(profile?.is_super_admin)
    || checked(profile?.is_tenant_super_admin);
}

function isGroupAdmin(group, profile = {}) {
  const membership = groupMembership(group);
  const role = trimmed(membership?.role || group?.my_role || group?.myRole || '');
  const status = trimmed(membership?.status || membership?.state || group?.my_status || group?.myStatus || '');
  const profileId = positiveInteger(profile?.id || profile?.user_id || profile?.userId);
  const ownerId = positiveInteger(group?.owner_id || group?.ownerId);

  return (['admin', 'owner'].includes(role) && (status === '' || status === 'active'))
    || (profileId !== null && ownerId === profileId)
    || isPlatformAdmin(profile);
}

function isGroupOwner(group, profile = {}) {
  const membership = groupMembership(group);
  const role = trimmed(membership?.role || group?.my_role || group?.myRole || '');
  const profileId = positiveInteger(profile?.id || profile?.user_id || profile?.userId);
  const ownerId = positiveInteger(group?.owner_id || group?.ownerId);

  return role === 'owner'
    || (profileId !== null && ownerId !== null && profileId === ownerId);
}

function isActiveGroupMember(group, profile = {}) {
  if (isGroupAdmin(group, profile)) return true;
  const membership = groupMembership(group);
  const role = trimmed(membership?.role || '');
  const status = trimmed(membership?.status || membership?.state || '');
  if (status !== '' && status !== 'active') return false;
  return ['member', 'admin', 'owner'].includes(role)
    || status === 'active'
    || checked(group?.is_member || group?.isMember);
}

function hasViewerMembershipContract(group) {
  return group?.viewerMembershipKnown === true;
}

function isKnownGroupAdmin(group, profile) {
  if (isGroupAdmin(group, profile)) return true;
  if (hasViewerMembershipContract(group)) return false;

  const profileId = positiveInteger(profile?.id || profile?.user_id || profile?.userId);
  const ownerId = positiveInteger(group?.owner_id || group?.ownerId);
  return profileId !== null && ownerId !== null ? false : null;
}

function isKnownGroupMember(group, profile) {
  if (isActiveGroupMember(group, profile)) return true;
  return hasViewerMembershipContract(group) ? false : null;
}

function renderForbidden(res) {
  return res.status(403).render('errors/403', { title: 'Forbidden' });
}

function renderNotFound(res, title = 'Page not found') {
  return res.status(404).render('errors/404', { title });
}

function renderTooManyRequests(res) {
  return res.status(429).render('errors/429', { title: 'Too many requests' });
}

function groupFileUploadErrorStatus(error) {
  if (!(error instanceof ApiError)) return 'file-upload-failed';
  if (error.status === 403) return 'file-forbidden';
  if (error.status !== 422) return 'file-upload-failed';

  const code = trimmed(
    error.data?.code
    || error.data?.error_code
    || (Array.isArray(error.data?.errors) ? error.data.errors[0]?.code : '')
  ).toUpperCase();
  if (code === 'FILE_TOO_LARGE') return 'file-too-large';
  if (code === 'INVALID_TYPE') return 'file-type-invalid';
  if (code === 'INVALID_FILE') return 'file-missing';

  const message = trimmed(error.message).toLowerCase();
  if (message.includes('25 mb') || message.includes('25mb') || message.includes('too large') || message.includes('size')) {
    return 'file-too-large';
  }
  if (message.includes('type') || message.includes('format') || message.includes('mime')) {
    return 'file-type-invalid';
  }
  return 'file-upload-failed';
}

async function groupAccessContext(req, id) {
  const groupResult = await getGroup(req.token, id);
  const profileResult = await getRequestProfile(req, req.token);
  return {
    group: normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id)),
    profile: objectFrom(profileResult)
  };
}

function groupFileValidationStatus(file) {
  if (!file) return 'file-missing';
  if (Number(file.size) > GROUP_FILE_MAX_SIZE) return 'file-too-large';
  const mimeType = trimmed(file.mimetype).toLowerCase();
  if (mimeType !== '' && !GROUP_FILE_ALLOWED_MIME_TYPES.has(mimeType)) return 'file-type-invalid';
  return null;
}

function groupRequestFailureStatus(error) {
  const code = apiErrorCode(error);
  if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') return 'request-safeguarding-unavailable';
  if (code.startsWith('SAFEGUARDING_') || code === 'VETTING_REQUIRED') {
    return 'request-safeguarding-restricted';
  }
  return 'request-failed';
}

function groupMembershipFailureStatus(error) {
  const code = apiErrorCode(error);
  if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') return 'group-safeguarding-unavailable';
  if (code.startsWith('SAFEGUARDING_') || code === 'VETTING_REQUIRED') {
    return 'group-safeguarding-restricted';
  }
  return 'group-failed';
}

function inviteGeneratedLink(result) {
  const data = dataFrom(result) || {};
  return trimmed(data.generated_link || data.generatedLink || data.invite_url || data.inviteUrl || '');
}

function inviteStatus(status, t = (key) => key) {
  const value = trimmed(status);
  if (GROUP_INVITE_SUCCESS_STATES.has(value)) {
    return {
      statusBanner: {
        type: 'success',
        title: t('govuk_alpha_groups.common.success_title'),
        message: t(`govuk_alpha_groups.states.${value}`)
      }
    };
  }

  if (GROUP_INVITE_ERROR_STATES.has(value)) {
    const message = value === 'invite-safeguarding-restricted'
      ? 'The recipient’s community safeguarding policy does not allow this direct interaction. Ask a coordinator for help.'
      : value === 'invite-safeguarding-unavailable'
        ? 'We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.'
        : t(`govuk_alpha_groups.states.${value}`);
    return {
      statusBanner: {
        type: 'error',
        title: t('govuk_alpha_groups.common.error_title'),
        message
      }
    };
  }

  return { statusBanner: null };
}

function notificationStatus(status, t = (key) => key) {
  const value = trimmed(status);
  if (value === 'prefs-saved') {
    return {
      statusBanner: {
        type: 'success',
        title: t('govuk_alpha_groups.common.success_title'),
        message: t('govuk_alpha_groups.states.prefs-saved')
      }
    };
  }

  if (value === 'prefs-failed') {
    return {
      statusBanner: {
        type: 'error',
        title: t('govuk_alpha_groups.common.error_title'),
        message: t('govuk_alpha_groups.states.prefs-failed')
      }
    };
  }

  return { statusBanner: null };
}

function imageStatus(status, t = (key) => key) {
  const value = trimmed(status);
  if (GROUP_IMAGE_SUCCESS_STATES.has(value)) {
    return {
      statusBanner: {
        type: 'success',
        title: t('govuk_alpha_groups.common.success_title'),
        message: t(`govuk_alpha_groups.states.${value}`)
      }
    };
  }

  if (GROUP_IMAGE_ERROR_STATES.has(value)) {
    return {
      statusBanner: {
        type: 'error',
        title: t('govuk_alpha_groups.common.error_title'),
        message: t(`govuk_alpha_groups.states.${value}`)
      }
    };
  }

  return { statusBanner: null };
}

function announcementStatus(status, t = (key) => key) {
  const value = trimmed(status);
  if (GROUP_ANNOUNCEMENT_SUCCESS_STATES.has(value)) {
    return {
      statusBanner: {
        type: 'success',
        title: t('govuk_alpha_groups.common.success_title'),
        message: t(`govuk_alpha_groups.states.${value}`)
      }
    };
  }

  if (GROUP_ANNOUNCEMENT_ERROR_STATES.has(value)) {
    const href = value === 'ann-title-required'
      ? '#ann-title'
      : value === 'ann-content-required'
        ? '#ann-content'
        : null;
    return {
      statusBanner: {
        type: 'error',
        title: t('govuk_alpha_groups.common.error_title'),
        message: t(`govuk_alpha_groups.states.${value}`),
        href
      }
    };
  }

  return { statusBanner: null };
}

function discussionStatus(status, t = (key) => key, { createPage = false } = {}) {
  const value = trimmed(status);
  if (Object.prototype.hasOwnProperty.call(GROUP_DISCUSSION_SUCCESS_MESSAGES, value)) {
    return {
      statusBanner: {
        type: 'success',
        title: t('states.success_title'),
        message: t(`groups.states.${value}`)
      }
    };
  }

  if (Object.prototype.hasOwnProperty.call(GROUP_DISCUSSION_ERROR_MESSAGES, value)) {
    return {
      statusBanner: {
        type: 'error',
        title: createPage && value === 'discussion-failed'
          ? t('polish_groups.discussion_failed_heading')
          : t('states.error_title'),
        message: createPage && value === 'discussion-failed'
          ? t('groups.discussions.create_failed')
          : t(`groups.states.${value}`)
      }
    };
  }

  return { statusBanner: null };
}

function fileStatus(status, t = (key) => key) {
  const value = trimmed(status);
  if (GROUP_FILE_SUCCESS_STATES.has(value)) {
    return {
      statusBanner: {
        type: 'success',
        title: t('govuk_alpha_groups.common.success_title'),
        message: t(`govuk_alpha_groups.states.${value}`)
      }
    };
  }

  if (GROUP_FILE_ERROR_STATES.has(value)) {
    return {
      statusBanner: {
        type: 'error',
        title: t('govuk_alpha_groups.common.error_title'),
        message: t(`govuk_alpha_groups.states.${value}`),
        fieldError: GROUP_FILE_FIELD_ERROR_STATES.has(value)
      }
    };
  }

  return { statusBanner: null };
}

function manageStatus(status, t = (key) => key) {
  const value = trimmed(status);
  if (GROUP_MANAGE_SUCCESS_STATES.has(value)) {
    return {
      statusBanner: {
        type: 'success',
        title: t('states.success_title'),
        message: t(`groups.states.${value}`)
      }
    };
  }

  if (GROUP_MANAGE_ERROR_STATES.has(value)) {
    return {
      statusBanner: {
        type: 'error',
        title: t('states.error_title'),
        message: value === 'request-safeguarding-restricted'
          ? t('safeguarding.errors.interaction_not_allowed')
          : value === 'request-safeguarding-unavailable'
            ? t('safeguarding.errors.policy_unavailable')
            : t(`groups.states.${value}`)
      }
    };
  }

  return { statusBanner: null };
}

function booleanPref(raw, key, fallback) {
  if (!raw || !Object.prototype.hasOwnProperty.call(raw, key)) {
    return fallback;
  }

  return raw[key] === true || raw[key] === 1 || raw[key] === '1' || raw[key] === 'true';
}

function normalizeNotificationPrefs(result) {
  const data = dataFrom(result) || {};
  const raw = data.preferences || data.preference || data;
  return {
    prefFrequency: allowed(raw.frequency, GROUP_NOTIFICATION_FREQUENCIES, 'instant'),
    prefEmailEnabled: booleanPref(raw, 'email_enabled', true),
    prefPushEnabled: booleanPref(raw, 'push_enabled', true)
  };
}

function parseInviteEmails(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function announcementPayload(body) {
  const title = trimmed(body.title, 255);
  const content = trimmed(body.content, 20000);

  if (title === '') {
    return { error: 'ann-title-required' };
  }

  if (content === '') {
    return { error: 'ann-content-required' };
  }

  return {
    title,
    content,
    is_pinned: checked(body.is_pinned),
    expires_at: optionalText(body.expires_at)
  };
}

function discussionPayload(body) {
  const title = trimmed(body.title, 255);
  const content = trimmed(body.content, 20000);

  if (title === '' || content === '') {
    return null;
  }

  return { title, content };
}

function discussionFormValues(body) {
  return {
    title: String(body?.title || '').slice(0, 255),
    content: String(body?.content || '').slice(0, 20000)
  };
}

function rememberDiscussionForm(req, groupId, discussionId, values, errors = {}) {
  if (!req.session) return;
  req.session.groupDiscussionFormReplay = {
    groupId: positiveInteger(groupId),
    discussionId: positiveInteger(discussionId),
    values,
    errors
  };
}

function consumeDiscussionForm(req, groupId, discussionId = null) {
  const replay = req.session?.groupDiscussionFormReplay;
  if (req.session) delete req.session.groupDiscussionFormReplay;
  return replay
    && replay.groupId === positiveInteger(groupId)
    && replay.discussionId === positiveInteger(discussionId)
    ? replay
    : { values: {}, errors: {} };
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

// List all groups
router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const limit = 30;
  const searchQuery = trimmed(req.query.q || req.query.search);
  const cursor = trimmed(req.query.cursor) || undefined;
  const groupsFilter = allowed(req.query.filter, ['all', 'joined', 'public', 'private'], 'all');
  const filters = {
    per_page: limit,
    cursor,
    q: searchQuery || undefined
  };
  if (groupsFilter === 'joined') filters.member = 'me';
  if (groupsFilter === 'public' || groupsFilter === 'private') filters.visibility = groupsFilter;

  const groupsResult = await getGroups(req.token, filters);

  const groups = collectionFrom(groupsResult)
    .map((group) => normalizeGroup(group, positiveInteger(group?.id)));
  const meta = groupsResult?.meta || {};
  const nextQuery = new URLSearchParams();
  if (searchQuery) nextQuery.set('q', searchQuery);
  if (groupsFilter !== 'all') nextQuery.set('filter', groupsFilter);
  const nextCursor = trimmed(meta.cursor || meta.next_cursor);
  if (nextCursor) nextQuery.set('cursor', nextCursor);

  res.render('groups/index', {
    title: 'Groups',
    groups,
    searchQuery,
    groupsFilter,
    pagination: {
      hasMore: Boolean(meta.has_more),
      cursor: nextCursor,
      nextHref: urlFor(res, `/groups?${nextQuery.toString()}`)
    },
    status: trimmed(req.query.status)
  });
}, { redirectOn401: loginRedirect() }));

// Create group form
router.get('/new', requireAuth, (req, res) => {
  res.render('groups/new', {
    title: 'Create a group',
    createFailed: trimmed(req.query.status) === 'group-create-failed',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
});

// Create group
router.post('/new', requireAuth, audit.groupCreate(), asyncRoute(async (req, res) => {
  const cover = uploadedFile(req, 'cover');
  const { name, description, location, tags } = req.body;
  const visibility = ['public', 'private'].includes(req.body.visibility)
    ? req.body.visibility
    : (req.body.is_private === 'true' ? 'private' : 'public');

  const errors = [];

  if (!name || !name.trim()) {
    errors.push({ text: res.locals.t('groups.errors.name_required'), href: '#name' });
  } else if (name.length > 255) {
    errors.push({ text: res.locals.t('groups.errors.name_too_long'), href: '#name' });
  }

  if (errors.length > 0) {
    await removeUploadedFile(cover);
    return res.render('groups/new', {
      title: 'Create a group',
      errors,
      fieldErrors: groupFieldErrors(errors),
      values: { name, description, location, visibility, tags },
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  }

  try {
    const tagList = groupTags(tags);
    const tagLabel = res.locals.t('groups.create.tags_label');
    const descriptionText = trimmed(description);
    const descriptionWithTags = tagList.length > 0
      ? trimmed(`${descriptionText}\n\n${tagLabel}: ${tagList.join(', ')}`)
      : descriptionText;
    const result = await createGroup(req.token, {
      name: name.trim(),
      description: descriptionWithTags || null,
      location: location ? location.trim() : null,
      visibility
    });

    const createdGroup = dataFrom(result)?.group || dataFrom(result);
    const groupId = positiveInteger(createdGroup && createdGroup.id);
    if (groupId === null) {
      throw new ApiError('Laravel did not return the created group', 502);
    }
    if (cover) {
      try {
        await uploadGroupCover(req.token, groupId, cover);
      } catch {
        // Laravel Blade treats the optional cover upload as best-effort once
        // the group exists, so its failure is intentionally silent here too.
      }
    }
    res.redirect(groupRedirect(res, groupId, 'group-created'));
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && apiErrorCode(error) === 'ONBOARDING_REQUIRED') {
      return res.redirect(urlFor(res, '/onboarding'));
    }
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res);
    }
    if (error instanceof ApiError && error.status !== 401) {
      const formErrors = groupFormErrors(error, 'Unable to create group');
      return res.render('groups/new', {
        title: 'Create a group',
        errors: formErrors,
        fieldErrors: groupFieldErrors(formErrors),
        values: { name, description, location, visibility, tags },
        csrfToken: req.csrfToken ? req.csrfToken() : ''
      });
    }
    throw error;
  } finally {
    await removeUploadedFile(cover);
  }
}));

// View group details
router.get('/:id(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const groupResult = await getGroup(req.token, id);
  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id));
  const isMember = isActiveGroupMember(group);

  const [membersResult, eventsResult, announcementsResult, feedResult] = await Promise.all([
    getGroupMembers(req.token, id, { per_page: 100 }).catch((error) => {
      if (isAuthError(error)) throw error;
      if (error instanceof ApiError && error.status === 403) return { data: [] };
      throw error;
    }),
    getEvents(req.token, { group_id: id, when: 'upcoming', per_page: 5 }).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: [] };
    }),
    callGroup(req.token, 'GET', `/${id}/announcements`).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: [] };
    }),
    isMember
      ? getFeedPosts(req.token, { group_id: id, per_page: 20 }).catch((error) => {
        if (isAuthError(error)) throw error;
        return { data: [] };
      })
      : Promise.resolve({ data: [] })
  ]);

  const members = collectionFrom(membersResult);
  const memberCountSource = group.member_count ?? group.memberCount;
  const parsedMemberCount = Number(memberCountSource);
  const displayMemberCount = memberCountSource === null || memberCountSource === undefined
    ? members.length
    : (Number.isFinite(parsedMemberCount) ? Math.trunc(parsedMemberCount) : 0);
  const events = collectionFrom(eventsResult)
    .map((event) => ({
      ...event,
      id: positiveInteger(event?.id),
      title: trimmed(event?.title),
      startsAt: event?.start_time || event?.start_date || event?.starts_at || event?.startsAt || '',
      coverImage: resolveBackendAssetUrl(event?.cover_image || event?.cover_image_url || event?.coverImage || event?.coverImageUrl)
    }))
    .filter((event) => event.id !== null && event.title !== '');
  const groupFeed = collectionFrom(feedResult)
    .map((item) => normalizeGroupFeedPost(item, res.locals.t('govuk_alpha.feed.unknown_author')));
  const pinnedAnnouncements = collectionFrom(announcementsResult)
    .filter((announcement) => trimmed(announcement?.title) !== '')
    .map(normalizeAnnouncement)
    .filter((announcement) => announcement.isPinned);
  const subGroups = (Array.isArray(group.sub_groups) ? group.sub_groups : [])
    .map((subGroup) => ({
      ...subGroup,
      id: positiveInteger(subGroup?.id),
      name: trimmed(subGroup?.name),
      description: trimmed(subGroup?.description),
      imageUrl: resolveBackendAssetUrl(subGroup?.image_url || subGroup?.imageUrl),
      memberCount: Number(subGroup?.member_count ?? subGroup?.memberCount ?? 0) || 0,
      isPrivate: trimmed(subGroup?.visibility || 'public') !== 'public'
    }))
    .filter((subGroup) => subGroup.id !== null && subGroup.name !== '');
  const myMembership = group.myMembership || group.my_membership;
  const membershipStatus = trimmed(myMembership?.status || myMembership?.state);
  const isAdmin = isGroupAdmin(group);
  const isPending = membershipStatus === 'pending';
  res.render('groups/detail', {
    title: group.name,
    group,
    displayMemberCount,
    members,
    events,
    groupFeed,
    pinnedAnnouncements,
    subGroups,
    myMembership,
    isAdmin,
    isMember,
    isPending,
    groupCanParticipate: isMember,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    status: trimmed(req.query.status)
  });
}, { notFoundTitle: 'Group not found' }));

// Edit group form
router.get('/:id(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);

  const [groupResult, profileResult] = await Promise.all([
    getGroup(req.token, id),
    getRequestProfile(req, req.token)
  ]);
  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id));
  const profile = objectFrom(profileResult);
  const myMembership = group.myMembership || group.my_membership;

  // Check permission
  if (!isGroupAdmin(group, profile)) {
    return renderForbidden(res);
  }

  res.render('groups/edit', {
    title: `Edit ${group.name}`,
    group,
    myMembership,
    isOwner: isGroupOwner(group, profile),
    updateFailed: trimmed(req.query.status) === 'group-update-failed',
    deleteFailed: trimmed(req.query.status) === 'group-delete-failed',
    deleteConfirmationRequired: false,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/invite', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupAdmin(group, profile) !== true) {
    return renderForbidden(res);
  }

  const invitesResult = await callGroup(req.token, 'GET', `/${id}/invites`).catch((error) => {
    if (isAuthError(error)) throw error;
    return { data: { items: [] } };
  });
  const pendingInvites = collectionFrom(invitesResult)
    .map(normalizeInvite)
    .filter((invite) => invite.id !== null);

  return res.render('groups/invite', {
    title: 'Invite members',
    activeNav: 'explore',
    group,
    generatedLink: inviteGeneratedLink(invitesResult),
    pendingInvites,
    ...inviteStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/notifications', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { group, profile } = await groupAccessContext(req, id);
  if (!isActiveGroupMember(group, profile)) {
    return renderForbidden(res);
  }

  const prefsResult = await callGroup(req.token, 'GET', `/${id}/notification-prefs`).catch((error) => {
    if (isAuthError(error)) throw error;
    return {
      data: {
        frequency: 'instant',
        email_enabled: true,
        push_enabled: true
      }
    };
  });

  return res.render('groups/notifications', {
    title: res.locals.t('govuk_alpha_groups.notifications.title'),
    activeNav: 'explore',
    group,
    ...normalizeNotificationPrefs(prefsResult),
    ...notificationStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/image', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupAdmin(group, profile) !== true) {
    return renderForbidden(res);
  }

  return res.render('groups/image', {
    title: 'Group images',
    activeNav: 'explore',
    group,
    ...imageStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/announcements', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { group, profile } = await groupAccessContext(req, id);
  if (!isActiveGroupMember(group, profile)) {
    return renderForbidden(res);
  }

  const announcementsResult = await callGroup(req.token, 'GET', `/${id}/announcements`).catch((error) => {
    if (isAuthError(error)) throw error;
    return { data: { items: [] } };
  });
  const announcements = collectionFrom(announcementsResult)
    .map(normalizeAnnouncement)
    .filter((announcement) => announcement.id !== null);

  return res.render('groups/announcements', {
    title: 'Announcements',
    activeNav: 'explore',
    group,
    announcements,
    isAdmin: isGroupAdmin(group, profile),
    ...announcementStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/announcements/:annId(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const { id, annId } = req.params;
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupAdmin(group, profile) !== true) {
    return renderForbidden(res);
  }

  const announcementsResult = await callGroup(req.token, 'GET', `/${id}/announcements`);
  const announcementData = collectionFrom(announcementsResult)
    .find((announcement) => String(positiveInteger(announcement?.id)) === String(annId));
  if (!announcementData) {
    return res.status(404).render('errors/404', { title: 'Announcement not found' });
  }

  const announcement = normalizeAnnouncement(announcementData);

  return res.render('groups/announcement-edit', {
    title: res.locals.t('govuk_alpha_groups.announcements.edit_heading'),
    activeNav: 'explore',
    group,
    announcement,
    ...announcementStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Announcement not found' }));

router.get('/:id(\\d+)/discussions', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const groupResult = await getGroup(req.token, id);
  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id));
  const isMember = isActiveGroupMember(group);
  const discussionsResult = isMember
    ? await callGroup(req.token, 'GET', `/${id}/discussions`).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: { items: [] } };
    })
    : { data: { items: [] } };
  const discussions = collectionFrom(discussionsResult)
    .map(normalizeDiscussion)
    .filter((discussion) => discussion.id !== null);

  return res.render('groups/discussions', {
    title: 'Discussions',
    activeNav: 'explore',
    group,
    isMember,
    discussions,
    ...discussionStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/discussions/new', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { group, profile } = await groupAccessContext(req, id);
  if (!isActiveGroupMember(group, profile)) {
    return renderForbidden(res);
  }
  const replay = consumeDiscussionForm(req, id);

  return res.render('groups/discussion-create', {
    title: res.locals.t('groups.discussions.new_title'),
    activeNav: 'explore',
    group,
    formValues: replay.values,
    fieldErrors: replay.errors,
    ...discussionStatus(req.query.status, res.locals.t, { createPage: true })
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/discussions/:discussionId(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const { id, discussionId } = req.params;
  const [groupResult, discussionResult] = await Promise.all([
    getGroup(req.token, id),
    callGroup(req.token, 'GET', `/${id}/discussions/${discussionId}`)
  ]);
  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id));
  const data = dataFrom(discussionResult) || {};
  const discussion = normalizeDiscussion(data.discussion || data.thread || data);
  const messages = (Array.isArray(data.messages) ? data.messages : collectionFrom({ data }))
    .map((message) => ({
      ...normalizeDiscussion(message),
      createdAt: isoDateTime(message?.created_at || message?.createdAt || message?.posted_at || message?.postedAt),
      createdAtLabel: bladeDateTime24Label(message?.created_at || message?.createdAt || message?.posted_at || message?.postedAt)
    }))
    .filter((message) => message.id !== null);
  const replay = consumeDiscussionForm(req, id, discussionId);

  return res.render('groups/discussion-detail', {
    title: discussion.title,
    activeNav: 'explore',
    group,
    discussion,
    messages,
    replyValues: replay.values,
    fieldErrors: replay.errors,
    ...discussionStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Discussion not found' }));

router.get('/:id(\\d+)/files/:fileId(\\d+)/download', requireAuth, asyncRoute(async (req, res) => {
  const { id, fileId } = req.params;
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupMember(group, profile) !== true) {
    return renderForbidden(res);
  }

  let download;

  try {
    download = await downloadGroupFile(req.token, `/${id}/files/${fileId}/download`);
  } catch (error) {
    if (isAuthError(error)) {
      return redirectTo(res, loginRedirect());
    }
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res);
    }
    if (error instanceof ApiError && error.status === 404) {
      return renderNotFound(res, 'File not found');
    }
    throw error;
  }

  res.status(download.status || 200);
  applyDownloadHeaders(res, download.headers);
  return res.send(Buffer.isBuffer(download.body) ? download.body : Buffer.from(download.body || ''));
}, { redirectOn401: loginRedirect(), notFoundTitle: 'File not found' }));

router.get('/:id(\\d+)/files', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupMember(group, profile) !== true) {
    return renderForbidden(res);
  }

  let filesResult;
  try {
    filesResult = await callGroup(req.token, 'GET', `/${id}/files?per_page=50`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res);
    }
    throw error;
  }

  const currentUserId = positiveInteger(profile.id || profile.user_id || profile.userId);
  const isAdmin = isGroupAdmin(group, profile);
  const files = collectionFrom(filesResult)
    .map(normalizeGroupFile)
    .filter((file) => file.id !== null)
    .map((file) => ({
      ...file,
      canDelete: isAdmin || (currentUserId !== null && file.uploadedBy === currentUserId)
    }));

  return res.render('groups/files', {
    title: res.locals.t('govuk_alpha_groups.files.title'),
    activeNav: 'explore',
    group,
    files,
    isAdmin,
    currentUserId,
    ...fileStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/manage', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupAdmin(group, profile) !== true) {
    return renderForbidden(res);
  }
  const ownerId = positiveInteger(group.owner_id || group.ownerId);
  const currentUserId = positiveInteger(profile.id || profile.user_id || profile.userId);
  const visibility = trimmed(group.visibility || 'public') || 'public';
  const isPrivate = checked(group.is_private ?? group.isPrivate) || visibility !== 'public';

  const [membersResult, requestsResult] = await Promise.all([
    getGroupMembers(req.token, id, { per_page: 100 }),
    callGroup(req.token, 'GET', `/${id}/requests`).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: [] };
    })
  ]);

  const members = collectionFrom(membersResult)
    .map((member) => normalizeGroupMember(member, ownerId, res.locals.t))
    .filter((member) => member.id !== null && member.id !== currentUserId);
  const pendingRequests = collectionFrom(requestsResult)
    .map(normalizeJoinRequest)
    .filter((requestItem) => requestItem.id !== null);

  return res.render('groups/manage', {
    title: res.locals.t('groups.manage.title'),
    activeNav: 'explore',
    group,
    members,
    pendingRequests,
    isPrivate,
    ...manageStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

// Update group
router.post('/:id(\\d+)/edit', requireAuth, audit.groupUpdate(), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const cover = uploadedFile(req, 'cover');
  const { name, description, location, tags } = req.body;
  const visibility = ['public', 'private'].includes(req.body.visibility)
    ? req.body.visibility
    : (req.body.is_private === 'true' ? 'private' : 'public');

  const errors = [];

  if (!name || !name.trim()) {
    errors.push({ text: res.locals.t('groups.errors.name_required'), href: '#name' });
  } else if (name.length > 255) {
    errors.push({ text: res.locals.t('groups.errors.name_too_long'), href: '#name' });
  }

  if (errors.length > 0) {
    await removeUploadedFile(cover);
    return res.render('groups/edit', {
      title: 'Edit group',
      group: { id, name, description, location, visibility, tagsText: trimmed(tags) },
      errors,
      fieldErrors: groupFieldErrors(errors),
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  }

  try {
    await updateGroup(req.token, id, {
      name: name.trim(),
      description: description ? description.trim() : null,
      location: location ? location.trim() : null,
      visibility,
      tags: groupTags(tags)
    });

    if (cover) {
      try {
        await uploadGroupCover(req.token, id, cover);
      } catch {
        // Match Blade's best-effort optional cover update.
      }
    }

    return res.redirect(groupRedirect(res, id, 'group-updated'));
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res);
    }
    if (error instanceof ApiError && error.status === 404) {
      return renderNotFound(res, 'Group not found');
    }
    if (error instanceof ApiError && error.status === 429) {
      return renderTooManyRequests(res);
    }
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      const formErrors = groupFormErrors(error, 'Unable to update group');
      return res.render('groups/edit', {
        title: 'Edit group',
        group: { id, name, description, location, visibility, tagsText: trimmed(tags) },
        errors: formErrors,
        fieldErrors: groupFieldErrors(formErrors),
        csrfToken: req.csrfToken ? req.csrfToken() : ''
      });
    }
    throw error;
  } finally {
    await removeUploadedFile(cover);
  }
}));

// Delete group
router.post('/:id(\\d+)/delete', requireAuth, audit.groupDelete(), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);

  if (trimmed(req.body.confirm).toLowerCase() !== 'yes') {
    const [groupResult, profileResult] = await Promise.all([
      getGroup(req.token, id),
      getRequestProfile(req, req.token)
    ]);
    const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), id);
    const profile = objectFrom(profileResult);
    const myMembership = group.myMembership || group.my_membership;
    if (!isGroupOwner(group, profile)) {
      return renderForbidden(res);
    }

    return res.status(400).render('groups/edit', {
      title: `Edit ${group.name}`,
      group,
      myMembership,
      isOwner: true,
      errors: [{ text: 'Confirm that you understand the group will be permanently deleted.', href: '#confirm-delete' }],
      deleteConfirmationRequired: true,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  }

  try {
    await deleteGroup(req.token, id);

    return res.redirect(statusRedirect(res, '/groups', 'group-deleted'));
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res);
    }
    if (error instanceof ApiError && error.status === 404) {
      return renderNotFound(res, 'Group not found');
    }
    if (error instanceof ApiError && error.status === 429) {
      return renderTooManyRequests(res);
    }
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      return res.redirect(groupRedirect(res, id, 'group-delete-failed'));
    }
    throw error;
  }
}));

// Join group
router.post('/:id(\\d+)/join', requireAuth, audit.groupJoin(), asyncRoute(async (req, res) => {
  const { id } = req.params;

  try {
    await joinGroup(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      return res.redirect(groupRedirect(res, id, groupMembershipFailureStatus(error)));
    }
    throw error;
  }

  res.redirect(groupRedirect(res, id, 'group-joined'));
}));

// Leave group
router.post('/:id(\\d+)/leave', requireAuth, audit.groupLeave(), asyncRoute(async (req, res) => {
  const { id } = req.params;

  try {
    await leaveGroup(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      return res.redirect(groupRedirect(res, id, 'group-failed'));
    }
    throw error;
  }

  res.redirect(groupRedirect(res, id, 'group-left'));
}));

router.post('/:id(\\d+)/invite/link', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const expiryDays = positiveInteger(req.body.expiry_days);
  const payload = {
    expiry_days: expiryDays !== null && expiryDays <= 90 ? expiryDays : null
  };

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'invite', 'invite-link-failed'), async (token) => {
    await callGroup(token, 'POST', `/${id}/invites/link`, payload);
    return res.redirect(groupSubpageRedirect(res, id, 'invite', 'invite-link-created'));
  });
}));

router.post('/:id(\\d+)/invite/email', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const emails = parseInviteEmails(req.body.emails);

  if (emails.length === 0) {
    return res.redirect(groupSubpageRedirect(res, id, 'invite', 'invite-emails-required'));
  }

  if (emails.length > 50) {
    return res.redirect(groupSubpageRedirect(res, id, 'invite', 'invite-emails-too-many'));
  }

  const payload = {
    emails,
    message: optionalText(req.body.message, 5000)
  };

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'invite', 'invite-email-failed'), async (token) => {
    await callGroup(token, 'POST', `/${id}/invites/email`, payload);
    return res.redirect(groupSubpageRedirect(res, id, 'invite', 'invite-emails-sent'));
  });
}));

router.post('/:id(\\d+)/invite/:inviteId(\\d+)/revoke', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const inviteId = Number(req.params.inviteId);

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'invite', 'invite-revoke-failed'), async (token) => {
    await callGroup(token, 'DELETE', `/${id}/invites/${inviteId}`);
    return res.redirect(groupSubpageRedirect(res, id, 'invite', 'invite-revoked'));
  });
}));

router.post('/:id(\\d+)/notifications', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const payload = {
    frequency: allowed(req.body.frequency, GROUP_NOTIFICATION_FREQUENCIES, 'instant'),
    email_enabled: checked(req.body.email_enabled),
    push_enabled: checked(req.body.push_enabled)
  };

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'notifications', 'prefs-failed'), async (token) => {
    await callGroup(token, 'PUT', `/${id}/notification-prefs`, payload);
    return res.redirect(groupSubpageRedirect(res, id, 'notifications', 'prefs-saved'));
  });
}));

router.post('/:id(\\d+)/image', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const file = uploadedFile(req, 'image');
  let group;
  let profile;
  try {
    ({ group, profile } = await groupAccessContext(req, id));
  } catch (error) {
    await removeUploadedFile(file);
    throw error;
  }
  if (isKnownGroupAdmin(group, profile) !== true) {
    await removeUploadedFile(file);
    return renderForbidden(res);
  }

  const type = allowed(req.body.type, ['avatar', 'cover'], 'avatar');

  if (!file) {
    return res.redirect(groupSubpageRedirect(res, id, 'image', 'image-missing'));
  }

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'image', 'image-failed'), async (token) => {
    try {
      const buffer = await fs.readFile(file.filepath);
      await uploadGroupImage(token, id, {
        type,
        file: {
          buffer,
          filename: trimmed(file.originalFilename) || 'group-image',
          contentType: trimmed(file.mimetype) || 'application/octet-stream',
          size: file.size
        }
      });
    } finally {
      await removeUploadedFile(file);
    }
    return res.redirect(groupSubpageRedirect(res, id, 'image', type === 'cover' ? 'cover-updated' : 'avatar-updated'));
  });
}));

router.post('/:id(\\d+)/files', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const file = uploadedFile(req, 'file');
  let group;
  let profile;
  try {
    ({ group, profile } = await groupAccessContext(req, id));
  } catch (error) {
    await removeUploadedFile(file);
    throw error;
  }
  if (isKnownGroupMember(group, profile) !== true) {
    await removeUploadedFile(file);
    return renderForbidden(res);
  }

  const validationStatus = groupFileValidationStatus(file);

  if (validationStatus) {
    await removeUploadedFile(file);
    return res.redirect(groupSubpageRedirect(res, id, 'files', validationStatus));
  }

  return requireGroupAction(req, res, (error) => (
    groupSubpageRedirect(res, id, 'files', groupFileUploadErrorStatus(error))
  ), async (token) => {
    try {
      const buffer = await fs.readFile(file.filepath);
      await uploadGroupFile(token, id, {
        folder: optionalText(req.body.folder, 100),
        description: optionalText(req.body.description, 500),
        file: {
          buffer,
          filename: trimmed(file.originalFilename) || 'group-file',
          contentType: trimmed(file.mimetype) || 'application/octet-stream',
          size: file.size
        }
      });
    } finally {
      await removeUploadedFile(file);
    }
    return res.redirect(groupSubpageRedirect(res, id, 'files', 'file-uploaded'));
  });
}));

router.post('/:id(\\d+)/files/:fileId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const fileId = Number(req.params.fileId);
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupMember(group, profile) !== true) {
    return renderForbidden(res);
  }

  return requireGroupAction(req, res, (error) => {
    const status = error instanceof ApiError && error.status === 404
      ? 'file-not-found'
      : error instanceof ApiError && error.status === 403
        ? 'file-forbidden'
        : 'file-delete-failed';
    return groupSubpageRedirect(res, id, 'files', status);
  }, async (token) => {
    await callGroup(token, 'DELETE', `/${id}/files/${fileId}`);
    return res.redirect(groupSubpageRedirect(res, id, 'files', 'file-deleted'));
  });
}));

router.post('/:id(\\d+)/announcements', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const payload = announcementPayload(req.body);

  if (payload.error) {
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', payload.error));
  }

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'announcements', 'ann-create-failed'), async (token) => {
    await callGroup(token, 'POST', `/${id}/announcements`, payload);
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', 'ann-created'));
  });
}));

router.post('/:id(\\d+)/announcements/:annId(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const annId = Number(req.params.annId);
  const payload = announcementPayload(req.body);

  if (payload.error) {
    return res.redirect(announcementEditRedirect(res, id, annId, payload.error));
  }

  return requireGroupAction(req, res, announcementEditRedirect(res, id, annId, 'ann-update-failed'), async (token) => {
    await callGroup(token, 'PUT', `/${id}/announcements/${annId}`, payload);
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', 'ann-updated'));
  });
}));

router.post('/:id(\\d+)/announcements/:annId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const annId = Number(req.params.annId);

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'announcements', 'ann-delete-failed'), async (token) => {
    await callGroup(token, 'DELETE', `/${id}/announcements/${annId}`);
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', 'ann-deleted'));
  });
}));

router.post('/:id(\\d+)/announcements/:annId(\\d+)/pin', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const annId = Number(req.params.annId);
  const isPinned = checked(req.body.is_pinned);

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'announcements', 'ann-pin-failed'), async (token) => {
    await callGroup(token, 'PUT', `/${id}/announcements/${annId}`, { is_pinned: isPinned });
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', isPinned ? 'ann-pinned' : 'ann-unpinned'));
  });
}));

router.post('/:id(\\d+)/discussions/new', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const payload = discussionPayload(req.body);
  const values = discussionFormValues(req.body);

  if (payload === null) {
    const errors = {};
    if (trimmed(values.title) === '') errors.title = res.locals.t('groups.errors.title_required');
    if (trimmed(values.content) === '') errors.content = res.locals.t('groups.errors.content_required');
    rememberDiscussionForm(req, id, null, values, errors);
    return res.redirect(urlFor(res, `/groups/${id}/discussions/new`));
  }

  return requireGroupAction(req, res, () => {
    rememberDiscussionForm(req, id, null, values);
    return groupSubpageRedirect(res, id, 'discussions/new', 'discussion-failed');
  }, async (token) => {
    const result = await callGroup(token, 'POST', `/${id}/discussions`, payload);
    const discussionId = resultId(result);
    const target = discussionId
      ? discussionRedirect(res, id, discussionId, 'discussion-created')
      : groupSubpageRedirect(res, id, 'discussions', 'discussion-created');
    return res.redirect(target);
  });
}));

router.post('/:id(\\d+)/discussions/:discussionId(\\d+)/reply', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const discussionId = Number(req.params.discussionId);
  const content = trimmed(req.body.content, 20000);
  const values = { content: String(req.body.content || '').slice(0, 20000) };

  if (content === '') {
    rememberDiscussionForm(req, id, discussionId, values, {
      content: res.locals.t('groups.errors.content_required')
    });
    return res.redirect(urlFor(res, `/groups/${id}/discussions/${discussionId}`));
  }

  return requireGroupAction(req, res, () => {
    rememberDiscussionForm(req, id, discussionId, values);
    return discussionRedirect(res, id, discussionId, 'reply-failed', '#discussion-replies');
  }, async (token) => {
    await callGroup(token, 'POST', `/${id}/discussions/${discussionId}/messages`, { content });
    return res.redirect(discussionRedirect(res, id, discussionId, 'reply-posted', '#discussion-replies'));
  });
}));

router.post('/:id(\\d+)/feed', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const content = trimmed(req.body.content, 20000);
  const image = uploadedFile(req, 'image');

  if (content === '') {
    await removeUploadedFile(image);
    return res.redirect(groupRedirect(res, id, 'group-post-empty', '#group-feed'));
  }

  try {
    return await requireGroupAction(req, res, groupRedirect(res, id, 'group-post-failed', '#group-feed'), async (token) => {
      const file = image ? {
        buffer: await fs.readFile(image.filepath),
        filename: image.originalFilename || image.filename || 'group-feed-image',
        contentType: image.mimetype || image.contentType || 'application/octet-stream'
      } : null;
      const payload = {
        content,
        visibility: 'public',
        group_id: id
      };
      if (file) {
        payload.image = file;
        payload.image_alt = trimmed(req.body.image_alt, 500);
      }
      await createFeedPostV2(token, payload);
      return res.redirect(groupRedirect(res, id, 'group-posted', '#group-feed'));
    });
  } finally {
    await removeUploadedFile(image);
  }
}));

router.post('/:id(\\d+)/members/:memberId(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const memberId = Number(req.params.memberId);
  const action = trimmed(req.body.action);

  if (!['promote', 'demote', 'remove'].includes(action)) {
    return res.redirect(groupSubpageRedirect(res, id, 'manage', 'member-failed'));
  }

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'manage', 'member-failed'), async (token) => {
    if (action === 'remove') {
      await callGroup(token, 'DELETE', `/${id}/members/${memberId}`);
      return res.redirect(groupSubpageRedirect(res, id, 'manage', 'member-removed'));
    }

    const role = action === 'promote' ? 'admin' : 'member';
    await callGroup(token, 'PUT', `/${id}/members/${memberId}`, { role });
    return res.redirect(groupSubpageRedirect(res, id, 'manage', action === 'promote' ? 'member-promoted' : 'member-demoted'));
  });
}));

router.post('/:id(\\d+)/requests/:requesterId(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const requesterId = Number(req.params.requesterId);
  const action = trimmed(req.body.action) === 'reject' ? 'reject' : 'accept';

  return requireGroupAction(req, res, (error) => (
    groupSubpageRedirect(res, id, 'manage', groupRequestFailureStatus(error))
  ), async (token) => {
    await callGroup(token, 'POST', `/${id}/requests/${requesterId}`, { action });
    return res.redirect(groupSubpageRedirect(res, id, 'manage', action === 'reject' ? 'request-rejected' : 'request-approved'));
  });
}));

module.exports = router;
