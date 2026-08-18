// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Writes the Android network security configuration into the generated project.
 *
 * TWO configs, and the split is the point:
 *
 *   main/res/xml/network_security_config.xml   production: certificate pinning
 *                                              for api.project-nexus.ie, NO
 *                                              cleartext, system CAs only.
 *   debug/res/xml/network_security_config.xml  debug: cleartext to local dev
 *                                              hosts only, no pinning, user CAs
 *                                              trusted for a local proxy.
 *
 * Android merges resources per variant, so the debug file overrides main's for
 * debug builds and is absent from release entirely.
 *
 * 🔴 WHY THE DEBUG FILE IS NECESSARY. A network security config OVERRIDES
 * `android:usesCleartextTraffic` on API 24+. The debug manifest sets that
 * attribute to `true`, but with only the production config present the XML won
 * and cleartext stayed blocked — so a debug build could reach neither the local
 * API on :8090 nor Metro on :8081. Local device testing was impossible, which is
 * the likeliest reason the Maestro suite sat unrun. Removing the debug file
 * silently restores that state; `npm run verify:network-security` is the guard.
 */

const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const PRODUCTION_SOURCE = 'android-network-security-config.xml';
const DEBUG_SOURCE = 'android-network-security-config.debug.xml';

function copyInto(projectRoot, platformProjectRoot, sourceName, variant) {
  const source = path.join(projectRoot, sourceName);
  if (!fs.existsSync(source)) throw new Error(`Missing network security config: ${source}`);

  const targetDirectory = path.join(platformProjectRoot, 'app', 'src', variant, 'res', 'xml');
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.copyFileSync(source, path.join(targetDirectory, 'network_security_config.xml'));
}

module.exports = function withAndroidNetworkSecurity(config) {
  config = withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android application manifest node is missing');
    application.$ = application.$ || {};
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    // Stays `false` for the main manifest. The debug manifest overlay flips it,
    // and the debug resource above is what actually makes cleartext work.
    application.$['android:usesCleartextTraffic'] = 'false';
    return modConfig;
  });

  return withDangerousMod(config, ['android', (modConfig) => {
    const { projectRoot, platformProjectRoot } = modConfig.modRequest;

    // Guard against the two ways this could go wrong silently: shipping the
    // permissive config to production, or shipping the pinned config to debug.
    const productionText = fs.readFileSync(path.join(projectRoot, PRODUCTION_SOURCE), 'utf8');
    if (/cleartextTrafficPermitted="true"/.test(productionText)) {
      throw new Error(
        `${PRODUCTION_SOURCE} permits cleartext traffic. Production must never do this — ` +
          `put development exceptions in ${DEBUG_SOURCE} instead.`
      );
    }
    const debugText = fs.readFileSync(path.join(projectRoot, DEBUG_SOURCE), 'utf8');
    if (/<pin\b/.test(debugText)) {
      throw new Error(
        `${DEBUG_SOURCE} contains certificate pins. Pinning in a debug build turns an ordinary ` +
          `networking problem into an unreadable handshake failure — keep pins in ${PRODUCTION_SOURCE}.`
      );
    }

    copyInto(projectRoot, platformProjectRoot, PRODUCTION_SOURCE, 'main');
    copyInto(projectRoot, platformProjectRoot, DEBUG_SOURCE, 'debug');

    return modConfig;
  }]);
};
