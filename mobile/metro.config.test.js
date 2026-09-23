// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('expo/metro-config', () => ({
  getDefaultConfig: () => ({ resolver: { blockList: /expo-default-exclusion/ }, transformer: {} }),
}));
jest.mock('uniwind/metro', () => ({ withUniwindConfig: (config) => config }));
jest.mock('@sentry/react-native/metro', () => jest.requireActual('@sentry/react-native/metro'));

const config = require('./metro.config');
const excluded = (file) => config.resolver.blockList.some((pattern) => pattern.test(file));

describe('Metro native build exclusions', () => {
  it.each(['android', 'ios'])('keeps browser replay excluded on %s through the actual Sentry wrapper', (platform) => {
    const resolveRequest = jest.fn();
    const context = { resolveRequest, mainFields: ['main', 'module'] };
    expect(config.resolver.resolveRequest(context, '@sentry/replay', platform)).toEqual({ type: 'empty' });
    expect(resolveRequest).not.toHaveBeenCalled();
  });

  it('preserves web replay resolution through the actual Sentry wrapper', () => {
    const resolveRequest = jest.fn(() => ({ type: 'sourceFile', filePath: 'replay.js' }));
    const context = { resolveRequest, mainFields: ['main', 'module'] };
    expect(config.resolver.resolveRequest(context, '@sentry/replay', 'web')).toEqual({ type: 'sourceFile', filePath: 'replay.js' });
    expect(resolveRequest).toHaveBeenCalledWith(context, '@sentry/replay', 'web');
  });

  it.each(['zod', 'zod/v4/core', '@sentry/core', 'react-hook-form'])('deduplicates exports and legacy entry points for %s', (name) => {
    const resolveRequest = jest.fn(() => ({ type: 'sourceFile', filePath: 'index.js' }));
    const context = { resolveRequest, isESMImport: false, mainFields: ['react-native', 'main', 'module'] };
    config.resolver.resolveRequest(context, name, 'android');
    expect(resolveRequest).toHaveBeenCalledWith(expect.objectContaining({
      isESMImport: true, mainFields: ['module', 'react-native', 'main'],
    }), name, 'android');
    expect(context.mainFields).toEqual(['react-native', 'main', 'module']);
  });

  it('preserves resolution context for unrelated packages', () => {
    const resolveRequest = jest.fn();
    const context = { resolveRequest, mainFields: ['main', 'module'] };
    for (const name of ['react-native', 'zod-other']) {
      config.resolver.resolveRequest(context, name, 'ios');
      expect(resolveRequest).toHaveBeenLastCalledWith(context, name, 'ios');
    }
  });

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
