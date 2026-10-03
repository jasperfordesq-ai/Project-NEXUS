// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One CSV export for every broker list.
 *
 * No broker list had an export until October 2026, although the Review
 * Archive is a compliance record. Rather than add a download route per list,
 * this pages the list's EXISTING endpoint (so the export obeys exactly the
 * same visibility rules as the screen — a broker never exports a row they
 * could not see) and writes a CSV in the browser.
 *
 * Honest limits: at most CSV_EXPORT_CAP rows, stated in the toast when hit;
 * the caller's current filter is in the file name so two exports are never
 * confused.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';

export const CSV_EXPORT_CAP = 5000;

export interface CsvColumn<T> {
  /** Column heading in the file (already translated). */
  label: string;
  /** Cell value for a row; null/undefined become an empty cell. */
  value: (row: T) => string | number | boolean | null | undefined;
}

export interface CsvPage<T> {
  rows: T[];
  /** True when a further page exists. */
  hasMore: boolean;
}

export interface CsvExportRequest<T> {
  /** File name without extension; a timestamp is appended. */
  filename: string;
  columns: CsvColumn<T>[];
  /** Fetch one page (1-based). Must throw or reject on failure. */
  fetchPage: (page: number) => Promise<CsvPage<T>>;
  cap?: number;
}

function escapeCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const text = String(raw);
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start).
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Build the CSV text (UTF-8 BOM so Excel opens accents correctly). */
export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(','));
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}

/** Collect rows page by page until the endpoint runs out or the cap is hit. */
export async function collectRows<T>(
  fetchPage: (page: number) => Promise<CsvPage<T>>,
  cap = CSV_EXPORT_CAP,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let page = 1;
  let truncated = false;
  // A hard page ceiling guards against an endpoint that always says hasMore.
  const maxPages = Math.ceil(cap / 1) + 1;
  while (page <= maxPages) {
    const result = await fetchPage(page);
    rows.push(...result.rows);
    if (rows.length >= cap) {
      truncated = result.hasMore || rows.length > cap;
      rows.length = Math.min(rows.length, cap);
      break;
    }
    if (!result.hasMore || result.rows.length === 0) break;
    page += 1;
  }
  return { rows, truncated };
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Hand the file to the browser. Separate so tests can stub it. */
export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a tick before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface CsvExportState {
  exporting: boolean;
  /** Runs the export; resolves when the toast has been shown. */
  run: <T>(request: CsvExportRequest<T>) => Promise<void>;
}

export function useCsvExport(download: typeof downloadTextFile = downloadTextFile): CsvExportState {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const run = useCallback(
    async <T,>(request: CsvExportRequest<T>) => {
      setExporting(true);
      try {
        const { rows, truncated } = await collectRows(request.fetchPage, request.cap ?? CSV_EXPORT_CAP);
        if (rows.length === 0) {
          toast.info(t('common.export_nothing'));
          return;
        }
        download(`${request.filename}_${timestamp()}.csv`, buildCsv(request.columns, rows));
        if (truncated) {
          toast.warning(t('common.export_truncated', { count: rows.length }));
        } else {
          toast.success(t('common.export_done', { count: rows.length }));
        }
      } catch {
        toast.error(t('common.export_failed'));
      } finally {
        setExporting(false);
      }
    },
    [download, t, toast],
  );

  return { exporting, run };
}

export default useCsvExport;
