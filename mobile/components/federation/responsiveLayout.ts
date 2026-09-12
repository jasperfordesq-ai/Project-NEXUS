// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ViewStyle } from 'react-native';

/** Keep action labels readable instead of allowing flexbox to squeeze a whole row together. */
export function responsiveFederationActionStyle(width: number, fontScale: number): ViewStyle {
  return {
    flexBasis: width < 320 || fontScale > 1.3 ? '100%' : '47%',
    flexGrow: 1,
  };
}
