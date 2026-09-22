// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { loadCreationDraft, type CreationDraftScope } from './creationDraftStore';

/** Resolve existing aliases without copying, deleting or merging unsent content. */
export async function resolveMessageDraftScope<T>(
  canonical: CreationDraftScope,
  legacy: CreationDraftScope | null,
  preferLegacyOnConflict: boolean,
): Promise<{ scope: CreationDraftScope; draft: T | null }> {
  const [draft, legacyDraft] = await Promise.all([
    loadCreationDraft<T>(canonical),
    legacy ? loadCreationDraft<T>(legacy) : Promise.resolve(null),
  ]);
  if (legacy && legacyDraft !== null && (draft === null || preferLegacyOnConflict)) {
    return { scope: legacy, draft: legacyDraft };
  }
  return { scope: canonical, draft };
}
