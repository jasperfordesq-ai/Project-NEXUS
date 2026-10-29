// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Group task list — statistics, status filter, add, change status, delete with a
 * confirmation page (React components/ideation/TeamTasks.tsx, shown by
 * tabs/GroupTasksTab.tsx). Section rule `tasks`: the community's `tab_tasks`
 * switch and an active member or group admin. Per-task actions follow the
 * server's own `can_update_status` / `can_delete` flags, exactly as the website
 * does; the API enforces them again.
 *
 * Endpoints: GET/POST /v2/groups/{id}/tasks, GET /v2/groups/{id}/task-stats,
 * GET/PUT/DELETE /v2/team-tasks/{id} (reached through callIdeationApi, whose
 * prefix is /api/v2 — the same controller serves ideation team tasks).
 */

const express = require('express');
const { callGroupApi, callIdeationApi, ApiError } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { readDate } = require('../lib/date-input');
const { requireGroupTool, renderRefusal } = require('../lib/group-tool-access');
const {
  NS, text, positiveInteger, collectionFrom, objectFrom, isAuthError,
  redirectWithStatus, loginRedirect, translator, statusBanner, dateLabel
} = require('../lib/group-tool-helpers');

const router = express.Router();

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUS_CODES = {
  created: { type: 'success', key: 'tasks.created' },
  updated: { type: 'success', key: 'tasks.updated' },
  deleted: { type: 'success', key: 'tasks.deleted' },
  'update-failed': { type: 'error', key: 'tasks.update_failed' },
  'delete-failed': { type: 'error', key: 'tasks.delete_failed' }
};
const AUTH = { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Page not found' };

function tasksPath(id) {
  return `/groups/${id}/tasks`;
}

function isOverdue(dueDate, status) {
  if (!dueDate || status === 'done') return false;
  const due = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? `${dueDate}T23:59:59Z` : dueDate);
  return !Number.isNaN(due.getTime()) && due < new Date();
}

function normalizeTask(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const status = STATUSES.includes(raw.status) ? raw.status : 'todo';
  const dueDate = text(raw.due_date);
  return {
    id: positiveInteger(raw.id),
    groupId: positiveInteger(raw.group_id),
    title: text(raw.title),
    description: text(raw.description),
    status,
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'medium',
    assigneeName: text(raw.assignee?.name),
    dueDateLabel: dateLabel(dueDate),
    overdue: isOverdue(dueDate, status),
    canUpdateStatus: raw.can_update_status === true,
    canDelete: raw.can_delete === true
  };
}

router.get('/:id(\\d+)/tasks', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'tasks');
  if (!access) return undefined;
  const { group } = access;
  const filter = STATUSES.includes(text(req.query.show)) ? text(req.query.show) : 'all';
  // Laravel pages tasks by cursor, 50 at a time (IdeationChallengesController
  // tasks list); without the cursor a group's list stopped at 50.
  const listParams = new URLSearchParams({ per_page: '50' });
  if (filter !== 'all') listParams.set('status', filter);
  const cursor = text(req.query.cursor).slice(0, 500);
  if (cursor) listParams.set('cursor', cursor);
  const query = `?${listParams.toString()}`;

  let loadFailed = false;
  const [tasksResult, statsResult] = await Promise.all([
    callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/tasks${query}`).catch((error) => {
      if (isAuthError(error) || (error instanceof ApiError && [403, 404].includes(error.status))) throw error;
      loadFailed = true;
      return { data: [] };
    }),
    callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/task-stats`).catch((error) => {
      if (isAuthError(error)) throw error;
      return null;
    })
  ]);
  const tasks = collectionFrom(tasksResult).map(normalizeTask).filter((task) => task.id !== null);
  const tasksMeta = (tasksResult && tasksResult.meta) || {};
  const nextTasksCursor = tasksMeta.has_more === true ? text(tasksMeta.cursor || tasksMeta.next_cursor).slice(0, 500) : '';
  const nextHref = nextTasksCursor
    ? `/groups/${encodeURIComponent(group.id)}/tasks?${new URLSearchParams({ ...(filter !== 'all' ? { show: filter } : {}), cursor: nextTasksCursor }).toString()}`
    : '';
  const statsData = statsResult ? objectFrom(statsResult) : null;
  const stats = statsData
    ? ['total', 'todo', 'in_progress', 'done', 'overdue'].reduce((acc, key) => ({ ...acc, [key]: Number(statsData[key]) || 0 }), {})
    : null;

  const t = translator(res);
  return res.render('groups/tasks/index', {
    title: t(`${NS}.tasks.title`),
    activeNav: 'explore',
    group,
    tasks,
    nextHref,
    stats,
    loadFailed,
    filter,
    filterOptions: ['all'].concat(STATUSES).map((value) => ({
      value,
      text: value === 'all' ? t(`${NS}.tasks.filter_all`) : t(`${NS}.tasks.status_${value}`),
      selected: value === filter
    })),
    statusOptions: STATUSES.map((value) => ({ value, text: t(`${NS}.tasks.status_${value}`) })),
    statusBanner: statusBanner(res, req.query.status, STATUS_CODES)
  });
}, AUTH));

// Every member can be assigned, not just the first page of 100 (Laravel's
// per-page cap). Bounded at 10 pages so a very large group cannot stall the form.
async function loadMembers(req, groupId) {
  const members = [];
  let cursor = '';
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ per_page: '100' });
    if (cursor) params.set('cursor', cursor);
    const result = await callGroupApi(req.token, 'GET', `/${encodeURIComponent(groupId)}/members?${params.toString()}`).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: [] };
    });
    members.push(...collectionFrom(result)
      .map((member) => ({ id: positiveInteger(member?.id || member?.user_id), name: text(member?.name || member?.display_name) }))
      .filter((member) => member.id !== null && member.name));
    const meta = (result && result.meta) || {};
    cursor = meta.has_more === true ? text(meta.cursor || meta.next_cursor) : '';
    if (!cursor) break;
  }
  return members;
}

function renderCreate(res, group, members, values = {}, errors = {}, statusCode = 200, failed = false) {
  const t = translator(res);
  return res.status(statusCode).render('groups/tasks/new', {
    title: t(`${NS}.tasks.create`),
    activeNav: 'explore',
    group,
    values,
    errors,
    errorList: Object.entries(errors).map(([field, message]) => ({
      text: message,
      href: field === 'due_date' ? '#due_date-day' : `#${field}`
    })),
    statusItems: STATUSES.map((value) => ({ value, text: t(`${NS}.tasks.status_${value}`), selected: (values.status || 'todo') === value })),
    priorityItems: PRIORITIES.map((value) => ({ value, text: t(`${NS}.tasks.priority_${value}`), selected: (values.priority || 'medium') === value })),
    assigneeItems: [{ value: '', text: t(`${NS}.tasks.unassigned`) }].concat(members.map((member) => ({
      value: String(member.id),
      text: member.name,
      selected: String(values.assigned_to || '') === String(member.id)
    }))),
    statusBanner: failed ? { type: 'error', message: t(`${NS}.tasks.create_failed`) } : null
  });
}

router.get('/:id(\\d+)/tasks/new', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'tasks');
  if (!access) return undefined;
  const members = await loadMembers(req, access.group.id);
  return renderCreate(res, access.group, members, { dueDateParts: { day: '', month: '', year: '' } });
}, AUTH));

router.post('/:id(\\d+)/tasks/new', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'tasks');
  if (!access) return undefined;
  const { group } = access;
  const t = translator(res);
  const due = readDate(req.body, 'due_date');
  const values = {
    title: text(req.body.title, 255),
    description: text(req.body.description, 5000),
    status: STATUSES.includes(text(req.body.status)) ? text(req.body.status) : 'todo',
    priority: PRIORITIES.includes(text(req.body.priority)) ? text(req.body.priority) : 'medium',
    assigned_to: positiveInteger(req.body.assigned_to),
    dueDateParts: due.parts,
    dueDateErrorFields: due.errorFields
  };
  const errors = {};
  if (!values.title) errors.title = t(`${NS}.tasks.title_required`);
  if (due.error) errors.due_date = t(`web_uk.date_input.${due.error}`);
  if (Object.keys(errors).length) {
    return renderCreate(res, group, await loadMembers(req, group.id), values, errors, 422);
  }

  try {
    await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/tasks`, {
      title: values.title,
      description: values.description || null,
      status: values.status,
      priority: values.priority,
      assigned_to: values.assigned_to,
      due_date: due.value || null
    });
    return redirectWithStatus(res, tasksPath(group.id), 'created');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return renderCreate(res, group, await loadMembers(req, group.id), values, {}, 200, true);
  }
}, AUTH));

/** Load a task and make sure it belongs to this group. */
async function loadGroupTask(req, groupId, taskId) {
  try {
    const task = normalizeTask(objectFrom(await callIdeationApi(req.token, 'GET', `/team-tasks/${encodeURIComponent(taskId)}`)));
    return task.id !== null && task.groupId === Number(groupId) ? task : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

router.post('/:id(\\d+)/tasks/:taskId(\\d+)/status', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'tasks');
  if (!access) return undefined;
  const { group } = access;
  const status = text(req.body.status);
  if (!STATUSES.includes(status)) return redirectWithStatus(res, tasksPath(group.id), 'update-failed');
  const task = await loadGroupTask(req, group.id, req.params.taskId);
  if (!task) return renderRefusal(res, 404);
  try {
    await callIdeationApi(req.token, 'PUT', `/team-tasks/${encodeURIComponent(task.id)}`, { status });
    return redirectWithStatus(res, tasksPath(group.id), 'updated');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, tasksPath(group.id), 'update-failed');
  }
}, AUTH));

router.get('/:id(\\d+)/tasks/:taskId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'tasks');
  if (!access) return undefined;
  const task = await loadGroupTask(req, access.group.id, req.params.taskId);
  if (!task) return renderRefusal(res, 404);
  if (!task.canDelete) return renderRefusal(res, 403);
  return res.render('groups/tasks/delete', {
    title: translator(res)(`${NS}.tasks.delete_title`),
    activeNav: 'explore',
    group: access.group,
    task
  });
}, AUTH));

router.post('/:id(\\d+)/tasks/:taskId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'tasks');
  if (!access) return undefined;
  const { group } = access;
  const task = await loadGroupTask(req, group.id, req.params.taskId);
  if (!task) return renderRefusal(res, 404);
  try {
    await callIdeationApi(req.token, 'DELETE', `/team-tasks/${encodeURIComponent(task.id)}`);
    return redirectWithStatus(res, tasksPath(group.id), 'deleted');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, tasksPath(group.id), 'delete-failed');
  }
}, AUTH));

module.exports = router;
