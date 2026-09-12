// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Sign release builds with the Play upload key when the signing values are
 * supplied, and honour `-PplayVersionCode` from `scripts/build-aab-play.sh`.
 *
 * 🔴 Why this is a plugin and not a hand edit. Until 2026-09-12 the block below
 * existed only in the git-ignored `android/app/build.gradle` of one developer
 * checkout. `scripts/build-aab-play.sh` exported PLAY_STORE_FILE and friends and
 * relied on that file reading them. A prebuild on the same machine (the Expo
 * SDK 55 upgrade) regenerated the file and the block was gone; a clean copy of
 * the repository never had it. The first 1.5.0 bundle therefore came out signed
 * with the DEBUG key, and only the script's own certificate check stopped it
 * being offered for upload. The recipe now lives in the repository: prebuild
 * regenerates the Gradle file, this plugin puts the block back every time.
 *
 * Values are read from the environment first, then Gradle properties, matching
 * the two ways the recipe has ever passed them. With none present the release
 * build type keeps the debug key — the build script refuses such a bundle.
 */
const SIGNING_CONFIG = [
  '        playRelease {',
  "            def playStoreFile = System.getenv('PLAY_STORE_FILE') ?: findProperty('playStoreFile')",
  '            if (playStoreFile) {',
  '                storeFile file(playStoreFile)',
  "                storePassword System.getenv('PLAY_STORE_PASSWORD') ?: findProperty('playStorePassword')",
  "                keyAlias System.getenv('PLAY_KEY_ALIAS') ?: findProperty('playKeyAlias')",
  "                keyPassword System.getenv('PLAY_KEY_PASSWORD') ?: findProperty('playKeyPassword')",
  '            }',
  '        }',
].join('\n');

const RELEASE_SIGNING =
  "signingConfig (System.getenv('PLAY_STORE_FILE') ?: findProperty('playStoreFile')) ? signingConfigs.playRelease : signingConfigs.debug";

function injectPlaySigning(gradleSource) {
  if (gradleSource.includes('playRelease {')) return gradleSource;

  const signingBlock = /^([ \t]*)signingConfigs[ \t]*\{[ \t]*$/m;
  if (!signingBlock.test(gradleSource)) {
    throw new Error('with-android-play-signing: no `signingConfigs {` block in android/app/build.gradle');
  }
  let out = gradleSource.replace(signingBlock, `$&\n${SIGNING_CONFIG}`);

  const releaseStart = out.search(/^[ \t]*release[ \t]*\{[ \t]*$/m);
  if (releaseStart < 0) {
    throw new Error('with-android-play-signing: no `release {` build type in android/app/build.gradle');
  }
  const head = out.slice(0, releaseStart);
  const tail = out.slice(releaseStart);
  const releaseSigning = /^([ \t]*)signingConfig signingConfigs\.debug[ \t]*$/m;
  if (!releaseSigning.test(tail)) {
    throw new Error('with-android-play-signing: the release build type does not sign with signingConfigs.debug as expected');
  }
  out = head + tail.replace(releaseSigning, `$1${RELEASE_SIGNING}`);

  // `-PplayVersionCode=N` from the build script wins; app.json's value is the default.
  // 🔴 Command form with a method call, never `versionCode (a ?: b).toInteger()`:
  // Groovy parses that as `(versionCode(a ?: b)).toInteger()` and Gradle fails
  // with "Value is null" — the fourth 1.5.0 build died on exactly that line.
  out = out.replace(
    /^([ \t]*)versionCode (\d+)[ \t]*$/m,
    "$1versionCode Integer.parseInt((findProperty('playVersionCode') ?: '$2').toString())",
  );
  return out;
}

module.exports = function withAndroidPlaySigning(config) {
  // Required here, not at the top: the unit test imports the pure transform and
  // `@expo/config-plugins` drags in an ESM-only `uuid` that Jest cannot parse.
  const { withAppBuildGradle } = require('@expo/config-plugins');
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = injectPlaySigning(modConfig.modResults.contents);
    return modConfig;
  });
};

module.exports.injectPlaySigning = injectPlaySigning;
