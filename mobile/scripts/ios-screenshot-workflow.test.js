// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(
  path.resolve(mobileRoot, '..', '.github', 'workflows', 'ios-simulator-screenshots.yml'),
  'utf8',
);
const tour = fs.readFileSync(
  path.resolve(mobileRoot, '.maestro', 'screens', 'apple-store-screens.yaml'),
  'utf8',
);

describe('iOS screenshot workflow', () => {
  it('keeps the public tour in one Maestro/XCTest session', () => {
    const captureStep = workflow.match(
      /- name: Run the four-screen public App Store tour[\s\S]*?(?=\n      - name:)/,
    )?.[0];

    expect(captureStep).toBeDefined();
    expect(captureStep.match(/maestro --device/g)).toHaveLength(1);
    expect(captureStep).toContain('.maestro/screens/apple-store-screens.yaml');
    expect(captureStep).not.toContain('apple-store-open-');
  });

  it('captures the accepted set and handles both iOS deep-link confirmations', () => {
    expect(tour).toContain('pressKey: Enter');
    expect(tour).not.toContain('id: "login-submit"');
    expect(tour.match(/takeScreenshot:/g)).toHaveLength(4);
    expect(tour).toContain('takeScreenshot: 01-feed');
    expect(tour).toContain('takeScreenshot: 02-listings');
    expect(tour).toContain('takeScreenshot: 04-messages');
    expect(tour).toContain('takeScreenshot: 05-events');
    expect(tour.match(/point: "67%,54%"/g)).toHaveLength(2);
  });

  it('runs page-content OCR over every prepared screenshot', () => {
    for (const name of ['01-feed.png', '02-listings.png', '04-messages.png', '05-events.png']) {
      expect(workflow).toContain(`apple-screenshots/${name}`);
    }
    expect(workflow).toContain('request.regionOfInterest = CGRect(x: 0, y: 0.12, width: 1, height: 0.88)');
  });
});
