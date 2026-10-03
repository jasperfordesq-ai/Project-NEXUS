// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSupportDiagnostics,
  getSupportDiagnosticsSnapshot,
  getSupportReportLocation,
  installSupportDiagnosticsCapture,
  MAX_SUPPORT_DIAGNOSTIC_ENTRIES,
  recordApiDiagnostic,
  recordConsoleDiagnostic,
} from './supportDiagnostics';

describe('supportDiagnostics', () => {
  beforeEach(() => {
    clearSupportDiagnostics();
  });

  afterEach(() => {
    clearSupportDiagnostics();
    vi.restoreAllMocks();
  });

  it('redacts sensitive values from console diagnostics', () => {
    recordConsoleDiagnostic('error', [
      'Failed for person@example.com',
      {
        Authorization: 'Bearer secret-token',
        nested: { csrfToken: 'csrf-secret', safe: 'kept' },
      },
    ]);

    const snapshot = getSupportDiagnosticsSnapshot();
    const json = JSON.stringify(snapshot);

    expect(json).toContain('[filtered]');
    expect(json).toContain('kept');
    expect(json).not.toContain('person@example.com');
    expect(json).not.toContain('secret-token');
    expect(json).not.toContain('csrf-secret');
  });

  it('stores API metadata without query-string secrets', () => {
    recordApiDiagnostic({
      method: 'POST',
      endpoint: '/v2/orders?token=secret-token&filter=open',
      status: 500,
      durationMs: 42.42,
    });

    const snapshot = getSupportDiagnosticsSnapshot();

    expect(snapshot.entries[0]).toMatchObject({
      kind: 'api',
      method: 'POST',
      endpoint: '/v2/orders?token=[filtered]&filter=open',
      status: 500,
      duration_ms: 42,
    });
  });

  describe('F-281: page address query strings and fragments never reach a report', () => {
    const SECRET = 'f281-synthetic-token-7c1e';
    let originalPath: string;

    beforeEach(() => {
      originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    });

    afterEach(() => {
      window.history.replaceState({}, '', originalPath);
    });

    it('drops the query string and fragment from page_url and route in the snapshot', () => {
      window.history.replaceState({}, '', `/partner-analytics?token=${SECRET}&ref=${SECRET}#impersonate=${SECRET}`);

      const snapshot = getSupportDiagnosticsSnapshot();

      expect(JSON.stringify(snapshot)).not.toContain(SECRET);
      // Control: the page itself is still identified, so staff can find it.
      expect(snapshot.route).toBe('/partner-analytics');
      expect(snapshot.page_url).toBe(`${window.location.origin}/partner-analytics`);
    });

    it('exposes the same stripped location for the top-level report fields', () => {
      window.history.replaceState({}, '', `/hour-timebank/reset?code=${SECRET}#access=${SECRET}`);

      const location = getSupportReportLocation();

      expect(JSON.stringify(location)).not.toContain(SECRET);
      expect(location).toEqual({
        pageUrl: `${window.location.origin}/hour-timebank/reset`,
        route: '/hour-timebank/reset',
      });
    });

    it('filters API query values under keys it does not recognise as safe', () => {
      recordApiDiagnostic({
        method: 'GET',
        endpoint: `/v2/partner-analytics?t=${SECRET}&page=2#frag=${SECRET}`,
        status: 200,
        durationMs: 5,
      });

      const snapshot = getSupportDiagnosticsSnapshot();

      expect(JSON.stringify(snapshot)).not.toContain(SECRET);
      // Control: a known-safe paging parameter is kept for debugging.
      expect(snapshot.entries[0]).toMatchObject({ endpoint: '/v2/partner-analytics?t=[filtered]&page=2' });
    });

    it('strips query strings from web addresses quoted inside console messages', () => {
      recordConsoleDiagnostic('error', [`Failed to load https://app.example.test/reset?token=${SECRET}#x=${SECRET}`]);

      const snapshot = getSupportDiagnosticsSnapshot();

      expect(JSON.stringify(snapshot)).not.toContain(SECRET);
      expect(snapshot.entries[0]?.message).toContain('https://app.example.test/reset');
    });
  });

  it('keeps only the newest diagnostic entries', () => {
    for (let i = 0; i < MAX_SUPPORT_DIAGNOSTIC_ENTRIES + 5; i++) {
      recordConsoleDiagnostic('warn', [`message-${i}`]);
    }

    const snapshot = getSupportDiagnosticsSnapshot();

    expect(snapshot.entries).toHaveLength(MAX_SUPPORT_DIAGNOSTIC_ENTRIES);
    expect(JSON.stringify(snapshot.entries[0])).toContain('message-5');
    expect(JSON.stringify(snapshot.entries.at(-1))).toContain(`message-${MAX_SUPPORT_DIAGNOSTIC_ENTRIES + 4}`);
  });

  // HELP-10: the once-a-minute background checks filled the 50-entry log and
  // pushed out the poll the member had created half an hour earlier.
  it('leaves successful background checks out, so the member\'s own actions survive', () => {
    recordApiDiagnostic({ method: 'POST', endpoint: '/v2/polls', status: 201, durationMs: 120 });
    for (let minute = 0; minute < 30; minute++) {
      recordApiDiagnostic({ method: 'POST', endpoint: '/v2/presence/heartbeat', status: 200, durationMs: 300 });
      recordApiDiagnostic({ method: 'GET', endpoint: '/v2/presence/online-count', status: 200, durationMs: 300 });
      recordApiDiagnostic({ method: 'GET', endpoint: '/v2/notifications/counts', status: 200, durationMs: 300 });
      recordApiDiagnostic({ method: 'GET', endpoint: '/v2/messages/unread-count?x=1', status: 200, durationMs: 300 });
    }

    const snapshot = getSupportDiagnosticsSnapshot();

    expect(snapshot.entries).toEqual([expect.objectContaining({ method: 'POST', endpoint: '/v2/polls', status: 201 })]);
    expect(snapshot.background_requests_omitted).toBe(120);
  });

  it('still records a background check that failed', () => {
    recordApiDiagnostic({ method: 'GET', endpoint: '/v2/notifications/counts', status: 500, durationMs: 300 });
    recordApiDiagnostic({ method: 'POST', endpoint: '/api/v2/presence/heartbeat', status: 0, durationMs: 300 });

    const snapshot = getSupportDiagnosticsSnapshot();

    expect(snapshot.entries.map((entry) => entry.status)).toEqual([500, 0]);
    expect(snapshot.background_requests_omitted).toBe(0);
  });

  it('can install and remove console capture', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const restore = installSupportDiagnosticsCapture();

    console.warn('Captured warning for person@example.com');
    restore();
    console.warn('Not captured');

    const json = JSON.stringify(getSupportDiagnosticsSnapshot());

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(json).toContain('Captured warning');
    expect(json).not.toContain('person@example.com');
    expect(json).not.toContain('Not captured');
  });
});
