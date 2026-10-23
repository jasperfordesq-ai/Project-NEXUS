// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockFetch = jest.fn();
global.fetch = mockFetch;
const api = require('../src/lib/api');
const {
  rememberTrustedDevice,
  trustedDeviceCookiesFrom,
  clearTrustedDeviceCookies
} = require('../src/lib/trusted-device-cookies');

const ALICE = `__Host-nexus_td_${'a'.repeat(24)}`;
const BOB = `__Host-nexus_td_${'b'.repeat(24)}`;
const TOKEN_A = '1'.repeat(64);
const TOKEN_B = '2'.repeat(64);

function response(cookie) {
  return { ok: true, headers: { get: (name) => name === 'content-type' ? 'application/json' : cookie },
    json: async () => ({ success: true, access_token: 'access', refresh_token: 'refresh' }) };
}

function fakeRes() {
  const set = [];
  const cleared = [];
  return {
    set,
    cleared,
    cookie: (name, value, options) => set.push({ name, value, options }),
    clearCookie: (name, options) => cleared.push({ name, options })
  };
}

beforeEach(() => mockFetch.mockReset());

it('retains only the opaque per-account cookie and forwards it on the next login', async () => {
  mockFetch.mockResolvedValueOnce(response(`unrelated=private; Path=/, ${ALICE}=${TOKEN_A}; Path=/; HttpOnly; Secure; SameSite=Lax`));
  const result = await api.verify2fa('challenge', '123456', 'hour-timebank', { trustDevice: true });
  expect(result.trusted_device_cookie).toEqual({ name: ALICE, value: TOKEN_A });
  expect(JSON.stringify(result)).not.toContain(TOKEN_A);

  mockFetch.mockResolvedValueOnce(response(''));
  await api.login('member@example.test', 'password', 'hour-timebank', [result.trusted_device_cookie]);
  expect(mockFetch.mock.calls[1][1].headers.Cookie).toBe(`${ALICE}=${TOKEN_A}`);
});

it('still captures the single cookie Laravel set before 23 Oct 2026', async () => {
  mockFetch.mockResolvedValueOnce(response('nexus_trusted_device=opaque%3D; HttpOnly; Secure'));
  const result = await api.verify2fa('challenge', '123456', 'hour-timebank', { trustDevice: true });
  expect(result.trusted_device_cookie).toEqual({ name: 'nexus_trusted_device', value: 'opaque%3D' });
});

it('does not capture trust when the member did not request it', async () => {
  mockFetch.mockResolvedValueOnce(response(`${ALICE}=${TOKEN_A}; HttpOnly`));
  expect((await api.verify2fa('challenge', '123456', 'hour-timebank')).trusted_device_cookie).toBeUndefined();
});

it('rejects cookie-header injection in stored trust input', async () => {
  mockFetch.mockResolvedValueOnce(response(''));
  await api.login('member@example.test', 'password', 'hour-timebank', [
    { name: ALICE, value: 'opaque; another=value' },
    { name: 'session; evil', value: TOKEN_A },
    'nexus_trusted_device=opaque'
  ]);
  expect(mockFetch.mock.calls[0][1].headers.Cookie).toBeUndefined();
});

it('keeps a separate cookie for each trusted account, so the second never overwrites the first', () => {
  const res = fakeRes();
  expect(rememberTrustedDevice(res, { name: ALICE, value: TOKEN_A }, 30)).toBe(true);
  expect(rememberTrustedDevice(res, { name: BOB, value: TOKEN_B }, 30)).toBe(true);
  expect(res.set.map((c) => c.name)).toEqual([`nexus_trusted_${'a'.repeat(24)}`, `nexus_trusted_${'b'.repeat(24)}`]);
  expect(res.set[0].options).toMatchObject({ httpOnly: true, signed: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400000 });

  const req = { signedCookies: {
    [`nexus_trusted_${'a'.repeat(24)}`]: TOKEN_A,
    [`nexus_trusted_${'b'.repeat(24)}`]: TOKEN_B,
    nexus_trusted_device: 'legacy',
    token: 'not-a-device-cookie'
  } };
  expect(trustedDeviceCookiesFrom(req)).toEqual([
    { name: ALICE, value: TOKEN_A },
    { name: BOB, value: TOKEN_B },
    { name: 'nexus_trusted_device', value: 'legacy' }
  ]);
});

it('ignores anything that is not a captured trusted-device cookie', () => {
  const res = fakeRes();
  expect(rememberTrustedDevice(res, { name: 'token', value: TOKEN_A }, 30)).toBe(false);
  expect(rememberTrustedDevice(res, { name: `__Host-nexus_td_${'Z'.repeat(24)}`, value: TOKEN_A }, 30)).toBe(false);
  expect(rememberTrustedDevice(res, null, 30)).toBe(false);
  expect(res.set).toEqual([]);
});

it('forgetting devices clears every trusted cookie and the legacy one', () => {
  const res = fakeRes();
  clearTrustedDeviceCookies({ signedCookies: { [`nexus_trusted_${'a'.repeat(24)}`]: TOKEN_A, token: 'x' } }, res);
  expect(res.cleared.map((c) => c.name).sort()).toEqual([`nexus_trusted_${'a'.repeat(24)}`, 'nexus_trusted_device'].sort());
  expect(res.cleared[0].options).toMatchObject({ httpOnly: true, signed: true, sameSite: 'lax', path: '/' });
  expect(res.cleared[0].options.maxAge).toBeUndefined();
});
