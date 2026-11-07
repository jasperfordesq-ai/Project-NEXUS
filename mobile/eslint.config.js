// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["**/*.test.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        afterEach: "readonly",
        beforeEach: "readonly",
        describe: "readonly",
        expect: "readonly",
        jest: "readonly",
        it: "readonly",
        require: "readonly",
      },
    },
    rules: {
      // Jest's module factory must be declared before the imports it mocks, and
      // React Native test doubles are loaded with require() after jest.mock has
      // been hoisted. These two production-oriented ordering rules therefore
      // report hundreds of false positives in tests.
      "import/first": "off",
      "react/display-name": "off",
      "react-hooks/rules-of-hooks": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: [
      "app.config.js",
      "jest-resolver.js",
      "jest-setup.ts",
      "metro.config.{js,cjs}",
      "scripts/**/*.{js,cjs}",
      "__mocks__/**/*.js",
    ],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        require: "readonly",
        module: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // i18next deliberately exposes a configured default singleton whose `t`
    // and `use` members are the supported runtime API. The import plugin reads
    // the same package's named exports and mistakes those member calls for an
    // accidental default import.
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "import/no-named-as-default-member": "off",
    },
  },
  {
    // React Native 0.83's KeyboardAvoidingView leaves a band the height of the status bar
    // at the bottom of an Android screen once the keyboard closes (it reads the close
    // event's screenY, which Android 11+ reports wrongly). The app's wrapper fixes that,
    // so screens must use it (7 November 2026). Tests may import the original to inspect it.
    files: ["**/*.{js,jsx,ts,tsx}"],
    ignores: ["**/*.test.{js,jsx,ts,tsx}", "components/ui/KeyboardAvoidingView.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "react-native",
          importNames: ["KeyboardAvoidingView"],
          message: "Use KeyboardAvoidingView from '@/components/ui/KeyboardAvoidingView': React Native's own leaves a gap on Android after the keyboard closes.",
        }],
      }],
    },
  },
]);
