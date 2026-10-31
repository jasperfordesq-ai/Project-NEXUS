// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';

export interface BadgeCopySource {
  name?: string;
  description?: string | null;
  name_code?: string | null;
  description_code?: string | null;
}

/** Small member catalogue; intentional custom overrides have no translation code. */
export function useBadgeCopy() {
  const { t } = useTranslation('badge_copy');
  return {
    badgeName: (badge: BadgeCopySource): string => badge.name_code
      ? t(badge.name_code, { defaultValue: badge.name ?? '' }) : badge.name ?? '',
    badgeDescription: (badge: BadgeCopySource): string => badge.description_code
      ? t(badge.description_code, { defaultValue: badge.description ?? '' }) : badge.description ?? '',
  };
}
