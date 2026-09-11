// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockFetch = jest.fn();
global.fetch = mockFetch;
const api = require('../src/lib/api');

function response(cookie) {
  return { ok: true, headers: { get: (name) => name === 'content-type' ? 'application/json' : cookie },
    json: async () => ({ success: true, access_token: 'access', refresh_token: 'refresh' }) };
}

beforeEach(() => mockFetch.mockReset());

it('retains only the opaque trusted cookie and forwards it on the next login', async () => {
  mockFetch.mockResolvedValueOnce(response('unrelated=private; Path=/, nexus_trusted_device=opaque%3D; HttpOnly; Secure'));
  const result = await api.verify2fa('challenge', '123456', 'hour-timebank', { trustDevice: true });
  expect(result.trusted_device_cookie).toBe('opaque%3D');
  expect(JSON.stringify(result)).not.toContain('opaque');
  mockFetch.mockResolvedValueOnce(response(''));
  await api.login('member@example.test', 'password', 'hour-timebank', result.trusted_device_cookie);
  expect(mockFetch.mock.calls[1][1].headers.Cookie).toBe('nexus_trusted_device=opaque%3D');
});

it('does not capture trust when the member did not request it', async () => {
  mockFetch.mockResolvedValueOnce(response('nexus_trusted_device=opaque; HttpOnly'));
  expect((await api.verify2fa('challenge', '123456', 'hour-timebank')).trusted_device_cookie).toBeUndefined();
});

it('rejects cookie-header injection in stored trust input', async () => {
  mockFetch.mockResolvedValueOnce(response(''));
  await api.login('member@example.test', 'password', 'hour-timebank', 'opaque; another=value');
  expect(mockFetch.mock.calls[0][1].headers.Cookie).toBeUndefined();
});
