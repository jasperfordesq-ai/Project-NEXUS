// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { TFunction } from 'i18next';
import { formatNumber, getFormattingLocale } from '@/lib/helpers';

/** "about 7 minutes", in the admin's language: the welcome-invitation estimates are rough by nature. */
export function aboutMinutes(t: TFunction, minutes: number): string {
  return t('member_import.about_minutes', { count: minutes, minutes: formatNumber(minutes) });
}

/** Hours as the server reports them ("1234.50"), grouped and spaced the way the admin's language does. */
export function formatHours(value: string): string {
  const hours = Number(value);
  return Number.isFinite(hours) ? formatNumber(hours, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value;
}

function unit(count: number, name: 'second' | 'minute' | 'hour'): string {
  return new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: name, unitDisplay: 'long' }).format(count);
}

/**
 * A rough, rounded-up time left in the admin's language ("45 seconds", "7 minutes").
 * Rounded up and never below five seconds: a precise-looking figure would promise more than a
 * running estimate can keep.
 */
export function formatTimeLeft(seconds: number): string {
  if (seconds < 60) return unit(Math.max(5, Math.ceil(seconds / 5) * 5), 'second');
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 120 ? unit(minutes, 'minute') : unit(Math.ceil(minutes / 60), 'hour');
}
