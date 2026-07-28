// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ChainedBackend from 'i18next-chained-backend';
import HttpBackend from 'i18next-http-backend';
import LocalStorageBackend from 'i18next-localstorage-backend';
import { queueSentryMessage } from '@/lib/telemetryQueue';

export const SUPPORTED_LOCALE_CODES = [
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'ga',
  'it',
  'ja',
  'nl',
  'pl',
  'pt',
] as const;

const DEV_MISSING_KEY_PREFIX = '[missing]';
const loggedMissingKeys = new Set<string>();
const thrownMissingKeys = new Set<string>();
const sentryReportedKeys = new Set<string>();
const STRICT_MISSING_KEY_STORAGE_KEY = 'nexus_i18n_strict_missing_keys';
const isVitest = import.meta.env.MODE === 'test' || Boolean(import.meta.env.VITEST);
const isInteractiveDev = import.meta.env.DEV && !isVitest;
const localeBackends = import.meta.env.DEV ? [HttpBackend] : [LocalStorageBackend, HttpBackend];
const PRODUCTION_LOCALE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const localeBackendOptions = import.meta.env.DEV
  ? [
      {
        // Dev must not reuse stale namespace payloads from localStorage. Missing-key
        // fixes should be visible on reload without clearing browser storage.
        loadPath: `/locales/{{lng}}/{{ns}}.json?v=${Date.now()}`,
      },
    ]
  : [
      {
        expirationTime: PRODUCTION_LOCALE_CACHE_TTL_MS,
        prefix: `i18n_${__BUILD_COMMIT__}_`,
      },
      {
        loadPath: `/locales/{{lng}}/{{ns}}.json?v=${__BUILD_COMMIT__}`,
      },
    ];

// The production LocalStorageBackend namespaces its cache under
// `i18n_<buildCommit>_`. Because the prefix changes on every deploy, each
// build's cached translations (11 locales × ~60 namespaces) are abandoned and
// never reclaimed — across many deploys they accumulate until localStorage hits
// its quota, at which point ANY setItem (even a tiny UI preference) throws
// QuotaExceededError and can crash a page. Purge every orphaned i18n_ cache
// whose prefix doesn't match the current build so storage stays bounded.
const I18N_CACHE_PREFIX = `i18n_${__BUILD_COMMIT__}_`;
const STARTUP_NAMESPACES = [
  'common',
  'auth',
  'errors',
  'utility',
] as const;

const purgeOrphanedI18nCaches = () => {
  if (import.meta.env.DEV) return; // LocalStorageBackend is not used in dev
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('i18n_') && !key.startsWith(I18N_CACHE_PREFIX)) {
        stale.push(key);
      }
    }
    stale.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // localStorage unavailable (private mode / blocked) — nothing to purge
  }
};

purgeOrphanedI18nCaches();

const isStrictMissingKeyMode = () => {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_I18N_STRICT_MISSING === '1') return true;

  try {
    return window.localStorage.getItem(STRICT_MISSING_KEY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const captureMissingKeyWarning = (identifier: string) => {
  queueSentryMessage(`[i18n] Missing translation key: ${identifier}`, 'warning');
};

const reportMissingKey = (identifier: string) => {
  if (isInteractiveDev && !loggedMissingKeys.has(identifier)) {
    loggedMissingKeys.add(identifier);
    console.error(`[i18n] Missing translation key: ${identifier}`);
  }

  if (isStrictMissingKeyMode() && !thrownMissingKeys.has(identifier)) {
    thrownMissingKeys.add(identifier);
    queueMicrotask(() => {
      throw new Error(`[i18n] Missing translation key: ${identifier}`);
    });
  }

  // Production: report to Sentry once per session so missing keys surface as alerts
  if (!import.meta.env.DEV && !sentryReportedKeys.has(identifier)) {
    sentryReportedKeys.add(identifier);
    captureMissingKeyWarning(identifier);
  }
};

const formatMissingKey = (key: string, fallbackText?: string) => {
  // Honor caller-supplied fallback text when present — i18next's own fallback
  // is suppressed once parseMissingKeyHandler is set, so forward it explicitly.
  if (typeof fallbackText === 'string' && fallbackText.length > 0 && fallbackText !== key) {
    return fallbackText;
  }
  return isInteractiveDev ? `${DEV_MISSING_KEY_PREFIX} ${key}` : key;
};

// Guarded. In the browser nothing initialises i18next before this module, so the
// guard is a no-op in production. In tests it is load-bearing: src/test/setup.ts
// initialises i18next up front with the committed English JSON so components
// render the real strings users see, and this module is pulled in transitively by
// @/lib/api, AuthContext, TenantContext and useMenus — i.e. by most page tests.
// Re-initialising there replaced those resources with a ChainedBackend that
// cannot fetch under jsdom, so every key went missing and fell through
// parseMissingKeyHandler. That handler's output depends on isInteractiveDev,
// which is why the same assertion could pass locally and fail in CI, or vice
// versa. Leaving an initialised instance alone keeps the two environments honest.
if (!i18n.isInitialized) {
  i18n
    .use(ChainedBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      fallbackLng: 'en',
      supportedLngs: SUPPORTED_LOCALE_CODES as unknown as string[],
      nonExplicitSupportedLngs: false,
      load: 'currentOnly',
      cleanCode: true,
      saveMissing: isInteractiveDev,
      appendNamespaceToMissingKey: isInteractiveDev,
      parseMissingKeyHandler: formatMissingKey,
      missingKeyHandler: (lng, ns, key) => {
        const localeList = Array.isArray(lng) ? lng.join(',') : lng || 'unknown';
        reportMissingKey(`${ns}:${key} [${localeList}]`);
      },
      // Tenant-aware filtering still happens in LanguageSwitcher. supportedLngs keeps
      // detection and fallback behavior constrained to the locales we actually ship.
      defaultNS: 'common',
      // Keep startup lean. Passing every known namespace here makes i18next fetch
      // all locale JSON files before login can settle. Component-level
      // useTranslation('namespace') calls still lazy-load their own namespaces.
      ns: [...STARTUP_NAMESPACES],
      debug: isInteractiveDev,

      interpolation: {
        escapeValue: false, // React already escapes values
      },

      backend: {
        backends: localeBackends,
        backendOptions: localeBackendOptions,
      },

      detection: {
        // Check localStorage first, then browser language, then <html lang>
        order: ['localStorage', 'navigator', 'htmlTag'],
        caches: ['localStorage'],
        lookupLocalStorage: 'nexus_language',
      },
    });
}

/** Languages that use right-to-left script direction. */
const RTL_LANGUAGES = new Set(['ar']);

const applyLangAttributes = (lng: string) => {
  document.documentElement.lang = lng;
  document.documentElement.dir = RTL_LANGUAGES.has(lng) ? 'rtl' : 'ltr';
};

// Keep <html lang="..."> and dir in sync with the active language for accessibility & SEO
i18n.on('languageChanged', applyLangAttributes);

// Apply on initial load so first paint is correct (before any languageChanged fires)
i18n.on('initialized', () => applyLangAttributes(i18n.language || 'en'));

export default i18n;
