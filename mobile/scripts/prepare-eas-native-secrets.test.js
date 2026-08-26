// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { installGoogleServicesJson } = require('./prepare-eas-native-secrets');

function firebaseConfig(packageName = 'ie.project.nexus') {
  return JSON.stringify({
    project_info: { project_id: 'example' },
    client: [{ client_info: { android_client_info: { package_name: packageName } } }],
  });
}

describe('EAS native secret preparation', () => {
  let tempRoot;

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('installs a validated Google services file into the native Android app', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eas-secrets-test-'));
    const source = path.join(tempRoot, 'eas-secret');
    fs.writeFileSync(source, firebaseConfig());

    const destination = installGoogleServicesJson(tempRoot, source);

    expect(destination).toBe(path.join(tempRoot, 'android', 'app', 'google-services.json'));
    expect(JSON.parse(fs.readFileSync(destination, 'utf8')).project_info.project_id).toBe('example');
  });

  it('rejects Firebase configuration for a different Android package', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eas-secrets-test-'));

    expect(() => installGoogleServicesJson(tempRoot, firebaseConfig('example.wrong.app')))
      .toThrow('does not contain the ie.project.nexus Android client');
  });
});
