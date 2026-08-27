// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// DEPRECATED — this file is superseded by metro.config.js which adds
// withUniwindConfig (NativeWind CSS transformer) and the heroui-native
// ESM transformIgnorePatterns allowlist.
//
// Metro resolves metro.config.js before metro.config.cjs, so this file
// is never loaded in normal operation. It is kept only for tooling that
// explicitly requires a .cjs extension; in that case it delegates to the
// canonical config.

module.exports = require('./metro.config.js');
