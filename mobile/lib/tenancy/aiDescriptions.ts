// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { AiDescriptionAvailability, TenantConfig } from '@/lib/api/tenant';

export type AiDescriptionSurface = keyof AiDescriptionAvailability;

/**
 * Whether a "Generate description" AI button may be shown for `surface`.
 *
 * 🔴 Hidden unless the server says exactly `true`. The tenant bootstrap's
 * `ai_descriptions` object (App\Services\AI\AiDescriptionAvailability) already
 * folds in the community's AI and Content generation switches, the area's own
 * switch (for example `listing.enable_ai_descriptions`) and whether the
 * community's own OpenAI key is saved and not refused for lack of credit — all
 * off by default (owner decision, 8 Nov 2026) — so nothing else is read here. A community that has not
 * loaded, an older server that never sends the object, a missing key, or anything
 * that is not the boolean `true` all mean the button is not rendered.
 *
 * A plain function over the tenant object rather than a context method on
 * purpose: screen tests mock `useTenant` with only the fields their screen reads,
 * and a missing method would crash the render, whereas a missing field simply
 * leaves the button hidden.
 */
export function aiDescriptionAvailable(
  tenant: Pick<TenantConfig, 'ai_descriptions'> | null | undefined,
  surface: AiDescriptionSurface,
): boolean {
  return tenant?.ai_descriptions?.[surface] === true;
}
