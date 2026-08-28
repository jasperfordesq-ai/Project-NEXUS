// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Accessibility — the platform targets WCAG 2.1 AA. Until 2026-08-28 the only
  // machine check was scripts/check-nested-interactive.mjs, so the codebase was
  // accessibility-clean by discipline alone and nothing stopped a regression.
  // The recommended set is enabled wholesale. Exactly two of its rules are
  // switched off further down, each with its reason and its finding count; the
  // handful of remaining sites carry a one-line suppression at the element
  // itself. Most of those are HeroUI v3 compound components — a card div whose
  // real control is a nested HeroUI Radio or Checkbox — which the plugin cannot
  // see into, so it reports the wrapper as an inaccessible control.
  jsxA11y.flatConfigs.recommended,

  {
    plugins: { 'react-hooks': reactHooks, i18next },
    rules: {
      // React Hooks — violations here are real runtime bugs, keep as errors
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // TypeScript — warn only so brownfield code doesn't block commits
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/triple-slash-reference': 'warn',

      // Disable no-undef for TypeScript — TS compiler catches undefined variables
      // and no-undef doesn't understand TS type-aware scoping (false positives on
      // globals like console, require, etc.). See:
      // https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-defined-in-my-files
      'no-undef': 'off',

      // JS — warn only
      'no-empty': 'warn',

      // console.error bypasses logError(), which is the only path that forwards
      // an error to Sentry in production. 13 call sites in the admin, GDPR and
      // WebAuthn screens were silently losing production errors until
      // 2026-08-28; this rule stops that class of mistake coming back.
      // Only `error` is restricted — warn/info/debug are dev-only in logger.ts
      // anyway, and deliberate console use is exempted per-file below.
      'no-console': ['error', { allow: ['warn', 'info', 'debug', 'log', 'table', 'group', 'groupCollapsed', 'groupEnd'] }],

      // i18n — catch hardcoded strings in JSX markup (between tags and in common attributes)
      // markupOnly: true limits scope to JSX text nodes — won't flag JS constants or config strings
      'i18next/no-literal-string': ['warn', { markupOnly: true }],
    },
  },
  {
    // Two rules from the recommended set are deliberately OFF platform-wide.
    // Everything else in the set is on at its recommended severity, and the
    // remaining sites are suppressed one line at a time at the exact element,
    // with the reason written there.
    rules: {
      // OFF — 44 findings (2026-08-28), and fixing them would make the product
      // LESS accessible, not more. Every one is `autoFocus` on the first field
      // of a modal, drawer, bottom sheet, search overlay or inline edit form
      // (ConfirmModal, SearchOverlay, QuotePostModal, CommentsSection, the
      // mobile compose overlay, and so on). WAI-ARIA APG's dialog pattern
      // *requires* focus to move into the dialog when it opens, so `autoFocus`
      // there is the correct implementation of it. The rule exists to catch
      // autofocus on page load, which steals focus from a user who never asked
      // for it — but it cannot tell a page-load field from a dialog field, so
      // it reports both. No WCAG 2.1 AA success criterion is failed by any of
      // the 44 sites. If a page-load autofocus is ever added, the reviewer has
      // to catch it; this rule will not.
      'jsx-a11y/no-autofocus': 'off',

      // OFF — 9 findings (2026-08-28), and this one is an HONEST DEFERRAL, not
      // a false positive. All nine are <video>/<audio> elements playing
      // member-uploaded media (feed carousel, lightbox, VideoPlayer, stories,
      // group media, marketplace listings, the course player, podcasts admin).
      // WCAG 1.2.2 (Captions, Prerecorded) does apply to them, so this is a
      // real gap — but it is a PRODUCT gap: there is no caption/subtitle upload
      // field anywhere in the platform, so there is no <track> file for these
      // elements to reference and nothing a code change here can point at.
      // Leaving the rule on would mean nine permanent inline suppressions that
      // read as "reviewed and fine", which is worse than one honest note.
      // Turn this rule back on in the same change that ships caption uploads.
      'jsx-a11y/media-has-caption': 'off',
    },
  },
  {
    // Admin UI is end-user output too. Keep JSX literals as a blocking error;
    // true protocol/code/command samples require a narrow documented inline
    // suppression at the exact rendered technical literal. The broker app is
    // staff-facing end-user output by the same argument, so it gets the same
    // blocking severity (it was violation-free when promoted, 2026-08-28).
    files: ['src/admin/**/*.{ts,tsx}', 'src/broker/**/*.{ts,tsx}'],
    rules: {
      'i18next/no-literal-string': ['error', { markupOnly: true }],
    },
  },
  {
    // Files where console.error is the intended behaviour, not a lost error:
    //  - logger.ts IS the dev console path that logError() delegates to.
    //  - supportDiagnostics.ts deliberately intercepts and restores console.
    //  - safeStorage.ts is a low-level primitive; importing the logger here
    //    would create an import cycle (logger -> telemetryQueue -> storage).
    //  - i18n.ts logs missing keys behind an interactive-dev guard.
    //  - tenor.ts reports an unconfigured optional GIPHY key, which is a
    //    configuration state rather than an error worth paging Sentry over.
    files: [
      'src/lib/logger.ts',
      'src/lib/supportDiagnostics.ts',
      'src/lib/safeStorage.ts',
      'src/lib/tenor.ts',
      'src/i18n.ts',
      'src/main.tsx',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      '*.config.js',
      '*.config.ts',
      'src/test/',
      'src/**/__mocks__/**',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'public/locales/translate*',
      'scripts/',
      'lighthouserc.cjs',
    ],
  }
);
