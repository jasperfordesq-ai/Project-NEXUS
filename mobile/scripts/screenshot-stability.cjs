// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

async function waitForStableFrame({
  captureFrame,
  differenceRatio,
  sleep,
  maxAttempts = 6,
  threshold = 0.001,
  delayMs = 500,
}) {
  if (maxAttempts < 2) throw new Error('pixel stability needs at least 2 frames');

  let previous = await captureFrame();
  for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
    await sleep(delayMs);
    const current = await captureFrame();
    if (differenceRatio(previous, current) <= threshold) return current;
    previous = current;
  }

  throw new Error(`screen did not become pixel-stable after ${maxAttempts} frames`);
}

module.exports = { waitForStableFrame };
