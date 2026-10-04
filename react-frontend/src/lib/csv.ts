// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CSV built in the browser (exports of data the page already holds).
 *
 * Every cell is neutralised the same way the server's CsvExportSanitizer
 * does it: text that starts — after any leading whitespace or control
 * characters — with `=`, `+`, `-` or `@` is prefixed with `'`, so a member's
 * name or description can never run as a spreadsheet formula when an admin
 * opens the file in Excel or LibreOffice. Numbers are left as numbers.
 * Then the cell is quoted, with inner quotes doubled.
 */

export type CsvValue = string | number | boolean | null | undefined;

// eslint-disable-next-line no-control-regex -- the control characters are the point: a cell that hides a formula behind them must still be neutralised.
const FORMULA_START = /^[\s\x00-\x1F]*[=+\-@]/;

/** One cell, neutralised and quoted. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '""';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `"${String(value)}"`;
  }
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A whole CSV document: one header row, then the data rows. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * Save CSV text as a file. A UTF-8 byte-order mark is added so Excel shows
 * accented names correctly.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
