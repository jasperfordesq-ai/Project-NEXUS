// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo } from 'react';
import { useSiteAccent } from '@/contexts/SiteAccentContext';
import { chartColorsFor, type ChartPalette } from '@/lib/chartColors';

/** Chart colours in the community's colours, following the theme (see `chartColorsFor`). */
export function useChartColors(): ChartPalette {
  const accent = useSiteAccent();
  return useMemo(() => chartColorsFor(accent), [accent]);
}
