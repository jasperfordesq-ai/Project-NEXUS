// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Import the i18next singleton directly — NOT '@/lib/i18n'. The app entry
// initialises that module anyway, and importing it here would drag the full
// i18next init into every unit test that renders a date (react-i18next is
// mocked in tests, so the init crashes the suite).
import * as Localization from 'expo-localization';
import i18n from 'i18next';

/**
 * Locale for Date/Intl formatting that follows the language the user picked
 * in Settings rather than the device locale.
 *
 * Passing 'default' (or nothing) to toLocaleDateString/Intl.DateTimeFormat
 * uses the OS locale — so a user who switched the app to Spanish would still
 * see English/German dates. Always pass this instead.
 */
export function dateLocale(): string {
  const language = i18n.language || 'en';

  // A tag that already carries a region ('pt-BR') is left alone — the member's choice wins.
  if (language.includes('-')) return language;

  /**
   * 🔴 A bare language code has no region, and `Intl` then picks the language's default one.
   * For English that is the **United States**: measured 2026-08-25, `'en'` renders
   * 17 August 2026 as **8/17/2026**, while `en-IE` gives 17/8/2026 and `en-GB` 17/08/2026.
   *
   * So every English-speaking member of an Ireland- and UK-centred platform was reading
   * American dates — spotted in a listing card while capturing store screenshots, which is
   * the only way something this quiet gets noticed.
   *
   * Taking the region from the DEVICE keeps the original intent of this helper intact: the
   * language still follows what the member chose in Settings, so switching the app to Spanish
   * still gives Spanish month names — now with the date order of wherever they actually are.
   */
  const region = Localization.getLocales()[0]?.regionCode;
  return region ? `${language}-${region}` : language;
}
