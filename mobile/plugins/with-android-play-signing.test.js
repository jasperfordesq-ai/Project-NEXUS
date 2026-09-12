// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');
const { injectPlaySigning } = require('./with-android-play-signing');

// The shape Expo's prebuild template generates (SDK 55), built with explicit
// newlines so the assertions do not depend on this file's line endings.
const generated = [
  'android {',
  '    defaultConfig {',
  "        applicationId 'ie.project.nexus'",
  '        versionCode 10',
  '        versionName "1.5.0"',
  '    }',
  '    signingConfigs {',
  '        debug {',
  "            storeFile file('debug.keystore')",
  "            storePassword 'android'",
  '        }',
  '    }',
  '    buildTypes {',
  '        debug {',
  '            signingConfig signingConfigs.debug',
  '        }',
  '        release {',
  '            // Caution! In production, you need to generate your own keystore file.',
  '            signingConfig signingConfigs.debug',
  '            minifyEnabled enableMinifyInReleaseBuilds',
  '        }',
  '    }',
  '}',
  '',
].join('\n');

describe('with-android-play-signing', () => {
  const out = injectPlaySigning(generated);

  it('adds a playRelease signing config that reads the environment, then Gradle properties', () => {
    expect(out).toContain("playRelease {\n            def playStoreFile = System.getenv('PLAY_STORE_FILE') ?: findProperty('playStoreFile')");
    expect(out).toContain("storePassword System.getenv('PLAY_STORE_PASSWORD') ?: findProperty('playStorePassword')");
    expect(out).toContain("keyAlias System.getenv('PLAY_KEY_ALIAS') ?: findProperty('playKeyAlias')");
    expect(out).toContain("keyPassword System.getenv('PLAY_KEY_PASSWORD') ?: findProperty('playKeyPassword')");
  });

  it('switches only the release build type to the upload key, and only when the values are present', () => {
    const releaseBlock = out.slice(out.indexOf('release {'));
    expect(releaseBlock).toContain(
      "signingConfig (System.getenv('PLAY_STORE_FILE') ?: findProperty('playStoreFile')) ? signingConfigs.playRelease : signingConfigs.debug",
    );
    const debugBlock = out.slice(out.indexOf('debug {\n            signingConfig'), out.indexOf('release {'));
    expect(debugBlock).toContain('signingConfig signingConfigs.debug');
    expect(debugBlock).not.toContain('playRelease');
  });

  it('lets -PplayVersionCode override the version code, with app.json as the default', () => {
    expect(out).toContain("versionCode (findProperty('playVersionCode') ?: '10').toString().toInteger()");
    expect(out).toContain('versionName "1.5.0"');
  });

  it('is idempotent across repeated prebuilds', () => {
    expect(injectPlaySigning(out)).toBe(out);
    expect(out.match(/playRelease \{/g)).toHaveLength(1);
  });

  it('refuses a template it does not recognise rather than silently leaving the debug key', () => {
    expect(() => injectPlaySigning('android {\n}\n')).toThrow(/no `signingConfigs \{` block/);
    const noRelease = generated.replace(/release \{/, 'staging {');
    expect(() => injectPlaySigning(noRelease)).toThrow(/no `release \{` build type/);
  });

  it('is listed in app.json', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo;
    expect(app.plugins).toContain('./plugins/with-android-play-signing');
  });
});
