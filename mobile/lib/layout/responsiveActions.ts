// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ViewStyle } from 'react-native';

/**
 * Give action rows a definite width that HeroUI's animated button wrapper cannot
 * collapse. Large text and very narrow windows become a single readable column.
 */
export function responsiveActionStyle(width: number, fontScale: number): ViewStyle {
  return {
    flexBasis: width < 320 || fontScale > 1.3 ? '100%' : '47%',
    flexGrow: 1,
  };
}
