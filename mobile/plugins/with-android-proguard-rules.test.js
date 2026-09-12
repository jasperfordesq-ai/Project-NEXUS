// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');
const { appendProguardRules, BEGIN, END } = require('./with-android-proguard-rules');

// Explicit newlines so the assertions do not depend on the line endings this
// file happens to be checked out with.
const generated = [
  '# Add project specific ProGuard rules here.',
  '',
  '# react-native-reanimated',
  '-keep class com.swmansion.reanimated.** { *; }',
  '',
].join('\n');

const RULES = '-keep class expo.modules.ExpoModulesPackageList { *; }\n';

describe('with-android-proguard-rules', () => {
  it('appends the rules inside a fence, keeping what the template already had', () => {
    const out = appendProguardRules(generated, RULES);
    expect(out).toContain('-keep class com.swmansion.reanimated.** { *; }');
    expect(out).toContain(BEGIN);
    expect(out).toContain('-keep class expo.modules.ExpoModulesPackageList { *; }');
    expect(out).toContain(END);
    expect(out.indexOf(BEGIN)).toBeLessThan(out.indexOf(END));
  });

  it('replaces the fence instead of stacking a second copy on the next prebuild', () => {
    const once = appendProguardRules(generated, RULES);
    const twice = appendProguardRules(once, '-keep class com.example.Changed { *; }\n');
    expect(twice.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(twice).toContain('-keep class com.example.Changed { *; }');
    expect(twice).not.toContain('ExpoModulesPackageList');
    expect(twice).toContain('-keep class com.swmansion.reanimated.** { *; }');
  });

  it('fences with # — a .pro file is ProGuard config, where // is a syntax error', () => {
    expect(BEGIN.startsWith('#')).toBe(true);
    expect(END.startsWith('#')).toBe(true);
    const out = appendProguardRules(generated, RULES);
    expect(out).not.toMatch(/^\s*\/\//m);
  });

  it('refuses empty rules rather than silently writing an empty fence', () => {
    expect(() => appendProguardRules(generated, '   \n\n')).toThrow(/is empty/);
  });

  // The point of the whole change: these are the rules no dependency ships for
  // us, each pinned to a runtime string lookup. Losing one is silent, so the
  // file is asserted rather than trusted.
  describe('android-proguard-rules.pro', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'android-proguard-rules.pro'), 'utf8');

    it.each([
      ['expo module registration', '-keep class expo.modules.ExpoModulesPackageList { *; }'],
      ['ReactActivityDelegate reflection', '-keepclassmembers class com.facebook.react.ReactActivityDelegate { *; }'],
      ['generated module-info providers', '-keep class **$$ReactModuleInfoProvider { *; }'],
      ['gesture handler (ships no consumer rules)', '-keep class com.swmansion.gesturehandler.** { *; }'],
      ['expo-notifications (consumer rules never wired upstream)', '-keep class expo.modules.notifications.** { *; }'],
      ['MLKit barcode probe', '-keep class com.google.mlkit.vision.barcode.BarcodeScanning { *; }'],
      ['image crop reflection', 'com.canhub.cropper.CropImageActivity'],
      ['Stripe card brand tint', 'com.stripe.android.view.CardBrandView'],
      ['readable stack traces', '-keepattributes SourceFile,LineNumberTable'],
    ])('keeps the rule for %s', (_label, rule) => {
      expect(text).toContain(rule);
    });

    it('never disables obfuscation, which would defeat the point of the file', () => {
      expect(text).not.toMatch(/^\s*-dontobfuscate/m);
      expect(text).not.toMatch(/^\s*-dontshrink/m);
    });
  });
});
