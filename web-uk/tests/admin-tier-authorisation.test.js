// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// F-498: `requireAdmin` authorised on the role STRING only
// (`user.role !== 'admin' && user.role !== 'super_admin'`). `super_admin`,
// `god`, `tenant_admin` and `coordinator` are never written to `users.role` —
// they are boolean flags — so the second test could never be the discriminator
// it was written to be, and a network or platform administrator whose stored
// role is `member` was refused.
//
// Worse, the only thing it had to read was `/api/auth/validate-token`, whose
// response (AuthController::validateToken) carries `user_id`, `tenant_id`,
// `type`, `expires_at`, `time_remaining` and `needs_refresh` — and NO role and
// no flags at all. So `user.role` was always undefined and the gate refused
// every tier, administrators included.
//
// The tier IS available to web-uk, from `GET /api/v2/users/me`
// (UserService::formatProfile private-fields block): `role`, `is_admin`,
// `is_super_admin`, `is_god`, `is_tenant_super_admin` — exactly the inputs
// `App\Support\Authorization\AdminTier::allows()` reads.
//
// These tests assert the CORRECT behaviour: they fail before the fix.

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  refreshToken: jest.fn(),
  validateToken: jest.fn(),
  getProfile: jest.fn()
}));

const api = require('../src/lib/api');
const { requireAdmin } = require('../src/middleware/auth');

// What AuthController::validateToken really answers: no role, no flags.
function tokenPayload() {
  return {
    success: true,
    valid: true,
    user_id: 4242,
    tenant_id: 2,
    type: 'access',
    expires_at: '2026-10-01T12:00:00+00:00',
    time_remaining: 900,
    needs_refresh: false
  };
}

// What GET /api/v2/users/me answers, in the envelope web-uk receives.
function profileEnvelope(overrides) {
  return {
    data: {
      id: 4242,
      role: 'member',
      is_admin: false,
      is_super_admin: false,
      is_tenant_super_admin: false,
      is_god: false,
      ...overrides
    },
    meta: {}
  };
}

function responseDouble() {
  const res = { render: jest.fn(), redirect: jest.fn(), clearCookie: jest.fn(), locals: {} };
  res.status = jest.fn(() => res);
  res.location = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

async function runGate(profileOverrides) {
  api.validateToken.mockResolvedValue(tokenPayload());
  api.getProfile.mockResolvedValue(profileEnvelope(profileOverrides));

  const req = { token: 'a-session-token', path: '/admin' };
  const res = responseDouble();
  const next = jest.fn();

  await requireAdmin(req, res, next);

  return { req, res, next };
}

describe('F-498 web-uk requireAdmin authorises on the admin tier, not the role string', () => {
  beforeEach(() => jest.clearAllMocks());

  it('admits a NETWORK administrator whose stored role string is member', async () => {
    const { res, next } = await runGate({ role: 'member', is_admin: true, is_tenant_super_admin: true });

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.render).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('admits a PLATFORM super administrator whose stored role string is member', async () => {
    const { res, next } = await runGate({ role: 'member', is_admin: true, is_super_admin: true });

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(next).toHaveBeenCalledWith();
  });

  it('admits a tenant_admin, a role string the old test did not list', async () => {
    const { res, next } = await runGate({ role: 'tenant_admin', is_admin: true });

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(next).toHaveBeenCalledWith();
  });

  it('CONTROL: still admits a plain admin', async () => {
    const { res, next } = await runGate({ role: 'admin', is_admin: true });

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(next).toHaveBeenCalledWith();
  });

  it('CONTROL: refuses a broker, even with a stale admin flag on the account', async () => {
    const { res, next } = await runGate({ role: 'broker', is_admin: true });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('errors/403', expect.any(Object));
    expect(next).not.toHaveBeenCalled();
  });

  it('CONTROL: refuses a coordinator', async () => {
    const { res, next } = await runGate({ role: 'coordinator' });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('CONTROL: refuses an ordinary member', async () => {
    const { res, next } = await runGate({ role: 'member' });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('CONTROL: an expired session still redirects to sign in rather than rendering 403', async () => {
    api.validateToken.mockResolvedValue(tokenPayload());
    api.getProfile.mockRejectedValue(new api.ApiError('Unauthorised', 401));

    const req = { token: 'an-expired-token', path: '/admin' };
    const res = responseDouble();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(res.render).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
