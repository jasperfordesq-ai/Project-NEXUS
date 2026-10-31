// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// In the app, require('./x.txt') is a bundled file (metro.config.js assetExts).
// In tests it is the file's own text, which jest-setup's readBundledText mock
// hands straight back, so the word-list loader runs against the real lists.
module.exports = {
  process(source) {
    return { code: `module.exports = ${JSON.stringify(source)};` };
  },
};
