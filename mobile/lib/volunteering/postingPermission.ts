// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Who may publish a volunteering opportunity.
 *
 * 🔴 This lives in one place because TWO screens have to agree about it, and they did
 * not. `new-volunteering.tsx` owned the rule privately and used it correctly: with no
 * qualifying organisation it disables the submit button and says "You need an approved
 * organisation before posting opportunities."
 *
 * The volunteering hub offered a prominent "Create opportunity" pill to everyone — and
 * it already fetched `getMyOrganisations()` on the same screen, so it had the answer and
 * ignored it. A member with no organisation could tap it, fill the whole form in, and
 * find the button dead at the bottom. Found on 2026-08-20 while walking the two-account
 * volunteering journey; it is the same shape as the feed defect the owner reported the
 * same week — an action offered where nothing is behind it.
 *
 * Duplicating the predicate would have let the button and the form drift apart again, so
 * both now import this, and a guard test asserts there is exactly one definition.
 */

import type { VolunteeringOrganisation } from '@/lib/api/volunteering';

/** Organisation states that may publish. `active` is the legacy spelling of `approved`. */
const POSTING_STATUSES = ['approved', 'active'];
/** Membership roles that may publish on the organisation's behalf. */
const POSTING_ROLES = ['owner', 'admin'];

export function canPostForOrganisation(org: VolunteeringOrganisation): boolean {
  return POSTING_STATUSES.includes(org.status ?? '') && POSTING_ROLES.includes(org.member_role ?? '');
}

/** True when the signed-in member manages at least one organisation that may publish. */
export function canPostAnyOpportunity(organisations: VolunteeringOrganisation[] | undefined): boolean {
  return (organisations ?? []).some(canPostForOrganisation);
}
