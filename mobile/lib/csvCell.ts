// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
  F-120: spreadsheet apps run a cell that starts with = + - @ (or a tab or carriage
  return, which some apps strip before evaluating) as a formula. An exported cell can
  hold text another member typed — a transaction description or a display name — so a
  crafted value could build a link or, in some apps, run a command when the member opens
  their own statement. Such a cell is prefixed with a single quote, the same rule the
  server applies to its CSV exports (F-005).

  A plain number ("-2", "-1,5", "1 000.5") is left alone: it cannot be a formula, and
  quoting it would turn the member's amounts into text in the spreadsheet.
*/
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d[\d.,   ]*$/;

export function neutraliseSpreadsheetFormula(text: string): string {
  return FORMULA_TRIGGER.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

/** One RFC 4180 CSV cell, formula-neutralised. */
export function csvCell(value: string | number | null | undefined): string {
  const text = neutraliseSpreadsheetFormula(String(value ?? ''));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
