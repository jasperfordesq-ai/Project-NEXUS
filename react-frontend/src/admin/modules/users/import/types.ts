// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Shapes of the member import endpoints (AdminMemberImportController). Codes
// are plain strings on purpose: the server owns the vocabulary, the UI maps
// the ones it knows to translated text and falls back for the rest.

export type ImportColumn = 'first_name' | 'last_name' | 'email' | 'phone' | 'location' | 'balance';

export interface ImportIssue {
  /** Spreadsheet row; 0 means the whole file (e.g. `already_member_unmatched`). */
  row: number;
  column: ImportColumn | null;
  code: string;
  params: Record<string, string | number | string[]>;
}

export interface CheckSummary {
  rows: number;
  blank_rows_ignored: number;
  total_balance: string;
  negative_count: number;
  with_location: number;
  without_location: number;
}

export interface CheckResult {
  status: 'file_error' | 'problems' | 'ready';
  file_error?: { code: string; params: Record<string, string | number | string[]> };
  header?: string[];
  source_rows?: Array<{ row: number; raw: string[] }>;
  problems?: ImportIssue[];
  warnings?: ImportIssue[];
  existing_member_rows?: number[];
  summary?: CheckSummary;
  import_id?: string;
  admission?: { requires_identity_check: boolean };
  /** About how long the welcome invitations for this file would take to send (ready files only). */
  invitation_minutes?: number;
}

/** The admin's choices that the server fixes on the first batch and ignores afterwards. */
export interface FirstBatchChoices {
  identityChecked: boolean;
  /** Queue a welcome invitation for each new member who is not held for an identity check. */
  sendInvitations: boolean;
}

export interface BatchResult {
  import_id: string;
  status: 'ready' | 'running' | 'stopped' | 'completed';
  next_index: number;
  total: number;
  totals: { created: number; balance: string; zeroed: number; admission_incomplete: number; invitations_queued: number };
  /** About how long until the queued invitations have gone (the sender's pace is shared); 0 when none were queued. */
  invitations_eta_minutes: number;
  /** Spreadsheet rows of members created without their identity step. */
  admission_incomplete_rows: number[];
  stop: { row: number; code: string; params: Record<string, string | number | string[]> } | null;
  held: boolean;
  batch: { processed: number; created: number; duration_ms: number };
}

export type RunnerPhase = 'idle' | 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';

export interface RunnerState {
  phase: RunnerPhase;
  total: number;
  nextIndex: number;
  batchNumber: number;
  batchSize: number;
  created: number;
  balance: string;
  zeroed: number;
  admissionIncomplete: number;
  admissionIncompleteRows: number[];
  invitationsQueued: number;
  invitationsEtaMinutes: number;
  held: boolean;
  stop: BatchResult['stop'];
  /** Machine code of the failure, e.g. IMPORT_NOT_FOUND; null unless phase is `failed`. */
  errorCode: string | null;
  startedAt: number | null;
  secondsRemaining: number | null;
}
