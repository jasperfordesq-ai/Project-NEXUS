// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { waitForStableFrame } = require('./screenshot-stability.cjs');

describe('pixel capture stability', () => {
  it('returns only after two consecutive frames are within the pixel budget', async () => {
    const frames = ['placeholder', 'logo-loading', 'logo-loaded', 'logo-loaded'];
    const captureFrame = jest.fn(async () => frames.shift());
    const differenceRatio = jest.fn((left, right) => left === right ? 0 : 0.5);

    await expect(waitForStableFrame({
      captureFrame,
      differenceRatio,
      sleep: async () => undefined,
      maxAttempts: 4,
      threshold: 0.001,
    })).resolves.toBe('logo-loaded');
    expect(captureFrame).toHaveBeenCalledTimes(4);
  });

  it('fails explicitly instead of accepting an unstable final frame', async () => {
    let frame = 0;
    await expect(waitForStableFrame({
      captureFrame: async () => `frame-${frame++}`,
      differenceRatio: () => 0.25,
      sleep: async () => undefined,
      maxAttempts: 3,
      threshold: 0.001,
    })).rejects.toThrow('did not become pixel-stable after 3 frames');
  });
});
