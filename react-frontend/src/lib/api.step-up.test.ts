// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Security register E-085: when the server refuses a high-risk staff action
 * with AUTH_STEP_UP_REQUIRED, the client asks once for a fresh second factor
 * and replays the request with the confirmation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type ApiModule = typeof import('./api');

function stepUpRefusal(): Response {
  return {
    ok: false,
    status: 403,
    headers: new Headers(),
    json: () => Promise.resolve({
      success: false,
      code: 'AUTH_STEP_UP_REQUIRED',
      errors: [{ code: 'AUTH_STEP_UP_REQUIRED', message: 'Confirm that it is you.', field: 'security_confirmation' }],
    }),
  } as Response;
}

function ok(data: unknown = { done: true }): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve({ success: true, data }),
  } as Response;
}

function sentConfirmation(call: number): string | null {
  const init = vi.mocked(fetch).mock.calls[call]?.[1];
  return (init?.headers as Headers | undefined)?.get('X-Security-Confirmation') ?? null;
}

describe('step-up retry', () => {
  let mod: ApiModule;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    mod = await import('./api');
    mod.tokenManager.adoptSession('admin-access', null, '2', 'test-binding');
  });

  afterEach(() => {
    mod.setStepUpHandler(null);
    mod.clearStepUpConfirmation();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('asks for a code once and replays the request with the confirmation', async () => {
    const handler = vi.fn().mockResolvedValue({ token: 'proof-1', expiresIn: 300 });
    mod.setStepUpHandler(handler);
    vi.mocked(fetch).mockResolvedValueOnce(stepUpRefusal()).mockResolvedValueOnce(ok());

    const result = await mod.api.post('/v2/admin/users/7/ban', { reason: 'Repeated abuse' });

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sentConfirmation(0)).toBeNull();
    expect(sentConfirmation(1)).toBe('proof-1');
    const replayed = vi.mocked(fetch).mock.calls[1]?.[1];
    expect(replayed?.method).toBe('POST');
    expect(replayed?.body).toBe(JSON.stringify({ reason: 'Repeated abuse' }));
  });

  it('reuses a confirmation still in date without asking again', async () => {
    const handler = vi.fn().mockResolvedValue({ token: 'proof-2', expiresIn: 300 });
    mod.setStepUpHandler(handler);
    vi.mocked(fetch)
      .mockResolvedValueOnce(stepUpRefusal()).mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(stepUpRefusal()).mockResolvedValueOnce(ok());

    await mod.api.post('/v2/admin/users/7/ban', {});
    const second = await mod.api.post('/v2/admin/users/8/ban', {});

    expect(second.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(sentConfirmation(3)).toBe('proof-2');
  });

  it('asks again when a held confirmation is refused', async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce({ token: 'old-proof', expiresIn: 300 })
      .mockResolvedValueOnce({ token: 'new-proof', expiresIn: 300 });
    mod.setStepUpHandler(handler);
    vi.mocked(fetch)
      .mockResolvedValueOnce(stepUpRefusal()).mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(stepUpRefusal()).mockResolvedValueOnce(stepUpRefusal()).mockResolvedValueOnce(ok());

    await mod.api.post('/v2/admin/users/7/ban', {});
    const result = await mod.api.post('/v2/admin/users/8/ban', {});

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(sentConfirmation(3)).toBe('old-proof');
    expect(sentConfirmation(4)).toBe('new-proof');
  });

  it('returns the refusal unchanged when the person cancels', async () => {
    mod.setStepUpHandler(vi.fn().mockResolvedValue(null));
    vi.mocked(fetch).mockResolvedValueOnce(stepUpRefusal());

    const result = await mod.api.post('/v2/admin/users/7/ban', {});

    expect(result.success).toBe(false);
    expect(result.code).toBe('AUTH_STEP_UP_REQUIRED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never loops: a refusal after a fresh confirmation is returned', async () => {
    const handler = vi.fn().mockResolvedValue({ token: 'proof-3', expiresIn: 300 });
    mod.setStepUpHandler(handler);
    vi.mocked(fetch).mockResolvedValueOnce(stepUpRefusal()).mockResolvedValueOnce(stepUpRefusal());

    const result = await mod.api.post('/v2/admin/users/7/ban', {});

    expect(result.code).toBe('AUTH_STEP_UP_REQUIRED');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one prompt between requests refused at the same time', async () => {
    let release: (value: { token: string; expiresIn: number }) => void = () => undefined;
    const handler = vi.fn(() => new Promise<{ token: string; expiresIn: number }>((resolve) => { release = resolve; }));
    mod.setStepUpHandler(handler);
    vi.mocked(fetch)
      .mockResolvedValueOnce(stepUpRefusal()).mockResolvedValueOnce(stepUpRefusal())
      .mockResolvedValue(ok());

    const first = mod.api.post('/v2/admin/users/7/ban', {});
    const second = mod.api.post('/v2/admin/users/8/ban', {});
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    release({ token: 'shared-proof', expiresIn: 300 });

    expect((await first).success).toBe(true);
    expect((await second).success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('leaves an unrelated 403 alone', async () => {
    const handler = vi.fn();
    mod.setStepUpHandler(handler);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: () => Promise.resolve({ success: false, errors: [{ code: 'AUTH_INSUFFICIENT_PERMISSIONS', message: 'No.' }] }),
    } as Response);

    const result = await mod.api.post('/v2/admin/users/7/ban', {});

    expect(result.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
    expect(handler).not.toHaveBeenCalled();
  });
});
