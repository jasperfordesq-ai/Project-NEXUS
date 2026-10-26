// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  getMyVereinDues
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const {
  DUES_TAGS,
  dateLabel,
  duesStatusLabel,
  forbidden,
  isForbidden,
  itemsFrom,
  money,
  positiveInt,
  rethrowAuth,
  trimmed,
  v
} = require('../lib/verein-shared');

/**
 * Clubs (Verein): a member's own dues (`/me/verein-dues`). View only — card
 * payment is BLOCKED; see the note in `routes/verein.js`.
 */

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  let rows = [];
  let loadFailed = false;
  try {
    rows = itemsFrom(await getMyVereinDues(req.token)).map((row) => {
      const status = trimmed(row?.status, 32);
      return {
        id: positiveInt(row?.id),
        organisation: trimmed(row?.organization_name) || v(t, 'unnamed_club'),
        year: positiveInt(row?.membership_year),
        amountLabel: money(res, row?.amount_cents, row?.currency),
        status,
        statusLabel: duesStatusLabel(t, status),
        statusTag: DUES_TAGS[status] || 'govuk-tag--grey',
        dueLabel: dateLabel(res, row?.due_date),
        paidLabel: dateLabel(res, row?.paid_at),
        owed: status === 'pending' || status === 'overdue'
      };
    });
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    loadFailed = true;
  }

  return res.render('verein/my-dues', {
    title: v(t, 'dues.my_title'),
    activeNav: 'account',
    rows,
    anyOwed: rows.some((row) => row.owed),
    loadFailed
  });
}));

// ---------------------------------------------------------------------------
// Organiser: a club's dues overview
// ---------------------------------------------------------------------------

module.exports = router;
