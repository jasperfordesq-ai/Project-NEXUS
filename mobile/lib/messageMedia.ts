// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import i18n from 'i18next';
import { ApiResponseError, authenticatedApiIdentity, authenticatedMediaRequest } from '@/lib/api/client';

/**
 * Download a message attachment and hand it to the share sheet.
 *
 * F-121 — the same checks as `downloadAuthenticatedFile`:
 *   - `downloadAsync` resolves for ANY HTTP status, so a 401/404 body used to be shared
 *     as if it were the attachment. A non-2xx answer is now deleted and reported.
 *   - The member who asked must still be the one signed in when the transfer finishes;
 *     otherwise the file is deleted instead of shared.
 *   - Files are written under the `nexus-message-` prefix, which sign-out purges
 *     (lib/sessionFileCache.ts).
 */
export async function openAuthenticatedMessageMedia(path: string, filename: string): Promise<void> {
  const identity = await authenticatedApiIdentity();
  const request = await authenticatedMediaRequest(path);
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'attachment';
  const target = `${FileSystem.cacheDirectory}nexus-message-${Date.now()}-${safeName}`;
  const discard = () => FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);

  const result = await FileSystem.downloadAsync(request.uri, target, { headers: request.headers })
    .catch(async (error: unknown) => {
      // A native transfer may have written part of the file before rejecting.
      await discard();
      throw error;
    });

  if (typeof result.status === 'number' && (result.status < 200 || result.status >= 300)) {
    await discard();
    throw new ApiResponseError(result.status, i18n.t('common:errors.requestFailedWithStatus', { status: result.status }));
  }

  try {
    await identity.assertCurrent();
    if (!await Sharing.isAvailableAsync()) throw new Error('sharing_unavailable');
    await identity.assertCurrent();
  } catch (error) {
    await discard();
    throw error;
  }
  await Sharing.shareAsync(result.uri);
}
