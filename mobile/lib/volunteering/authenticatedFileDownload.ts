// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import i18n from 'i18next';

import { ApiResponseError, authenticatedApiIdentity } from '@/lib/api/client';
import { API_BASE_URL, APP_VERSION } from '@/lib/constants';

export const SHARING_UNAVAILABLE = 'sharing_unavailable';
export const DOWNLOAD_CANCELLED = 'download_cancelled';
let downloadSequence = 0;

/**
 * Download a file from an authenticated API endpoint and hand it to the share sheet.
 *
 * 🔴 Both the group file download and the volunteering certificate used to be opened with
 * `Linking.openURL(<api url>)`. The system browser carries no bearer token, so every tap
 * landed on a JSON `{"message":"Unauthenticated."}` page — measured on a device during the
 * 2026-09-05 audit (S4-11). `authenticatedMediaRequest` in `lib/api/client.ts` cannot be
 * reused: it deliberately accepts only `/api/v2/messages/` paths. This helper does the same
 * header work for any same-origin API path, writes the body to the cache directory and
 * opens the share sheet, which is the only way a downloaded file can be handed to another
 * app on iOS.
 *
 * Lives under `lib/volunteering/` because that directory was in scope for the audit fix;
 * the group files tab imports it too. Move it to `lib/` once the concurrent work settles.
 */
export async function downloadAuthenticatedFile(
  path: string,
  filename: string,
  headers: Record<string, string> = {},
  options: { isActive?: () => boolean } = {},
): Promise<void> {
  const assertActive = () => {
    if (options.isActive && !options.isActive()) throw new Error(DOWNLOAD_CANCELLED);
  };
  assertActive();
  const base = new URL(API_BASE_URL);
  const resolved = new URL(path, `${base.origin}/`);
  if (resolved.origin !== base.origin) {
    throw new ApiResponseError(400, i18n.t('common:errors.generic'));
  }
  const { token, tenantSlug, assertCurrent } = await authenticatedApiIdentity();
  assertActive();

  const safeName = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+$/, 'download').slice(0, 120) || 'download';
  const directory = `${FileSystem.cacheDirectory}nexus-download-${Date.now()}-${++downloadSequence}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  try {
    assertActive();
  } catch (error) {
    await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined);
    throw error;
  }
  const target = `${directory}${safeName}`;
  const result = await FileSystem.downloadAsync(resolved.toString(), target, {
    headers: {
      ...headers,
      Authorization: `Bearer ${token}`,
      'X-Tenant-Slug': tenantSlug,
      'X-Nexus-Mobile': '1',
      'X-Nexus-Mobile-Version': APP_VERSION,
    },
  }).catch(async (error: unknown) => {
    // A native transfer may have written only part of the file before rejecting.
    await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined);
    throw error;
  });

  // `downloadAsync` resolves for any HTTP status; a 401/404 body would otherwise be shared
  // as if it were the file.
  if (typeof result.status === 'number' && (result.status < 200 || result.status >= 300)) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw new ApiResponseError(
      result.status,
      i18n.t('common:errors.requestFailedWithStatus', { status: result.status }),
    );
  }

  try {
    await assertCurrent();
    assertActive();
    if (!(await Sharing.isAvailableAsync())) throw new Error(SHARING_UNAVAILABLE);
    await assertCurrent();
    assertActive();
  } catch (error) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw error;
  }
  await Sharing.shareAsync(result.uri);
}
