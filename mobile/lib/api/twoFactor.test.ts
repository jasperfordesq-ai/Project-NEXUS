// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import {
  beginTwoFactorSetupFromSession,
  buildOtpAuthUri,
  confirmSecurityWithPassword,
  formatSetupKey,
  getTwoFactorStatus,
  verifyTwoFactorSetupFromSession,
} from './twoFactor';

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe('two-factor API from a signed-in session', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the status envelope', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: { enabled: false, enrollment_allowed: true, enforcement_required: false, setup_required: false, backup_codes_remaining: 0 } });
    await expect(getTwoFactorStatus()).resolves.toEqual(expect.objectContaining({ enabled: false, enrollment_allowed: true }));
    expect(api.get).toHaveBeenCalledWith('/api/v2/auth/2fa/status');
  });

  it('confirms the password at the security-confirm endpoint and returns the token', async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: { security_confirmation_token: 'fresh', expires_in: 300 } });
    await expect(confirmSecurityWithPassword('secret-pass')).resolves.toBe('fresh');
    expect(api.post).toHaveBeenCalledWith('/api/webauthn/security-confirm', { current_password: 'secret-pass' });
  });

  it('refuses to carry on without a confirmation token (F-170)', async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: {} });
    await expect(confirmSecurityWithPassword('secret-pass')).rejects.toThrow();
  });

  it('sends the confirmation token to setup and verify, with the bearer session (not anonymous)', async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { qr_code_url: 'data:x', secret: 'ABC', backup_codes: [] } })
      .mockResolvedValueOnce({ data: { backup_codes: ['ONE', 'TWO'] } });

    await expect(beginTwoFactorSetupFromSession('fresh')).resolves.toEqual(expect.objectContaining({ secret: 'ABC' }));
    await expect(verifyTwoFactorSetupFromSession('123456', 'fresh')).resolves.toEqual({ backup_codes: ['ONE', 'TWO'] });

    expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/auth/2fa/setup', { security_confirmation_token: 'fresh' });
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/auth/2fa/verify', { code: '123456', security_confirmation_token: 'fresh' });
  });

  it('builds the otpauth link the way the server does, with issuer and label encoded', () => {
    expect(buildOtpAuthUri('jbsw y3dp', 'alex+test@example.org')).toBe(
      'otpauth://totp/Project%20NEXUS%3Aalex%2Btest%40example.org?secret=JBSWY3DP&issuer=Project%20NEXUS',
    );
    expect(buildOtpAuthUri('JBSWY3DP', null)).toBe('otpauth://totp/Project%20NEXUS?secret=JBSWY3DP&issuer=Project%20NEXUS');
    expect(buildOtpAuthUri('JBSWY3DP', 'a:b', 'My Org & Co')).toBe(
      'otpauth://totp/My%20Org%20%26%20Co%3Aa%3Ab?secret=JBSWY3DP&issuer=My%20Org%20%26%20Co',
    );
  });

  it('groups the key in fours for typing by hand', () => {
    expect(formatSetupKey('jbswy3dpehpk3pxp')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(formatSetupKey('ABCDEF')).toBe('ABCD EF');
  });
});
