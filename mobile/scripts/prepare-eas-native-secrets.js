// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

function readSecretFile(value) {
  if (!value) throw new Error('GOOGLE_SERVICES_JSON is required for Android EAS builds.');
  return fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : value;
}

function installGoogleServicesJson(projectDir, secretValue) {
  const contents = readSecretFile(secretValue);
  const config = JSON.parse(contents);
  const packageNames = (config.client ?? [])
    .map((client) => client.client_info?.android_client_info?.package_name)
    .filter(Boolean);

  if (!packageNames.includes('ie.project.nexus')) {
    throw new Error('GOOGLE_SERVICES_JSON does not contain the ie.project.nexus Android client.');
  }

  const destination = path.join(projectDir, 'android', 'app', 'google-services.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents, { mode: 0o600 });
  return destination;
}

if (require.main === module && process.env.EAS_BUILD_PLATFORM === 'android') {
  installGoogleServicesJson(process.cwd(), process.env.GOOGLE_SERVICES_JSON);
  console.log('Installed and validated Firebase Android configuration for the EAS build.');
}

module.exports = { installGoogleServicesJson, readSecretFile };
