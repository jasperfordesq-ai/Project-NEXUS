// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-i18n-literals.mjs — Reject hardcoded React and mobile UI strings using i18next-cli.
 *
 * Both the member/admin web app and the React Native app are user-facing and
 * must use translations. Technical identifiers and punctuation are filtered
 * after i18next-cli reports them.
 *
 * Usage:
 *   node scripts/check-i18n-literals.mjs
 *   node scripts/check-i18n-literals.mjs --list
 *   node scripts/check-i18n-literals.mjs --baseline
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, '.github', 'i18n-literal-baseline.json');
const MOBILE_ROOT = path.join(ROOT, 'mobile');
const MOBILE_CLI_PATH = path.join(
  ROOT,
  'react-frontend',
  'node_modules',
  'i18next-cli',
  'dist',
  'esm',
  'cli.js',
);
const MOBILE_APP_CONFIG_PATH = path.join(MOBILE_ROOT, 'app.json');
const MOBILE_LOCALES_ROOT = path.join(MOBILE_ROOT, 'locales');
const MOBILE_LANGUAGES = ['de', 'en', 'es', 'fr', 'ga', 'it', 'pt'];
const REQUIRED_NATIVE_IOS_KEYS = [
  'CFBundleDisplayName',
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSMicrophoneUsageDescription',
  // Face ID replaced the photo-library WRITE permission in the App Store
  // release candidate (e0882204e): the app never saves to the library, and
  // Apple rejects a permission string for a capability the binary does not
  // use. mobile/native-config.test.js and verify-ios-release-config.mjs both
  // assert NSPhotoLibraryAddUsageDescription is ABSENT — requiring it here
  // too made the two gates contradict each other.
  'NSFaceIDUsageDescription',
  'NSLocationWhenInUseUsageDescription',
];
const LITERAL_PATTERN = /Error: Found hardcoded string:/;
const INTERPOLATION_PATTERN = /Error: Interpolation issue:/;
const NON_TRANSLATABLE_VALUES = new Set([
  '--',
  '.ics',
  '0%',
  '95%',
  '100%',
  '€16 : €1',
  '%)',
  'AGPL-3.0-or-later',
  'Google',
  'Outlook',
  'XP',
  'KB',
  'KB)',
  'MB',
  'MB)',
  'TC',
  'cr',
  'hrs',
  'km',
  'min',
  'vs',
  'api_key',
  'hmac',
  'oauth2',
  'jwt',
  'â€”',
  'Â·',
]);
const NON_TRANSLATABLE_PATTERNS = [
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /^[\d.,]+$/,
  /^[+\-]?\d+(\.\d+)?%$/,
  /^[A-Z]{2,5}$/,
  /^[\p{P}\p{S}\d\s]+$/u,
];

const args = process.argv.slice(2);
const listMode = args.includes('--list');
const baselineMode = args.includes('--baseline');

function runI18nextLint() {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm --prefix react-frontend run i18n:lint']
    : ['--prefix', 'react-frontend', 'run', 'i18n:lint'];
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 50 * 1024 * 1024,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
  };
}

function runMobileI18nextLint() {
  const result = spawnSync(process.execPath, [MOBILE_CLI_PATH, 'lint'], {
    cwd: MOBILE_ROOT,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 50 * 1024 * 1024,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
  };
}

function validateMobileNativeLocales() {
  const errors = [];
  const appConfig = JSON.parse(fs.readFileSync(MOBILE_APP_CONFIG_PATH, 'utf8'));
  const localeFiles = appConfig?.expo?.locales ?? {};
  const configuredLanguages = Object.keys(localeFiles).sort();

  if (JSON.stringify(configuredLanguages) !== JSON.stringify(MOBILE_LANGUAGES)) {
    errors.push(
      `mobile/app.json locales must be exactly: ${MOBILE_LANGUAGES.join(', ')} ` +
      `(found: ${configuredLanguages.join(', ') || 'none'})`,
    );
  }

  const localePayloads = new Map();
  for (const language of MOBILE_LANGUAGES) {
    const relativePath = localeFiles[language];
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      errors.push(`mobile/app.json has no native locale file for ${language}`);
      continue;
    }

    const localePath = path.resolve(MOBILE_ROOT, relativePath);
    if (!localePath.startsWith(`${MOBILE_ROOT}${path.sep}`) || !fs.existsSync(localePath)) {
      errors.push(`Native locale file for ${language} does not exist inside mobile/: ${relativePath}`);
      continue;
    }

    const payload = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    localePayloads.set(language, payload);
    for (const key of REQUIRED_NATIVE_IOS_KEYS) {
      if (typeof payload?.ios?.[key] !== 'string' || payload.ios[key].trim().length === 0) {
        errors.push(`${relativePath} is missing ios.${key}`);
      }
    }
    if (typeof payload?.android?.app_name !== 'string' || payload.android.app_name.trim().length === 0) {
      errors.push(`${relativePath} is missing android.app_name`);
    }
  }

  const english = localePayloads.get('en');
  if (english) {
    for (const language of MOBILE_LANGUAGES.filter((item) => item !== 'en')) {
      const payload = localePayloads.get(language);
      if (!payload) continue;
      for (const key of REQUIRED_NATIVE_IOS_KEYS.filter((item) => item !== 'CFBundleDisplayName')) {
        if (payload.ios?.[key] === english.ios?.[key]) {
          errors.push(`${localeFiles[language]} copies the English ios.${key} instead of translating it`);
        }
      }
    }
  }

  const localizationPlugin = (appConfig?.expo?.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-localization',
  );
  for (const platform of ['ios', 'android']) {
    const supported = localizationPlugin?.[1]?.supportedLocales?.[platform];
    if (!Array.isArray(supported) || JSON.stringify([...supported].sort()) !== JSON.stringify(MOBILE_LANGUAGES)) {
      errors.push(`expo-localization supportedLocales.${platform} must declare every mobile locale`);
    }
  }

  return errors;
}

function flattenLocaleKeys(value, prefix = '', keys = new Set()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenLocaleKeys(child, fullKey, keys);
    } else {
      keys.add(fullKey);
    }
  }
  return keys;
}

function flattenLocaleValues(value, prefix = '', values = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenLocaleValues(child, fullKey, values);
    } else {
      values.set(fullKey, child);
    }
  }
  return values;
}

function interpolationVariables(value) {
  return [...String(value).matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

function snapshotMobileLocaleGaps() {
  const englishDirectory = path.join(MOBILE_LOCALES_ROOT, 'en');
  const namespaceFiles = fs.readdirSync(englishDirectory)
    .filter((file) => file.endsWith('.json'))
    .sort();
  let missingKeys = 0;
  const files = {};
  const interpolationErrors = [];

  for (const namespaceFile of namespaceFiles) {
    const englishPayload = JSON.parse(fs.readFileSync(path.join(englishDirectory, namespaceFile), 'utf8'));
    const english = flattenLocaleKeys(englishPayload);
    const englishValues = flattenLocaleValues(englishPayload);
    for (const language of MOBILE_LANGUAGES.filter((item) => item !== 'en')) {
      const localePath = path.join(MOBILE_LOCALES_ROOT, language, namespaceFile);
      if (!fs.existsSync(localePath)) {
        missingKeys += english.size;
        files[`${language}/${namespaceFile}`] = english.size;
        continue;
      }
      const translatedPayload = JSON.parse(fs.readFileSync(localePath, 'utf8'));
      const translated = flattenLocaleKeys(translatedPayload);
      const translatedValues = flattenLocaleValues(translatedPayload);
      let fileMissingKeys = 0;
      for (const key of english) {
        if (!translated.has(key)) {
          missingKeys += 1;
          fileMissingKeys += 1;
        }
      }
      if (fileMissingKeys > 0) {
        files[`${language}/${namespaceFile}`] = fileMissingKeys;
      }
      for (const [key, englishValue] of englishValues) {
        if (!translatedValues.has(key)) continue;
        const expected = interpolationVariables(englishValue);
        const actual = interpolationVariables(translatedValues.get(key));
        if (expected !== actual) {
          interpolationErrors.push(
            `${language}/${namespaceFile}:${key} interpolation variables differ (${expected || 'none'} -> ${actual || 'none'})`,
          );
        }
      }
    }
  }

  return { missingKeys, files, interpolationErrors };
}

function parseLiterals(output, scopePrefix = '') {
  const literals = [];
  const interpolationDiagnostics = [];
  let diagnosticCount = 0;
  let currentFile = '';

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (/^(src|app|components|lib)[\\/].+\.(tsx?|jsx?)$/.test(line.trim())) {
      currentFile = line.trim();
      continue;
    }

    if (INTERPOLATION_PATTERN.test(line)) {
      interpolationDiagnostics.push(`${scopePrefix}${currentFile || 'unknown file'}: ${line.trim()}`);
      continue;
    }

    if (!LITERAL_PATTERN.test(line)) {
      continue;
    }

    if (!currentFile) {
      continue;
    }

    diagnosticCount += 1;

    const match = line.match(/^\s*(\d+):\s*Error: Found hardcoded string:\s*(.*)$/);
    const value = match ? match[2] : line.trim();
    if (isIgnorableLiteral(value)) {
      continue;
    }

    literals.push({
      file: `${scopePrefix}${currentFile.replace(/\\/g, '/')}`,
      line: match ? Number(match[1]) : null,
      value,
    });
  }

  return { literals, interpolationDiagnostics, diagnosticCount };
}

function normaliseLiteralValue(rawValue) {
  const trimmed = rawValue.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return parsed.trim();
    }
  } catch {
    // i18next-cli can print the first line of a multiline string; keep raw text.
  }
  return trimmed.replace(/^"+|"+$/g, '').trim();
}

function isIgnorableLiteral(rawValue) {
  const value = normaliseLiteralValue(rawValue);
  if (NON_TRANSLATABLE_VALUES.has(value)) {
    return true;
  }
  return NON_TRANSLATABLE_PATTERNS.some((pattern) => pattern.test(value));
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return { count: 0 };
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function summarizeByFile(literals) {
  const counts = new Map();
  for (const literal of literals) {
    counts.set(literal.file, (counts.get(literal.file) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

const lintResult = runI18nextLint();
const mobileLintResult = runMobileI18nextLint();
const nativeLocaleErrors = validateMobileNativeLocales();
const parsedLint = parseLiterals(lintResult.output);
const parsedMobileLint = parseLiterals(mobileLintResult.output, 'mobile/');
const literals = [...parsedLint.literals, ...parsedMobileLint.literals];
const mobileLocaleGapSnapshot = snapshotMobileLocaleGaps();
nativeLocaleErrors.push(...mobileLocaleGapSnapshot.interpolationErrors);
const byFile = summarizeByFile(literals);
const interpolationDiagnostics = [
  ...parsedLint.interpolationDiagnostics,
  ...parsedMobileLint.interpolationDiagnostics,
];

if (lintResult.status !== 0 && parsedLint.diagnosticCount === 0) {
  console.error('i18next-cli lint failed, but no hardcoded-string diagnostics were parsed.');
  console.error(lintResult.output.trim());
  process.exit(lintResult.status);
}

if (mobileLintResult.status !== 0 && parsedMobileLint.diagnosticCount === 0) {
  console.error('Mobile i18next-cli lint failed, but no hardcoded-string diagnostics were parsed.');
  console.error(mobileLintResult.output.trim());
  process.exit(mobileLintResult.status);
}

if (interpolationDiagnostics.length > 0) {
  console.error('i18next-cli found interpolation callsite errors:');
  for (const diagnostic of interpolationDiagnostics) {
    console.error(`  - ${diagnostic}`);
  }
  process.exit(1);
}

if (nativeLocaleErrors.length > 0) {
  console.error('Mobile native-locale validation failed:');
  for (const error of nativeLocaleErrors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

if (baselineMode) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({
      count: literals.length,
      updated: new Date().toISOString(),
      source: 'scripts/check-i18n-literals.mjs',
      scope: 'react-frontend/src (except lawyer-controlled platform legal pages) and mobile app/components/lib',
      localeGaps: {
        mobileMissingKeys: mobileLocaleGapSnapshot.missingKeys,
      },
      topFiles: byFile.slice(0, 25),
    }, null, 2)}\n`,
  );
  console.log(`Baseline written: ${literals.length} web/mobile hardcoded string(s).`);
  process.exit(0);
}

if (listMode) {
  for (const literal of literals) {
    const line = literal.line === null ? '' : `:${literal.line}`;
    console.log(`${literal.file}${line} ${literal.value}`);
  }
  if (literals.length > 0) {
    console.log('');
  }
}

const baseline = loadBaseline();
const mobileMissingKeysBaseline = baseline.localeGaps?.mobileMissingKeys;
const mobileLocaleGapsRegressed =
  typeof mobileMissingKeysBaseline !== 'number' ||
  mobileLocaleGapSnapshot.missingKeys > mobileMissingKeysBaseline;

console.log('============================================================');
console.log('  Web + Mobile i18n Literal String Check');
console.log('============================================================');
console.log(`  Current UI literals:        ${literals.length}`);
console.log(`  Baseline:                   ${baseline.count}`);
console.log('  Scope:                      member/admin web + mobile (legal corpus separately governed)');
console.log(`  Mobile locale-key gaps:     ${mobileLocaleGapSnapshot.missingKeys}`);
console.log(`  Mobile interpolation gaps:  ${mobileLocaleGapSnapshot.interpolationErrors.length}`);
if (args.includes('--details')) {
  for (const [file, count] of Object.entries(mobileLocaleGapSnapshot.files)) {
    console.log(`    ${file}: ${count}`);
  }
}

if (literals.length > baseline.count || mobileLocaleGapsRegressed) {
  console.error('');
  if (literals.length > baseline.count) {
    console.error(`  FAIL: ${literals.length - baseline.count} new web/mobile literal string(s) introduced.`);
  }
  if (mobileLocaleGapsRegressed) {
    console.error(
      `  FAIL: Mobile locale-key gaps increased from ${mobileMissingKeysBaseline ?? 'no baseline'} ` +
      `to ${mobileLocaleGapSnapshot.missingKeys}.`,
    );
  }
  console.error('');
  console.error('  Top files currently carrying literals:');
  for (const item of byFile.slice(0, 10)) {
    console.error(`   ${item.file}: ${item.count}`);
  }
  console.error('');
  console.error('  Fix new UI strings with t()/Trans, or refresh the baseline only after review:');
  console.error('   node scripts/check-i18n-literals.mjs --baseline');
  process.exit(1);
}

if (literals.length < baseline.count) {
  console.log('');
  console.log(`  ${baseline.count - literals.length} literal string(s) fixed. Run --baseline to lock in the improvement.`);
}

if (
  typeof mobileMissingKeysBaseline === 'number' &&
  mobileLocaleGapSnapshot.missingKeys < mobileMissingKeysBaseline
) {
  console.log(
    `  ${mobileMissingKeysBaseline - mobileLocaleGapSnapshot.missingKeys} mobile locale-key gap(s) fixed. ` +
    'Run --baseline to lock in the improvement.',
  );
}

console.log('  No literal-string regression.');
process.exit(0);
