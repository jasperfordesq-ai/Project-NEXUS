// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));
jest.mock('@/lib/constants', () => ({
  API_BASE_URL: 'https://test.api',
  APP_VERSION: '1.2.0',
  DEFAULT_TENANT: 'default-community',
  STORAGE_KEYS: {
    AUTH_TOKEN: 'nexus_auth_token',
    REFRESH_TOKEN: 'nexus_refresh_token',
    TENANT_SLUG: 'nexus_tenant_slug',
    USER_DATA: 'nexus_user_data',
  },
  TIMEOUTS: { API_GET: 30_000, API_MUTATION: 15_000, API_UPLOAD: 60_000, API_REQUEST: 15_000 },
}));

import { ApiResponseError } from './client';
import { storage } from '@/lib/storage';
import { isUploadAborted, uploadWithProgress } from './uploadWithProgress';

const mockStorage = storage as jest.Mocked<typeof storage>;

/** Minimal stand-in for React Native's XMLHttpRequest, driven by the test. */
class FakeXhr {
  static last: FakeXhr;
  headers: Record<string, string> = {};
  method = '';
  url = '';
  timeout = 0;
  responseType = '';
  status = 0;
  responseText = '';
  sent: unknown = undefined;
  aborted = false;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;

  constructor() { FakeXhr.last = this; }

  open(method: string, url: string): void { this.method = method; this.url = url; }
  setRequestHeader(key: string, value: string): void { this.headers[key] = value; }
  send(body: unknown): void { this.sent = body; }
  abort(): void { this.aborted = true; this.onabort?.(); }

  /** Test helper: complete the request with a status and body. */
  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.get.mockImplementation(async (key: string) =>
    key === 'nexus_auth_token' ? 'tok-123' : key === 'nexus_tenant_slug' ? 'hour-timebank' : null);
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
});

/** Let the awaited storage reads settle so the request has actually been opened. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('uploadWithProgress', () => {
  it('POSTs the form to the API and resolves with the parsed body', async () => {
    const form = new FormData();
    const promise = uploadWithProgress<{ data: { id: number } }>('/v2/podcasts/1/episodes', form);
    await flush();

    expect(FakeXhr.last.method).toBe('POST');
    expect(FakeXhr.last.url).toBe('https://test.api/v2/podcasts/1/episodes');
    expect(FakeXhr.last.sent).toBe(form);

    FakeXhr.last.respond(201, { data: { id: 7 } });
    await expect(promise).resolves.toEqual({ data: { id: 7 } });
  });

  /**
   * 🔴 Identity headers must come from trusted storage, and Content-Type must stay unset
   * so React Native writes its own multipart boundary. Setting it by hand produces a
   * body the server cannot parse, with no useful error.
   */
  it('sends the stored token and tenant, and never sets Content-Type', async () => {
    const promise = uploadWithProgress('/v2/podcasts/1/episodes', new FormData());
    await flush();

    expect(FakeXhr.last.headers.Authorization).toBe('Bearer tok-123');
    expect(FakeXhr.last.headers['X-Tenant-Slug']).toBe('hour-timebank');
    expect(FakeXhr.last.headers['X-Nexus-Mobile']).toBe('1');
    expect(Object.keys(FakeXhr.last.headers)).not.toContain('Content-Type');

    FakeXhr.last.respond(200, {});
    await promise;
  });

  it('falls back to the default community when no tenant is stored', async () => {
    mockStorage.get.mockImplementation(async (key: string) => (key === 'nexus_auth_token' ? 'tok-123' : null));
    const promise = uploadWithProgress('/v2/podcasts/1/episodes', new FormData());
    await flush();

    expect(FakeXhr.last.headers['X-Tenant-Slug']).toBe('default-community');
    FakeXhr.last.respond(200, {});
    await promise;
  });

  it('reports progress as a whole percentage', async () => {
    const onProgress = jest.fn();
    const promise = uploadWithProgress('/v2/podcasts/1/episodes', new FormData(), { onProgress });
    await flush();

    FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 200 });
    FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 200, total: 200 });
    // A length it cannot measure must not produce a bogus number.
    FakeXhr.last.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });

    expect(onProgress.mock.calls).toEqual([[13], [100]]);
    FakeXhr.last.respond(200, {});
    await promise;
  });

  it('surfaces the API error message rather than a generic failure', async () => {
    const promise = uploadWithProgress('/v2/podcasts/1/episodes', new FormData());
    await flush();
    FakeXhr.last.respond(422, { message: 'The audio file is too large.' });

    await expect(promise).rejects.toMatchObject({
      status: 422,
      message: 'The audio file is too large.',
    });
  });

  /**
   * Cancelling is not a failure: the studio keeps the filled-in form and the chosen
   * file so the member can retry, which it can only do if it can tell the two apart.
   */
  it('marks a cancelled upload with UPLOAD_ABORTED', async () => {
    const controller = new AbortController();
    const promise = uploadWithProgress('/v2/podcasts/1/episodes', new FormData(), { signal: controller.signal });
    await flush();

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(ApiResponseError);
    await promise.catch((error) => {
      expect(isUploadAborted(error)).toBe(true);
      expect(FakeXhr.last.aborted).toBe(true);
    });
  });

  it('does not even open a request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    FakeXhr.last = undefined as unknown as FakeXhr;

    const error = await uploadWithProgress('/v2/podcasts/1/episodes', new FormData(), { signal: controller.signal })
      .then(() => null, (rejection: unknown) => rejection);

    expect(isUploadAborted(error)).toBe(true);
    expect(FakeXhr.last).toBeUndefined();
  });

  it('reports a network drop and a timeout distinctly', async () => {
    const dropped = uploadWithProgress('/v2/podcasts/1/episodes', new FormData());
    await flush();
    FakeXhr.last.onerror?.();
    await expect(dropped).rejects.toMatchObject({ status: 0 });

    const timedOut = uploadWithProgress('/v2/podcasts/1/episodes', new FormData());
    await flush();
    FakeXhr.last.ontimeout?.();
    await expect(timedOut).rejects.toMatchObject({ status: 0 });
  });
});
