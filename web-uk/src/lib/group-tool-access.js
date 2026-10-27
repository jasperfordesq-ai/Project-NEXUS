// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Who may open a group's collaboration tools (Q&A, wiki, tasks, analytics, data
 * export), and whether the community has switched each one on.
 *
 * The rules are the website's, copied rather than reinvented
 * (react-frontend/src/pages/groups/groupSections.ts and GroupDetailPage.tsx):
 *
 * - a section with a `tab_<key>` setting is shown unless the community's
 *   `group_tabs.tab_<key>` is false (an absent setting counts as on, exactly as
 *   `hasGroupTab(tab) => groupTabs[tab] ?? true`). The settings arrive with the
 *   tenant bootstrap as `group_tabs`;
 * - Q&A, wiki and tasks need an active member (or a group admin);
 * - analytics and the automation tools (data export) need a group admin;
 * - "member" is `viewer_membership.status === 'active'` (else `is_member`), and
 *   "admin" is `viewer_membership.is_admin` (else `is_admin`). `is_admin` is the
 *   server's own answer and already includes tenant admins.
 *
 * A section the community switched off answers 404, as if it did not exist; a
 * person without the right standing gets 403. The API applies the same gates
 * (`group.tab:<key>` middleware), so this is the page agreeing with the server,
 * not the only lock.
 */

const { getGroup } = require('./api');
const { getRequestProfile } = require('./request-profile');
const { resolveBackendMediaUrl } = require('./accessible-shell');

const SECTION_RULES = {
  qa: { configKey: 'tab_qa', requiresMembership: true },
  wiki: { configKey: 'tab_wiki', requiresMembership: true },
  tasks: { configKey: 'tab_tasks', requiresMembership: true },
  analytics: { configKey: 'tab_analytics', requiresAdmin: true },
  automation: { requiresAdmin: true }
};

function isOff(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

function groupTabs(tenant) {
  const tabs = tenant && typeof tenant === 'object' ? tenant.group_tabs : null;
  return tabs && typeof tabs === 'object' && !Array.isArray(tabs) ? tabs : {};
}

function sectionSwitchedOn(tenant, section) {
  const rule = SECTION_RULES[section];
  if (!rule) return false;
  if (!rule.configKey) return true;
  return !isOff(groupTabs(tenant)[rule.configKey]);
}

function text(value) {
  return String(value ?? '').trim();
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function legacyMembership(raw) {
  return raw.my_membership || raw.myMembership || raw.membership || null;
}

function isMember(raw) {
  if (raw.viewer_membership && typeof raw.viewer_membership === 'object') {
    return text(raw.viewer_membership.status) === 'active';
  }
  const legacy = legacyMembership(raw);
  if (legacy && typeof legacy === 'object') {
    const status = text(legacy.status || legacy.state);
    if (status !== '') return status === 'active';
    return ['member', 'admin', 'owner'].includes(text(legacy.role));
  }
  if (raw.my_status !== undefined && raw.my_status !== null) return text(raw.my_status) === 'active';
  return truthy(raw.is_member);
}

function isAdmin(raw) {
  if (raw.viewer_membership && typeof raw.viewer_membership === 'object') {
    return truthy(raw.viewer_membership.is_admin);
  }
  if (raw.is_admin !== undefined) return truthy(raw.is_admin);
  const legacy = legacyMembership(raw);
  const role = text(legacy?.role || raw.my_role);
  const status = text(legacy?.status || legacy?.state || raw.my_status);
  return ['admin', 'owner'].includes(role) && (status === '' || status === 'active');
}

function normalizeToolGroup(raw, fallbackId) {
  const group = raw && typeof raw === 'object' ? raw : {};
  const id = Number.parseInt(group.id, 10);
  return {
    id: Number.isInteger(id) && id > 0 ? id : fallbackId,
    name: text(group.name || group.title) || 'Group',
    imageUrl: resolveBackendMediaUrl(group.image_url || group.avatar_url),
    ownerId: Number.parseInt(group.owner_id, 10) || null
  };
}

/**
 * Load the group and decide whether this person may open `section`.
 *
 * @returns {Promise<{ allowed: true, group, isMember, isAdmin, profile } |
 *                   { allowed: false, status: 403|404 }>}
 */
async function groupToolAccess(req, id, section) {
  if (!sectionSwitchedOn(req.accessibleRouting?.tenant, section)) {
    return { allowed: false, status: 404 };
  }

  const groupResult = await getGroup(req.token, id);
  const data = dataFrom(groupResult);
  const raw = (data && typeof data === 'object' && data.group && typeof data.group === 'object') ? data.group : (data || {});
  const member = isMember(raw);
  const admin = isAdmin(raw);
  const rule = SECTION_RULES[section];

  if (rule.requiresAdmin && !admin) return { allowed: false, status: 403 };
  if (rule.requiresMembership && !member && !admin) return { allowed: false, status: 403 };

  const profileResult = await getRequestProfile(req, req.token).catch(() => null);
  const profileData = dataFrom(profileResult) || {};
  const profile = profileData.user && typeof profileData.user === 'object' ? profileData.user : profileData;

  return {
    allowed: true,
    group: normalizeToolGroup(raw, Number(id)),
    isMember: member,
    isAdmin: admin,
    profile
  };
}

function renderRefusal(res, status) {
  const t = typeof res.locals?.t === 'function' ? res.locals.t : null;
  if (status === 404) {
    return res.status(404).render('errors/404', { title: t ? t('govuk_alpha.error_pages.404_title') : 'Page not found' });
  }
  return res.status(403).render('errors/403', { title: t ? t('govuk_alpha.error_pages.403_title') : 'Forbidden' });
}

/**
 * Route guard: resolves the access context, or answers the refusal itself and
 * returns null.
 */
async function requireGroupTool(req, res, section) {
  const access = await groupToolAccess(req, req.params.id, section);
  if (!access.allowed) {
    renderRefusal(res, access.status);
    return null;
  }
  return access;
}

module.exports = {
  SECTION_RULES,
  sectionSwitchedOn,
  groupToolAccess,
  requireGroupTool,
  renderRefusal,
  isMember,
  isAdmin
};
