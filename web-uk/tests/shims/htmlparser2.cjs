// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// Test-only shim, wired in via jest.config.js `moduleNameMapper`.
//
// sanitize-html 2.17.7 (the release that closes CVE-2026-63670 and
// CVE-2026-84371) depends on htmlparser2 ^12, which ships as an ES module
// only. The production runtime is fine: web-uk runs on Node 22, and Node
// 22.12+ can `require()` an ES module natively. Jest's own module loader
// cannot, so every suite that touches the sanitiser failed with
// "Cannot use import statement outside a module".
//
// Rather than revert the security fix or bolt a Babel pipeline onto a
// plain-CommonJS project, this shim hands the single problematic package to
// Node's real `require` — the same loader production uses — and re-exports
// the result. Nothing else about module resolution changes.
'use strict';

// NOT `require('node:module')`: inside Jest that returns Jest's own `module`,
// whose createRequire() is Jest's loader — it applies moduleNameMapper, maps
// 'htmlparser2' straight back to this file, and the circular load yields {}.
// process.getBuiltinModule() (Node 22.3+) reaches the real Node loader.
const nodeModule = typeof process.getBuiltinModule === 'function'
  ? process.getBuiltinModule('node:module')
  : require('node:module');

module.exports = nodeModule.createRequire(__filename)('htmlparser2');
