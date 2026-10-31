// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
jest.mock('@expo/config-plugins', () => ({
  withInfoPlist: (config, action) => {
    config.infoPlist = action({ modResults: config.infoPlist }).modResults;
    return config;
  },
}));
const plugin = require('./with-ios-no-background-audio');
const appConfig = require('../app.json');

it('removes the audio background mode App Review rejected and keeps the others', () => {
  const config = plugin({ infoPlist: { UIBackgroundModes: ['audio', 'remote-notification'] } });
  expect(config.infoPlist.UIBackgroundModes).toEqual(['remote-notification']);
});

it('drops the key entirely when audio was the only background mode', () => {
  const config = plugin({ infoPlist: { UIBackgroundModes: ['audio'] } });
  expect(config.infoPlist).not.toHaveProperty('UIBackgroundModes');
});

it('leaves an Info.plist without background modes untouched', () => {
  const config = plugin({ infoPlist: { CFBundleAllowMixedLocalizations: true } });
  expect(config.infoPlist).toEqual({ CFBundleAllowMixedLocalizations: true });
});

it('is registered first, so its Info.plist mod runs after expo-audio adds the mode', () => {
  expect(appConfig.expo.plugins[0]).toBe('./plugins/with-ios-no-background-audio');
  expect(appConfig.expo.ios.infoPlist.UIBackgroundModes ?? []).not.toContain('audio');
});
