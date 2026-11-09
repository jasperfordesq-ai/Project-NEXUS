// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

/** 05:00–11:59 morning, 12:00–17:59 afternoon, otherwise evening — in the member's own time. */
export function partOfDay(now: Date = new Date()): PartOfDay {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * "Good morning, Maeve" / "Good afternoon" — a greeting for the time of day
 * (AWID: warmth). Shared by the welcome panels so every page greets the same
 * way. Translations live in common.json under `greeting`.
 */
export function useGreeting(firstName?: string | null): string {
  const { t } = useTranslation('common');
  const name = firstName?.trim();
  const part = partOfDay();
  if (name) {
    if (part === 'morning') return t('greeting.morning', { name });
    if (part === 'afternoon') return t('greeting.afternoon', { name });
    return t('greeting.evening', { name });
  }
  if (part === 'morning') return t('greeting.morning_generic');
  if (part === 'afternoon') return t('greeting.afternoon_generic');
  return t('greeting.evening_generic');
}
