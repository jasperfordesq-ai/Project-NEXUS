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
]);
