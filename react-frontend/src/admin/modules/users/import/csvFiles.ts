// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { CheckResult, ImportIssue } from './types';

// The server's own trim (MemberImportRowRules::clean): white space, Unicode
// separators and format characters (no-break and ideographic spaces, zero-width
// spaces, the byte-order mark, the word joiner) from both ends of every cell.
const SERVER_TRIM = /^[\s\p{Z}\p{Cf}]+|[\s\p{Z}\p{Cf}]+$/gu;

/**
 * Same escape as the server's CsvExportSanitizer, which the import undoes: after
 * trimming, the server removes ONE leading apostrophe when the next character is
 * = + - or @. So the value is trimmed here first (and written trimmed), and a
 * cell that starts with one of those characters gets the apostrophe. A cell that
 * already starts with an apostrophe is left alone: the server reads what we write
 * exactly as it would read the original, which is the property that matters.
 */
function cell(value: string): string {
  const trimmed = value.replace(SERVER_TRIM, '');
  const escaped = /^[=+\-@]/.test(trimmed) ? `'${trimmed}` : trimmed;
  return /[",;\r\n]/.test(escaped) ? `"${escaped.replace(/"/g, '""')}"` : escaped;
}

// Written as a code point: a literal byte-order mark in source is invisible.
const BOM = String.fromCharCode(0xfeff);

/** A CSV a spreadsheet opens correctly: byte-order mark, CRLF rows, escaped cells. */
export function buildCsv(header: string[], rows: string[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = await readBytes(file);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The admin's own file, minus the given spreadsheet rows (e.g. existing members). */
export function correctedFile(check: CheckResult, excludeRows: number[]): string {
  const skip = new Set(excludeRows);
  return buildCsv(check.header ?? [], (check.source_rows ?? []).filter((r) => !skip.has(r.row)).map((r) => r.raw));
}

/** The rows from a spreadsheet row onwards — what is left after a stopped import. */
export function remainingRowsFile(check: CheckResult, fromSourceRow: number): string {
  return buildCsv(check.header ?? [], (check.source_rows ?? []).filter((r) => r.row >= fromSourceRow).map((r) => r.raw));
}

/**
 * The rows not yet imported, by position. For a checked file every source row
 * became a held row in order, so the server's `next_index` names exactly the
 * first row that was not imported — no spreadsheet row number is involved.
 */
export function rowsFromIndexFile(check: CheckResult, index: number): string {
  return buildCsv(check.header ?? [], (check.source_rows ?? []).slice(Math.max(0, index)).map((r) => r.raw));
}

/** The named spreadsheet rows as they were in the file, each with its row number in front. */
export function rowsWithNumbersFile(check: CheckResult, rowNumbers: number[], rowLabel: string): string {
  const byRow = new Map((check.source_rows ?? []).map((r) => [r.row, r.raw]));
  const rows = rowNumbers.flatMap((n) => {
    const raw = byRow.get(n);
    return raw ? [[String(n), ...raw]] : [];
  });
  return buildCsv([rowLabel, ...(check.header ?? [])], rows);
}

/** One line per problem. The caller supplies the translated headings and wording. */
export function problemsFile(
  check: CheckResult,
  labels: { row: string; column: string; problem: string },
  describe: (issue: ImportIssue) => string,
  columnLabel: (column: string | null) => string,
): string {
  return buildCsv(
    [labels.row, labels.column, labels.problem],
    (check.problems ?? []).map((p) => [String(p.row), columnLabel(p.column), describe(p)]),
  );
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
