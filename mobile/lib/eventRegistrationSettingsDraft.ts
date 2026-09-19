// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { registrationSettingsInputSchema, type OrganizerRegistrationSettings, type RegistrationSettingsInput } from './api/eventRegistration';
import { eventIsoToLocalInput, eventLocalInputToIso, isValidTimeZone } from './utils/eventDateTime';

export interface RegistrationSettingsDraft {
  approval: 'auto' | 'manual';
  opens: string; closes: string; cutoff: string;
  memberLimit: string; guests: boolean; maxGuests: string; retentionDays: string;
}
export function registrationSettingsDraft(settings: OrganizerRegistrationSettings | null, timezone: string): RegistrationSettingsDraft {
  return {
    approval: settings?.approval_mode ?? 'auto',
    opens: eventIsoToLocalInput(settings?.opens_at_utc, timezone),
    closes: eventIsoToLocalInput(settings?.closes_at_utc, timezone),
    cutoff: eventIsoToLocalInput(settings?.cancellation_cutoff_at_utc, timezone),
    memberLimit: String(settings?.per_member_limit ?? 1), guests: settings?.guests_enabled ?? false,
    maxGuests: String(settings?.guests_enabled ? settings.max_guests_per_registration : 1),
    retentionDays: String(settings?.guest_retention_days ?? 30),
  };
}
/** Returns null on invalid input; preserves exact unchanged instants, including DST overlaps. */
export function registrationSettingsPayload(draft: RegistrationSettingsDraft, settings: OrganizerRegistrationSettings | null,
  timezone: string, eventStart: string, recovered?: RegistrationSettingsInput): RegistrationSettingsInput | null {
  if (!isValidTimeZone(timezone) || !Number.isFinite(Date.parse(eventStart))) return null;
  const date = (typed: string, original: string | null | undefined, restored: string | null | undefined) => {
    const value = typed.trim();
    if (!value) return null;
    if (restored && value === eventIsoToLocalInput(restored, timezone)) return restored;
    if (original && value === eventIsoToLocalInput(original, timezone)) return original;
    return eventLocalInputToIso(value.replace(' ', 'T'), timezone) ?? undefined;
  };
  const opens = date(draft.opens, settings?.opens_at_utc, recovered?.opens_at_utc);
  const closes = date(draft.closes, settings?.closes_at_utc, recovered?.closes_at_utc);
  const cutoff = date(draft.cutoff, settings?.cancellation_cutoff_at_utc, recovered?.cancellation_cutoff_at_utc);
  if ([opens, closes, cutoff].some(value => value === undefined)
    || [closes, cutoff].some(value => value && Date.parse(value) > Date.parse(eventStart))) return null;
  const integer = (value: string) => /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  const parsed = registrationSettingsInputSchema.safeParse({
    approval_mode: draft.approval, opens_at_utc: opens, closes_at_utc: closes,
    cancellation_cutoff_at_utc: cutoff, per_member_limit: integer(draft.memberLimit),
    guests_enabled: draft.guests, max_guests_per_registration: draft.guests ? integer(draft.maxGuests) : 0,
    guest_retention_days: integer(draft.retentionDays), expected_revision: settings?.revision ?? 0,
  });
  return parsed.success ? parsed.data : null;
}
