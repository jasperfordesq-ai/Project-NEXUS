// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Saving two-factor recovery codes to a text file.
 *
 * 🔴 The codes are shown exactly once, at enrolment, and are the only way back into
 * an account whose authenticator is lost. Until 12 September 2026 the enrolment page
 * printed them as a bare list with no way to keep them, which invites the two worst
 * habits: a screenshot, or not saving them at all.
 *
 * Rules this module exists to hold:
 *
 * - The file is built from the codes already in the page's memory. It is never
 *   fetched, so there is no request to log, no response to cache and no URL that
 *   could be replayed.
 * - The object URL is revoked immediately, including when the click throws. One left
 *   alive keeps the codes readable for the life of the document.
 * - Nothing here logs. No `console`, no telemetry, no breadcrumb: a recovery code in
 *   a log is the same as a password in a log.
 * - The filename carries a date and nothing else. No email address, no member id, no
 *   community name — the file may end up in a shared downloads folder or a backup.
 * - Every word in the file comes from the caller, already translated. This module
 *   contains no user-facing English.
 */

export interface RecoveryCodesFile {
  /** Translated heading, e.g. "Project NEXUS recovery codes". */
  title: string;
  /** Translated line saying when they were issued. */
  generated: string;
  /** Translated sentence or two on how to use and keep them. */
  guidance: string;
  codes: string[];
}

export interface BuildOptions {
  /**
   * Defaults to CRLF. These files are opened in whatever a member has to hand, and
   * Windows Notepad renders LF-only text as one unbroken line — which would make the
   * codes unreadable exactly when someone is locked out and least able to cope.
   */
  lineEnding?: '\n' | '\r\n';
}

export function buildRecoveryCodesFile(file: RecoveryCodesFile, options: BuildOptions = {}): string {
  const eol = options.lineEnding ?? '\r\n';
  const lines = [file.title, file.generated, '', file.guidance, '', ...file.codes, ''];
  return lines.join(eol).replace(/(\r\n|\n)+$/, eol);
}

/** `recovery-codes-2026-09-12.txt` — date only, deliberately. */
export function recoveryCodesFilename(now: Date = new Date()): string {
  const iso = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return `recovery-codes-${iso}.txt`;
}

export interface DownloadDeps {
  documentRef?: Document;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

/**
 * Save the codes as a text file. Must be called from a user gesture — browsers block
 * downloads that nobody asked for, and a recovery-code file should never appear
 * except because someone pressed the button.
 */
export function downloadRecoveryCodes(
  file: RecoveryCodesFile,
  filename: string,
  deps: DownloadDeps = {},
): void {
  if (!file.codes.length) {
    throw new Error('downloadRecoveryCodes: no recovery codes to save');
  }

  const documentRef = deps.documentRef ?? document;
  const createObjectURL = deps.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = deps.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);

  const blob = new Blob([buildRecoveryCodesFile(file)], { type: 'text/plain;charset=utf-8' });
  const url = createObjectURL(blob);
  try {
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // Belt and braces: an anchor that opened a tab would put the codes on screen in a
    // context this page does not control.
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    documentRef.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      documentRef.body.removeChild(anchor);
    }
  } finally {
    revokeObjectURL(url);
  }
}
