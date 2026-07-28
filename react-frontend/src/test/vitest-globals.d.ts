// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// vitest.config.ts sets `globals: true`, so test files call describe/it/expect
// without importing them. Those globals are declared by `vitest/globals`, which
// is NOT under node_modules/@types and so is never auto-included.
//
// This reference — rather than a `"types"` array in tsconfig.tests.json — is
// deliberate. Setting `"types"` REPLACES automatic @types inclusion, which
// silently dropped @types/google.maps and made 29 errors appear in four
// application files that the app type-check passes cleanly (`Cannot find
// namespace 'google'`). Test files must be checked in the same type environment
// as the app, or the ratchet baselines artefacts of its own configuration.
/// <reference types="vitest/globals" />
