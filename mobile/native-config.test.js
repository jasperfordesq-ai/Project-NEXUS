// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

const root = __dirname;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function readPngSize(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

/** Every file with `name` anywhere under `absoluteDir`; empty when the directory is absent. */
function findFiles(absoluteDir, name) {
  if (!fs.existsSync(absoluteDir)) return [];

  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) return findFiles(full, name);
    return entry.name === name ? [full] : [];
  });
}

function listSourceFiles(relativeDir) {
  const dir = path.join(root, relativeDir);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      return listSourceFiles(relativePath);
    }
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [relativePath] : [];
  });
}

describe('native app configuration', () => {
  it('uses HeroUI Native and native gesture/animation packages, not web HeroUI', () => {
    const pkg = readJson('package.json');
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

    expect(deps['heroui-native']).toBeTruthy();
    expect(deps['uniwind']).toBeTruthy();
    expect(deps['react-native-reanimated']).toBeTruthy();
    expect(deps['react-native-gesture-handler']).toBeTruthy();
    expect(deps['react-native-worklets']).toBeTruthy();
    expect(deps['expo-font']).toBeTruthy();
    expect(deps['expo-system-ui']).toBeTruthy();
    expect(deps['@heroui/react']).toBeUndefined();
    expect(deps['@nextui-org/react']).toBeUndefined();
  });

  it('has no web HeroUI imports in mobile source files', () => {
    const sourceFiles = [
      ...listSourceFiles('app'),
      ...listSourceFiles('components'),
      ...listSourceFiles('lib'),
    ];
    const offenders = sourceFiles.filter((relativePath) => {
      const source = read(relativePath);
      return /@heroui\/(?!native)|@nextui|@nextui-org\/react|@heroui\/react/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps react-native-reanimated as the last Babel plugin', () => {
    const factory = require('./babel.config.js');
    const config = factory({ cache: jest.fn() });

    expect(config.presets).toContain('babel-preset-expo');
    expect(config.plugins.at(-1)).toBe('react-native-reanimated/plugin');
  });

  it('wraps Metro with Uniwind and transforms native ESM packages', () => {
    const metroConfig = read('metro.config.js');

    expect(metroConfig).toContain('withUniwindConfig(config');
    expect(metroConfig).toContain("cssEntryFile: './global.css'");
    expect(metroConfig).toContain("dtsFile: './uniwind-types.d.ts'");
    expect(metroConfig).toContain('heroui-native');
    expect(metroConfig).toContain('react-native-reanimated');
    expect(metroConfig).toContain('react-native-gesture-handler');
    expect(metroConfig).toContain('react-native-worklets');
    expect(metroConfig).toContain('uniwind');
    expect(metroConfig).toContain('inlineRequires: true');
  });

  it('loads Tailwind v4, Uniwind, and HeroUI Native styles from global CSS', () => {
    const globalCss = read('global.css');

    expect(globalCss).toContain("@import 'tailwindcss'");
    expect(globalCss).toContain("@import 'uniwind'");
    expect(globalCss).toContain("@import 'heroui-native/styles'");
    expect(globalCss).toContain("@source './node_modules/heroui-native/lib'");
  });

  it('keeps common native navigation labels translated', () => {
    const common = readJson('locales/en/common.json');

    expect(common.back).toBe('Back');
    expect(common.buttons.back).toBe('Back');
  });

  it('configures Face ID and localizes its usage description in every native locale', () => {
    const app = readJson('app.json').expo;
    const localAuthenticationPlugin = app.plugins.find((plugin) => {
      return Array.isArray(plugin) && plugin[0] === 'expo-local-authentication';
    });

    expect(localAuthenticationPlugin).toEqual([
      'expo-local-authentication',
      {
        faceIDPermission: 'Use Face ID to unlock the Timebank Global session already saved on this device.',
      },
    ]);

    const localeFiles = Object.values(app.locales);
    expect(localeFiles).toHaveLength(7);
    for (const localeFile of localeFiles) {
      const locale = readJson(localeFile);
      expect(locale.ios.NSFaceIDUsageDescription).toEqual(expect.any(String));
      expect(locale.ios.NSFaceIDUsageDescription.trim()).not.toBe('');
    }
  });

  it('declares that the app uses only exempt standard encryption on iOS', () => {
    const app = readJson('app.json').expo;

    expect(app.ios.config.usesNonExemptEncryption).toBe(false);
  });

  it('declares only the native permissions exercised by the app', () => {
    const app = readJson('app.json').expo;
    const locationPlugin = app.plugins.find((plugin) => {
      return Array.isArray(plugin) && plugin[0] === 'expo-location';
    });

    expect(locationPlugin[1]).toEqual(expect.objectContaining({
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
    }));
    expect(locationPlugin[1].locationWhenInUsePermission).toEqual(expect.any(String));
    expect(app.ios.infoPlist.NSPhotoLibraryAddUsageDescription).toBeUndefined();

    for (const localeFile of Object.values(app.locales)) {
      const locale = readJson(localeFile);
      expect(locale.ios.NSLocationWhenInUseUsageDescription).toEqual(expect.any(String));
      expect(locale.ios.NSPhotoLibraryAddUsageDescription).toBeUndefined();
    }
  });

  it('declares app-collected iOS data without tracking and aggregates SDK manifests', () => {
    const app = readJson('app.json').expo;
    const manifest = app.ios.privacyManifests;
    const collectedTypes = manifest.NSPrivacyCollectedDataTypes;
    const typeNames = collectedTypes.map((entry) => entry.NSPrivacyCollectedDataType);

    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
    expect(typeNames).toEqual(expect.arrayContaining([
      'NSPrivacyCollectedDataTypeName',
      'NSPrivacyCollectedDataTypeEmailAddress',
      'NSPrivacyCollectedDataTypePhoneNumber',
      'NSPrivacyCollectedDataTypePreciseLocation',
      'NSPrivacyCollectedDataTypePurchaseHistory',
      'NSPrivacyCollectedDataTypeUserID',
      'NSPrivacyCollectedDataTypeDeviceID',
      'NSPrivacyCollectedDataTypePhotosorVideos',
      'NSPrivacyCollectedDataTypeAudioData',
      'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
      'NSPrivacyCollectedDataTypeOtherUserContent',
      'NSPrivacyCollectedDataTypeSearchHistory',
      'NSPrivacyCollectedDataTypeProductInteraction',
      'NSPrivacyCollectedDataTypeSensitiveInfo',
    ]));
    expect(collectedTypes).not.toContainEqual(expect.objectContaining({
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePaymentInfo',
    }));
    for (const entry of collectedTypes) {
      expect(entry.NSPrivacyCollectedDataTypeLinked).toBe(true);
      expect(entry.NSPrivacyCollectedDataTypeTracking).toBe(false);
      expect(entry.NSPrivacyCollectedDataTypePurposes.length).toBeGreaterThan(0);
    }

    const buildProperties = app.plugins.find((plugin) => {
      return Array.isArray(plugin) && plugin[0] === 'expo-build-properties';
    });
    expect(buildProperties[1].ios.deploymentTarget).toBe('15.1');
    expect(buildProperties[1].ios.useFrameworks).toBeUndefined();
    expect(buildProperties[1].ios.privacyManifestAggregationEnabled).toBe(true);
  });

  it('places native providers and system UI at the root', () => {
    const layout = read('app/_layout.tsx');
    const gestureIndex = layout.indexOf('<GestureHandlerRootView');
    const heroIndex = layout.indexOf('<HeroUINativeProvider>');
    const safeAreaIndex = layout.indexOf('<SafeAreaProvider>');
    // StatusBar now lives in <ThemedShell/> (mounted inside the provider stack)
    // and its style follows the active light/dark scheme.
    const themedShellIndex = layout.indexOf('<ThemedShell />');
    const statusIndex = layout.indexOf('<StatusBar style={');

    expect(gestureIndex).toBeGreaterThan(-1);
    expect(heroIndex).toBeGreaterThan(gestureIndex);
    expect(safeAreaIndex).toBeGreaterThan(heroIndex);
    // ThemedShell (which renders StatusBar) is mounted after SafeAreaProvider.
    expect(themedShellIndex).toBeGreaterThan(safeAreaIndex);
    expect(statusIndex).toBeGreaterThan(-1);
  });

  it('bundles native fonts and assets into Android release builds', () => {
    const app = readJson('app.json').expo;

    expect(app.plugins).toEqual(expect.arrayContaining(['expo-font']));
    expect(app.assetBundlePatterns).toEqual(expect.arrayContaining(['assets/**/*']));
    expect(app.icon).toBe('./assets/icon.png');
    // The splash image moved from the legacy top-level `splash` key to the
    // expo-splash-screen plugin, which supersedes it. Same file, one source of truth.
    const splashPlugin = app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
    expect(splashPlugin[1].image).toBe('./assets/splash.png');
    expect(app.android.adaptiveIcon.foregroundImage).toBe('./assets/adaptive-icon.png');
  });

  it('checks the pinned release channel for updates on launch', () => {
    const app = readJson('app.json').expo;

    expect(app.updates.enabled).toBe(true);
    expect(app.updates.checkAutomatically).toBe('ON_LOAD');
    expect(app.updates.fallbackToCacheTimeout).toBe(0);
  });

  /*
    🔴 A locally built Play bundle listens to NO update channel unless app.json says which.
    EAS writes the channel into a cloud build itself; `scripts/build-aab-play.sh` — the
    recipe for the bundle that actually goes to Play — gets it only from here. Found on
    2026-09-10 by opening the version code 8 bundle: no channel, so the Expo update service
    would never have served it anything, and no over-the-air fix could reach those phones.
    The channel must be the one the store build profile is pinned to, or a publish aimed at
    "the store build" lands on a channel the store build does not read.
  */
  it('bakes the store update channel into locally built bundles', () => {
    const app = readJson('app.json').expo;
    const eas = readJson('eas.json');

    expect(app.updates.requestHeaders['expo-channel-name']).toBe('production');
    expect(app.updates.requestHeaders['expo-channel-name']).toBe(eas.build.production.channel);
  });

  it('configures a branded splash while React is booting', () => {
    const app = readJson('app.json').expo;
    const splashPlugin = app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
    const splash = splashPlugin?.[1];

    /*
      🔴 Configured through the plugin, not the legacy top-level `splash` key. The plugin
      supersedes that key when both are present, so leaving it behind would have been a
      second, dead source of truth. The key is gone; this asserts the plugin took it over.

      `cover` rather than `contain`: the artwork is a full-bleed painted 1284x2778 image, and
      `contain` letterboxed it with hard bands on any other aspect ratio. `dark` gives the
      surrounding fill the dark theme's background instead of bright blue. Audit 2026-09-09,
      item 7 — a genuinely dark splash IMAGE still needs artwork and is an owner decision.
    */
    expect(app.splash).toBeUndefined();
    expect(splash).toEqual(expect.objectContaining({
      image: './assets/splash.png',
      resizeMode: 'cover',
      backgroundColor: '#006FEE',
      enableFullScreenImage_legacy: true,
    }));
    expect(splash.dark?.backgroundColor).toBe('#0A0A0F');
    expect(app.android.adaptiveIcon.backgroundColor).toBe('#006FEE');
    expect(fs.existsSync(path.join(root, splash.image))).toBe(true);
  });

  it('holds the splash until a real screen is ready, and can never strand a member on it', () => {
    /*
      🔴 Without `expo-splash-screen` the native splash hid as soon as React rendered — and
      the first thing React renders is app/index.tsx, a bare spinner. A cold start was three
      screens: splash, blank spinner, real screen.
      The backstop matters as much as the hold: the release lives inside the provider tree,
      so a provider that throws would otherwise leave the splash up for ever.
    */
    const pkg = readJson('package.json');
    expect(pkg.dependencies['expo-splash-screen']).toBeTruthy();

    const layout = read('app/_layout.tsx');
    expect(layout).toContain('holdSplash()');
    expect(layout).toMatch(/pathname !== '\/'[\s\S]{0,80}releaseSplash\(\)/);

    // Released from the crash boundary too, which sits above the navigator.
    expect(read('components/ErrorBoundary.tsx')).toContain('releaseSplash()');

    const splashModule = read('lib/ui/splash.ts');
    expect(splashModule).toContain('SPLASH_MAX_HOLD_MS');
    expect(splashModule).toContain('preventAutoHideAsync');
  });

  it('keeps the Android notification icon in Expo-compatible dimensions', () => {
    const appConfig = require('./app.config.js')({ config: readJson('app.json').expo });
    const notificationsPlugin = appConfig.plugins.find((plugin) => {
      return Array.isArray(plugin) && plugin[0] === 'expo-notifications';
    });
    const notificationIcon = Array.isArray(notificationsPlugin)
      ? notificationsPlugin[1]?.icon
      : null;

    expect(notificationIcon).toBe('./assets/notification-icon.png');
    expect(readPngSize('assets/notification-icon.png')).toEqual({
      width: 96,
      height: 96,
    });
  });

  it('keeps Maestro flows aligned with the production native application id', () => {
    const app = readJson('app.json').expo;
    const maestroDir = path.join(root, '.maestro');
    const flows = fs.readdirSync(maestroDir).filter((file) => file.endsWith('.yaml') && file !== 'config.yaml');
    const mismatched = flows.filter((file) => {
      const source = read(path.join('.maestro', file));
      return !source.includes(`appId: ${app.android.package}`);
    });

    expect(app.android.package).toBe(app.ios.bundleIdentifier);
    expect(mismatched).toEqual([]);
  });

  it('documents the native local API port consistently', () => {
    const envExample = read('.env.example');

    expect(envExample).toContain('http://10.0.2.2:8090');
    expect(envExample).toContain('http://localhost:8090');
  });

  /**
   * 🔴 Google Play asks about every permission an app declares, and this app was asking to
   * draw over other apps.
   *
   * `SYSTEM_ALERT_WINDOW` is React Native's development overlay (the red box, the dev menu).
   * `expo-dev-client` puts it in the DEBUG manifest, where it belongs — but it was also in
   * `main`, which ships. Measured on the generated project on 2026-08-25: it appeared in
   * `android/app/src/main/AndroidManifest.xml`, so a release build declared "Display over
   * other apps" while nothing in the app draws an overlay. That is a review question at
   * best, and a reason to look harder at everything else at worst.
   *
   * The permission list is asserted whole, not just for the overlay: a permission arriving
   * with some future dependency should be a decision, not a surprise noticed by a reviewer.
   *
   * `android/` is gitignored and regenerated by prebuild, so app.json is the only source of
   * truth a test can rely on — the generated manifest is checked too, but only when a local
   * build happens to have produced one.
   */
  it('declares only the permissions the app actually uses, and blocks the dev overlay', () => {
    const app = readJson('app.json').expo;

    expect(app.android.permissions).toEqual([
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.CAMERA',
    ]);
    expect(app.android.blockedPermissions).toContain('android.permission.SYSTEM_ALERT_WINDOW');
  });

  it('keeps the dev overlay out of the shipping manifest when one has been generated', () => {
    // 🔴 `blockedPermissions` does NOT delete the line — Expo emits it with
    // `tools:node="remove"` so the Android manifest merger strips it, which is what
    // actually keeps it out of the built artefact. A first version of this test asserted
    // the string was absent, went red against a correctly-configured project, and would
    // have been "fixed" by deleting the guard.
    const source = 'android/app/src/main/AndroidManifest.xml';
    if (fs.existsSync(path.join(root, source))) {
      const text = read(source);
      const declarations = text
        .split('\n')
        .filter((line) => line.includes('android.permission.SYSTEM_ALERT_WINDOW'));
      for (const line of declarations) {
        expect(line).toContain('tools:node="remove"');
      }
    }

    // The merged manifest is the real artefact — the one Play reads. It exists only after a
    // release build, so this arm is opportunistic; when it runs it is the assertion that
    // cannot be fooled.
    //
    // 🔴 Found by mutation-testing this very test: it hardcoded
    // `merged_manifests/release/AndroidManifest.xml`, while AGP 8.14 writes
    // `merged_manifests/release/processReleaseManifest/AndroidManifest.xml`. `existsSync`
    // was false, the arm silently skipped, and putting the permission back into the real
    // merged manifest did not turn this test red. Searching for the file survives AGP
    // moving it again.
    const mergedRoot = path.join(root, 'android/app/build/intermediates/merged_manifests');
    // Debug manifests intentionally contain the development overlay permission
    // supplied by React Native. They are never uploaded to Play and must not make
    // this shipping-artifact assertion fail merely because a developer built an
    // emulator APK before running Jest.
    const merged = findFiles(mergedRoot, 'AndroidManifest.xml')
      .filter((file) => /[\\/]release[\\/]/i.test(file));
    for (const file of merged) {
      expect({ file: path.relative(root, file), overlay: read(path.relative(root, file)).includes('android.permission.SYSTEM_ALERT_WINDOW') })
        .toEqual({ file: path.relative(root, file), overlay: false });
    }
  });

  /**
   * 🔴 Google Play's anti-steering rule, which is a SEPARATE violation from the billing one.
   *
   * An app may not send someone out to buy, elsewhere, the thing it is not allowed to sell
   * in-app. The identity screen had exactly that: a "Open web verification flow" button
   * calling `Linking.openURL(APP_URL + '/settings/verify-identity')`, sitting directly under
   * the in-app pay button. Both are gone (owner decision, 2026-08-25 — see
   * IDENTITY_VERIFICATION_AVAILABLE_IN_APP), and this stops the link coming back.
   *
   * Scoped to the paid verification path deliberately. The app opens plenty of URLs and
   * should keep doing so — the marketplace's Stripe payments are for second-hand physical
   * goods, which Play explicitly exempts.
   */
  it('never links out to the paid identity verification flow', () => {
    // The two payment modules for NON-Android targets are the allowed exceptions, and they
    // are listed rather than pattern-excluded so a third one cannot appear quietly. Metro
    // resolves `identityPayment.native.ts` on Android, so neither of these is in the app
    // Play receives; both are also unreachable while the flow is switched off.
    const allowed = [
      path.join('lib', 'payments', 'identityPayment.ts'),
      path.join('lib', 'payments', 'identityPayment.web.ts'),
    ];
    const offenders = listSourceFiles('app')
      .concat(listSourceFiles('lib'), listSourceFiles('components'))
      .filter((file) => !/\.test\.[jt]sx?$/.test(file))
      .filter((file) => /settings\/verify-identity/.test(read(file)))
      .filter((file) => !allowed.includes(file));

    expect(offenders).toEqual([]);
  });

  it('does not ship the web identity redirect to Android', () => {
    // The exceptions above are only safe because Android resolves the `.native` variant.
    // If that file stopped existing, Metro would fall back to `identityPayment.ts` — the one
    // that opens the website — and the anti-steering guard above would be exempting a file
    // that really does ship.
    expect(fs.existsSync(path.join(root, 'lib/payments/identityPayment.native.ts'))).toBe(true);
    expect(read('lib/payments/identityPayment.native.ts')).not.toContain('settings/verify-identity');
  });

  it('keeps the generated network-security source fail-closed', () => {
    const networkConfig = read('android-network-security-config.xml');

    expect(networkConfig).not.toContain('cleartextTrafficPermitted="true"');
    expect(networkConfig).not.toContain('10.0.2.2');
    expect(networkConfig).not.toContain('localhost');
    expect(networkConfig).toContain('<base-config cleartextTrafficPermitted="false">');
  });

  /**
   * 🔴 Apple's review guideline 5.1.1 requires each purpose string to describe what the app
   * actually does with the data, and a reviewer checks it against the running app. Three of
   * ours described a narrower app than the one we ship: the camera string named only
   * marketplace QR codes while the camera also scans event check-in codes; the photo-library
   * string said "profile or post" while photos are chosen for listings, events, groups,
   * marketplace items and organisation logos, and VIDEOS are chosen too; the location string
   * named only nearby marketplace listings while the Listings tab uses location as well.
   *
   * These assertions tie each string to the code path that needs it. A new use of a
   * protected resource fails here until its purpose string says so. Audit 2026-09-09, item 4.
   */
  describe('iOS purpose strings describe what the app really does', () => {
    const appConfig = readJson('app.json');
    const infoPlist = appConfig.expo.ios.infoPlist;

    function pluginOptions(name) {
      const entry = appConfig.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name);
      return entry ? entry[1] : null;
    }

    it('names both things the camera scans', () => {
      // marketplace-tools.tsx scans marketplace QR codes; EventOfflineCheckinCard.tsx scans
      // event check-in codes. Both reach the same permission.
      for (const description of [infoPlist.NSCameraUsageDescription, pluginOptions('expo-camera').cameraPermission]) {
        expect(description).toMatch(/marketplace/i);
        expect(description).toMatch(/check-in/i);
      }
    });

    it('says the photo library is used for videos too, not only a profile picture', () => {
      const description = infoPlist.NSPhotoLibraryUsageDescription;
      // group-detail.tsx and new-marketplace-listing.tsx both pick MediaType videos.
      expect(description).toMatch(/video/i);
      expect(description).toMatch(/listing/i);
      expect(description).toMatch(/event/i);
    });

    it('says location serves listings as well as the marketplace', () => {
      // exchanges.tsx (the Listings tab) requests foreground location, not just marketplace-map.tsx.
      const description = pluginOptions('expo-location').locationWhenInUsePermission;
      expect(description).toMatch(/listing/i);
      expect(description).toMatch(/marketplace/i);
      /*
        🔴 The two assertions above are not enough on their own, and the control run proved
        it: the old string, "search nearby marketplace listings", contains both words and
        passed. "Marketplace listings" is a single noun phrase naming ONE use — it is exactly
        the claim that was too narrow, because timebank listings are a separate thing found
        by the same permission. The two uses have to read as two.
      */
      expect(description).not.toMatch(/marketplace listings/i);
    });

    it('configures expo-image-picker explicitly rather than relying on plugin precedence', () => {
      /*
        Left unconfigured, the plugin contributes Expo's own generic defaults ("Allow
        $(PRODUCT_NAME) to access your photos"). Today `applyPermissions` lets an existing
        infoPlist value win, so ours survived — but that is a precedence rule inside a
        dependency, not a decision of ours, and plugin order decides the camera string
        already. Setting all three here makes the shipped text ours whatever the order.
      */
      const options = pluginOptions('expo-image-picker');
      expect(options).toBeTruthy();
      expect(options.photosPermission).toBe(infoPlist.NSPhotoLibraryUsageDescription);
      expect(options.microphonePermission).toBe(infoPlist.NSMicrophoneUsageDescription);
      expect(options.cameraPermission).toBe(infoPlist.NSCameraUsageDescription);
    });

    it('leaves no purpose string as Expo\'s placeholder', () => {
      const strings = Object.entries(infoPlist).filter(([key]) => key.endsWith('UsageDescription'));
      expect(strings.length).toBeGreaterThan(0);
      for (const [, description] of strings) {
        expect(description).not.toMatch(/\$\(PRODUCT_NAME\)/);
        expect(description.length).toBeGreaterThan(30);
      }
    });
  });
});
