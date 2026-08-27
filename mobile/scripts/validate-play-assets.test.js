// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { validatePlayAssets, validateScreenshotMeta } = require('./validate-play-assets.cjs');

describe('Google Play image-asset validation', () => {
  it('accepts every committed store image', () => {
    expect(validatePlayAssets().problems).toEqual([]);
  });

  it('rejects the original 1080×2400 phone ratio', () => {
    expect(validateScreenshotMeta({ width: 1080, height: 2400, bitDepth: 8, colorType: 2 }))
      .toContain('longest edge must not exceed twice the shortest edge');
  });

  it('rejects an alpha channel even when every pixel happens to be opaque', () => {
    expect(validateScreenshotMeta({ width: 1080, height: 1920, bitDepth: 8, colorType: 6 }))
      .toContain('must be a 24-bit RGB PNG with no alpha channel');
  });

  it('accepts the prepared 9:16 24-bit shape', () => {
    expect(validateScreenshotMeta({ width: 1080, height: 1920, bitDepth: 8, colorType: 2 }))
      .toEqual([]);
  });

  it('rejects a tablet capture that has not been framed to Play\'s 9:16 ratio', () => {
    expect(validateScreenshotMeta({ width: 1200, height: 1920, bitDepth: 8, colorType: 2 }))
      .toContain('must use the 9:16 or 16:9 aspect ratio required by the Play listing editor');
  });
});
