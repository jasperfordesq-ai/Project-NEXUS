// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

// React Native 0.83 updates text/layout constraints on configuration changes.
// Keep the current activity and its unsaved React state when the user changes
// text size; activity recreation otherwise remounts the active form.
module.exports = function withAndroidFontScale(config) {
  return withAndroidManifest(config, (modConfig) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(modConfig.modResults);
    const changes = new Set((activity.$['android:configChanges'] || '').split('|').filter(Boolean));
    changes.add('fontScale');
    activity.$['android:configChanges'] = [...changes].join('|');
    return modConfig;
  });
};
