// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// Stub for heroui-native's GlobalAnimationSettingsContext.
// Returned by moduleNameMapper when no HeroUINativeProvider is in the test tree.

'use strict';

const NOOP_PROVIDER = ({ children }) => children;

module.exports = {
  useGlobalAnimationSettings: () => ({ globalIsAllAnimationsDisabled: false }),
  GlobalAnimationSettingsProviderComponent: NOOP_PROVIDER,
  default: NOOP_PROVIDER,
};
