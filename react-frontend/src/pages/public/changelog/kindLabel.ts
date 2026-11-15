// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { TFunction } from 'i18next';

/**
 * The kinds of change CHANGELOG.md uses as `###` headings, which have a
 * translated name. A heading that is not in this list is shown as written.
 */
const KNOWN_KINDS = [
  'added',
  'changed',
  'fixed',
  'security',
  'removed',
  'deprecated',
  'documentation',
  'internal',
  'notes',
  'accessibility',
  'other',
] as const;

type KnownKind = (typeof KNOWN_KINDS)[number];

function isKnown(type: string): type is KnownKind {
  return (KNOWN_KINDS as readonly string[]).includes(type);
}

export function kindLabel(t: TFunction<'public'>, type: string, fallback: string): string {
  return isKnown(type) ? t(`changelog_page.types.${type}`) : fallback;
}
