// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Plain words for a volunteering safeguarding incident's status, as the person
 * who reported it and the organisation see it. Staff screens keep the working
 * words ("Under investigation", "Escalated"); members are told what it means
 * for them. Keys live in the `volunteering` namespace.
 */

export type IncidentStatus = 'open' | 'investigating' | 'escalated' | 'resolved' | 'closed';

export const MEMBER_STATUS_KEY: Record<IncidentStatus, string> = {
  open: 'safeguarding.member_status.received',
  investigating: 'safeguarding.member_status.looking_into',
  escalated: 'safeguarding.member_status.specialist',
  resolved: 'safeguarding.member_status.dealt_with',
  closed: 'safeguarding.member_status.closed',
};

/** The translation key for a status, falling back to "received" for an unknown value. */
export function memberStatusKey(status: string): string {
  return MEMBER_STATUS_KEY[status as IncidentStatus] ?? MEMBER_STATUS_KEY.open;
}
