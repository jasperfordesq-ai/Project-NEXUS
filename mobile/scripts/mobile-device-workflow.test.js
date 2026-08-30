// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(
  path.resolve(mobileRoot, '..', '.github', 'workflows', 'mobile-device-tests.yml'),
  'utf8',
);
const tour = fs.readFileSync(
  path.resolve(mobileRoot, '.maestro', 'screens', 'capture-screens.yaml'),
  'utf8',
);
const openLogin = fs.readFileSync(
  path.resolve(mobileRoot, '.maestro', 'subflows', 'open-login.yaml'),
  'utf8',
);
const savedCollectionFlowPath = path.resolve(
  mobileRoot,
  '.maestro',
  '13-effect-verifying-saved-collection.yaml',
);
const coreEffectFlow = fs.readFileSync(
  path.resolve(mobileRoot, '.maestro', '12-effect-verifying-core-modules.yaml'),
  'utf8',
);
const effectVerifier = fs.readFileSync(
  path.resolve(mobileRoot, 'scripts', 'mobile-device-effects.php'),
  'utf8',
);

describe('Android device screenshot evidence', () => {
  it('waits for the real fresh-install destination before choosing a tenant', () => {
    expect(tour).toContain('visible: "Select your timebank|Welcome back"');
    expect(tour).toContain('id: "tenant-option-hour-timebank"');
    expect(tour).toContain('visible: "Welcome back"');
  });

  it('dismisses an API 36 System UI ANR before testing the app underneath', () => {
    for (const flow of [openLogin, tour]) {
      expect(flow).toContain('(System UI|Process system) isn.t responding');
      expect(flow).toContain('- tapOn: "^Wait$"');
      expect(flow).toContain('visible: "Select your timebank|Welcome back"');
    }
  });

  it('cannot report green when the listing tour or artifact is missing', () => {
    expect(workflow).toContain('npm run screenshot:tour');
    expect(workflow).not.toContain('screenshot:tour ||');
    expect(workflow).toContain('if-no-files-found: error');
  });

  it('uses the maintained setup actions', () => {
    expect(workflow).toContain('actions/checkout@v5');
    expect(workflow).toContain('actions/setup-node@v5');
    expect(workflow).toContain('actions/setup-java@v5');
  });
});

describe('Android persisted-effect journeys', () => {
  it('opens the message composer deterministically before asserting its contents', () => {
    expect(coreEffectFlow).toContain('openLink: "nexus:///messages/new"');
    expect(coreEffectFlow).not.toContain('- tapOn: "New message"');
  });

  it('creates and independently verifies a saved collection', () => {
    expect(fs.existsSync(savedCollectionFlowPath)).toBe(true);
    const savedCollectionFlow = fs.readFileSync(savedCollectionFlowPath, 'utf8');
    expect(savedCollectionFlow).toContain('id: "saved-collection-name"');
    expect(savedCollectionFlow).toContain('id: "saved-collection-description"');
    expect(savedCollectionFlow).toContain('id: "create-saved-collection-submit"');
    expect(savedCollectionFlow).toContain('visible: "No saved items"');
    expect(effectVerifier).toContain("const SAVED_COLLECTION_NAME = 'E2E Device Journey Collection';");
    expect(effectVerifier).toContain("'saved collection persisted'");
    expect(effectVerifier).toContain("'assert-collection'");
    expect(workflow).toContain('thirteen Maestro end-to-end flows');
  });
});
