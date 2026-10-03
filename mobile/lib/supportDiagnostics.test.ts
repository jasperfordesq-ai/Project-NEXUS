// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/constants', () => ({ APP_VERSION: '1.8.1' }));

import { Platform } from 'react-native';

import { describeSupportSystem, getSupportDiagnostics } from './supportDiagnostics';

describe('support diagnostics', () => {
  it('carries only the five harmless fields, nothing that identifies the member or the phone', () => {
    const diagnostics = getSupportDiagnostics();

    // An allow-list: a new field must be added here deliberately, after asking whether a
    // support worker should see it.
    expect(Object.keys(diagnostics).sort()).toEqual(['app_version', 'client', 'language', 'os_version', 'platform']);
    expect(diagnostics.client).toBe('native_app');
    expect(diagnostics.app_version).toBe('1.8.1');
    expect(diagnostics.platform).toBe(Platform.OS);

    const serialised = JSON.stringify(diagnostics).toLowerCase();
    for (const forbidden of ['token', 'email', 'password', 'device', 'install', 'tenant', '@']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('names the system the way a member would recognise it', () => {
    const base = { client: 'native_app' as const, app_version: '1.8.1', language: 'en' };

    expect(describeSupportSystem({ ...base, platform: 'ios', os_version: '17.4' })).toBe('iOS 17.4');
    // React Native reports Android's API level; calling level 34 "Android 34" would be wrong.
    expect(describeSupportSystem({ ...base, platform: 'android', os_version: '34' })).toBe('Android (API 34)');
    expect(describeSupportSystem({ ...base, platform: 'android', os_version: '' })).toBe('Android');
  });
});
