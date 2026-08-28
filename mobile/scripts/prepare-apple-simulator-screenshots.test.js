// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { PNG } = require('pngjs');
const {
  ACCEPTED_PORTRAIT_SIZES,
  EXPECTED_SCREENSHOTS,
  convertOpaquePngToRgb,
  validateNativeSize,
} = require('./prepare-apple-simulator-screenshots.cjs');

describe('Apple Simulator screenshot preparation', () => {
  it('requires the complete eight-screen App Store story', () => {
    expect(EXPECTED_SCREENSHOTS).toEqual([
      '01-feed.png',
      '02-listings.png',
      '03-members.png',
      '04-messages.png',
      '05-events.png',
      '06-wallet.png',
      '07-volunteering.png',
      '08-settings.png',
    ]);
  });

  it('accepts only Apple current 6.9-inch portrait dimensions', () => {
    expect(ACCEPTED_PORTRAIT_SIZES.size).toBe(3);
    expect(validateNativeSize(1320, 2868)).toBe('1320x2868');
    expect(() => validateNativeSize(1080, 1920)).toThrow('not an accepted native 6.9-inch');
  });

  it('removes an unused opaque alpha channel without changing pixels', () => {
    const image = new PNG({ width: 2, height: 1 });
    image.data.set([10, 20, 30, 255, 40, 50, 60, 255]);
    const input = PNG.sync.write(image, { colorType: 6 });

    const output = convertOpaquePngToRgb(input);

    expect(output.buffer[25]).toBe(2);
    expect(Array.from(PNG.sync.read(output.buffer).data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('refuses to hide real transparency by flattening it', () => {
    const image = new PNG({ width: 1, height: 1 });
    image.data.set([10, 20, 30, 128]);
    const input = PNG.sync.write(image, { colorType: 6 });

    expect(() => convertOpaquePngToRgb(input)).toThrow('contains transparent pixels');
  });
});
