// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';

/**
 * F-121: files one member's session wrote to the app's cache directory — downloaded
 * message attachments, authenticated file downloads and CSV exports (wallet statements,
 * audited event exports). They used to outlive sign-out, so the next person to use the
 * phone could find another member's statement or attachments in the app's cache.
 *
 * Every name here is written only by this app's own session-bound code:
 *   - `nexus-message-`        lib/messageMedia.ts
 *   - `nexus-download-`       lib/volunteering/authenticatedFileDownload.ts
 *   - `nexus-audited-export-` lib/auditedExportCache.ts (wallet and event CSV exports)
 *   - `wallet-transactions-`  wallet exports written by builds before F-121
 */
const SESSION_FILE_PREFIXES = [
  'nexus-message-',
  'nexus-download-',
  'nexus-audited-export-',
  'wallet-transactions-',
] as const;

/** Remove every session-owned cache file. Never throws: sign-out must always complete. */
export async function purgeSessionFileCaches(): Promise<void> {
  const root = FileSystem.cacheDirectory;
  if (!root) return;
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(root);
  } catch {
    return;
  }
  const owned = names.filter((name) => SESSION_FILE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  await Promise.allSettled(owned.map((name) => FileSystem.deleteAsync(`${root}${name}`, { idempotent: true })));
}
