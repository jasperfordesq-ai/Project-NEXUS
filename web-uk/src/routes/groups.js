// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { confirmFirst } = require('../lib/confirm-action');
const fs = require('fs/promises');
const { htmlToPlainText } = require('../lib/html-sanitizer');
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
  createFeedPostWithMedia,
  createFeedPoll,
  toggleFeedLike,
  toggleReaction,
  callUgcTranslateApi,
  hideFeedItem,
  muteFeedUser,
  reportFeedItem,
  deleteFeedPostV2,
  voteFeedPoll,
  getEvents,
  callMatchesApi,
  ApiError
} = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { readDate, splitDate, readDateTime, splitDateTime } = require('../lib/date-input');
const { POST_REACTION_TYPES } = require('../lib/feed-reactions');
const { audit } = require('../lib/auditLogger');
const { resolveBackendMediaUrl, flagEnabled } = require('../lib/accessible-shell');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { getRequestProfile } = require('../lib/request-profile');
const { resolveCanCreateEvents } = require('../lib/event-create-permission');
const { rememberClientRefusal, consumeApiRefusal } = require('../lib/api-refusal');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
const { sectionSwitchedOn: toolSectionOn } = require('../lib/group-tool-access');
const { sectionSwitchedOn: mediaSectionOn } = require('../lib/group-media-access');

const { translateFields, preferences, translationBinding, validSavedTranslation, translateCommentTree } = require('../lib/ugc-translation');
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
  'ann-forbidden', 'ann-not-found', 'ann-title-required', 'ann-content-required',
  'ann-expires-invalid'
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
  'file-pdf-active', 'file-pdf-unchecked',
  'file-delete-failed', 'file-forbidden', 'file-not-found'
]);
const GROUP_FILE_FIELD_ERROR_STATES = new Set([
  'file-upload-failed', 'file-too-large', 'file-type-invalid', 'file-missing',
  'file-pdf-active', 'file-pdf-unchecked'
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

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function routedTenant(req) {
  const tenant = req?.accessibleRouting?.tenant;
  return tenant && typeof tenant === 'object' ? tenant : {};
}

/**
 * The community's per-section group switches (tenant bootstrap `group_tabs`),
 * read exactly as React's `hasGroupTab` does: a switch that is not stated is ON
 * (TenantContext: `groupTabs[tab] ?? true`).
 */
function groupTabEnabled(req, key) {
  const tabs = routedTenant(req).group_tabs;
  if (!tabs || typeof tabs !== 'object' || !Object.prototype.hasOwnProperty.call(tabs, key)) return true;
  return tabs[key] !== false && tabs[key] !== 0 && tabs[key] !== '0';
}

function tenantFeatureEnabled(req, key) {
  return flagEnabled(routedTenant(req), key, 'features', true);
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

/**
 * The community's active group types, in the admin order, for the directory
 * filter (GET /api/v2/groups/types). A failure only hides the filter: the list
 * itself still loads, and a type label on a card comes from the group row.
 */
async function loadDirectoryGroupTypes(token) {
  try {
    const result = await callGroupApi(token, 'GET', '/types');
    return collectionFrom(result)
      .map((row) => ({ id: positiveInteger(row?.id), name: trimmed(row?.name) }))
      .filter((row) => row.id !== null && row.name !== '');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return [];
  }
}

function groupTypeLabel(raw) {
  const type = raw && typeof raw.type === 'object' && raw.type !== null ? raw.type : null;
  return type ? trimmed(type.name) : '';
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
    imageUrl: resolveBackendMediaUrl(raw.image_url || raw.imageUrl || raw.avatar_url || raw.avatarUrl),
    coverImageUrl: resolveBackendMediaUrl(raw.cover_image_url || raw.coverImageUrl || raw.cover_url || raw.coverUrl),
    createdAtLabel: dateLabel(raw.created_at || raw.createdAt),
    tagsText: groupTags(raw.tags).join(', '),
    typeLabel: groupTypeLabel(raw),
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
    expiresAtInput: dateInputValue(raw.expires_at || raw.expiresAt),
    // Three-field GOV.UK date pattern. `expiresAtInput` stays for any other reader.
    expiresAtParts: splitDate(dateInputValue(raw.expires_at || raw.expiresAt))
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
    expiresAtLabel: dateLabel(raw.expires_at || raw.expiresAt) || '-',
    // A link invite's address on this accessible site (the API's opens the website).
    accessiblePath: type === 'link' ? accessibleInvitePath(raw.invite_url || raw.inviteUrl) : ''
  };
}

// Intl's unit style owns the unit symbol, its placement and the decimal
// separator — the old template literal hardcoded English 'KB'/'MB' and a '.'
// decimal in every language.
function formatBytes(value) {
  const bytes = Number(value) || 0;
  const format = (amount, unit) => new Intl.NumberFormat(getRequestIntlLocale(), {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1
  }).format(amount);
  if (bytes >= 1048576) return format(Math.round((bytes / 1048576) * 10) / 10, 'megabyte');
  if (bytes >= 1024) return format(Math.round(bytes / 1024), 'kilobyte');
  return format(bytes, 'byte');
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
  const text = htmlToPlainText(value);

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

  const id = positiveInteger(raw.id);
  const type = trimmed(raw.type, 40).toLowerCase() || 'post';
  const authorId = positiveInteger(author.id || raw.author_id || raw.user_id);
  const reactions = raw.reactions && typeof raw.reactions === 'object' ? raw.reactions : {};
  const reactionCounts = reactions.counts && typeof reactions.counts === 'object' ? reactions.counts : {};
  const reactionTotal = Object.values(reactionCounts)
    .reduce((total, count) => total + (nonNegativeInteger(count) || 0), 0);
  const rawPoll = raw.poll_data && typeof raw.poll_data === 'object' ? raw.poll_data : null;
  const userVoteOptionId = rawPoll ? positiveInteger(rawPoll.user_vote_option_id) : null;
  const pollOptions = rawPoll && Array.isArray(rawPoll.options)
    ? rawPoll.options.map((option) => {
      const optionId = positiveInteger(option?.id);
      const percentage = Number(option?.percentage);
      return {
        id: optionId,
        label: trimmed(option?.text || option?.label, 500),
        voteCount: nonNegativeInteger(option?.vote_count) || 0,
        percentage: Number.isFinite(percentage) ? Math.max(0, Math.min(100, Math.round(percentage))) : null,
        isUserChoice: userVoteOptionId !== null && optionId === userVoteOptionId
      };
    }).filter((option) => option.id !== null)
    : [];

  return {
    id,
    type,
    title: trimmed(raw.title, 200),
    // Every group feed item links to its own page, where its comments are (React
    // FeedCard's permalink + comment drawer). Posts have a dedicated page.
    detailHref: id === null ? '' : (type === 'post' ? `/feed/posts/${id}` : `/feed/item/${encodeURIComponent(type)}/${id}`),
    authorId,
    likeCount: nonNegativeInteger(raw.likes_count ?? raw.like_count ?? raw.likeCount) || 0,
    commentCount: nonNegativeInteger(raw.comments_count ?? raw.comment_count ?? raw.commentCount) || 0,
    isLiked: checked(raw.is_liked ?? raw.isLiked),
    reactionCounts,
    reactionTotal,
    userReaction: trimmed(reactions.user_reaction || raw.user_reaction, 40),
    poll: rawPoll ? {
      options: pollOptions,
      isActive: checked(rawPoll.is_active),
      userVoteOptionId,
      canVote: pollOptions.length > 0 && checked(rawPoll.is_active) && userVoteOptionId === null
    } : null,
    mediaExtra: Math.max(0, mediaRows.length - 4),
    authorName: trimmed(author.name || raw.author_name || raw.authorName) || unknownAuthor,
    authorAvatar: resolveBackendMediaUrl(author.avatar_url || author.avatarUrl || raw.author_avatar_url || raw.authorAvatarUrl),
    createdAt: createdDate && !Number.isNaN(createdDate.getTime()) ? createdDate.toISOString() : '',
    createdAtLabel: createdDate && !Number.isNaN(createdDate.getTime())
      ? bladeDateTime24Label(createdAt)
      : '',
    contentParagraphs: plainParagraphs(raw.content),
    media: mediaRows.slice(0, 4).map((media) => {
      const fullUrl = resolveBackendMediaUrl(media?.file_url || media?.fileUrl || media?.url);
      return {
        fullUrl,
        thumbnailUrl: resolveBackendMediaUrl(media?.thumbnail_url || media?.thumbnailUrl) || fullUrl,
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
  return res.status(403).render('errors/403', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.403_title') : 'Forbidden') });
}

function renderNotFound(res, title = 'Page not found') {
  return res.status(404).render('errors/404', { title });
}

function renderTooManyRequests(res) {
  return res.status(429).render('errors/429', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.429_title') : 'Too many requests') });
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
  // F-551: a PDF refused for scripts, or because it could not be checked.
  if (code === 'PDF_ACTIVE_CONTENT') return 'file-pdf-active';
  if (code === 'PDF_NOT_INSPECTABLE') return 'file-pdf-unchecked';

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
        : value === 'ann-expires-invalid'
          ? '#expires_at-day'
          : null;
    return {
      statusBanner: {
        type: 'error',
        title: t('govuk_alpha_groups.common.error_title'),
        // The expiry message reuses the shared, already-translated date wording.
        message: value === 'ann-expires-invalid'
          ? t('web_uk.date_input.date_invalid')
          : t(`govuk_alpha_groups.states.${value}`),
        href
      }
    };
  }

  return { statusBanner: null };
}

// Outcomes of translating a discussion or reply (POST …/translate below).
const DISCUSSION_TRANSLATE_MESSAGES = {
  'translate-done': { type: 'success', key: 'govuk_alpha_feed.translate.text_done' },
  'translate-failed': { type: 'error', key: 'govuk_alpha_feed.translate.text_failed' },
  'translate-unavailable': { type: 'error', key: 'govuk_alpha_feed.translate.unavailable' },
  'translate-same': { type: 'error', key: 'govuk_alpha_feed.translate.text_same' },
  'translate-empty': { type: 'error', key: 'govuk_alpha_feed.translate.text_empty' }
};

function discussionStatus(status, t = (key) => key, { createPage = false } = {}) {
  const value = trimmed(status);
  if (Object.prototype.hasOwnProperty.call(DISCUSSION_TRANSLATE_MESSAGES, value)) {
    const { type, key } = DISCUSSION_TRANSLATE_MESSAGES[value];
    return {
      statusBanner: {
        type,
        title: t(type === 'success' ? 'states.success_title' : 'states.error_title'),
        message: t(key)
      }
    };
  }
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

// Stash the just-submitted announcement so the error re-render can put the member's own
// words back, mirroring `storeTransferForm` in routes/wallet.js. Without this, the create
// form came back EMPTY and the edit form came back showing the SAVED text — so a member
// who typed a long announcement and tripped any validation or API failure lost all of it.
// Only echoed input is stored; it is consumed (and deleted) once by the matching GET.
function rememberAnnouncementForm(req, key, body) {
  if (!req.session) return;
  const source = body && typeof body === 'object' ? body : {};
  req.session.groupAnnouncementForms ||= {};
  req.session.groupAnnouncementForms[key] = {
    title: trimmed(source.title, 255),
    content: trimmed(source.content, 20000),
    isPinned: checked(source.is_pinned),
    // The three GOV.UK date fields are echoed as typed, not reformatted: an unreal date
    // is exactly what the member has to see in order to correct it.
    expiresAtParts: {
      day: trimmed(source['expires_at-day'], 2),
      month: trimmed(source['expires_at-month'], 2),
      year: trimmed(source['expires_at-year'], 4)
    }
  };
}

function consumeAnnouncementForm(req, key) {
  const state = req.session?.groupAnnouncementForms?.[key];
  if (state && req.session?.groupAnnouncementForms) {
    delete req.session.groupAnnouncementForms[key];
  }
  return state && typeof state === 'object' ? state : null;
}

function announcementFormKey(id, annId = null) {
  return annId === null ? `create:${id}` : `edit:${id}:${annId}`;
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

  const expiresAt = readDate(body, 'expires_at');
  // A typed-but-unreal expiry is an error, not "no expiry" — dropping it would
  // silently create a never-expiring announcement.
  if (expiresAt.error) {
    return { error: 'ann-expires-invalid' };
  }

  return {
    title,
    content,
    is_pinned: checked(body.is_pinned),
    // 🔴 NOT `|| ''`. The previous `optionalText()` returned NULL for an absent expiry and
    // the API distinguishes the two — an empty string is a value, null clears the field.
    // `readDate().value` is already null when nothing was entered, so pass it through.
    // A date alone is read by Laravel as 00:00 (strtotime), so the announcement
    // vanished at the START of the chosen day. Send the end of that day.
    expires_at: expiresAt.value ? `${expiresAt.value} 23:59:59` : null
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
  // Group type filter (React c7344ef45): `?type=<id>` as on the website.
  const typeId = positiveInteger(req.query.type);
  if (typeId) filters.type_id = typeId;

  const [groupsResult, groupTypes, recommendedGroups] = await Promise.all([
    getGroups(req.token, filters),
    loadDirectoryGroupTypes(req.token),
    loadRecommendedGroups(req.token)
  ]);

  const groups = collectionFrom(groupsResult)
    .map((group) => normalizeGroup(group, positiveInteger(group?.id)));
  // Featured groups first, in their own section (React GroupsPage).
  const featuredGroups = groups.filter((group) => group.is_featured === true || group.is_featured === 1 || group.isFeatured === true);
  const regularGroups = groups.filter((group) => !featuredGroups.includes(group));
  const meta = groupsResult?.meta || {};
  const nextQuery = new URLSearchParams();
  if (searchQuery) nextQuery.set('q', searchQuery);
  if (groupsFilter !== 'all') nextQuery.set('filter', groupsFilter);
  if (typeId) nextQuery.set('type', String(typeId));
  const nextCursor = trimmed(meta.cursor || meta.next_cursor);
  if (nextCursor) nextQuery.set('cursor', nextCursor);

  res.render('groups/index', {
    title: res.locals.t('govuk_alpha.groups.title'),
    groups,
    featuredGroups,
    regularGroups,
    recommendedGroups,
    searchQuery,
    groupsFilter,
    groupTypes,
    selectedTypeId: typeId,
    pagination: {
      hasMore: Boolean(meta.has_more),
      cursor: nextCursor,
      nextHref: urlFor(res, `/groups?${nextQuery.toString()}`)
    },
    status: trimmed(req.query.status)
  });
}, { redirectOn401: loginRedirect() }));

/**
 * "Recommended for you" in the directory (React RecommendedGroups,
 * GET /api/v2/matches/all?modules=groups&limit=3&min_score=50). Optional: when the
 * read fails or returns nothing, the section is simply not shown.
 */
async function loadRecommendedGroups(token) {
  try {
    const data = dataFrom(await callMatchesApi(token, 'GET', '/all?modules=groups&limit=3&min_score=50')) || {};
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return matches
      .map((match) => ({
        id: positiveInteger(match?.group_id),
        title: trimmed(match?.title),
        score: Math.max(0, Math.min(100, Math.round(Number(match?.match_score) || 0))),
        reasons: Array.isArray(match?.match_reasons)
          ? match.match_reasons.map((reason) => trimmed(reason)).filter(Boolean).slice(0, 3)
          : [],
        imageUrl: resolveBackendMediaUrl(match?.image_url)
      }))
      .filter((match) => match.id !== null && match.title !== '')
      .slice(0, 3);
  } catch (error) {
    if (isAuthError(error)) throw error;
    return [];
  }
}

// ---- Group invitation links (React route groups/invite/:token) ------------
// Organisers mint and email these links from the invite page; this is where a
// member redeems one. A signed-out visitor is asked to sign in and is brought
// straight back here afterwards (lib/login-return.js).
const GROUP_INVITE_TOKEN = '[A-Za-z0-9]{40}';
const GROUP_INVITE_ERROR_KEYS = {
  EXPIRED: 'error_expired',
  REVOKED: 'error_revoked',
  EMAIL_MISMATCH: 'error_email_mismatch',
  CAPACITY_FULL: 'error_capacity',
  MEMBERSHIP_LIMIT_REACHED: 'error_limit',
  GROUP_UNAVAILABLE: 'error_group_unavailable',
  SAFEGUARDING_RESTRICTED: 'error_safeguarding',
  SAFEGUARDING_POLICY_UNAVAILABLE: 'error_safeguarding_unavailable'
};

function accessibleInvitePath(link) {
  const match = /\/groups\/invite\/([A-Za-z0-9]{40})(?:[?#]|$)/.exec(String(link || ''));
  return match ? `/groups/invite/${match[1]}` : '';
}

function groupInviteErrorCode(error) {
  const code = apiErrorCode(error);
  if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') return code;
  if (code.startsWith('SAFEGUARDING_') || code === 'VETTING_REQUIRED') return 'SAFEGUARDING_RESTRICTED';
  return Object.prototype.hasOwnProperty.call(GROUP_INVITE_ERROR_KEYS, code) ? code : 'INVALID';
}

function groupInviteErrorKey(code) {
  return `govuk_alpha_groups.invite_accept.${GROUP_INVITE_ERROR_KEYS[code] || 'error_invalid'}`;
}

// The page is reachable signed out; only a visitor carrying a sign-in is put
// through requireAuth (which also refreshes an expired access token).
function authIfSignedIn(req, res, next) {
  if (req.signedCookies?.token || req.signedCookies?.refresh_token) return requireAuth(req, res, next);
  return next();
}

router.get(`/invite/:token(${GROUP_INVITE_TOKEN})`, authIfSignedIn, asyncRoute(async (req, res) => {
  const inviteToken = req.params.token;
  const invitePath = `/groups/invite/${inviteToken}`;
  const token = req.token || '';
  const base = {
    title: res.locals.t('govuk_alpha_groups.invite_accept.title'),
    inviteToken,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  };

  if (!token) {
    return res.render('groups/invite-accept', {
      ...base,
      signedOut: true,
      signInHref: `/login?status=auth-required&return_to=${encodeURIComponent(invitePath)}`
    });
  }

  let preview;
  try {
    preview = dataFrom(await callGroup(token, 'GET', `/invite/${encodeURIComponent(inviteToken)}`)) || {};
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (!(error instanceof ApiError)) throw error;
    return res.status(error.status === 404 ? 404 : 200).render('groups/invite-accept', {
      ...base,
      errorKey: groupInviteErrorKey(groupInviteErrorCode(error))
    });
  }

  const group = preview.group && typeof preview.group === 'object' ? preview.group : {};
  const membershipStatus = trimmed(preview.membership?.status) || 'none';
  const queryError = trimmed(req.query.error).toUpperCase();
  return res.render('groups/invite-accept', {
    ...base,
    group: {
      id: positiveInteger(group.id),
      name: trimmed(group.name),
      memberCount: Number(group.member_count) || 0,
      isPrivate: trimmed(group.visibility || 'public') !== 'public'
    },
    alreadyMember: membershipStatus === 'active',
    justAccepted: trimmed(req.query.status) === 'accepted',
    errorKey: queryError ? groupInviteErrorKey(queryError) : ''
  });
}, { redirectOn401: loginRedirect() }));

router.post(`/invite/:token(${GROUP_INVITE_TOKEN})/accept`, requireAuth, asyncRoute(async (req, res) => {
  const inviteToken = req.params.token;
  const invitePath = `/groups/invite/${inviteToken}`;
  try {
    await callGroup(req.token, 'POST', `/invite/${encodeURIComponent(inviteToken)}/accept`, {});
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (!(error instanceof ApiError)) throw error;
    return redirectTo(res, `${invitePath}?error=${encodeURIComponent(groupInviteErrorCode(error))}`);
  }
  return redirectTo(res, `${invitePath}?status=accepted`);
}, { redirectOn401: loginRedirect() }));

// Create group form
/**
 * What the create/edit form may offer (GET /api/v2/groups/form-capabilities —
 * React getGroupFormCapabilities): allowed visibilities, templates, group types,
 * the groups this member may nest a new group under, and which optional fields
 * apply. A failure only removes the optional fields; the core form still works.
 */
async function loadGroupFormCapabilities(token) {
  try {
    const raw = objectFrom(await callGroupApi(token, 'GET', '/form-capabilities'));
    const fields = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};
    const rows = (list) => (Array.isArray(list) ? list : [])
      .map((row) => ({ id: positiveInteger(row?.id), name: trimmed(row?.name), description: trimmed(row?.description) }))
      .filter((row) => row.id !== null && row.name !== '');
    const visibilities = (Array.isArray(raw.allowed_visibility) ? raw.allowed_visibility : [])
      .filter((value) => ['public', 'private', 'secret'].includes(value));
    const groupTypes = rows(raw.group_types);
    const parentCandidates = rows(raw.parent_candidates);
    return {
      allowedVisibility: visibilities.length > 0 ? visibilities : ['public', 'private'],
      templates: rows(raw.templates),
      groupTypes,
      parentCandidates,
      showType: fields.type === true && groupTypes.length > 0,
      showParent: fields.parent === true && parentCandidates.length > 0,
      showBranding: fields.branding === true
    };
  } catch (error) {
    if (isAuthError(error)) throw error;
    return {
      allowedVisibility: ['public', 'private'],
      templates: [],
      groupTypes: [],
      parentCandidates: [],
      showType: false,
      showParent: false,
      showBranding: false
    };
  }
}

function groupVisibilityFrom(body, allowedVisibility = ['public', 'private', 'secret']) {
  if (allowedVisibility.includes(body.visibility)) return body.visibility;
  return body.is_private === 'true' && allowedVisibility.includes('private') ? 'private' : 'public';
}

async function uploadGroupImageFile(token, groupId, file, type) {
  if (!file) return;
  const buffer = await fs.readFile(file.filepath);
  await uploadGroupImage(token, groupId, {
    type,
    file: {
      buffer,
      filename: trimmed(file.originalFilename) || `group-${type}`,
      contentType: trimmed(file.mimetype) || 'application/octet-stream',
      size: file.size
    }
  });
}

async function renderNewGroupForm(req, res, extra = {}) {
  const capabilities = await loadGroupFormCapabilities(req.token);
  return res.render('groups/new', {
    title: res.locals.t('govuk_alpha.groups.create.title'),
    capabilities,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    ...extra
  });
}

router.get('/new', requireAuth, asyncRoute(async (req, res) => (
  renderNewGroupForm(req, res, { createFailed: trimmed(req.query.status) === 'group-create-failed' })
), { redirectOn401: loginRedirect() }));

// Create group
router.post('/new', requireAuth, audit.groupCreate(), asyncRoute(async (req, res) => {
  const cover = uploadedFile(req, 'cover');
  const avatar = uploadedFile(req, 'avatar');
  const { name, description, location } = req.body;
  const visibility = groupVisibilityFrom(req.body);
  const templateId = positiveInteger(req.body.template_id);
  const typeId = positiveInteger(req.body.type_id);
  const parentId = positiveInteger(req.body.parent_id);
  const values = { name, description, location, visibility, template_id: templateId, type_id: typeId, parent_id: parentId };

  const errors = [];

  if (!name || !name.trim()) {
    errors.push({ text: res.locals.t('groups.errors.name_required'), href: '#name' });
  } else if (name.length > 255) {
    errors.push({ text: res.locals.t('groups.errors.name_too_long'), href: '#name' });
  }

  if (errors.length > 0) {
    await removeUploadedFile(cover);
    await removeUploadedFile(avatar);
    return renderNewGroupForm(req, res, { errors, fieldErrors: groupFieldErrors(errors), values });
  }

  try {
    // There is no group "Tags" field any more: the API has no group tags
    // (GroupService::create drops `tags`) and React offers none. The old field
    // only appended a "Tags: …" line to the description.
    const payload = {
      name: name.trim(),
      description: trimmed(description) || null,
      location: location ? location.trim() : null,
      visibility
    };
    if (templateId !== null) payload.template_id = templateId;
    if (typeId !== null) payload.type_id = typeId;
    if (parentId !== null) payload.parent_id = parentId;
    const result = await createGroup(req.token, payload);

    const createdGroup = dataFrom(result)?.group || dataFrom(result);
    const groupId = positiveInteger(createdGroup && createdGroup.id);
    if (groupId === null) {
      throw new ApiError('Laravel did not return the created group', 502);
    }
    for (const [file, type] of [[avatar, 'avatar'], [cover, 'cover']]) {
      if (!file) continue;
      try {
        await uploadGroupImageFile(req.token, groupId, file, type);
      } catch {
        // Optional images are best-effort once the group exists; the group
        // photo page can retry them.
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
      return renderNewGroupForm(req, res, { errors: formErrors, fieldErrors: groupFieldErrors(formErrors), values });
    }
    throw error;
  } finally {
    await removeUploadedFile(cover);
    await removeUploadedFile(avatar);
  }
}));

router.post('/:id(\\d+)/translate', requireAuth, asyncRoute(async (req, res) => {
  const result = await getGroup(req.token, req.params.id);
  const group = normalizeGroup(dataFrom(result)?.group || dataFrom(result), Number(req.params.id));
  const translated = await translateFields(req, res, req.token, { type: 'group', id: group.id, fields: { name: group.name, body: group.description || '' } }, true);
  if (req.session && translated) req.session.ugcTranslation = translated;
  return res.redirect(res.locals.urlFor(`/groups/${group.id}?status=${translated ? 'translate-done' : 'translate-failed'}#content-translation`));
}));

// View group details
router.get('/:id(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const groupResult = await getGroup(req.token, id);
  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id));
  const isMember = isActiveGroupMember(group);
  // React shows the Feed section only while the community's `tab_feed` switch is on
  // (groupSections.ts); the feed itself is for members (GroupFeedTab).
  const showFeed = groupTabEnabled(req, 'tab_feed');
  const feedCursor = trimmed(req.query.feed_cursor, 500);
  const feedQuery = { group_id: id, per_page: 20 };
  if (feedCursor) feedQuery.cursor = feedCursor;

  const [membersResult, eventsResult, announcementsResult, feedResult, canCreateEvents, profileResult] = await Promise.all([
    getGroupMembers(req.token, id, { per_page: 100 }).catch((error) => {
      if (isAuthError(error)) throw error;
      if (error instanceof ApiError && error.status === 403) return { data: [] };
      throw error;
    }),
    getEvents(req.token, { group_id: id, when: 'upcoming', per_page: 5 }).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: [] };
    }),
    callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/announcements`).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: [] };
    }),
    isMember && showFeed
      ? getFeedPosts(req.token, feedQuery).catch((error) => {
        if (isAuthError(error)) throw error;
        return { data: [] };
      })
      : Promise.resolve({ data: [] }),
    // The community may restrict who creates Events (React 7565bee36).
    isMember ? resolveCanCreateEvents(req, req.token) : Promise.resolve(false),
    // Only to tell the member's own posts (delete) from others' (hide/mute/report).
    isMember && showFeed
      ? getRequestProfile(req, req.token).catch((error) => {
        if (isAuthError(error)) throw error;
        return {};
      })
      : Promise.resolve({})
  ]);
  const currentUserId = positiveInteger(objectFrom(profileResult)?.id);

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
      coverImage: resolveBackendMediaUrl(event?.cover_image || event?.cover_image_url || event?.coverImage || event?.coverImageUrl)
    }))
    .filter((event) => event.id !== null && event.title !== '');
  const groupFeed = collectionFrom(feedResult)
    .map((item) => normalizeGroupFeedPost(item, res.locals.t('govuk_alpha.feed.unknown_author')))
    // React excludeGamificationMilestones: badge/level cards are not feed content.
    .filter((post) => post.id !== null && !['badge_earned', 'level_up'].includes(post.type))
    .map((post) => ({ ...post, isOwn: currentUserId !== null && post.authorId === currentUserId }));
  const feedMeta = feedResult && typeof feedResult.meta === 'object' && feedResult.meta ? feedResult.meta : {};
  const nextFeedCursor = feedMeta.has_more === true ? trimmed(feedMeta.cursor || feedMeta.next_cursor, 500) : '';
  const feedNextHref = nextFeedCursor
    ? `/groups/${id}?feed_cursor=${encodeURIComponent(nextFeedCursor)}#group-feed`
    : '';
  const status = trimmed(req.query.status);
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
      imageUrl: resolveBackendMediaUrl(subGroup?.image_url || subGroup?.imageUrl),
      memberCount: Number(subGroup?.member_count ?? subGroup?.memberCount ?? 0) || 0,
      isPrivate: trimmed(subGroup?.visibility || 'public') !== 'public'
    }))
    .filter((subGroup) => subGroup.id !== null && subGroup.name !== '');
  const myMembership = group.myMembership || group.my_membership;
  const membershipStatus = trimmed(myMembership?.status || myMembership?.state);
  const isAdmin = isGroupAdmin(group);
  const isPending = membershipStatus === 'pending';
  const sectionLinks = groupSectionLinks(req.accessibleRouting?.tenant || res.locals.tenant || {}, group.id, { isMember, isAdmin });
  const contentTranslation = await translateFields(req, res, req.token, { type: 'group', id: group.id, fields: { name: group.name, body: group.description || '' } });
  res.render('groups/detail', {
    contentTranslation,
    translationAvailable: (req.accessibleRouting?.tenant || res.locals.tenant)?.translation?.enabled !== false,
    translationFailed: req.query.status === 'translate-failed',
    membershipRefusal: req.query.status === 'group-failed' ? consumeApiRefusal(req, `group-${Number(id)}-membership`) : '',
    title: group.name,
    group,
    sectionLinks,
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
    canCreateEvents,
    showFeed,
    feedCursor,
    feedNextHref,
    feedStatus: groupFeedStatusMessage(status, res.locals.t),
    // React ComposeHub: the Poll tab is gated on the `polls` feature.
    canCreatePolls: isMember && tenantFeatureEnabled(req, 'polls'),
    postReactionTypes: POST_REACTION_TYPES,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    status
  });
}, { notFoundTitle: 'Group not found' }));

// ---------------------------------------------------------------------------
// Group feed actions (React GroupFeedTab + FeedCard). Each is a plain form post
// that returns to the group feed, on the same page of it.
// ---------------------------------------------------------------------------

const GROUP_FEED_STATUS_KEYS = {
  'like-added': 'states.like-added',
  'like-removed': 'states.like-removed',
  'like-failed': 'states.like-failed',
  'reaction-added': 'feed_t1.status_reaction_added',
  'reaction-removed': 'feed_t1.status_reaction_removed',
  'reaction-failed': 'feed_t1.status_reaction_failed',
  'content-hidden': 'states.content-hidden',
  'author-muted': 'states.author-muted',
  'content-reported': 'states.content-reported',
  'moderation-failed': 'states.moderation-failed',
  'post-deleted': 'states.post-deleted',
  'post-delete-failed': 'states.post-delete-failed',
  'poll-voted': 'states.poll-voted',
  'poll-vote-failed': 'states.poll-vote-failed',
  'poll-created': 'govuk_alpha_groups.poll.states.created',
  'poll-question-required': 'govuk_alpha_groups.poll.states.question_required',
  'poll-options-required': 'govuk_alpha_groups.poll.states.options_required',
  'poll-expiry-invalid': 'govuk_alpha_groups.poll.states.expiry_invalid',
  'poll-create-failed': 'govuk_alpha_groups.poll.states.create_failed',
  'group-post-scheduled': 'govuk_alpha_groups.compose.states.scheduled',
  'group-post-image-invalid': 'govuk_alpha_groups.compose.states.image_invalid',
  'group-post-schedule-invalid': 'govuk_alpha_groups.compose.states.schedule_invalid'
};
const GROUP_FEED_ERROR_STATUSES = new Set([
  'like-failed', 'reaction-failed', 'moderation-failed', 'post-delete-failed', 'poll-vote-failed',
  'poll-question-required', 'poll-options-required', 'poll-expiry-invalid', 'poll-create-failed',
  'group-post-image-invalid', 'group-post-schedule-invalid'
]);
// Which field an error status points at, for the error summary link.
const GROUP_FEED_ERROR_TARGETS = {
  'poll-question-required': '#group-poll-question',
  'poll-options-required': '#group-poll-option-1',
  'poll-expiry-invalid': '#group-poll-expires-day',
  'group-post-image-invalid': '#group-feed-image',
  'group-post-schedule-invalid': '#group-feed-schedule-day'
};

function groupFeedStatusMessage(status, t) {
  const key = GROUP_FEED_STATUS_KEYS[status];
  if (!key || typeof t !== 'function') return null;
  return {
    type: GROUP_FEED_ERROR_STATUSES.has(status) ? 'error' : 'success',
    text: t(key),
    href: GROUP_FEED_ERROR_TARGETS[status] || ''
  };
}

function groupFeedRedirect(res, id, status, req = null, fragment = '#group-feed') {
  const cursor = trimmed(req?.body?.feed_cursor, 500);
  const cursorPart = cursor ? `&feed_cursor=${encodeURIComponent(cursor)}` : '';
  return `${urlFor(res, `/groups/${id}`)}?status=${encodeURIComponent(status)}${cursorPart}${fragment}`;
}

const FEED_TARGET_TYPE = '[a-z_]{1,40}';

async function groupFeedAction(req, res, id, failureStatus, action) {
  try {
    const status = await action(req.token);
    return res.redirect(groupFeedRedirect(res, id, status, req));
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, loginRedirect());
    const status = typeof failureStatus === 'function' ? failureStatus(error) : failureStatus;
    return res.redirect(groupFeedRedirect(res, id, status, req));
  }
}

router.post(`/:id(\\d+)/feed/items/:type(${FEED_TARGET_TYPE})/:itemId(\\d+)/like`, requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return groupFeedAction(req, res, id, 'like-failed', async (token) => {
    const result = await toggleFeedLike(token, { target_type: req.params.type, target_id: Number(req.params.itemId) });
    return dataFrom(result)?.action === 'unliked' ? 'like-removed' : 'like-added';
  });
}));

router.post(`/:id(\\d+)/feed/items/:type(${FEED_TARGET_TYPE})/:itemId(\\d+)/react`, requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const emoji = trimmed(req.body.emoji);
  if (!POST_REACTION_TYPES.includes(emoji)) {
    return res.redirect(groupFeedRedirect(res, id, 'reaction-failed', req));
  }
  return groupFeedAction(req, res, id, 'reaction-failed', async (token) => {
    const result = await toggleReaction(token, {
      target_type: req.params.type,
      target_id: Number(req.params.itemId),
      reaction_type: emoji
    });
    return dataFrom(result)?.action === 'removed' ? 'reaction-removed' : 'reaction-added';
  });
}));

router.post(`/:id(\\d+)/feed/items/:type(${FEED_TARGET_TYPE})/:itemId(\\d+)/hide`, requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return groupFeedAction(req, res, id, 'moderation-failed', async (token) => {
    await hideFeedItem(token, Number(req.params.itemId), { type: req.params.type });
    return 'content-hidden';
  });
}));

router.post(`/:id(\\d+)/feed/items/:type(${FEED_TARGET_TYPE})/:itemId(\\d+)/report`, requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const reason = trimmed(req.body.reason, 1000);
  if (reason === '') {
    return res.redirect(groupFeedRedirect(res, id, 'moderation-failed', req));
  }
  return groupFeedAction(req, res, id, (error) => (
    // Already reported by this member: the report stands, so say so.
    error instanceof ApiError && error.status === 409 ? 'content-reported' : 'moderation-failed'
  ), async (token) => {
    await reportFeedItem(token, req.params.type, Number(req.params.itemId), { reason });
    return 'content-reported';
  });
}));

router.post('/:id(\\d+)/feed/users/:userId(\\d+)/mute', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return groupFeedAction(req, res, id, 'moderation-failed', async (token) => {
    await muteFeedUser(token, Number(req.params.userId));
    return 'author-muted';
  });
}));

router.post('/:id(\\d+)/feed/polls/:pollId(\\d+)/vote', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const optionId = positiveInteger(req.body.option_id);
  if (optionId === null) {
    return res.redirect(groupFeedRedirect(res, id, 'poll-vote-failed', req));
  }
  return groupFeedAction(req, res, id, 'poll-vote-failed', async (token) => {
    await voteFeedPoll(token, Number(req.params.pollId), { option_id: optionId });
    return 'poll-voted';
  });
}));

// Deleting a post is irreversible, so it has its own confirmation page.
router.get('/:id(\\d+)/feed/posts/:postId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const groupResult = await getGroup(req.token, id);
  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), id);
  return res.render('groups/feed-delete', {
    title: res.locals.t('govuk_alpha_groups.feed.delete_title'),
    group,
    postId: Number(req.params.postId),
    feedCursor: trimmed(req.query.feed_cursor, 500),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Group not found' }));

router.post('/:id(\\d+)/feed/posts/:postId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return groupFeedAction(req, res, id, 'post-delete-failed', async (token) => {
    await deleteFeedPostV2(token, Number(req.params.postId));
    return 'post-deleted';
  });
}));

const GROUP_POLL_MAX_OPTIONS = 6;

// A poll inside the group (React PollTab with `group_id`; POST /v2/feed/polls).
router.post('/:id(\\d+)/feed/polls', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const pollRedirect = (status) => res.redirect(groupFeedRedirect(res, id, status, null, '#group-poll'));
  if (!tenantFeatureEnabled(req, 'polls')) {
    return renderNotFound(res);
  }
  const question = trimmed(req.body.question, 500);
  const options = [];
  for (let index = 1; index <= GROUP_POLL_MAX_OPTIONS; index += 1) {
    const option = trimmed(req.body[`option_${index}`], 200);
    if (option) options.push(option);
  }
  if (!question) return pollRedirect('poll-question-required');
  if (options.length < 2) return pollRedirect('poll-options-required');
  const expires = readDate(req.body, 'expires_at');
  if (expires.error) return pollRedirect('poll-expiry-invalid');
  if (expires.value && new Date(`${expires.value}T23:59:59Z`).getTime() <= Date.now()) {
    return pollRedirect('poll-expiry-invalid');
  }

  const payload = { question, options, group_id: id };
  // End of the chosen day: a bare date is 00:00 to PollService, so "today" was
  // refused as past and "tomorrow" closed the poll as tomorrow began.
  if (expires.value) payload.expires_at = `${expires.value} 23:59:59`;
  try {
    await createFeedPoll(req.token, payload);
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, loginRedirect());
    return pollRedirect('poll-create-failed');
  }
  return res.redirect(groupFeedRedirect(res, id, 'poll-created'));
}));

/**
 * The whole member list, searchable and paged (React GroupMembersTab: `q` and a
 * cursor). The group page shows the first 100 without a search.
 *
 * Deliberately NOT /groups/:id/members: that path was the retired Blade
 * member-management page and is pinned as "not found" (tests/routes.test.js).
 */
router.get('/:id(\\d+)/member-list', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const query = trimmed(req.query.q, 100);
  const cursor = trimmed(req.query.cursor, 200);
  const apiQuery = new URLSearchParams();
  apiQuery.set('per_page', '50');
  if (query) apiQuery.set('q', query);
  if (cursor) apiQuery.set('cursor', cursor);

  let groupResult;
  let membersResult;
  try {
    [groupResult, membersResult] = await Promise.all([
      getGroup(req.token, id),
      callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/members?${apiQuery.toString()}`)
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    throw error;
  }

  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id));
  const members = collectionFrom(membersResult)
    .map((member) => {
      const name = trimmed(member?.name)
        || trimmed(`${trimmed(member?.first_name || member?.firstName)} ${trimmed(member?.last_name || member?.lastName)}`);
      const role = trimmed(member?.role || member?.membership?.role).toLowerCase();
      return {
        id: positiveInteger(member?.user_id || member?.userId || member?.id),
        name,
        tagline: trimmed(member?.tagline),
        avatarUrl: resolveBackendMediaUrl(member?.avatar_url || member?.avatarUrl || member?.avatar),
        isAdmin: role === 'admin' || role === 'owner'
      };
    })
    .filter((member) => member.name !== '');
  const meta = membersResult?.meta || dataFrom(membersResult)?.meta || {};
  const nextCursor = trimmed(meta.cursor || meta.next_cursor || dataFrom(membersResult)?.cursor, 200);
  const hasMore = meta.has_more === true || dataFrom(membersResult)?.has_more === true;
  const pageHref = (pageCursor) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (pageCursor) params.set('cursor', pageCursor);
    const text = params.toString();
    return `/groups/${id}/member-list${text ? `?${text}` : ''}`;
  };

  return res.render('groups/members', {
    title: res.locals.t('govuk_alpha_groups.members_page.title', { group: group.name }),
    activeNav: 'explore',
    group,
    members,
    query,
    pagination: {
      nextHref: hasMore && nextCursor ? pageHref(nextCursor) : '',
      firstHref: cursor ? pageHref('') : ''
    }
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

/**
 * Every group event, past and upcoming, paged (React group events tab reads
 * GET /api/v2/events?group_id=&when=all). The group page shows the next five.
 */
const GROUP_EVENT_WHEN = ['all', 'upcoming', 'past'];

router.get('/:id(\\d+)/events', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const when = allowed(req.query.when, GROUP_EVENT_WHEN, 'all');
  const cursor = trimmed(req.query.cursor, 200);
  const params = { group_id: id, when, per_page: 20 };
  if (cursor) params.cursor = cursor;

  let groupResult;
  let eventsResult;
  try {
    [groupResult, eventsResult] = await Promise.all([
      getGroup(req.token, id),
      getEvents(req.token, params)
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    throw error;
  }

  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id));
  const events = collectionFrom(eventsResult)
    .map((event) => ({
      id: positiveInteger(event?.id),
      title: trimmed(event?.title),
      location: trimmed(event?.location),
      startsAt: event?.start_time || event?.start_date || event?.starts_at || event?.startsAt || '',
      coverImage: resolveBackendMediaUrl(event?.cover_image || event?.cover_image_url || event?.coverImage || event?.coverImageUrl)
    }))
    .filter((event) => event.id !== null && event.title !== '');
  const meta = eventsResult?.meta || {};
  const nextCursor = trimmed(meta.cursor || meta.next_cursor, 200);
  const pageHref = (pageCursor) => `/groups/${id}/events?when=${when}${pageCursor ? `&cursor=${encodeURIComponent(pageCursor)}` : ''}`;

  return res.render('groups/events', {
    title: res.locals.t('govuk_alpha_groups.events_page.title', { group: group.name }),
    activeNav: 'explore',
    group,
    events,
    when,
    pagination: {
      nextHref: meta.has_more === true && nextCursor ? pageHref(nextCursor) : '',
      firstHref: cursor ? pageHref('') : ''
    }
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

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
    capabilities: await loadGroupFormCapabilities(req.token),
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

  const invitesResult = await callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/invites`).catch((error) => {
    if (isAuthError(error)) throw error;
    return { data: { items: [] } };
  });
  const pendingInvites = collectionFrom(invitesResult)
    .map(normalizeInvite)
    .filter((invite) => invite.id !== null);

  return res.render('groups/invite', {
    title: (res.locals.t ? res.locals.t('govuk_alpha_groups.invite.title') : 'Invite members'),
    activeNav: 'explore',
    group,
    generatedLink: inviteGeneratedLink(invitesResult),
    // The API's link opens the main website; the same token redeems here too.
    accessibleInvitePath: accessibleInvitePath(inviteGeneratedLink(invitesResult)),
    pendingInvites,
    inviteResults: (() => {
      const stored = consumeFormReplay(req, 'groupInviteResults', id);
      const rows = stored && Array.isArray(stored.rows) ? stored.rows : [];
      const t = res.locals.t;
      return rows.map((row) => {
        let key = 'result_failed';
        if (row.status === 'sent') key = row.delivered === false ? 'result_delivery_failed' : 'result_sent';
        else if (row.status === 'already_member') key = 'result_already_member';
        else if (row.status === 'already_invited') key = 'result_already_invited';
        return { email: row.email, outcome: t(`govuk_alpha_groups.invite.${key}`) };
      });
    })(),
    ...inviteStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/notifications', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { group, profile } = await groupAccessContext(req, id);
  if (!isActiveGroupMember(group, profile)) {
    return renderForbidden(res);
  }

  const prefsResult = await callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/notification-prefs`).catch((error) => {
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
    title: (res.locals.t ? res.locals.t('govuk_alpha_groups.image.title') : 'Group images'),
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

  // Laravel pages announcements 20 at a time by cursor, takes `limit` (not
  // per_page), and hides expired ones unless include_expired is set
  // (GroupsController::announcements). Admins see expired ones so they can edit them.
  const isAdmin = isGroupAdmin(group, profile);
  const listParams = new URLSearchParams({ limit: '20' });
  const listCursor = trimmed(req.query.cursor, 500);
  if (listCursor) listParams.set('cursor', listCursor);
  if (isAdmin) listParams.set('include_expired', '1');
  const announcementsResult = await callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/announcements?${listParams.toString()}`).catch((error) => {
    if (isAuthError(error)) throw error;
    return { data: { items: [] } };
  });
  const announcements = collectionFrom(announcementsResult)
    .map(normalizeAnnouncement)
    .filter((announcement) => announcement.id !== null);
  const listData = dataFrom(announcementsResult) || {};
  const nextAnnouncementsCursor = listData.has_more === true ? trimmed(listData.cursor, 500) : '';

  return res.render('groups/announcements', {
    title: (res.locals.t ? res.locals.t('govuk_alpha_groups.announcements.title') : 'Announcements'),
    activeNav: 'explore',
    group,
    announcements,
    nextHref: nextAnnouncementsCursor
      ? `/groups/${encodeURIComponent(id)}/announcements?${new URLSearchParams({ cursor: nextAnnouncementsCursor }).toString()}`
      : '',
    isAdmin,
    announcementForm: consumeAnnouncementForm(req, announcementFormKey(id)),
    ...announcementStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/announcements/:annId(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const { id, annId } = req.params;
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupAdmin(group, profile) !== true) {
    return renderForbidden(res);
  }

  // There is no single-announcement read, so walk the pages (expired ones
  // included) until it turns up; it used to look only in the newest 20.
  let announcementData = null;
  let lookupCursor = '';
  for (let page = 0; page < 20 && !announcementData; page += 1) {
    const params = new URLSearchParams({ limit: '100', include_expired: '1' });
    if (lookupCursor) params.set('cursor', lookupCursor);
    const pageResult = await callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/announcements?${params.toString()}`);
    announcementData = collectionFrom(pageResult)
      .find((announcement) => String(positiveInteger(announcement?.id)) === String(annId)) || null;
    const pageData = dataFrom(pageResult) || {};
    lookupCursor = pageData.has_more === true ? trimmed(pageData.cursor, 500) : '';
    if (!lookupCursor) break;
  }
  if (!announcementData) {
    return res.status(404).render('errors/404', { title: 'Announcement not found' });
  }

  const announcement = normalizeAnnouncement(announcementData);

  return res.render('groups/announcement-edit', {
    title: res.locals.t('govuk_alpha_groups.announcements.edit_heading'),
    activeNav: 'explore',
    group,
    announcement,
    announcementForm: consumeAnnouncementForm(req, announcementFormKey(id, annId)),
    ...announcementStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Announcement not found' }));

router.get('/:id(\\d+)/discussions', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const groupResult = await getGroup(req.token, id);
  const group = normalizeGroup(dataFrom(groupResult)?.group || dataFrom(groupResult), Number(id));
  const isMember = isActiveGroupMember(group);
  // Laravel pages discussions 20 at a time by cursor (GroupsController::discussions).
  const listCursor = trimmed(req.query.cursor, 500);
  const listParams = new URLSearchParams({ per_page: '20' });
  if (listCursor) listParams.set('cursor', listCursor);
  const discussionsResult = isMember
    ? await callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/discussions?${listParams.toString()}`).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: { items: [] } };
    })
    : { data: { items: [] } };
  const discussions = collectionFrom(discussionsResult)
    .map(normalizeDiscussion)
    .filter((discussion) => discussion.id !== null);
  const listMeta = discussionsResult?.meta || {};
  const listNextCursor = listMeta.has_more === true ? trimmed(listMeta.cursor || listMeta.next_cursor, 500) : '';

  // 🔴 "Not a member" and "waiting for approval" are different things, and this
  // page used to show the pending-approval message to anyone who was not a
  // member. Somebody who had never asked to join was told their request was
  // waiting for an admin — which could stop them joining at all. `detail.njk`
  // already guards that message with exactly this state.
  const myMembership = group.myMembership || group.my_membership;
  const isPending = trimmed(myMembership?.status || myMembership?.state) === 'pending';

  return res.render('groups/discussions', {
    title: (res.locals.t ? res.locals.t('govuk_alpha.groups.discussions.title') : 'Discussions'),
    activeNav: 'explore',
    group,
    isMember,
    isPending,
    discussions,
    nextHref: listNextCursor ? `/groups/${encodeURIComponent(id)}/discussions?${new URLSearchParams({ cursor: listNextCursor }).toString()}` : '',
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
    // Replies come oldest first, 50 per page, with a forward cursor
    // (GroupsController::discussionMessages). Without the cursor a thread
    // stopped at its first 50 replies and newer ones never showed.
    callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/discussions/${encodeURIComponent(discussionId)}?${(() => {
      const params = new URLSearchParams({ per_page: '50' });
      const cursor = trimmed(req.query.cursor, 500);
      if (cursor) params.set('cursor', cursor);
      return params.toString();
    })()}`)
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

  // A translation made on the previous request (POST …/translate) is shown once,
  // under the discussion or the reply it belongs to, then forgotten.
  let translation = null;
  if (req.session && req.session.discussionTranslation) {
    const stored = req.session.discussionTranslation;
    delete req.session.discussionTranslation;
    const source = stored.messageId === null ? discussion : messages.find(message => Number(message.id) === Number(stored.messageId));
    if (source && Number(stored.discussionId) === Number(discussionId) && trimmed(stored.text) && await validSavedTranslation(req, res, req.token, stored, stored.messageId === null ? 'group_discussion' : 'group_discussion_reply', source.id, { body: htmlToPlainText(source.content || '').slice(0, 8000).trim() })) {
      translation = {
        messageId: positiveInteger(stored.messageId),
        text: trimmed(stored.text, 10000),
        locale: trimmed(stored.locale, 10) || 'en'
      };
    }
  }

  discussion.cachedTranslation = await translateFields(req, res, req.token, { type: 'group_discussion', id: discussion.id, fields: { body: htmlToPlainText(discussion.content || '').slice(0, 8000).trim() } });
  for (const message of messages) message.cachedTranslation = await translateFields(req, res, req.token, { type: 'group_discussion_reply', id: message.id, fields: { body: htmlToPlainText(message.content || '').slice(0, 8000).trim() } });
  return res.render('groups/discussion-detail', {
    title: discussion.title,
    activeNav: 'explore',
    group,
    discussion,
    messages,
    newerRepliesHref: data.has_more === true && trimmed(data.cursor, 500)
      ? `/groups/${encodeURIComponent(id)}/discussions/${encodeURIComponent(discussionId)}?${new URLSearchParams({ cursor: trimmed(data.cursor, 500) }).toString()}#discussion-replies`
      : '',
    replyValues: replay.values,
    fieldErrors: replay.errors,
    translation,
    currentCursor: trimmed(req.query.cursor, 500),
    ...discussionStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Discussion not found' }));

/**
 * Translate a group discussion, or one reply in it (React GroupDiscussionTab's
 * Translate, AWID feedback 30 Oct 2026). The text is read from the API — the
 * same page of the thread the member was on — never taken from the form.
 */
router.post('/:id(\\d+)/discussions/:discussionId(\\d+)/translate', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const discussionId = Number(req.params.discussionId);
  const messageId = positiveInteger(req.body.message_id);
  const cursor = trimmed(req.body.cursor, 500);
  const back = `/groups/${id}/discussions/${discussionId}${cursor ? `?${new URLSearchParams({ cursor }).toString()}` : ''}`;
  const redirectWith = (status, fragment = '') => {
    const separator = back.includes('?') ? '&' : '?';
    return res.redirect(`${urlFor(res, back)}${separator}status=${encodeURIComponent(status)}${fragment}`);
  };

  const targetLocale = (await preferences(req, res, req.token)).locale;

  let status = 'translate-done';
  try {
    const params = new URLSearchParams({ per_page: '50' });
    if (cursor) params.set('cursor', cursor);
    const data = dataFrom(await callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/discussions/${encodeURIComponent(discussionId)}?${params.toString()}`)) || {};
    const source = messageId === null
      ? (data.discussion || data.thread || data)
      : (Array.isArray(data.messages) ? data.messages : []).find((message) => Number(message?.id) === messageId);
    const sourceText = htmlToPlainText(source?.content || '').slice(0, 8000).trim();
    if (sourceText === '') {
      status = 'translate-empty';
    } else {
      const result = await callUgcTranslateApi(req.token, {
        content_type: messageId === null ? 'group_discussion' : 'group_discussion_reply',
        content_id: messageId === null ? discussionId : messageId,
        source_text: sourceText,
        target_locale: targetLocale
      });
      const translated = trimmed(dataFrom(result)?.translated_text, 10000);
      if (translated === '') {
        status = 'translate-unavailable';
      } else if (translated === sourceText) {
        status = 'translate-same';
      } else if (req.session) {
        req.session.discussionTranslation = { discussionId, messageId, text: translated, locale: targetLocale, binding: await translationBinding(req, res, req.token, messageId === null ? 'group_discussion' : 'group_discussion_reply', messageId === null ? discussionId : messageId, { body: sourceText }) };
      }
    }
  } catch (error) {
    if (isAuthError(error)) return res.redirect(urlFor(res, loginRedirect()));
    const code = String(error?.data?.code || error?.data?.errors?.[0]?.code || '').toUpperCase();
    status = ['TRANSLATION_UNAVAILABLE', 'TRANSLATION_DISABLED', 'AI_NOT_CONFIGURED', 'AI_UNAVAILABLE'].includes(code)
      || code.includes('FEATURE_DISABLED')
      ? 'translate-unavailable'
      : 'translate-failed';
  }

  const fragment = status === 'translate-done'
    ? (messageId === null ? '#discussion-translation' : `#reply-${messageId}`)
    : '';
  return redirectWith(status, fragment);
}));

router.get('/:id(\\d+)/files/:fileId(\\d+)/download', requireAuth, asyncRoute(async (req, res) => {
  const { id, fileId } = req.params;
  const { group, profile } = await groupAccessContext(req, id);
  if (isKnownGroupMember(group, profile) !== true) {
    return renderForbidden(res);
  }

  let download;

  try {
    download = await downloadGroupFile(req.token, `/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}/download`);
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

  // 🔴 Group files listed the first 50 and stopped, and could not be browsed by
  // folder (until 27 Oct 2026). Laravel pages them with a forward-only cursor and
  // filters by `folder`; React lists the folders from GET /files/folders.
  const cursor = trimmed(req.query.cursor, 200);
  const selectedFolder = trimmed(req.query.folder, 100);
  // Name search (GroupFilesController reads `q`), as React's files tab offers.
  const fileQuery = trimmed(req.query.q, 100);
  const filesQuery = new URLSearchParams();
  filesQuery.set('per_page', '50');
  if (cursor) filesQuery.set('cursor', cursor);
  if (selectedFolder) filesQuery.set('folder', selectedFolder);
  if (fileQuery) filesQuery.set('q', fileQuery);

  let filesResult;
  let foldersResult;
  try {
    [filesResult, foldersResult] = await Promise.all([
      callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/files?${filesQuery.toString()}`),
      callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/files/folders`).catch((error) => {
        if (isAuthError(error)) throw error;
        return { data: [] };
      })
    ]);
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

  const folders = collectionFrom(foldersResult)
    .map((row) => ({
      folder: trimmed(row?.folder, 100),
      fileCount: Number(row?.file_count) || 0
    }))
    .filter((row) => row.folder !== '');
  const filesData = dataFrom(filesResult) || {};
  const nextCursor = trimmed(filesData.cursor || filesResult?.meta?.cursor, 200);
  const hasMore = filesData.has_more === true || filesResult?.meta?.has_more === true;
  const pageHref = (pageCursor) => {
    const params = new URLSearchParams();
    if (selectedFolder) params.set('folder', selectedFolder);
    if (fileQuery) params.set('q', fileQuery);
    if (pageCursor) params.set('cursor', pageCursor);
    const query = params.toString();
    return `/groups/${id}/files${query ? `?${query}` : ''}`;
  };

  return res.render('groups/files', {
    title: res.locals.t('govuk_alpha_groups.files.title'),
    activeNav: 'explore',
    group,
    files,
    folders,
    selectedFolder,
    fileQuery,
    pagination: {
      nextHref: hasMore && nextCursor ? pageHref(nextCursor) : '',
      firstHref: cursor ? pageHref('') : ''
    },
    isAdmin,
    currentUserId,
    uploadForm: consumeFormReplay(req, 'groupFiles', id),
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

  // Laravel caps a page at 100 and pages by cursor with an optional name search
  // (GroupsController::members); React's members tab searches and loads more,
  // so admins of a larger group could not reach anyone past the first 100.
  const memberQuery = trimmed(req.query.q, 100);
  const memberCursor = trimmed(req.query.cursor, 200);
  const [membersResult, requestsResult] = await Promise.all([
    getGroupMembers(req.token, id, { per_page: 50, q: memberQuery || undefined, cursor: memberCursor || undefined }),
    callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/requests`).catch((error) => {
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

  const membersMeta = membersResult?.meta || dataFrom(membersResult)?.meta || {};
  const nextMembersCursor = trimmed(membersMeta.cursor || membersMeta.next_cursor || dataFrom(membersResult)?.cursor, 200);
  const moreMembers = membersMeta.has_more === true || dataFrom(membersResult)?.has_more === true;
  const membersNextHref = moreMembers && nextMembersCursor
    ? `/groups/${encodeURIComponent(id)}/manage?${new URLSearchParams({ ...(memberQuery ? { q: memberQuery } : {}), cursor: nextMembersCursor }).toString()}#group-members`
    : '';

  return res.render('groups/manage', {
    title: res.locals.t('groups.manage.title'),
    activeNav: 'explore',
    group,
    members,
    memberQuery,
    membersNextHref,
    pendingRequests,
    isPrivate,
    ...manageStatus(req.query.status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group not found' }));

// Update group
router.post('/:id(\\d+)/edit', requireAuth, audit.groupUpdate(), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const cover = uploadedFile(req, 'cover');
  const avatar = uploadedFile(req, 'avatar');
  const { name, description, location } = req.body;
  const visibility = groupVisibilityFrom(req.body);
  // Type, parent group and brand colours are only sent when the form actually
  // offered them (hidden `has_*` markers), so a blank choice clears the value
  // instead of an absent field wiping it.
  const hasType = checked(req.body.has_type);
  const hasParent = checked(req.body.has_parent);
  const hasBranding = checked(req.body.has_branding);
  const colour = (value) => trimmed(value, 20) || null;
  const formGroup = {
    id,
    name,
    description,
    location,
    visibility,
    type_id: positiveInteger(req.body.type_id),
    parent_id: positiveInteger(req.body.parent_id),
    primary_color: colour(req.body.primary_color),
    accent_color: colour(req.body.accent_color)
  };
  const renderEditForm = async (formErrors) => res.render('groups/edit', {
    title: (res.locals.t ? res.locals.t('govuk_alpha.polish_groups.edit_link') : 'Edit group'),
    group: formGroup,
    capabilities: await loadGroupFormCapabilities(req.token),
    errors: formErrors,
    fieldErrors: groupFieldErrors(formErrors),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });

  const errors = [];

  if (!name || !name.trim()) {
    errors.push({ text: res.locals.t('groups.errors.name_required'), href: '#name' });
  } else if (name.length > 255) {
    errors.push({ text: res.locals.t('groups.errors.name_too_long'), href: '#name' });
  }

  if (errors.length > 0) {
    await removeUploadedFile(cover);
    await removeUploadedFile(avatar);
    return renderEditForm(errors);
  }

  try {
    const payload = {
      name: name.trim(),
      description: description ? description.trim() : null,
      location: location ? location.trim() : null,
      visibility
    };
    if (hasType) payload.type_id = formGroup.type_id;
    if (hasParent) payload.parent_id = formGroup.parent_id === id ? null : formGroup.parent_id;
    if (hasBranding) {
      payload.primary_color = formGroup.primary_color;
      payload.accent_color = formGroup.accent_color;
    }
    await updateGroup(req.token, id, payload);

    for (const [file, type] of [[avatar, 'avatar'], [cover, 'cover']]) {
      if (!file) continue;
      try {
        await uploadGroupImageFile(req.token, id, file, type);
      } catch {
        // Match Blade's best-effort optional image update.
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
      return renderEditForm(groupFormErrors(error, 'Unable to update group'));
    }
    throw error;
  } finally {
    await removeUploadedFile(cover);
    await removeUploadedFile(avatar);
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
      errors: [{ text: res.locals.t('groups.delete.confirm_error'), href: '#confirm-delete' }],
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

  let joinResult;
  try {
    joinResult = await joinGroup(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      const status = groupMembershipFailureStatus(error);
      // Full, membership limit reached, banned... (GroupsController::join): Laravel's reason.
      if (status === 'group-failed') rememberClientRefusal(req, `group-${Number(id)}-membership`, error);
      return res.redirect(groupRedirect(res, id, status));
    }
    throw error;
  }

  // 🔴 Joining a group that needs approval does NOT make you a member, and the
  // API says so plainly: {"status":"pending","action":"requested"}. web-uk threw
  // that away and always announced "You have joined the group." — on a page that
  // then told the same member their request was waiting for an admin. Read the
  // answer instead of assuming it.
  const joined = dataFrom(joinResult) || {};
  const membershipState = trimmed(joined.status || joined.membership?.status || joined.membership?.state);
  const pending = membershipState === 'pending' || trimmed(joined.action) === 'requested';

  res.redirect(groupRedirect(res, id, pending ? 'group-requested' : 'group-joined'));
}));

// Cancel a pending join request. Laravel withdraws it through the same
// DELETE /v2/groups/{id}/membership that leaving uses (action "request_cancelled"),
// which is what React's "Cancel join request" calls. Until 27 Oct 2026 web-uk only
// said the request was pending and gave no way to take it back.
router.post('/:id(\\d+)/cancel-request', requireAuth, audit.groupLeave(), asyncRoute(async (req, res) => {
  if (confirmFirst(req, res, 'cancel_join_request', { cancelHref: `/groups/${req.params.id}`, button: 'govuk_alpha_groups.membership.cancel_request' })) return undefined;
  const { id } = req.params;

  try {
    await leaveGroup(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      // Sole admin, owner cannot leave... (GroupsController): Laravel's reason.
      rememberClientRefusal(req, `group-${Number(id)}-membership`, error);
      return res.redirect(groupRedirect(res, id, 'group-failed'));
    }
    throw error;
  }

  res.redirect(groupRedirect(res, id, 'group-request-cancelled'));
}));

// Leave group
router.post('/:id(\\d+)/leave', requireAuth, audit.groupLeave(), asyncRoute(async (req, res) => {
  const { id } = req.params;

  try {
    await leaveGroup(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      // Sole admin, owner cannot leave... (GroupsController): Laravel's reason.
      rememberClientRefusal(req, `group-${Number(id)}-membership`, error);
      return res.redirect(groupRedirect(res, id, 'group-failed'));
    }
    throw error;
  }

  res.redirect(groupRedirect(res, id, 'group-left'));
}));

router.post('/:id(\\d+)/invite/link', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const expiryDays = positiveInteger(req.body.expiry_days);
  // Blank means the link never expires. Anything typed must be a whole number of days
  // from 1 to 90; it is no longer silently turned into "never expires".
  if (trimmed(req.body.expiry_days) !== '' && (expiryDays === null || expiryDays > 90)) {
    return res.redirect(groupSubpageRedirect(res, id, 'invite', 'invite-link-failed'));
  }
  const payload = {
    expiry_days: expiryDays
  };

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'invite', 'invite-link-failed'), async (token) => {
    await callGroup(token, 'POST', `/${encodeURIComponent(id)}/invites/link`, payload);
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
    const result = await callGroup(token, 'POST', `/${encodeURIComponent(id)}/invites/email`, payload);
    // Laravel answers per address (GroupInviteService::sendEmailInvites):
    // sent, already a member, already invited, invalid, and whether the email
    // went out. React lists them; "sent" for everything hid the rest.
    const rows = (Array.isArray(dataFrom(result)) ? dataFrom(result) : collectionFrom(result))
      .slice(0, 50)
      .map((row) => ({
        email: trimmed(row?.email, 254),
        status: trimmed(row?.status, 40),
        delivered: row?.email_delivered === false ? false : (row?.email_delivered === true ? true : null)
      }))
      .filter((row) => row.email !== '');
    rememberFormReplay(req, 'groupInviteResults', id, { rows });
    return res.redirect(groupSubpageRedirect(res, id, 'invite', 'invite-emails-sent'));
  });
}));

router.post('/:id(\\d+)/invite/:inviteId(\\d+)/revoke', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const inviteId = Number(req.params.inviteId);

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'invite', 'invite-revoke-failed'), async (token) => {
    await callGroup(token, 'DELETE', `/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`);
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
    await callGroup(token, 'PUT', `/${encodeURIComponent(id)}/notification-prefs`, payload);
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
  // 🔴 A file input cannot be repopulated by HTML — a browser forbids setting its value —
  // so the member always has to pick the file again after a too-large / wrong-type
  // rejection. Losing the folder and the 500-character description as well is the
  // avoidable half, and that is what this preserves.
  const rememberUpload = () => rememberFormReplay(req, 'groupFiles', id, {
    folder: trimmed(req.body.folder, 100),
    description: trimmed(req.body.description, 500)
  });

  if (validationStatus) {
    rememberUpload();
    await removeUploadedFile(file);
    return res.redirect(groupSubpageRedirect(res, id, 'files', validationStatus));
  }

  return requireGroupAction(req, res, (error) => {
    rememberUpload();
    return groupSubpageRedirect(res, id, 'files', groupFileUploadErrorStatus(error));
  }, async (token) => {
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
    await callGroup(token, 'DELETE', `/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`);
    return res.redirect(groupSubpageRedirect(res, id, 'files', 'file-deleted'));
  });
}));

router.post('/:id(\\d+)/announcements', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const payload = announcementPayload(req.body);

  if (payload.error) {
    rememberAnnouncementForm(req, announcementFormKey(id), req.body);
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', payload.error));
  }

  return requireGroupAction(req, res, () => {
    rememberAnnouncementForm(req, announcementFormKey(id), req.body);
    return groupSubpageRedirect(res, id, 'announcements', 'ann-create-failed');
  }, async (token) => {
    await callGroup(token, 'POST', `/${encodeURIComponent(id)}/announcements`, payload);
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', 'ann-created'));
  });
}));

router.post('/:id(\\d+)/announcements/:annId(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const annId = Number(req.params.annId);
  const payload = announcementPayload(req.body);

  if (payload.error) {
    rememberAnnouncementForm(req, announcementFormKey(id, annId), req.body);
    return res.redirect(announcementEditRedirect(res, id, annId, payload.error));
  }

  return requireGroupAction(req, res, () => {
    rememberAnnouncementForm(req, announcementFormKey(id, annId), req.body);
    return announcementEditRedirect(res, id, annId, 'ann-update-failed');
  }, async (token) => {
    await callGroup(token, 'PUT', `/${encodeURIComponent(id)}/announcements/${encodeURIComponent(annId)}`, payload);
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', 'ann-updated'));
  });
}));

router.post('/:id(\\d+)/announcements/:annId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const annId = Number(req.params.annId);

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'announcements', 'ann-delete-failed'), async (token) => {
    await callGroup(token, 'DELETE', `/${encodeURIComponent(id)}/announcements/${encodeURIComponent(annId)}`);
    return res.redirect(groupSubpageRedirect(res, id, 'announcements', 'ann-deleted'));
  });
}));

router.post('/:id(\\d+)/announcements/:annId(\\d+)/pin', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const annId = Number(req.params.annId);
  const isPinned = checked(req.body.is_pinned);

  return requireGroupAction(req, res, groupSubpageRedirect(res, id, 'announcements', 'ann-pin-failed'), async (token) => {
    await callGroup(token, 'PUT', `/${encodeURIComponent(id)}/announcements/${encodeURIComponent(annId)}`, { is_pinned: isPinned });
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
    const result = await callGroup(token, 'POST', `/${encodeURIComponent(id)}/discussions`, payload);
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
    await callGroup(token, 'POST', `/${encodeURIComponent(id)}/discussions/${encodeURIComponent(discussionId)}/messages`, { content });
    return res.redirect(discussionRedirect(res, id, discussionId, 'reply-posted', '#discussion-replies'));
  });
}));

// React PostTab: up to 10 images per post (MediaUploader maxFiles, and the API's
// PostMediaService::MAX_MEDIA_PER_POST). Without JavaScript each photo is its own
// file field with its own alt text: `image` / `image_alt`, then `image_2` /
// `image_2_alt` … `image_10` / `image_10_alt`.
const GROUP_POST_MAX_IMAGES = 10;
const GROUP_POST_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function groupPostImageFields() {
  return Array.from({ length: GROUP_POST_MAX_IMAGES }, (_, index) => (
    index === 0 ? { file: 'image', alt: 'image_alt' } : { file: `image_${index + 1}`, alt: `image_${index + 1}_alt` }
  ));
}

router.post('/:id(\\d+)/feed', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const content = trimmed(req.body.content, 20000);
  const images = groupPostImageFields()
    .map((field) => ({ upload: uploadedFile(req, field.file), altText: trimmed(req.body[field.alt], 500) }))
    .filter((entry) => entry.upload);
  const cleanUp = () => Promise.all(images.map((entry) => removeUploadedFile(entry.upload)));

  if (content === '') {
    await cleanUp();
    return res.redirect(groupRedirect(res, id, 'group-post-empty', '#group-feed'));
  }
  if (images.some((entry) => !GROUP_POST_IMAGE_TYPES.has(trimmed(entry.upload.mimetype).toLowerCase()))) {
    await cleanUp();
    return res.redirect(groupRedirect(res, id, 'group-post-image-invalid', '#group-feed'));
  }
  // "Publish later" (React PostTab schedule): optional, but half-entered is an error.
  const schedule = readDateTime(req.body, 'schedule');
  if (schedule.error) {
    await cleanUp();
    return res.redirect(groupRedirect(res, id, 'group-post-schedule-invalid', '#group-feed'));
  }

  try {
    return await requireGroupAction(req, res, groupRedirect(res, id, 'group-post-failed', '#group-feed'), async (token) => {
      const files = await Promise.all(images.map(async (entry) => ({
        buffer: await fs.readFile(entry.upload.filepath),
        filename: entry.upload.originalFilename || entry.upload.filename || 'group-feed-image',
        contentType: entry.upload.mimetype || entry.upload.contentType || 'application/octet-stream',
        altText: entry.altText
      })));
      const payload = {
        content,
        visibility: 'public',
        group_id: id
      };
      if (schedule.value) {
        payload.publish_status = 'scheduled';
        payload.scheduled_at = schedule.value;
      }
      if (files.length > 1) {
        await createFeedPostWithMedia(token, { ...payload, files });
      } else {
        if (files.length === 1) {
          const [{ altText, ...file }] = files;
          payload.image = file;
          payload.image_alt = altText;
        }
        await createFeedPostV2(token, payload);
      }
      return res.redirect(groupRedirect(res, id, schedule.value ? 'group-post-scheduled' : 'group-posted', '#group-feed'));
    });
  } finally {
    await cleanUp();
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
      await callGroup(token, 'DELETE', `/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`);
      return res.redirect(groupSubpageRedirect(res, id, 'manage', 'member-removed'));
    }

    const role = action === 'promote' ? 'admin' : 'member';
    await callGroup(token, 'PUT', `/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, { role });
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
    await callGroup(token, 'POST', `/${encodeURIComponent(id)}/requests/${encodeURIComponent(requesterId)}`, { action });
    return res.redirect(groupSubpageRedirect(res, id, 'manage', action === 'reject' ? 'request-rejected' : 'request-approved'));
  });
}));

// ---------------------------------------------------------------------------
// Group automation for group admins (React GroupAutomationTab: requiresAdmin).
// The welcome message and scheduled posts live here; the API re-checks the
// admin right itself (GroupAccessService::canConfigure / canIntegrate).
// ---------------------------------------------------------------------------

async function requireGroupAdminContext(req, res, id) {
  const context = await groupAccessContext(req, id);
  if (!isGroupAdmin(context.group, context.profile)) {
    renderForbidden(res);
    return null;
  }
  return context;
}

function automationStatus(status, allowed, errors, t) {
  if (!allowed.includes(status)) return null;
  return {
    type: errors.includes(status) ? 'error' : 'success',
    text: t(`govuk_alpha_groups.automation_states.${status}`)
  };
}

router.get('/:id(\\d+)/welcome', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const context = await requireGroupAdminContext(req, res, id);
  if (!context) return undefined;
  let config;
  try {
    config = objectFrom(await callGroup(req.token, 'GET', `/${encodeURIComponent(id)}/welcome`));
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    throw error;
  }
  return res.render('groups/welcome', {
    title: res.locals.t('govuk_alpha_groups.welcome.title'),
    group: context.group,
    welcome: { enabled: checked(config.enabled), message: trimmed(config.message) },
    statusMessage: automationStatus(trimmed(req.query.status), ['welcome-saved', 'welcome-failed'], ['welcome-failed'], res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Group not found', redirectOn401: loginRedirect() }));

router.post('/:id(\\d+)/welcome', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const payload = { enabled: checked(req.body.enabled), message: trimmed(req.body.message, 5000) };
  try {
    await callGroup(req.token, 'PUT', `/${encodeURIComponent(id)}/welcome`, payload);
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, loginRedirect());
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    return res.redirect(groupSubpageRedirect(res, id, 'welcome', 'welcome-failed'));
  }
  return res.redirect(groupSubpageRedirect(res, id, 'welcome', 'welcome-saved'));
}));

const SCHEDULED_RECURRENCE_PATTERNS = ['daily', 'weekly', 'monthly'];

/**
 * The API schedules a discussion only while the community's discussion section is
 * on, and an announcement only while announcements are (GroupScheduledPostService),
 * so only those types are offered.
 */
function scheduledPostTypes(req) {
  return [
    groupTabEnabled(req, 'tab_discussion') ? 'discussion' : null,
    groupTabEnabled(req, 'tab_announcements') ? 'announcement' : null
  ].filter(Boolean);
}

function normalizeScheduledPost(row) {
  const raw = row && typeof row === 'object' ? row : {};
  const pattern = trimmed(raw.recurrence_pattern);
  return {
    id: positiveInteger(raw.id),
    postType: trimmed(raw.post_type) === 'announcement' ? 'announcement' : 'discussion',
    title: trimmed(raw.title),
    content: trimmed(raw.content),
    scheduledAt: isoDateTime(raw.scheduled_at),
    scheduledAtLabel: bladeDateTime24Label(raw.scheduled_at),
    isRecurring: checked(raw.is_recurring),
    recurrencePattern: SCHEDULED_RECURRENCE_PATTERNS.includes(pattern) ? pattern : ''
  };
}

async function loadScheduledPosts(token, id) {
  return collectionFrom(await callGroup(token, 'GET', `/${encodeURIComponent(id)}/scheduled-posts`))
    .map(normalizeScheduledPost)
    .filter((post) => post.id !== null);
}

async function renderScheduledPosts(req, res, id, context, extra = {}) {
  let posts;
  try {
    posts = await loadScheduledPosts(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    throw error;
  }
  const status = trimmed(req.query.status);
  return res.render('groups/scheduled-posts', {
    title: res.locals.t('govuk_alpha_groups.scheduled.title'),
    group: context.group,
    posts,
    postTypes: scheduledPostTypes(req),
    recurrencePatterns: SCHEDULED_RECURRENCE_PATTERNS,
    values: {},
    fieldErrors: {},
    statusMessage: automationStatus(
      status,
      ['scheduled-created', 'scheduled-cancelled', 'scheduled-cancel-failed'],
      ['scheduled-cancel-failed'],
      res.locals.t
    ),
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    ...extra
  });
}

router.get('/:id(\\d+)/scheduled-posts', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const context = await requireGroupAdminContext(req, res, id);
  if (!context) return undefined;
  return renderScheduledPosts(req, res, id, context);
}, { notFoundTitle: 'Group not found', redirectOn401: loginRedirect() }));

router.post('/:id(\\d+)/scheduled-posts', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const context = await requireGroupAdminContext(req, res, id);
  if (!context) return undefined;
  const t = res.locals.t;
  const postTypes = scheduledPostTypes(req);
  const postType = allowed(req.body.post_type, postTypes, '');
  const title = trimmed(req.body.title, 255);
  const content = trimmed(req.body.content, 60000);
  const when = readDateTime(req.body, 'scheduled_at', { required: true });
  const isRecurring = checked(req.body.is_recurring);
  const pattern = allowed(req.body.recurrence_pattern, SCHEDULED_RECURRENCE_PATTERNS, '');

  const errors = [];
  if (!postType) errors.push({ text: t('govuk_alpha_groups.scheduled.errors.type_required'), href: '#post_type' });
  if (!title) errors.push({ text: t('govuk_alpha_groups.scheduled.errors.title_required'), href: '#title' });
  if (!content) errors.push({ text: t('govuk_alpha_groups.scheduled.errors.content_required'), href: '#content' });
  if (when.error) {
    errors.push({ text: t(`web_uk.date_input.${when.error}`), href: when.errorFields[0] === 'time' ? '#scheduled_at-time' : '#scheduled_at-day' });
  } else if (when.value && new Date(`${when.value}:00Z`).getTime() <= Date.now()) {
    errors.push({ text: t('govuk_alpha_groups.scheduled.errors.when_past'), href: '#scheduled_at-day' });
  }
  if (isRecurring && !pattern) {
    errors.push({ text: t('govuk_alpha_groups.scheduled.errors.pattern_required'), href: '#recurrence_pattern' });
  }

  const values = {
    post_type: postType,
    title,
    content,
    scheduled_at_parts: when.parts || splitDateTime(''),
    is_recurring: isRecurring,
    recurrence_pattern: pattern
  };
  const fieldErrors = Object.fromEntries(errors.map((error) => [error.href.slice(1).replace(/-(day|time)$/, ''), error.text]));
  if (errors.length > 0) {
    return renderScheduledPosts(req, res, id, context, { errors, fieldErrors, values });
  }

  const payload = { post_type: postType, title, content, scheduled_at: when.value, is_recurring: isRecurring };
  if (isRecurring) payload.recurrence_pattern = pattern;
  try {
    await callGroup(req.token, 'POST', `/${encodeURIComponent(id)}/scheduled-posts`, payload);
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, loginRedirect());
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    const apiErrors = error instanceof ApiError && [400, 422].includes(error.status)
      ? groupFormErrors(error, t('govuk_alpha_groups.automation_states.scheduled-create-failed'))
      : [{ text: t('govuk_alpha_groups.automation_states.scheduled-create-failed') }];
    return renderScheduledPosts(req, res, id, context, { errors: apiErrors, fieldErrors: {}, values });
  }
  return res.redirect(groupSubpageRedirect(res, id, 'scheduled-posts', 'scheduled-created'));
}, { notFoundTitle: 'Group not found', redirectOn401: loginRedirect() }));

// Cancelling stops a planned post for good, so it is confirmed on its own page.
router.get('/:id(\\d+)/scheduled-posts/:postId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const postId = Number(req.params.postId);
  const context = await requireGroupAdminContext(req, res, id);
  if (!context) return undefined;
  let posts;
  try {
    posts = await loadScheduledPosts(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    throw error;
  }
  const post = posts.find((row) => row.id === postId);
  if (!post) return renderNotFound(res);
  return res.render('groups/scheduled-post-cancel', {
    title: res.locals.t('govuk_alpha_groups.scheduled.cancel_title'),
    group: context.group,
    post,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Group not found', redirectOn401: loginRedirect() }));

router.post('/:id(\\d+)/scheduled-posts/:postId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const postId = Number(req.params.postId);
  try {
    await callGroup(req.token, 'DELETE', `/${encodeURIComponent(id)}/scheduled-posts/${encodeURIComponent(postId)}`);
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, loginRedirect());
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    return res.redirect(groupSubpageRedirect(res, id, 'scheduled-posts', 'scheduled-cancel-failed'));
  }
  return res.redirect(groupSubpageRedirect(res, id, 'scheduled-posts', 'scheduled-cancelled'));
}));

// Links to the group sections that live in their own route files (Q&A, wiki,
// tasks, gallery, challenges, channels, analytics, data export, webhooks).
// Each link appears only when the community has that section switched on and
// the viewer has the standing its page requires, so a link never leads to a
// 403 or 404 (React groupSections.ts gates its tabs the same way).
function groupSectionLinks(tenant, groupId, { isMember, isAdmin }) {
  const id = String(groupId);
  const memberOrAdmin = isMember || isAdmin;
  const member = [
    { on: memberOrAdmin && toolSectionOn(tenant, 'qa'), path: `/groups/${id}/qa`, key: 'govuk_alpha_group_tools.qa.title' },
    { on: memberOrAdmin && toolSectionOn(tenant, 'wiki'), path: `/groups/${id}/wiki`, key: 'govuk_alpha_group_tools.wiki.title' },
    { on: memberOrAdmin && toolSectionOn(tenant, 'tasks'), path: `/groups/${id}/tasks`, key: 'govuk_alpha_group_tools.tasks.title' },
    { on: memberOrAdmin && mediaSectionOn(tenant, 'media'), path: `/groups/${id}/gallery`, key: 'govuk_alpha_group_media.gallery.title' },
    { on: memberOrAdmin && mediaSectionOn(tenant, 'challenges'), path: `/groups/${id}/challenges`, key: 'govuk_alpha_group_media.challenges.title' },
    { on: isMember && mediaSectionOn(tenant, 'chatrooms'), path: `/groups/${id}/channels`, key: 'govuk_alpha_group_media.channels.title' }
  ];
  const admin = [
    { on: isAdmin && toolSectionOn(tenant, 'analytics'), path: `/groups/${id}/analytics`, key: 'govuk_alpha_group_tools.analytics.title' },
    { on: isAdmin && toolSectionOn(tenant, 'automation'), path: `/groups/${id}/data-export`, key: 'govuk_alpha_group_tools.data_export.title' },
    { on: isAdmin && mediaSectionOn(tenant, 'automation'), path: `/groups/${id}/webhooks`, key: 'govuk_alpha_group_media.webhooks.title' }
  ];
  const pick = (rows) => rows.filter((row) => row.on).map(({ path, key }) => ({ path, key }));
  return { member: pick(member), admin: pick(admin) };
}

module.exports = router;
module.exports.groupSectionLinks = groupSectionLinks;
