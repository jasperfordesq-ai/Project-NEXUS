// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('expo/metro-config', () => ({
  getDefaultConfig: () => ({ resolver: { blockList: /expo-default-exclusion/ }, transformer: {} }),
}));
jest.mock('uniwind/metro', () => ({ withUniwindConfig: (config) => config }));
jest.mock('@sentry/react-native/metro', () => ({ withSentryResolver: (config) => config }));

const config = require('./metro.config');
const excluded = (file) => config.resolver.blockList.some((pattern) => pattern.test(file));

describe('Metro native build exclusions', () => {
  it.each([
    'C:\\app\\node_modules\\react-native-worklets\\android\\.cxx\\Debug\\CMakeTmp\\file',
    '/app/node_modules/expo-updates/android/.cxx/Debug/CMakeFiles/file',
    '/app/android/app/build/generated/file',
    '/app/android/build/generated/file',
    '/app/android/.gradle/cache/file',
    '/app/expo-default-exclusion/file',
  ])('ignores ephemeral or default-excluded files: %s', (file) => {
    expect(excluded(file)).toBe(true);
  });

  it.each([
    '/app/node_modules/expo-updates/build/index.js',
    '/app/node_modules/heroui-native/lib/module/index.js',
    'C:\\app\\components\\ui\\Button.tsx',
  ])('keeps runtime source available: %s', (file) => {
    expect(excluded(file)).toBe(false);
  });
});
