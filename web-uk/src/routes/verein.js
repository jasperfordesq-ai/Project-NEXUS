// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs/promises');
const express = require('express');
const {
  ApiError,
  getVereinDuesFeeConfig,
  setVereinDuesFeeConfig,
  listVereinDues,
  listVereinOverdueDues,
  generateVereinDues,
  remindVereinDues,
  waiveVereinDues,
  previewVereinMemberImport,
  importVereinMembers
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const {
  BILLING_CYCLES,
  CSV_MAX_BYTES,
  CURRENCIES,
  DUES_STATUSES,
  DUES_TAGS,
  IMPORT_SESSION_KEY,
  dateLabel,
  decimal,
  duesStatusLabel,
  forbidden,
  isForbidden,
  itemsFrom,
  money,
  positiveInt,
  rethrowAuth,
  trimmed,
  unwrap,
  v,
  withStatus
} = require('../lib/verein-shared');

/**
 * Clubs (Verein) — membership dues, cross-club invitations and member import.
 *
 * React routes `me/verein-invitations`, `me/verein-dues`, `clubs/:id/admin/dues`
 * and `clubs/:id/admin/import`, all behind `caring_community` (as here, in
 * tenant-feature-gates.js) and all enforced again by Laravel: the organiser pages
 * answer 403 unless the caller is a tenant admin or this club's verein_admin.
 *
 * 🔴 PAYING dues is not offered. Laravel's only payment path for dues is a Stripe
 * PaymentIntent (`POST /v2/me/verein-dues/{id}/pay` returns a client secret),
 * which needs Stripe.js; there is no hosted checkout page for dues. The member
 * sees what is owed and its status, and is told plainly that card payment is not
 * available here — never a pretend payment. See docs/REACT_PARITY_AND_ROADMAP.md.
 */

const router = express.Router();

function duesPath(orgId) {
  return `/clubs/${orgId}/admin/dues`;
}

router.get('/:id(\\d+)/admin/dues', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  const orgId = positiveInt(req.params.id);
  const currentYear = new Date().getUTCFullYear();
  const yearParam = positiveInt(req.query.year);
  const year = yearParam >= 2000 && yearParam <= 2100 ? yearParam : currentYear;
  const statusFilter = DUES_STATUSES.includes(req.query.dues_status) ? req.query.dues_status : '';

  let feeConfig = null;
  let rows = [];
  let overdueCount = 0;
  try {
    const config = unwrap(await getVereinDuesFeeConfig(req.token, orgId)) || {};
    feeConfig = config.fee_config || null;
    const params = { year: String(year) };
    if (statusFilter) params.status = statusFilter;
    rows = itemsFrom(await listVereinDues(req.token, orgId, params));
    overdueCount = itemsFrom(await listVereinOverdueDues(req.token, orgId)).length;
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    throw error;
  }

  const status = trimmed(req.query.status, 32);
  const statusTexts = {
    'config-saved': v(t, 'dues.admin_config_saved'),
    generated: v(t, 'dues.admin_generated', { generated: positiveInt(req.query.generated) || 0, skipped: positiveInt(req.query.skipped) || 0 }),
    reminded: v(t, 'dues.admin_reminder_sent'),
    'bulk-reminded': v(t, 'dues.admin_bulk_reminder_sent', { count: positiveInt(req.query.count) || 0 }),
    waived: v(t, 'dues.admin_waived'),
    'save-failed': v(t, 'dues.errors.save_failed'),
    'generate-failed': v(t, 'dues.errors.generate_failed'),
    'remind-failed': v(t, 'dues.errors.reminder_failed'),
    'waive-failed': v(t, 'dues.errors.waive_failed')
  };
  const flashed = req.session && typeof req.session.vereinError === 'string' ? req.session.vereinError : '';
  if (req.session) delete req.session.vereinError;

  return res.render('verein/admin-dues', {
    title: v(t, 'dues.admin_title'),
    activeNav: 'account',
    orgId,
    year,
    years: [currentYear + 1, currentYear, currentYear - 1, currentYear - 2],
    statusFilter,
    statuses: DUES_STATUSES,
    overdueCount,
    config: {
      feeAmount: feeConfig ? String((Number(feeConfig.fee_amount_cents) || 0) / 100) : '',
      currency: CURRENCIES.includes(feeConfig?.currency) ? feeConfig.currency : 'CHF',
      billingCycle: BILLING_CYCLES.includes(feeConfig?.billing_cycle) ? feeConfig.billing_cycle : 'annual',
      gracePeriod: feeConfig ? String(feeConfig.grace_period_days ?? 30) : '30',
      lateFee: feeConfig && feeConfig.late_fee_cents != null ? String(Number(feeConfig.late_fee_cents) / 100) : '',
      isActive: feeConfig ? Boolean(feeConfig.is_active) : true
    },
    currencies: CURRENCIES,
    cycles: BILLING_CYCLES,
    rows: rows.map((row) => {
      const rowStatus = trimmed(row?.status, 32);
      const name = trimmed(`${row?.first_name || ''} ${row?.last_name || ''}`) || trimmed(row?.email) || v(t, 'unknown_member');
      return {
        id: positiveInt(row?.id),
        name,
        email: trimmed(row?.email),
        amountLabel: money(res, row?.amount_cents, row?.currency),
        statusLabel: duesStatusLabel(t, rowStatus),
        statusTag: DUES_TAGS[rowStatus] || 'govuk-tag--grey',
        dueLabel: dateLabel(res, row?.due_date),
        reminders: positiveInt(row?.reminder_count),
        open: rowStatus === 'pending' || rowStatus === 'overdue'
      };
    }),
    statusMessage: Object.hasOwn(statusTexts, status)
      ? { type: status.endsWith('-failed') ? 'error' : 'success', text: (status.endsWith('-failed') && flashed) || statusTexts[status] }
      : null,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

function rememberRefusal(req, error) {
  if (error instanceof ApiError && error.status < 500 && error.status !== 403 && req.session) {
    req.session.vereinError = trimmed(error.message, 300);
  }
}

router.post('/:id(\\d+)/admin/dues/fee-config', asyncRoute(async (req, res) => {
  const orgId = positiveInt(req.params.id);
  const fee = decimal(req.body?.fee_amount);
  const lateFeeText = trimmed(req.body?.late_fee, 16);
  const lateFee = lateFeeText === '' ? null : decimal(lateFeeText);
  const grace = Number.parseInt(trimmed(req.body?.grace_period_days, 4), 10);
  const currency = CURRENCIES.includes(req.body?.currency) ? req.body.currency : '';
  const cycle = BILLING_CYCLES.includes(req.body?.billing_cycle) ? req.body.billing_cycle : '';

  if (fee === null || !currency || !cycle || !Number.isInteger(grace) || grace < 0 || (lateFeeText !== '' && lateFee === null)) {
    return withStatus(res, duesPath(orgId), 'save-failed');
  }

  try {
    await setVereinDuesFeeConfig(req.token, orgId, {
      fee_amount_cents: Math.round(fee * 100),
      currency,
      billing_cycle: cycle,
      grace_period_days: grace,
      late_fee_cents: lateFee === null ? null : Math.round(lateFee * 100),
      is_active: req.body?.is_active === '1'
    });
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    rememberRefusal(req, error);
    return withStatus(res, duesPath(orgId), 'save-failed');
  }
  return withStatus(res, duesPath(orgId), 'config-saved');
}));

router.post('/:id(\\d+)/admin/dues/generate', asyncRoute(async (req, res) => {
  const orgId = positiveInt(req.params.id);
  const year = positiveInt(req.body?.year);
  if (year < 2000 || year > 2100) return withStatus(res, duesPath(orgId), 'generate-failed');

  let result;
  try {
    result = unwrap(await generateVereinDues(req.token, orgId, year)) || {};
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    rememberRefusal(req, error);
    return withStatus(res, duesPath(orgId), 'generate-failed', { year: String(year) });
  }
  return withStatus(res, duesPath(orgId), 'generated', {
    year: String(year),
    generated: String(Number(result.generated) || 0),
    skipped: String(Number(result.skipped) || 0)
  });
}));

router.post('/:id(\\d+)/admin/dues/remind-overdue', asyncRoute(async (req, res) => {
  const orgId = positiveInt(req.params.id);
  let overdue;
  try {
    overdue = itemsFrom(await listVereinOverdueDues(req.token, orgId));
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    return withStatus(res, duesPath(orgId), 'remind-failed');
  }

  // Per-row best effort, as React does: one failure does not stop the rest.
  let sent = 0;
  for (const row of overdue) {
    const duesId = positiveInt(row?.id);
    if (!duesId) continue;
    try {
      await remindVereinDues(req.token, orgId, duesId);
      sent += 1;
    } catch (error) {
      rethrowAuth(error);
    }
  }
  return withStatus(res, duesPath(orgId), 'bulk-reminded', { count: String(sent) });
}));

router.post('/:id(\\d+)/admin/dues/:duesId(\\d+)/remind', asyncRoute(async (req, res) => {
  const orgId = positiveInt(req.params.id);
  try {
    await remindVereinDues(req.token, orgId, positiveInt(req.params.duesId));
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    rememberRefusal(req, error);
    return withStatus(res, duesPath(orgId), 'remind-failed');
  }
  return withStatus(res, duesPath(orgId), 'reminded');
}));

// Waiving forgives a member's dues, so it gets its own confirmation page with a
// required reason (React asks for one in a modal).
router.get('/:id(\\d+)/admin/dues/:duesId(\\d+)/waive', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  return res.render('verein/admin-waive', {
    title: v(t, 'dues.admin_waive_title'),
    activeNav: 'account',
    orgId: positiveInt(req.params.id),
    duesId: positiveInt(req.params.duesId),
    memberName: trimmed(req.query.name, 200),
    reasonMissing: req.query.error === 'reason',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/:id(\\d+)/admin/dues/:duesId(\\d+)/waive', asyncRoute(async (req, res) => {
  const orgId = positiveInt(req.params.id);
  const duesId = positiveInt(req.params.duesId);
  const reason = trimmed(req.body?.reason, 1000);
  if (!reason) {
    return res.redirect(`${res.locals.urlFor(`${duesPath(orgId)}/${duesId}/waive`)}?error=reason`);
  }
  try {
    await waiveVereinDues(req.token, orgId, duesId, reason);
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    rememberRefusal(req, error);
    return withStatus(res, duesPath(orgId), 'waive-failed');
  }
  return withStatus(res, duesPath(orgId), 'waived');
}));

// ---------------------------------------------------------------------------
// Organiser: import members from a CSV (upload or paste), preview, then import
// ---------------------------------------------------------------------------

function importPath(orgId) {
  return `/clubs/${orgId}/admin/import`;
}

function renderImportForm(req, res, orgId, errorKey = '', csv = '') {
  const t = res.locals.t;
  return res.render('verein/import', {
    title: v(t, 'import.title'),
    activeNav: 'account',
    orgId,
    csv,
    errorText: errorKey ? v(t, `import.errors.${errorKey}`) : (req.session?.vereinError || ''),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

router.get('/:id(\\d+)/admin/import', asyncRoute(async (req, res) => {
  const orgId = positiveInt(req.params.id);
  const response = renderImportForm(req, res, orgId);
  if (req.session) delete req.session.vereinError;
  return response;
}));

async function csvFromRequest(req) {
  const file = req.files && req.files.csv_file;
  if (file && typeof file.filepath === 'string' && file.filepath) {
    if (Number(file.size) > CSV_MAX_BYTES) return { error: 'read_failed' };
    try {
      return { csv: (await fs.readFile(file.filepath, 'utf8')).replace(/^\uFEFF/, '') };
    } catch {
      return { error: 'read_failed' };
    }
  }
  return { csv: String(req.body?.csv ?? '').slice(0, CSV_MAX_BYTES) };
}

router.post('/:id(\\d+)/admin/import/preview', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  const orgId = positiveInt(req.params.id);
  const { csv, error: readError } = await csvFromRequest(req);
  if (readError) return renderImportForm(req, res.status(422), orgId, readError);
  if (!csv || !csv.trim()) return renderImportForm(req, res.status(422), orgId, 'empty_csv');

  let preview;
  try {
    preview = unwrap(await previewVereinMemberImport(req.token, orgId, csv)) || {};
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    if (error instanceof ApiError && error.status < 500 && req.session) {
      req.session.vereinError = trimmed(error.message, 300);
      const response = renderImportForm(req, res.status(422), orgId, '', csv);
      delete req.session.vereinError;
      return response;
    }
    return renderImportForm(req, res.status(503), orgId, 'preview_failed', csv);
  }

  // The CSV the organiser previewed is the CSV that gets imported: it is kept
  // server-side for the confirm step rather than round-tripped through the page.
  if (req.session) req.session[IMPORT_SESSION_KEY] = { orgId, csv };

  const summary = preview.summary || {};
  // F-126: import never enrols an existing account (it needs an invitation the
  // member accepts), so Laravel reports those rows as `existing_account`.
  const actionKeys = { create: 'create', existing_account: 'existing_account', link_existing: 'link', already_member: 'already', invalid: 'invalid' };
  return res.render('verein/import-preview', {
    title: v(t, 'import.step2'),
    activeNav: 'account',
    orgId,
    organisationName: trimmed(preview.organization?.name),
    summary: {
      total: Number(summary.total_rows) || 0,
      create: Number(summary.ready_to_create) || 0,
      existing: Number(summary.existing_accounts) || 0,
      duplicates: Number(summary.duplicates) || 0,
      invalid: Number(summary.invalid) || 0
    },
    items: (Array.isArray(preview.items) ? preview.items : []).map((item) => ({
      row: positiveInt(item?.row),
      actionLabel: v(t, `import.actions.${actionKeys[item?.action] || 'invalid'}`),
      invalid: item?.action === 'invalid',
      email: trimmed(item?.email),
      name: trimmed(`${item?.first_name || ''} ${item?.last_name || ''}`),
      role: trimmed(item?.role, 32),
      errors: Array.isArray(item?.errors) ? item.errors.map((message) => trimmed(message, 300)).filter(Boolean) : []
    })),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/:id(\\d+)/admin/import', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  const orgId = positiveInt(req.params.id);
  const stored = req.session && req.session[IMPORT_SESSION_KEY];
  if (!stored || stored.orgId !== orgId || typeof stored.csv !== 'string' || !stored.csv.trim()) {
    return res.redirect(res.locals.urlFor(importPath(orgId)));
  }
  // Spent on first use, so a double submit cannot import twice.
  delete req.session[IMPORT_SESSION_KEY];

  let result;
  try {
    result = unwrap(await importVereinMembers(req.token, orgId, stored.csv)) || {};
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    if (error instanceof ApiError && error.status < 500 && req.session) {
      req.session.vereinError = trimmed(error.message, 300);
      return res.redirect(res.locals.urlFor(importPath(orgId)));
    }
    return renderImportForm(req, res.status(503), orgId, 'import_failed');
  }

  // Temporary passwords are shown once, on this response only, exactly as React
  // shows them; they are never stored in the session or put in a URL.
  res.set('Cache-Control', 'no-store');
  return res.render('verein/import-result', {
    title: v(t, 'import.result.title'),
    activeNav: 'account',
    orgId,
    created: Number(result.created) || 0,
    linked: Number(result.linked) || 0,
    skipped: Number(result.skipped) || 0,
    passwords: (Array.isArray(result.members) ? result.members : [])
      .filter((member) => member && typeof member.temporary_password === 'string' && member.temporary_password)
      .map((member) => ({ email: trimmed(member.email), password: member.temporary_password }))
  });
}));

module.exports = router;
