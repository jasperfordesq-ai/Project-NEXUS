// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
jest.mock('@expo/config-plugins', () => ({
  AndroidConfig: { Manifest: { getMainActivityOrThrow: (manifest) => manifest.activity } },
  withAndroidManifest: (config, action) => {
    config.manifest = action({ modResults: config.manifest }).modResults;
    return config;
  },
  withMainApplication: (config, action) => {
    config.application = action({ modResults: config.application }).modResults;
    return config;
  },
}));
const plugin = require('./with-android-font-scale');
const source = `class MainApplication {
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}`;
function fixture(contents = source, language = 'kt') {
  return {
    manifest: { activity: { $: { 'android:configChanges': 'keyboard|orientation' } } },
    application: { contents, language },
  };
}
it('preserves native handling and generates the application refresh exactly once', () => {
  const config = plugin(fixture());
  expect(config.manifest.activity.$['android:configChanges']).toBe('keyboard|orientation|fontScale');
  const once = config.application.contents;
  expect(once.indexOf('reactHost.onConfigurationChanged(this)')).toBeGreaterThan(once.indexOf('ApplicationLifecycleDispatcher.onConfigurationChanged'));
  expect(once).toContain('LifecycleEventListener)?.onHostResume()');
  expect(once).not.toContain('recreate(');
  expect(plugin(config).application.contents).toBe(once);
});
it('fails explicitly when the native template no longer supports the integration', () => {
  expect(() => plugin(fixture('class MainApplication {}'))).toThrow();
  expect(() => plugin(fixture(source, 'java'))).toThrow('Kotlin');
});

