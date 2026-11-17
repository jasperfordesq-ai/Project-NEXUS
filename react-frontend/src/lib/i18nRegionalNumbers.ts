// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { i18n as I18nInstance } from 'i18next';
import { getFormattingLocale } from '@/lib/helpers';

/**
 * Make i18next's built-in `number` format (`{{count, number}}` in the locale
 * files) use the same locale as every stand-alone number on screen:
 * getFormattingLocale(), the member's language plus the community's region.
 *
 * i18next 25 formats with the bare language code (`en`), which Intl reads as
 * the United States. The replacement goes in through the instance's own
 * formatter (`services.formatter.add`, see node_modules/i18next Formatter) and
 * calls getFormattingLocale() each time it formats, never once at start-up:
 * the community's region is only known after the tenant loads.
 *
 * The language i18next passes in is not used: getFormattingLocale() reads the
 * active language itself, which is what every stand-alone number uses too.
 * (helpers imports `@/i18n`, which imports this module; that cycle is safe
 * because helpers is only called at format time.)
 *
 * Only `number` is replaced: it is the only built-in format the locale files
 * use. Options written in the string (`number(minimumFractionDigits: 1)`) are
 * passed through as before.
 */
export function installRegionalNumberFormat(instance: I18nInstance): boolean {
  const formatter = instance.services?.formatter;
  if (!formatter) {
    return false;
  }

  formatter.add('number', (value: unknown, _lng: string | undefined, options: Intl.NumberFormatOptions) =>
    // i18next passes its own interpolation options alongside the format's; Intl
    // ignores keys it does not know, as i18next's built-in formatter relies on.
    new Intl.NumberFormat(getFormattingLocale(), { ...options }).format(value as number),
  );

  return true;
}
