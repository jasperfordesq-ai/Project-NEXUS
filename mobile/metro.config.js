// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const { withSentryResolver } = require('@sentry/react-native/metro');

const config = getDefaultConfig(__dirname);
// Share Zod's ESM core between app schemas and the CommonJS form resolver.
// Its nested packages have legacy main/module fields as well as root exports.
// Both resolution paths must prefer ESM, or Metro includes a second core/locales.
// Sentry core also exposes two entry points; share its ESM implementation so
// imports and requires do not bundle duplicate instrumentation and scope code.
// Form resolvers require react-hook-form while screens import it. Share the
// same form implementation and context instead of embedding its CJS copy too.
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  if (moduleName === 'zod' || moduleName.startsWith('zod/') || moduleName === '@sentry/core' || moduleName === 'react-hook-form') {
    return resolve({
      ...context,
      isESMImport: true,
      mainFields: ['module', ...context.mainFields.filter((name) => name !== 'module')],
    }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

// Preserve Expo's exclusions and keep native build scratch directories out of
// Metro's Windows watcher: CMake creates/removes them while Gradle is running.
const defaultBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList) ? defaultBlockList : defaultBlockList ? [defaultBlockList] : []),
  /[/\\](?:\.cxx|\.gradle)[/\\]/,
  /[/\\]android[/\\](?:app[/\\])?build[/\\]/,
  // Test modules depend on testing-library and cannot be bundled.
  /.*[/\\].*\.test\.[jt]sx?$/,
  /.*[/\\].*\.spec\.[jt]sx?$/,
  /.*[/\\]jest-setup\.[jt]s$/,
];

// Enable package.json "exports" field resolution. Required for heroui-native
// which uses conditional exports to serve the correct ESM/CJS entry point.
config.resolver.unstable_enablePackageExports = true;

// heroui-native ships as ESM source (JSX/TSX inside node_modules) and must be
// transformed by Babel — same allowlist as jest.config.js transformIgnorePatterns.
// tailwind-variants and react-native-worklets are also ESM-only packages.
config.transformer.transformIgnorePatterns = [
  'node_modules/(?!(' +
    'react-native|' +
    '@react-native(-community)?|' +
    'expo|' +
    '@expo|' +
    '@expo-google-fonts|' +
    'react-navigation|' +
    '@react-navigation|' +
    '@unimodules|' +
    'sentry-expo|' +
    '@sentry/react-native|' +
    'react-native-svg|' +
    'react-native-reanimated|' +
    'react-native-worklets|' +
    'react-native-gesture-handler|' +
    '@gorhom|' +
    'heroui-native|' +
    'tailwind-variants|' +
    'nativewind|' +
    'uniwind' +
  '))',
];

// Keep module loading explicit. With the current SDK, inline requires add about
// 502 KB to the Android Hermes bundle and exceed its existing size budget.
// Android startup/navigation was compared with both settings; development
// startup samples were variable, so no signed-release speed improvement is claimed.
// Re-measure bundle size and native startup before changing either option.
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: false,
  },
});

// Per-community accent themes must be REGISTERED at build time: uniwind compiles the
// CSS variables into the bundle and offers no runtime setter for an arbitrary colour,
// so `Uniwind.setTheme()` can only reach themes named here. The names are derived from
// config/tenant-palettes.json rather than written out, so this list and the generated
// CSS cannot drift apart.
const palette = require('./config/tenant-palettes.json');
const tenantThemes = Object.keys(palette.tenants ?? {})
  .sort()
  .flatMap((slug) => ['light', 'dark'].map((scheme) => `t-${slug}-${scheme}`));

// The SDK's resolver excludes browser DOM replay from Android/iOS bundles.
// Keep its default platform selection so Expo Web retains its existing behaviour.
module.exports = withSentryResolver(withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
  extraThemes: tenantThemes,
}));
