// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { TFunction } from 'i18next';
import type { ImportIssue } from './types';

type Params = Record<string, string | number | string[]>;

/** The server sends lists (e.g. column names) as arrays; the wording wants one string. */
function flatten(params: Params): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]),
  );
}

/** "First name", or "Whole row" for a problem that belongs to no single column. */
export function describeColumn(t: TFunction, column: string | null): string {
  return t(`member_import.columns.${column ?? 'null'}.label`, { defaultValue: column ?? '' });
}

/** One problem found in a row, in words an administrator can act on. */
export function describeIssue(t: TFunction, issue: ImportIssue): string {
  return t(`member_import.problem.${issue.code}`, {
    ...flatten(issue.params),
    column: describeColumn(t, issue.column),
    defaultValue: t('member_import.problem.unknown'),
  });
}

/** A change the import will make to a value (warnings never block the import). */
export function describeWarning(t: TFunction, issue: ImportIssue): string {
  const text = t(`member_import.warning.${issue.code}`, {
    ...flatten(issue.params),
    defaultValue: t('member_import.warning.unknown'),
  });
  return t('member_import.warning_row', { row: issue.row, text });
}

/** Title and body for a reason the whole file was refused. Unknown codes get a generic, still-useful message. */
export function describeFileError(t: TFunction, code: string, params: Params = {}): { title: string; body: string } {
  const known = `member_import.file_error.${code}`;
  const key = t(`${known}.title`, { defaultValue: '' }) === '' ? 'member_import.file_error.unknown' : known;
  const flat = flatten(params);
  return { title: t(`${key}.title`, flat), body: t(`${key}.body`, flat) };
}

/**
 * Why the server stopped the import on a row. `stopped_by_admin` is the
 * server's record of the admin's own Stop, worded exactly as that stop is.
 */
export function describeStop(t: TFunction, stop: { row: number; code: string; params: Params }): string {
  if (stop.code === 'stopped_by_admin') return t('member_import.stopped.by_admin');
  return t(`member_import.stop.${stop.code}`, {
    ...flatten(stop.params),
    row: stop.row,
    defaultValue: t('member_import.stop.unknown', { row: stop.row }),
  });
}
