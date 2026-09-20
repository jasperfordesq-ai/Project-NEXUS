// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { AndroidConfig, withAndroidManifest, withMainApplication } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// React Native 0.83 updates text/layout constraints on configuration changes.
// Keep the current activity and its unsaved React state when the user changes
// text size; activity recreation otherwise remounts the active form.
module.exports = function withAndroidFontScale(config) {
  config = withAndroidManifest(config, (modConfig) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(modConfig.modResults);
    const changes = new Set((activity.$['android:configChanges'] || '').split('|').filter(Boolean));
    changes.add('fontScale');
    activity.$['android:configChanges'] = [...changes].join('|');
    return modConfig;
  });
  return withMainApplication(config, (modConfig) => {
    if (modConfig.modResults.language !== 'kt') {
      throw new Error('Android font-scale support requires the Kotlin MainApplication template.');
    }
    modConfig.modResults.contents = mergeContents({
      src: modConfig.modResults.contents,
      tag: 'nexus-font-scale',
      anchor: /ApplicationLifecycleDispatcher\.onConfigurationChanged\(this, newConfig\)/,
      offset: 1,
      comment: '//',
      newSrc: [
        '    // Application resources update after Activity.onResume on Android font changes.',
        '    // Refresh native layout metrics and the JS Dimensions event without losing drafts.',
        '    reactHost.onConfigurationChanged(this)',
        '    (reactHost.currentReactContext?.getNativeModule("DeviceInfo") as? com.facebook.react.bridge.LifecycleEventListener)?.onHostResume()',
      ].join('\n'),
    }).contents;
    return modConfig;
  });
};
