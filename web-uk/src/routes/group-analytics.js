// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Group admin tools: analytics with CSV export, and the private group data
 * export.
 *
 * - Analytics follows React pages/groups/api/analytics.ts and
 *   tabs/GroupAnalyticsTab.tsx. Section rule `analytics`: the community's
 *   `tab_analytics` switch and a group admin. Figures are shown as GOV.UK summary
 *   lists and tables instead of charts.
 * - The data export follows pages/groups/api/dataExport.ts and
 *   components/GroupDataExportPanel.tsx, which the website shows on its admin-only
 *   Automation tab (no tab switch). There is no "list my exports" endpoint, so the
 *   status page is addressed by the export's id, as the website keeps it in state.
 *
 * Every download is streamed through this server with the member's token on the
 * server-to-API request, so the token never appears in a browser URL and the
 * API's signed `download_url` is never shown.
 */

const express = require('express');
const { callGroupApi, downloadGroupFile, ApiError } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { requireGroupTool } = require('../lib/group-tool-access');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const {
  NS, text, positiveInteger, objectFrom, isAuthError,
  redirectWithStatus, loginRedirect, translator, statusBanner, dateTimeLabel, sendDownload
} = require('../lib/group-tool-helpers');

const router = express.Router();

const DAYS = [7, 30, 90];
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const EXPORT_STATUSES = ['queued', 'processing', 'completed', 'failed', 'expired'];
const ANALYTICS_STATUS = {
  'export-failed': { type: 'error', key: 'analytics.export_failed' }
};
const DATA_EXPORT_STATUS = {
  requested: { type: 'success', key: 'data_export.requested' },
  'request-failed': { type: 'error', key: 'data_export.request_failed' },
  'download-failed': { type: 'error', key: 'data_export.download_failed' }
};
const AUTH = { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Page not found' };

function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

/** Same reading of the dashboard payload as React's normalizeDashboard(). */
function normalizeDashboard(payload) {
  const data = record(payload);
  const engagement = data.engagement;
  const overview = record(data.overview);
  const kpi = record(data.kpi);
  const engagementSummary = record(record(engagement).summary);
  const activity = data.activity_breakdown ?? data.activity;
  const comparative = record(data.comparative);
  const timeline = Array.isArray(record(engagement).timeline) ? engagement.timeline : list(engagement);

  return {
    kpi: {
      totalMembers: num(kpi.total_members ?? overview.total_members),
      activeMembers: num(kpi.active_members ?? engagementSummary.active_members),
      participationRate: num(kpi.participation_rate ?? engagementSummary.participation_rate),
      avgPostsPerDay: num(kpi.avg_posts_per_day ?? engagementSummary.avg_posts_per_day)
    },
    growth: list(data.member_growth ?? data.growth).map((point) => {
      const row = record(point);
      return { date: text(row.date), totalMembers: num(row.total_members ?? row.members), newMembers: num(row.new_members) };
    }),
    engagement: timeline.map((point) => {
      const row = record(point);
      return { date: text(row.date), posts: num(row.posts), discussions: num(row.discussions), activeMembers: num(row.active_members) };
    }),
    contributors: list(data.top_contributors).map((item) => {
      const row = record(item);
      return { userId: positiveInteger(row.user_id), name: text(row.name), postCount: num(row.post_count) };
    }).filter((row) => row.name),
    activity: Array.isArray(activity)
      ? activity.map((item) => ({ type: text(record(item).type), count: num(record(item).count) }))
      : Object.entries(record(activity)).filter(([type]) => type !== 'total').map(([type, count]) => ({ type, count: num(count) })),
    retention: list(data.retention).map((item) => {
      const row = record(item);
      return {
        month: text(row.month),
        joined: num(row.joined),
        stillActive: num(row.still_active),
        retentionLabel: percentLabel(row.retention_pct ?? row.retention_rate)
      };
    }),
    comparative: {
      yourMembers: num(comparative.your_members ?? comparative.group_members),
      avgMembers: num(comparative.avg_members),
      yourActivity: num(comparative.your_activity),
      avgActivity: num(comparative.avg_activity),
      percentileRank: num(comparative.percentile_rank ?? comparative.percentile)
    }
  };
}

router.get('/:id(\\d+)/analytics', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'analytics');
  if (!access) return undefined;
  const { group } = access;
  const requested = Number(text(req.query.days));
  const days = DAYS.includes(requested) ? requested : 30;

  let loadFailed = false;
  const result = await callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/analytics?days=${days}`).catch((error) => {
    if (isAuthError(error) || (error instanceof ApiError && [403, 404].includes(error.status))) throw error;
    loadFailed = true;
    return { data: {} };
  });

  const t = translator(res);
  const dashboard = normalizeDashboard(objectFrom(result));
  dashboard.kpi.participationRateLabel = percentLabel(dashboard.kpi.participationRate);
  dashboard.kpi.avgPostsPerDayLabel = numberLabel(dashboard.kpi.avgPostsPerDay);
  return res.render('groups/analytics/index', {
    title: t(`${NS}.analytics.title`),
    activeNav: 'explore',
    group,
    days,
    dayOptions: DAYS.map((value) => ({ value: String(value), text: t(`${NS}.analytics.last_days`, { count: value }), selected: value === days })),
    dashboard,
    loadFailed,
    statusBanner: statusBanner(res, req.query.status, ANALYTICS_STATUS)
  });
}, AUTH));

router.get('/:id(\\d+)/analytics/export/:type(members|activity)', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'analytics');
  if (!access) return undefined;
  const { group } = access;
  const type = req.params.type;
  try {
    // One literal call per export so the API ledger matches each Laravel route.
    const download = type === 'members'
      ? await downloadGroupFile(req.token, `/${encodeURIComponent(group.id)}/analytics/export/members`)
      : await downloadGroupFile(req.token, `/${encodeURIComponent(group.id)}/analytics/export/activity`);
    return sendDownload(res, download, `group-${group.id}-${type}.csv`, 'text/csv');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, `/groups/${group.id}/analytics`, 'export-failed');
  }
}, AUTH));

function normalizeExport(payload) {
  const row = record(payload);
  const id = text(row.id);
  if (!new RegExp(`^${UUID}$`).test(id) || !EXPORT_STATUSES.includes(row.status)) return null;
  return {
    id,
    status: row.status,
    byteSize: typeof row.byte_size === 'number' ? row.byte_size : null,
    createdAtLabel: dateTimeLabel(row.created_at),
    completedAtLabel: dateTimeLabel(row.completed_at),
    expiresAtLabel: dateTimeLabel(row.expires_at)
  };
}

// Intl's unit style owns the unit symbol, its placement and the decimal separator.
function sizeLabel(bytes) {
  if (bytes === null) return '';
  const format = (amount, unit) => new Intl.NumberFormat(getRequestIntlLocale(), {
    style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1
  }).format(amount);
  if (bytes >= 1048576) return format(bytes / 1048576, 'megabyte');
  if (bytes >= 1024) return format(bytes / 1024, 'kilobyte');
  return format(bytes, 'byte');
}

function percentLabel(value) {
  return new Intl.NumberFormat(getRequestIntlLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(num(value) / 100);
}

function numberLabel(value) {
  return new Intl.NumberFormat(getRequestIntlLocale(), { maximumFractionDigits: 2 }).format(num(value));
}

router.get('/:id(\\d+)/data-export', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'automation');
  if (!access) return undefined;
  return res.render('groups/analytics/data-export', {
    title: translator(res)(`${NS}.data_export.title`),
    activeNav: 'explore',
    group: access.group,
    exportRecord: null,
    statusBanner: statusBanner(res, req.query.status, DATA_EXPORT_STATUS)
  });
}, AUTH));

router.post('/:id(\\d+)/data-export', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'automation');
  if (!access) return undefined;
  const { group } = access;
  try {
    const created = normalizeExport(objectFrom(await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/exports`, {})));
    if (!created) return redirectWithStatus(res, `/groups/${group.id}/data-export`, 'request-failed');
    return redirectWithStatus(res, `/groups/${group.id}/data-export/${created.id}`, 'requested');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, `/groups/${group.id}/data-export`, 'request-failed');
  }
}, AUTH));

router.get(`/:id(\\d+)/data-export/:exportId(${UUID})`, requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'automation');
  if (!access) return undefined;
  const { group } = access;
  const t = translator(res);
  let exportRecord = null;
  let refreshFailed = false;
  try {
    exportRecord = normalizeExport(objectFrom(await callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/exports/${encodeURIComponent(req.params.exportId)}`)));
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: t('govuk_alpha.error_pages.404_title') });
    }
    refreshFailed = true;
  }
  if (!exportRecord && !refreshFailed) refreshFailed = true;
  const k = `${NS}.data_export`;
  const exportRows = [];
  if (exportRecord) {
    exportRows.push({ key: { text: t(`${k}.status_label`) }, value: { text: t(`${k}.status_${exportRecord.status}`) } });
    if (exportRecord.createdAtLabel) exportRows.push({ key: { text: t(`${k}.requested_at`) }, value: { text: exportRecord.createdAtLabel } });
    if (exportRecord.byteSize !== null) exportRows.push({ key: { text: t(`${k}.size`) }, value: { text: sizeLabel(exportRecord.byteSize) } });
    if (exportRecord.status === 'completed' && exportRecord.expiresAtLabel) {
      exportRows.push({ key: { text: t(`${k}.available_until`) }, value: { text: exportRecord.expiresAtLabel } });
    }
  }
  return res.render('groups/analytics/data-export', {
    title: t(`${NS}.data_export.title`),
    activeNav: 'explore',
    group,
    exportId: req.params.exportId,
    exportRecord,
    exportRows,
    refreshFailed,
    statusBanner: statusBanner(res, req.query.status, DATA_EXPORT_STATUS)
  });
}, AUTH));

router.get(`/:id(\\d+)/data-export/:exportId(${UUID})/download`, requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'automation');
  if (!access) return undefined;
  const { group } = access;
  const exportId = req.params.exportId;
  try {
    const download = await downloadGroupFile(req.token, `/${encodeURIComponent(group.id)}/exports/${encodeURIComponent(exportId)}/download`);
    return sendDownload(res, download, `group-${group.id}-export.json`, 'application/json');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, `/groups/${group.id}/data-export/${exportId}`, 'download-failed');
  }
}, AUTH));

module.exports = router;
