// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Proves the debug cleartext exception cannot leak into a release build.
 *
 * Adding a permissive network security config for development is the standard
 * Android pattern, and it is also one edit away from disabling certificate
 * pinning in production. The split is only safe if something checks it, so this
 * asserts both halves and runs in the release gate.
 *
 * It checks the SOURCE files always, and the GENERATED project as well when one
 * exists — because the generated tree is what actually gets packaged, and a
 * plugin change could write the wrong file to the wrong variant while both
 * sources stay correct.
 *
 * Usage:
 *   node scripts/verify-network-security.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');

const PRODUCTION_SOURCE = path.join(MOBILE_ROOT, 'android-network-security-config.xml');
const DEBUG_SOURCE = path.join(MOBILE_ROOT, 'android-network-security-config.debug.xml');
const GENERATED_MAIN = path.join(MOBILE_ROOT, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml');
const GENERATED_DEBUG = path.join(MOBILE_ROOT, 'android', 'app', 'src', 'debug', 'res', 'xml', 'network_security_config.xml');

const failures = [];
const notes = [];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/** The production config must pin, must refuse cleartext, must not trust user CAs. */
function checkProduction(label, file) {
  const text = read(file);

  if (/cleartextTrafficPermitted="true"/.test(text)) {
    failures.push(`${label}: permits cleartext traffic. Production must never do this.`);
  }
  if (!/<pin\b/.test(text)) {
    failures.push(`${label}: contains no <pin> element — certificate pinning has been removed.`);
  }
  if (!/api\.project-nexus\.ie/.test(text)) {
    failures.push(`${label}: does not pin api.project-nexus.ie.`);
  }
  if (/<certificates\s+src="user"/.test(text)) {
    failures.push(
      `${label}: trusts USER-installed CAs. That lets any device-installed certificate ` +
        `intercept production traffic and defeats the pinning above.`
    );
  }
  if (!/base-config\s+cleartextTrafficPermitted="false"/.test(text)) {
    failures.push(`${label}: base-config does not explicitly forbid cleartext.`);
  }
}

/** The debug config may permit cleartext, but only for local hosts, and must not pin. */
function checkDebug(label, file) {
  const text = read(file);

  if (/<pin\b/.test(text)) {
    failures.push(`${label}: contains certificate pins. Keep pinning in the production config.`);
  }

  // A blanket permission would let a debug build be pointed at any plaintext host.
  const baseAllowsCleartext = /base-config\s+cleartextTrafficPermitted="true"/.test(text);
  if (baseAllowsCleartext) {
    failures.push(
      `${label}: base-config permits cleartext for EVERY host. Scope it to the local ` +
        `development domains instead, so a debug build cannot silently downgrade arbitrary traffic.`
    );
  }

  const permitsLocal = /<domain[^>]*>10\.0\.2\.2<\/domain>/.test(text);
  if (!permitsLocal) {
    failures.push(
      `${label}: does not permit cleartext to 10.0.2.2. The Android emulator reaches the ` +
        `host machine on that address, so a local API and Metro are both unreachable without it.`
    );
  }
}

checkProduction('android-network-security-config.xml (source)', PRODUCTION_SOURCE);
checkDebug('android-network-security-config.debug.xml (source)', DEBUG_SOURCE);

if (fs.existsSync(GENERATED_MAIN)) {
  checkProduction('android/app/src/main/.../network_security_config.xml (generated)', GENERATED_MAIN);

  if (!fs.existsSync(GENERATED_DEBUG)) {
    failures.push(
      'android/app/src/debug/.../network_security_config.xml is MISSING from the generated project. ' +
        'Without it the debug build inherits the production config, cleartext stays blocked, and the ' +
        'app cannot reach a local API or Metro — run `npx expo prebuild --platform android`.'
    );
  } else {
    checkDebug('android/app/src/debug/.../network_security_config.xml (generated)', GENERATED_DEBUG);

    // The whole safety argument rests on these two being different files.
    if (read(GENERATED_MAIN) === read(GENERATED_DEBUG)) {
      failures.push(
        'the generated main and debug configs are IDENTICAL, so the variant split is not doing anything.'
      );
    }
  }
} else {
  notes.push('no generated android/ project — source files checked only. Run prebuild for the full check.');
}

for (const n of notes) console.log(`network security: NOTE ${n}`);

if (failures.length > 0) {
  console.error('');
  for (const f of failures) console.error(`network security: FAIL ${f}`);
  console.error('');
  console.error('network security: refusing to certify this configuration.');
  process.exit(1);
}

console.log('network security: OK — production pins and forbids cleartext; debug permits it for local hosts only.');
