// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Whether to show a "Generate description" (AI) button.
 *
 * The server decides, per community, in the tenant bootstrap's
 * `ai_descriptions` (App\Services\AI\AiDescriptionAvailability): the
 * community's AI and Content generation must be on, the area's own switch on,
 * and the community's own OpenAI key saved and not refused for lack of credit.
 * Every switch is off by default (owner decision, 8 Nov 2026).
 *
 * The button shows only when the flag is exactly `true`; a missing field (an
 * older server, a tenant still loading) hides it.
 */
export type AiDescriptionArea = 'listings' | 'jobs' | 'marketplace';

export interface AiDescriptionAvailability {
  listings?: boolean;
  jobs?: boolean;
  marketplace?: boolean;
}

export function aiDescriptionAvailable(
  tenant: { ai_descriptions?: AiDescriptionAvailability } | null | undefined,
  area: AiDescriptionArea,
): boolean {
  return tenant?.ai_descriptions?.[area] === true;
}
