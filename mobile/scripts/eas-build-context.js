// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

function linkLocalNodeModules(appDir, contextDir) {
  const source = path.join(appDir, 'node_modules');
  const destination = path.join(contextDir, 'node_modules');

  if (!fs.existsSync(source)) {
    throw new Error('mobile/node_modules is missing; run npm ci before starting an EAS build.');
  }

  fs.symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
  return destination;
}

function materializeRuntimeVersion(contextDir) {
  const appJsonPath = path.join(contextDir, 'app.json');
  const config = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const runtimeVersion = config.expo?.runtimeVersion;

  if (runtimeVersion?.policy === 'appVersion') {
    if (!config.expo.version) {
      throw new Error('Cannot materialize the appVersion runtime policy without expo.version.');
    }
    config.expo.runtimeVersion = config.expo.version;
    fs.writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  return config.expo?.runtimeVersion;
}

module.exports = { linkLocalNodeModules, materializeRuntimeVersion };
