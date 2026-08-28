// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
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

      // i18n — catch hardcoded strings in JSX markup (between tags and in common attributes)
      // markupOnly: true limits scope to JSX text nodes — won't flag JS constants or config strings
      'i18next/no-literal-string': ['warn', { markupOnly: true }],
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
