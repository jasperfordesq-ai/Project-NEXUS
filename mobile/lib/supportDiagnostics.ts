// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Platform } from 'react-native';
import i18n from 'i18next';

import { APP_VERSION } from '@/lib/constants';

/**
 * The technical details a "Something isn't working" request may carry, when the
 * member leaves the box ticked.
 *
 * 🔴 This is an ALLOW-list, not a scrubber. Every field is something a member
 * could read off their own phone and would not mind a support worker seeing:
 * which app version, which operating system, which language. Nothing here can
 * identify the member or their device.
 *
 * Never add: the access or refresh token, the member's email or id, the push
 * token, an installation / advertising / device id, the community slug (the
 * server already knows it), an IP address, or a screen's URL parameters (that is
 * where reset and sign-in tokens travel — finding F-281 on the web). The server
 * redacts some of these as a backstop; it is not the first line.
 *
 * The form shows the member these exact values before they send, so what they
 * agree to and what is sent cannot drift apart.
 */
export interface SupportDiagnostics {
  client: 'native_app';
  platform: string;
  os_version: string;
  app_version: string;
  language: string;
}

export function getSupportDiagnostics(): SupportDiagnostics {
  return {
    client: 'native_app',
    platform: Platform.OS,
    os_version: String(Platform.Version ?? ''),
    app_version: APP_VERSION,
    language: String(i18n.resolvedLanguage || i18n.language || ''),
  };
}

/**
 * The phone's system as a member would recognise it: "iOS 17.4", or
 * "Android (API 34)" — React Native reports Android's API level, not the
 * marketing version, and calling level 34 "Android 34" would be wrong.
 */
export function describeSupportSystem(diagnostics: SupportDiagnostics): string {
  const version = diagnostics.os_version.trim();
  if (diagnostics.platform === 'ios') return version ? `iOS ${version}` : 'iOS';
  if (diagnostics.platform === 'android') return version ? `Android (API ${version})` : 'Android';
  return [diagnostics.platform, version].filter(Boolean).join(' ');
}
