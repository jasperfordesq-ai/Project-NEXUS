// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { AppState } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { PreparedAuditedCsv } from './prepareAuditedCsv';
let sharing = false;
/** No automatic export or retry. Native dismissal is not proof of a completed copy. */
export async function shareAuditedCsv(prepare: () => Promise<PreparedAuditedCsv>, isActive: () => boolean): Promise<void> {
  if (sharing) throw new Error('export_in_progress');
  if (!isActive() || AppState.currentState !== 'active') throw new Error('download_cancelled');
  sharing = true;
  let file: PreparedAuditedCsv | undefined;
  let handedOff = false;
  try {
    if (!await Sharing.isAvailableAsync()) throw new Error('sharing_unavailable');
    if (!isActive() || AppState.currentState !== 'active') throw new Error('download_cancelled');
    file = await prepare();
    await file.assertCurrent();
    if (!isActive() || AppState.currentState !== 'active') throw new Error('download_cancelled');
    handedOff = true;
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  } finally {
    try {
      // Preserve handed-off files even on cancellation/error: the native API
      // cannot tell us whether another app has already begun consuming the URI.
      if (handedOff) file?.releaseAfterSharing();
      else {
        try { file?.dispose(); } catch { /* The cache observer retries orphan cleanup. */ }
      }
    } finally { sharing = false; }
  }
}
