// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { randomUUID } = require('node:crypto');
const { callEventTemplateApi, ApiError } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();
const tokenFrom = (req) => req.token || req.signedCookies?.token || '';
const trimmed = (value, limit = null) => { const text = String(value || '').trim(); return limit === null ? text : text.slice(0, limit); };
const positiveInteger = (value) => { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; };
const selectedFilter = (value) => ['active', 'archived', 'all'].includes(String(value || '')) ? String(value) : 'active';
const checked = (value) => value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
const dataFrom = (result) => result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
const collectionFrom = (result) => { const data = dataFrom(result); return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []); };
const redirectTo = (res, path) => res.redirect(res.locals.urlFor ? res.locals.urlFor(path) : path);
const TEMPLATE_FIELD_KEYS = new Set([
  'title', 'description', 'category_id', 'group_id', 'location',
  'venue_accessibility', 'latitude', 'longitude', 'max_attendees',
  'is_online', 'allow_remote_attendance', 'timezone', 'all_day',
  'federated_visibility'
]);

function normalizedAudit(audit, formatDate) {
  if (!audit || typeof audit !== 'object') return {};
  const evidence = audit.evidence && typeof audit.evidence === 'object' && !Array.isArray(audit.evidence)
    ? audit.evidence
    : {};
  const knownFields = (value) => Array.isArray(value)
    ? value.filter((field) => typeof field === 'string' && TEMPLATE_FIELD_KEYS.has(field))
    : [];
  const integrityHash = trimmed(evidence.snapshot_hash || evidence.effective_snapshot_hash);
  const recordedAt = new Date(audit.created_at);
  return {
    ...audit,
    recordedAtLabel: audit.created_at && !Number.isNaN(recordedAt.getTime())
      ? formatDate(recordedAt, {
        day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
      })
      : trimmed(audit.created_at),
    evidence: {
      ...evidence,
      integrity_chunks: integrityHash.match(/.{1,8}/g) || [],
      copied_fields: knownFields(evidence.copied_fields),
      override_fields: knownFields(evidence.override_fields)
    }
  };
}

function materializationInput(body) {
  const version = positiveInteger(body.template_version); const start = trimmed(body.start_time); const end = trimmed(body.end_time) || null; const title = trimmed(body.title, 255); const timezone = trimmed(body.timezone, 64); const location = trimmed(body.location, 255) || null; const rawCapacity = trimmed(body.max_attendees); const capacity = rawCapacity ? positiveInteger(rawCapacity) : null; const allDay = checked(body.all_day);
  if (!version || !start || !title || !timezone || (rawCapacity && !capacity) || (allDay && !end)) return null;
  return { template_version: version, start_time: start, end_time: end, overrides: { title, location, max_attendees: capacity, timezone, all_day: allDay } };
}

async function renderMaterialization(req, res, values = null, preview = null) {
  const templateId = Number(req.params.templateId); const template = dataFrom(await callEventTemplateApi(tokenFrom(req), 'GET', `/${templateId}`)) || {}; const configuration = template.version?.configuration || {};
  const defaults = values || { template_version: template.current_version, start_time: '', end_time: '', overrides: { title: configuration.title || '', location: configuration.location || '', max_attendees: configuration.max_attendees || '', timezone: configuration.timezone || 'UTC', all_day: configuration.all_day === true } };
  res.set('Cache-Control', 'private, no-store');
  return res.render('events/template-materialize', { title: res.locals.t('event_templates.materialize_title'), activeNav: 'events', template, values: defaults, preview, status: trimmed(req.query.status), idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : '' });
}

router.get('/:templateId(\\d+)/history', requireAuth, asyncRoute(async (req, res) => {
  const templateId = Number(req.params.templateId); const cursor = trimmed(req.query.cursor, 4096); const query = new URLSearchParams({ per_page: '20' }); if (cursor) query.set('cursor', cursor);
  const filter = selectedFilter(req.query.filter); const libraryCursor = trimmed(req.query.library_cursor, 4096);
  const [templateResult, historyResult] = await Promise.all([callEventTemplateApi(tokenFrom(req), 'GET', `/${templateId}`), callEventTemplateApi(tokenFrom(req), 'GET', `/${templateId}/history?${query}`)]);
  res.set('Cache-Control', 'private, no-store');
  const formatDate = typeof res.locals.formatLocaleDate === 'function'
    ? res.locals.formatLocaleDate
    : (value) => trimmed(value);
  const meta = historyResult?.meta || {};
  return res.render('events/template-history', { title: res.locals.t('event_templates.audit_title'), activeNav: 'events', template: dataFrom(templateResult) || {}, audits: collectionFrom(historyResult).map((audit) => normalizedAudit(audit, formatDate)), pagination: { ...meta, next_cursor: trimmed(meta.next_cursor, 4096) }, filter, libraryCursor });
}, { notFoundTitle: 'Template not found' }));

router.get('/:templateId(\\d+)/materialize', requireAuth, asyncRoute(async (req, res) => renderMaterialization(req, res), { notFoundTitle: 'Template not found' }));
router.post('/:templateId(\\d+)/materialize/preview', requireAuth, asyncRoute(async (req, res) => {
  const input = materializationInput(req.body); if (!input) return redirectTo(res, `/event-templates/${req.params.templateId}/materialize?status=invalid`);
  try { const preview = dataFrom(await callEventTemplateApi(tokenFrom(req), 'POST', `/${req.params.templateId}/materialization-preview`, input)) || {}; return renderMaterialization(req, res, input, preview); }
  catch (error) { if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required'); if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, `/event-templates/${req.params.templateId}/materialize?status=failed`); throw error; }
}));
router.post('/:templateId(\\d+)/materialize', requireAuth, asyncRoute(async (req, res) => {
  const input = materializationInput(req.body); const key = trimmed(req.body.idempotency_key, 191); if (!input || !key) return redirectTo(res, `/event-templates/${req.params.templateId}/materialize?status=invalid`);
  try { const result = dataFrom(await callEventTemplateApi(tokenFrom(req), 'POST', `/${req.params.templateId}/materializations`, input, { headers: { 'Idempotency-Key': key } })) || {}; const eventId = positiveInteger(result.event?.id || result.event_id || result.id); return redirectTo(res, eventId ? `/events/${eventId}/edit` : '/events/templates?status=materialized'); }
  catch (error) { if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required'); if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, `/event-templates/${req.params.templateId}/materialize?status=failed`); throw error; }
}));

module.exports = router;
