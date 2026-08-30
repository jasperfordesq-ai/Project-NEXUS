// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

module.exports = {
  preset: 'jest-expo',
  // React Native Gesture Handler requires its mock setup to run before tests.
  setupFiles: ['./node_modules/react-native-gesture-handler/jestSetup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  // Custom resolver to stub heroui-native's animation-settings context modules so
  // components work without HeroUINativeProvider in the test tree.
  resolver: '<rootDir>/jest-resolver.js',

  // Map react-native-reanimated to a self-contained manual mock so the native
  // react-native-worklets initialisation (NativeWorklets) is never invoked in tests.
  moduleNameMapper: {
    // The production wrapper imports Ionicons directly to avoid bundling every icon family.
    // jest-expo's barrel mock does not intercept that path, so the real component otherwise
    // starts asynchronous font work in test workers, producing React act() warnings and an
    // occasional worker that Jest must force-exit after the suite. Keep the real glyph map in
    // the synchronous mock because two screens validate server-provided icon names at runtime.
    '^@expo/vector-icons/Ionicons$': '<rootDir>/__mocks__/expo-ionicons.js',
    '^react-native-reanimated$': '<rootDir>/__mocks__/react-native-reanimated.js',
    '^react-native-worklets$': '<rootDir>/__mocks__/react-native-worklets.js',
  },

  // Coverage must count files NO test imports. Without this, jest only
  // instruments modules a test actually pulls in, so an entirely untested
  // screen or API module is invisible to the percentage rather than dragging
  // it down — the metric silently rewards not writing the test at all.
  // Measured on 2026-08-18: 37 source files (~3.2k lines, including the
  // 759-line root layout and the 473-line jobs API client) were absent from
  // the report for exactly this reason.
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    '!**/*.test.{ts,tsx}',
    '!**/*.d.ts',
  ],

  // heroui-native and its peer deps ship as ESM — must be transformed by Babel.
  // IMPORTANT: No trailing `/` after the alternation group — bare `expo` matches
  // expo-modules-core, expo-router, etc. (same pattern as jest-expo's own preset).
  // Second entry prevents the reanimated reentrant-plugin error in multi-platform tests.
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '\\.pnpm|' +
      'react-native|' +
      '@react-native(-community)?|' +
      'expo|' +
      '@expo|' +
      '@expo-google-fonts|' +
      'react-navigation|' +
      '@react-navigation|' +
      '@unimodules|' +
      'unimodules|' +
      'sentry-expo|' +
      '@sentry|' +
      'native-base|' +
      'react-native-svg|' +
      'react-native-reanimated|' +
      'react-native-gesture-handler|' +
      '@gorhom|' +
      'heroui-native|' +
      'tailwind-variants|' +
      'nativewind|' +
      'uniwind' +
    '))',
    'node_modules/react-native-reanimated/plugin/',
  ],
};
