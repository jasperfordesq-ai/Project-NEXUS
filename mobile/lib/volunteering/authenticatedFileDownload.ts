// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import i18n from 'i18next';

import { ApiResponseError } from '@/lib/api/client';
import { API_BASE_URL, APP_VERSION, DEFAULT_TENANT, STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';

export const SHARING_UNAVAILABLE = 'sharing_unavailable';

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
export async function downloadAuthenticatedFile(path: string, filename: string): Promise<void> {
  const base = new URL(API_BASE_URL);
  const resolved = new URL(path, `${base.origin}/`);
  if (resolved.origin !== base.origin) {
    throw new ApiResponseError(400, i18n.t('common:errors.generic'));
  }
  const [token, tenantSlug] = await Promise.all([
    storage.get(STORAGE_KEYS.AUTH_TOKEN),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!token) throw new ApiResponseError(401, i18n.t('common:errors.unauthorized'));

  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'download';
  const target = `${FileSystem.cacheDirectory}nexus-download-${Date.now()}-${safeName}`;
  const result = await FileSystem.downloadAsync(resolved.toString(), target, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Slug': tenantSlug?.trim() || DEFAULT_TENANT,
      'X-Nexus-Mobile': '1',
      'X-Nexus-Mobile-Version': APP_VERSION,
    },
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

  if (!(await Sharing.isAvailableAsync())) throw new Error(SHARING_UNAVAILABLE);
  await Sharing.shareAsync(result.uri);
}
