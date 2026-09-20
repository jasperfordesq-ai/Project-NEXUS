// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { fetch } from 'expo/fetch';
import { File, type FileHandle } from 'expo-file-system';
import { createAuditedExportDirectory } from './auditedExportCache';
import i18n from 'i18next';
import { api, ApiResponseError, authenticatedApiIdentity } from '@/lib/api/client';
import { API_BASE_URL, API_V2, APP_VERSION } from '@/lib/constants';

/** Dispose unshared files immediately; release shared files to the foreground cache cleanup. */
export interface PreparedAuditedCsv { uri: string; assertCurrent: () => Promise<void>; dispose: () => void; releaseAfterSharing: () => void }
/** Streams a single audited POST to disk without buffering the entire export or retrying it. */
export async function prepareAuditedCsv(path: string, filename: string, body: unknown,
  headers: Record<string, string>, isActive: () => boolean): Promise<PreparedAuditedCsv> {
  const assertActive = () => { if (!isActive()) throw new Error('download_cancelled'); };
  assertActive();
  const base = new URL(API_BASE_URL); const url = new URL(path, base.origin);
  if (url.origin !== base.origin || !url.pathname.startsWith('/api/v2/') || url.username || url.password
    || !/^[A-Za-z0-9_-]+\.csv$/.test(filename)) throw new Error('invalid_export_target');
  const origin = await authenticatedApiIdentity();
  await origin.assertCurrent(); assertActive();
  // Renew an expired session using a safe read through the ordinary API client.
  // Never replay the audited POST to discover whether renewal is needed.
  await api.get(API_V2 + '/users/me');
  await origin.assertCurrent(); assertActive();
  const identity = await authenticatedApiIdentity();
  const assertCurrent = async () => { assertActive(); await origin.assertCurrent(); await identity.assertCurrent(); assertActive(); };
  await assertCurrent();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  const cancellation = setInterval(() => { if (!isActive()) controller.abort(); }, 250);
  let lease: ReturnType<typeof createAuditedExportDirectory> | undefined; let handle: FileHandle | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const dispose = () => { lease?.dispose(); };
  try {
    const trustedHeaders = { ...headers };
    for (const key of Object.keys(trustedHeaders)) {
      if (['authorization', 'x-tenant-slug', 'content-type', 'accept'].includes(key.toLowerCase())) delete trustedHeaders[key];
    }
    const response = await fetch(url.toString(), { method: 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { ...trustedHeaders, Authorization: 'Bearer ' + identity.token, 'X-Tenant-Slug': identity.tenantSlug,
        'X-Nexus-Mobile': '1', 'X-Nexus-Mobile-Version': APP_VERSION, Accept: 'text/csv', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new ApiResponseError(response.status, i18n.t('common:errors.requestFailedWithStatus', { status: response.status }));
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/csv' || !response.body) throw new Error('invalid_export_response');
    await assertCurrent();
    lease = createAuditedExportDirectory();
    const file = new File(lease.directory, filename); file.create(); handle = file.open();
    reader = response.body.getReader(); let bytes = 0;
    while (true) {
      assertActive();
      const chunk = await reader.read();
      assertActive();
      if (chunk.done) break;
      handle.writeBytes(chunk.value); bytes += chunk.value.byteLength;
    }
    if (bytes === 0) throw new Error('empty_export_response');
    handle.close(); handle = undefined;
    await assertCurrent();
    return { uri: file.uri, assertCurrent, dispose, releaseAfterSharing: lease.release };
  } catch (error) {
    controller.abort();
    try { handle?.close(); } catch { /* Preserve the transfer error. */ }
    try { dispose(); } catch { /* A later cache cleanup must retry inaccessible files. */ }
    throw error;
  } finally {
    clearTimeout(timeout); clearInterval(cancellation);
    try { reader?.releaseLock(); } catch { /* Transfer already aborted. */ }
  }
}
