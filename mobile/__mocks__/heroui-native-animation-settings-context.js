// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// Stub for heroui-native's AnimationSettingsContext (parent/tree animation cascading).

'use strict';

module.exports = {
  useAnimationSettings: () => ({ isAllAnimationsDisabled: false }),
  AnimationSettingsProvider: ({ children }) => children,
};
