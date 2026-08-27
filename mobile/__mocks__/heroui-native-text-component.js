// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// Stub for heroui-native's TextComponentContext.
// Provides a default textProps value so HeroText / Button.Label work without
// HeroUINativeProvider in the test tree.

'use strict';

const NOOP_PROVIDER = ({ children, value }) => children;

module.exports = {
  // useTextComponent returns { textProps: undefined } — components use it safely
  useTextComponent: () => ({ textProps: undefined }),
  TextComponentProvider: NOOP_PROVIDER,
  default: NOOP_PROVIDER,
};
