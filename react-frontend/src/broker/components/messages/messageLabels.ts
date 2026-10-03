// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Labels and vocab shared by the Messages list, quick view and detail page,
 * so a copy reason or a flag severity is named the same way on every screen.
 */

import type { TFunction } from 'i18next';

export const FLAG_SEVERITIES = ['info', 'warning', 'concern', 'urgent'] as const;
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number];

/** Unknown or legacy severities (low…critical) read as a concern. */
export function normalizeSeverity(severity?: string | null): FlagSeverity {
  const s = (severity || '').toLowerCase();
  return (FLAG_SEVERITIES as readonly string[]).includes(s) ? (s as FlagSeverity) : 'concern';
}

/** Copy reasons are slugs (first_contact, random_sample…); show the translated label. */
export function copyReasonLabel(t: TFunction<'broker'>, reason: string | null | undefined): string {
  if (!reason) return '—';
  return t(`messages.copy_reason_${reason}`, { defaultValue: reason.replace(/_/g, ' ') });
}
