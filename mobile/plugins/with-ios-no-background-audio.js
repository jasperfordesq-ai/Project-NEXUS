// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { withInfoPlist } = require('@expo/config-plugins');

// App Review rejected 1.10.0 (8) under guideline 2.5.4 on 30 Oct 2026: the app
// declared the iOS "audio" background mode and the reviewer found no feature that
// needs persistent audio. The only user was the podcast player, so iOS now stops a
// podcast when the phone locks. expo-audio's enableBackgroundPlayback must stay on
// for Android (it registers the media-playback foreground service behind the
// lock-screen controls), and it also adds "audio" on iOS — this plugin strips that
// one entry and keeps any other background mode, such as remote notifications.
//
// 🔴 It must stay FIRST in app.json's plugin list. Expo runs Info.plist mods in
// reverse order of registration, so only the first-registered plugin sees what
// expo-audio added. Placed anywhere later, it runs too early and removes nothing
// (checked with `npx expo config --type introspect`).
module.exports = function withIosNoBackgroundAudio(config) {
  return withInfoPlist(config, (modConfig) => {
    const modes = modConfig.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      const kept = modes.filter((mode) => mode !== 'audio');
      if (kept.length > 0) {
        modConfig.modResults.UIBackgroundModes = kept;
      } else {
        delete modConfig.modResults.UIBackgroundModes;
      }
    }
    return modConfig;
  });
};
