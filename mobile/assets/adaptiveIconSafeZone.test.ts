// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Android launcher icon must fit inside the shape the launcher will cut it into.
 *
 * 🔴 Reported by the owner on 2026-08-25: "It looks great in the emulator, but it is cropped
 * on my Android." Both were true. Android composites the adaptive icon's 108dp foreground
 * over its background and then masks the result — only the central **72dp, about 66%**, is
 * guaranteed to survive, and each launcher picks its own shape. Measured on the artwork that
 * shipped: the content spanned x=120..903 of 1024, i.e. **11.7% to 88.2%**, with the four
 * dots at the extremes. A circular mask cut all four off. The Pixel emulator's launcher
 * masks less aggressively, which is exactly why it looked right there and wrong on a real
 * phone — an emulator screenshot cannot answer this question.
 *
 * The layer behind it stays the brand blue #006FEE, not the artwork's own #0268EE. The two
 * differ by seven parts in 255 of green, which is invisible, and an existing test pins the
 * brand value — drifting a brand colour to match an asset would be the wrong way round.
 *
 * 🔴 It is the DIAMETER that matters, not a square fit. The first repair attempt cropped to
 * the "central motif" and scaled it up; that cut through the white ring, so the ring arrived
 * at the launcher already broken and looked like the same fault. For round artwork the rule
 * is simply: everything within a circle of 66% of the canvas, centred.
 */

import fs from 'node:fs';
import path from 'node:path';

// `pngjs` ships no types and the repo has no @types/pngjs; only two members are used here,
// so a local shape is cheaper and clearer than adding a dependency for a test.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PNG } = require('pngjs') as {
  PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
};

const ICON = path.resolve(__dirname, 'adaptive-icon.png');

/** Android's guaranteed-visible fraction of the adaptive icon layer: 72dp of 108dp. */
const SAFE_FRACTION = 72 / 108;

describe('the Android adaptive icon foreground', () => {
  const png = PNG.sync.read(fs.readFileSync(ICON));

  it('is square and large enough for every launcher density', () => {
    expect(png.width).toBe(png.height);
    expect(png.width).toBeGreaterThanOrEqual(432);
  });

  it('is transparent outside the artwork, so the background colour shows through', () => {
    // A full-bleed foreground with its own baked background is what caused the crop: the
    // artwork then has to reach the edges to fill the tile.
    const corners = [
      [2, 2],
      [png.width - 3, 2],
      [2, png.height - 3],
      [png.width - 3, png.height - 3],
    ];
    for (const [x, y] of corners) {
      const alpha = png.data[((png.width * y + x) << 2) + 3];
      expect(alpha).toBe(0);
    }
  });

  it('keeps every visible pixel inside the safe circle', () => {
    const centre = png.width / 2;
    const safeRadius = (png.width * SAFE_FRACTION) / 2;

    let worst = 0;
    let worstAt: [number, number] = [0, 0];
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        if (png.data[((png.width * y + x) << 2) + 3] < 16) continue;
        const dx = x - centre + 0.5;
        const dy = y - centre + 0.5;
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius > worst) {
          worst = radius;
          worstAt = [x, y];
        }
      }
    }

    // Reported as a fraction, because that is the number a designer can act on.
    const worstFraction = (worst * 2) / png.width;
    expect({ worstFraction: Number(worstFraction.toFixed(3)), worstAt }).toEqual({
      worstFraction: expect.any(Number),
      worstAt: expect.any(Array),
    });
    expect(worst).toBeLessThanOrEqual(safeRadius);
  });
});
