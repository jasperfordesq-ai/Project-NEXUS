// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const readJson = (relativePath) => JSON.parse(
  fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8'),
);

const app = readJson('app.json').expo;
const eas = readJson('eas.json');
const mobilePackage = readJson('package.json');
const storeMetadata = readJson('store-listing/apple/en-GB.json');
const easStoreConfig = require(path.join(mobileRoot, 'store.config.js'));
const aasaPath = path.resolve(mobileRoot, '../react-frontend/public/.well-known/apple-app-site-association');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const appIcon = fs.readFileSync(path.join(mobileRoot, 'assets/icon.png'));
const pngSignature = '89504e470d0a1a0a';
assert(appIcon.subarray(0, 8).toString('hex') === pngSignature, 'iOS app icon must be a PNG');
if (appIcon.subarray(0, 8).toString('hex') === pngSignature && appIcon.length >= 26) {
  assert(appIcon.readUInt32BE(16) === 1024, 'iOS app icon must be 1024 pixels wide');
  assert(appIcon.readUInt32BE(20) === 1024, 'iOS app icon must be 1024 pixels high');
  assert(
    ![4, 6].includes(appIcon[25]),
    'iOS app icon PNG must not contain an alpha channel',
  );
}

assert(app.ios?.bundleIdentifier === 'ie.project.nexus', 'iOS bundle identifier must remain ie.project.nexus');
assert(
  /^\d+$/.test(app.ios?.buildNumber ?? '') && Number(app.ios.buildNumber) > 1,
  'iOS buildNumber must be an explicit positive integer greater than the initial build',
);
assert(app.scheme === 'nexus', 'native callback scheme must remain nexus for Stripe and deep links');
assert(app.ios?.config?.usesNonExemptEncryption === false, 'iOS exempt-encryption declaration must be explicit');
assert(app.ios?.supportsTablet === false, 'first iOS release must remain iPhone-only until iPad is walked');
assert(
  app.ios?.associatedDomains?.includes('applinks:app.project-nexus.ie'),
  'iOS associated domains must include app.project-nexus.ie',
);
assert(
  fs.existsSync(aasaPath),
  'generate the real apple-app-site-association file after the Apple Team ID is available',
);
if (fs.existsSync(aasaPath)) {
  try {
    const aasa = JSON.parse(fs.readFileSync(aasaPath, 'utf8'));
    const appIDs = aasa?.applinks?.details?.flatMap((entry) => entry?.appIDs ?? []) ?? [];
    assert(
      appIDs.some((appID) => /^[A-Z0-9]{10}\.ie\.project\.nexus$/.test(appID)),
      'AASA must contain the real Apple Team ID joined to ie.project.nexus',
    );
  } catch {
    assert(false, 'apple-app-site-association must be valid JSON');
  }
}
assert(app.ios?.privacyManifests?.NSPrivacyTracking === false, 'iOS privacy manifest must explicitly disable tracking');
assert(app.ios?.privacyManifests?.NSPrivacyTrackingDomains?.length === 0, 'iOS privacy manifest must not declare tracking domains');
const privacyDataTypes = app.ios?.privacyManifests?.NSPrivacyCollectedDataTypes ?? [];
assert(privacyDataTypes.length > 0, 'iOS privacy manifest must declare app-collected data');
assert(
  privacyDataTypes.every((entry) => entry.NSPrivacyCollectedDataTypeTracking === false),
  'no app-collected iOS data type may be declared for tracking',
);
assert(
  !privacyDataTypes.some((entry) => entry.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypePaymentInfo'),
  'do not declare Stripe-held card details as payment data collected by Project NEXUS',
);

const localAuthenticationPlugin = app.plugins?.find((plugin) => {
  return Array.isArray(plugin) && plugin[0] === 'expo-local-authentication';
});
assert(
  typeof localAuthenticationPlugin?.[1]?.faceIDPermission === 'string'
    && localAuthenticationPlugin[1].faceIDPermission.trim() !== '',
  'expo-local-authentication must provide a Face ID usage description',
);
const locationPlugin = app.plugins?.find((plugin) => {
  return Array.isArray(plugin) && plugin[0] === 'expo-location';
});
assert(
  locationPlugin?.[1]?.locationAlwaysAndWhenInUsePermission === false
    && locationPlugin?.[1]?.locationAlwaysPermission === false
    && locationPlugin?.[1]?.isIosBackgroundLocationEnabled === false,
  'iOS location must remain foreground-only without Always permission declarations',
);
assert(
  app.ios?.infoPlist?.NSPhotoLibraryAddUsageDescription === undefined,
  'do not declare photo-library write access when the app only selects existing media',
);

for (const [locale, localeFile] of Object.entries(app.locales ?? {})) {
  const nativeLocale = readJson(localeFile.replace(/^\.\//, ''));
  assert(
    typeof nativeLocale.ios?.NSFaceIDUsageDescription === 'string'
      && nativeLocale.ios.NSFaceIDUsageDescription.trim() !== '',
    `${locale} native locale must include NSFaceIDUsageDescription`,
  );
}

assert(Boolean(eas.build?.preview?.ios), 'preview profile must define an iOS cloud builder');
assert(Boolean(eas.build?.production?.ios), 'production profile must define an iOS cloud builder');
assert(eas.build?.['ios-simulator']?.ios?.simulator === true, 'unsigned iOS simulator compile profile must remain available');
assert(eas.build?.['ios-simulator']?.developmentClient !== true, 'iOS simulator compile proof must not depend on an uninstalled development client');
assert(eas.build?.['ios-simulator']?.environment === 'preview', 'iOS simulator compile must use the checked preview EAS environment');
assert(eas.build?.production?.channel === 'production', 'production iOS build must use the production OTA channel');
assert(
  mobilePackage.scripts?.['submit:ios:testflight'] === 'node scripts/eas-submit-ios.js',
  'TestFlight submission must use the exact-build fail-closed wrapper, never --latest',
);
const buildPropertiesPlugin = app.plugins?.find((plugin) => {
  return Array.isArray(plugin) && plugin[0] === 'expo-build-properties';
});
assert(
  buildPropertiesPlugin?.[1]?.ios?.privacyManifestAggregationEnabled === true,
  'iOS third-party privacy manifest aggregation must be explicitly enabled',
);
assert(
  buildPropertiesPlugin?.[1]?.ios?.deploymentTarget === '15.1',
  'Expo SDK 54 iOS deployment target must remain at its supported minimum of 15.1',
);
assert(
  buildPropertiesPlugin?.[1]?.ios?.useFrameworks === undefined,
  'do not enable static frameworks for the React Native 0.81 and Stripe 0.50.3 build',
);

const utf8Bytes = (value) => Buffer.byteLength(value, 'utf8');
assert(storeMetadata.name === app.name, 'App Store name must match the installed app name');
assert(storeMetadata.name.length >= 2 && storeMetadata.name.length <= 30, 'App Store name must be 2-30 characters');
assert(storeMetadata.subtitle.length <= 30, 'App Store subtitle must be at most 30 characters');
assert(storeMetadata.promotionalText.length <= 170, 'App Store promotional text must be at most 170 characters');
assert(storeMetadata.description.length <= 4000, 'App Store description must be at most 4000 characters');
assert(utf8Bytes(storeMetadata.keywords) <= 100, 'App Store keywords must be at most 100 UTF-8 bytes');
assert(storeMetadata.version === app.version, 'App Store version must match the Expo app version');
assert(storeMetadata.releaseMode === 'MANUAL', 'first Apple release must remain manual');
for (const key of ['supportUrl', 'marketingUrl', 'privacyPolicyUrl']) {
  assert(
    typeof storeMetadata[key] === 'string' && storeMetadata[key].startsWith('https://'),
    `${key} must be an HTTPS URL`,
  );
}
assert(
  fs.existsSync(path.join(mobileRoot, 'store-listing/apple/app-privacy.md')),
  'Apple privacy working answers must be present',
);
assert(
  fs.existsSync(path.join(mobileRoot, 'store-listing/apple/age-rating.md')),
  'Apple current-questionnaire age-rating working answers must be present',
);
assert(
  fs.existsSync(path.join(mobileRoot, 'store-listing/apple/screenshots.md')),
  'Apple real-iPhone screenshot capture plan must be present',
);
assert(
  fs.existsSync(path.join(mobileRoot, 'store-listing/apple/review-notes.md')),
  'Apple review notes must be present',
);
assert(
  fs.existsSync(path.join(mobileRoot, 'store-listing/apple/build-evidence.md')),
  'successful iOS cloud-build evidence must be present',
);
assert(
  fs.existsSync(path.join(mobileRoot, 'store-listing/apple/readiness-audit.md')),
  'maintained Apple readiness audit must be present',
);
assert(
  app.ios?.infoPlist?.NSCameraUsageDescription
    === 'Scan a marketplace QR code when you choose to use the scanner.',
  'iOS camera permission must describe the QR scanner actually used by the app',
);
const developerAdvertisingTypes = privacyDataTypes
  .filter((entry) => entry.NSPrivacyCollectedDataTypePurposes
    ?.includes('NSPrivacyCollectedDataTypePurposeDeveloperAdvertising'))
  .map((entry) => entry.NSPrivacyCollectedDataType);
for (const requiredType of [
  'NSPrivacyCollectedDataTypePreciseLocation',
  'NSPrivacyCollectedDataTypeCoarseLocation',
  'NSPrivacyCollectedDataTypeUserID',
  'NSPrivacyCollectedDataTypeDeviceID',
  'NSPrivacyCollectedDataTypeOtherDataTypes',
]) {
  assert(
    developerAdvertisingTypes.includes(requiredType),
    `${requiredType} must retain the conservative developer-marketing purpose while paid campaigns exist`,
  );
}
assert(eas.submit?.production?.ios?.metadataPath === './store.config.js', 'iOS submission must use the checked EAS metadata config');
assert(easStoreConfig.configVersion === 0, 'EAS metadata config version must be supported');
assert(easStoreConfig.apple?.info?.['en-GB']?.title === storeMetadata.name, 'EAS English (UK) metadata must use the checked store copy');
assert(easStoreConfig.apple?.release?.automaticRelease === false, 'EAS metadata must require manual Apple release');
assert(
  easStoreConfig.apple?.info?.['en-GB']?.privacyChoicesUrl === storeMetadata.privacyChoicesUrl,
  'EAS metadata must publish the account-deletion privacy choices URL',
);

const ascAppId = eas.submit?.production?.ios?.ascAppId;
assert(
  typeof ascAppId === 'string' && /^\d+$/.test(ascAppId),
  'replace the App Store Connect app ID placeholder with the numeric Apple ID before submission',
);

if (failures.length) {
  console.error('iOS release configuration is not ready:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('iOS release configuration checks passed.');
