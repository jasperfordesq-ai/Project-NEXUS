// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Appends mobile/android-proguard-rules.pro into the generated
 * android/app/proguard-rules.pro.
 *
 * WHY A PLUGIN RATHER THAN expo-build-properties' `extraProguardRules`.
 * `extraProguardRules` takes a single JSON string, so every rule would live in
 * app.json as one `\n`-escaped line with no room for the evidence that justifies
 * it. The rules only make sense with that evidence attached — each one exists
 * because a named dependency looks something up by string at runtime — so they
 * live in a real, commentable .pro file and this plugin carries it in, the same
 * way with-android-network-security.js carries the network config in.
 *
 * 🔴 WHY IT IS FENCED. `android/` is regenerated on every release build, but
 * `expo prebuild` without `--clean` leaves an existing proguard-rules.pro in
 * place. Appending unconditionally would stack a fresh copy of every rule on
 * each build — harmless to R8, but it makes the file unreadable and hides a
 * stale copy of rules that were edited. The fence is replaced, never repeated.
 *
 * The fence deliberately does not reuse expo-build-properties' own
 * `@generated begin expo-build-properties` markers: that plugin purges its block
 * on each prebuild, and writing inside it would delete these rules.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = 'android-proguard-rules.pro';
// 🔴 `#`, never `//`. A .pro file is ProGuard configuration, not Java: `//` is a
// syntax error there, and R8 fails the release build on it.
const BEGIN = '# @generated begin nexus-proguard-rules — do not edit, see mobile/android-proguard-rules.pro';
const END = '# @generated end nexus-proguard-rules';

// [\s\S] rather than the `s` flag: the fenced body spans many lines and must be
// matched in full, including the trailing newline the writer puts after END.
const FENCE = new RegExp(
  `${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
  'm'
);

/**
 * Pure transform, exported for the unit test: returns `generated` with the fenced
 * block either replaced (if already present) or appended.
 */
function appendProguardRules(generated, rules) {
  const trimmed = rules.replace(/\s+$/, '');
  if (!trimmed) {
    throw new Error(`with-android-proguard-rules: ${SOURCE} is empty`);
  }
  const block = `${BEGIN}\n${trimmed}\n${END}\n`;
  if (FENCE.test(generated)) {
    return generated.replace(FENCE, block);
  }
  return `${generated.replace(/\s+$/, '')}\n\n${block}`;
}

module.exports = function withAndroidProguardRules(config) {
  // Required here, not at the top: the unit test imports the pure transform and
  // `@expo/config-plugins` drags in an ESM-only `uuid` that Jest cannot parse.
  const { withDangerousMod } = require('@expo/config-plugins');

  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const { projectRoot, platformProjectRoot } = modConfig.modRequest;

      const source = path.join(projectRoot, SOURCE);
      if (!fs.existsSync(source)) {
        // Refuse rather than warn. A release built without these rules launches,
        // installs, and then fails at runtime in ways no build check can see.
        throw new Error(`with-android-proguard-rules: missing ${source}`);
      }

      const target = path.join(platformProjectRoot, 'app', 'proguard-rules.pro');
      if (!fs.existsSync(target)) {
        throw new Error(`with-android-proguard-rules: no generated ${target}`);
      }

      const rules = fs.readFileSync(source, 'utf8');
      fs.writeFileSync(target, appendProguardRules(fs.readFileSync(target, 'utf8'), rules));

      return modConfig;
    },
  ]);
};

module.exports.appendProguardRules = appendProguardRules;
module.exports.BEGIN = BEGIN;
module.exports.END = END;
