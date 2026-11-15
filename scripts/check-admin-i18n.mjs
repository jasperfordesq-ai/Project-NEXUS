// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-admin-i18n.mjs — Verify that admin React translation keys exist.
 *
 * Scope-aware parsing covers both admin source trees, useTranslation key
 * prefixes, namespace overrides, literal calls, and high-risk dynamic or
 * registry-backed keys that ordinary JSX lint cannot resolve.
 *
 * Exit code 0 = no missing admin keys detected.
 * Exit code 1 = one or more required admin keys are missing.
 *
 * The parser uses the TypeScript dependency installed by react-frontend.
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

const PROJECT_ROOT = process.cwd();
const require = createRequire(import.meta.url);
const ts = require(join(PROJECT_ROOT, 'react-frontend', 'node_modules', 'typescript'));
const ADMIN_SRC_DIR = join(PROJECT_ROOT, 'react-frontend', 'src', 'admin');
const SUPER_ADMIN_SRC_DIR = join(PROJECT_ROOT, 'react-frontend', 'src', 'super-admin');
const PLATFORM_TEAM_SRC_DIR = join(PROJECT_ROOT, 'react-frontend', 'src', 'platform-team');
const LOCALES_DIR = join(PROJECT_ROOT, 'react-frontend', 'public', 'locales', 'en');
const MODULE_REGISTRY_FILE = join(
  PROJECT_ROOT,
  'react-frontend',
  'src',
  'admin',
  'modules',
  'config',
  'moduleRegistry.ts',
);

const MODULE_IDS = readModuleIds(MODULE_REGISTRY_FILE);
const LOCALE_KEYSETS = loadLocaleKeysets(LOCALES_DIR);
const SOURCE_FILES = [ADMIN_SRC_DIR, SUPER_ADMIN_SRC_DIR, PLATFORM_TEAM_SRC_DIR]
  .filter(existsSync)
  .flatMap((directory) => walkFiles(directory, /\.(ts|tsx)$/));
const INDIRECT_REQUIREMENTS = readIndirectTranslationRequirements();

let missingCount = 0;
let warningCount = 0;

console.log('============================================================');
console.log('  Admin i18n Coverage Check');
console.log('============================================================');
console.log(`  Source files: ${SOURCE_FILES.length}`);
console.log(`  Locale namespaces: ${[...LOCALE_KEYSETS.keys()].sort().join(', ')}`);
console.log('');

for (const requirement of INDIRECT_REQUIREMENTS) {
  reportMissingIfNeeded(requirement.namespace, requirement.key, requirement.file, requirement.line);
}

for (const filePath of SOURCE_FILES) {
  const relPath = normalizeSlashes(relative(PROJECT_ROOT, filePath));
  const source = readFileSync(filePath, 'utf8');
  const callsites = extractTranslationCallsites(source, filePath);

  for (const call of callsites) {
    const targetNamespace = call.overrideNamespace ?? call.namespace;
    if (!targetNamespace || !LOCALE_KEYSETS.has(targetNamespace)) {
      continue;
    }

    if (call.kind === 'literal') {
      const resolvedKey = call.keyPrefix && !call.key.includes(':')
        ? `${call.keyPrefix}.${call.key}`
        : call.key;
      const qualified = splitQualifiedKey(resolvedKey, targetNamespace);
      reportMissingIfNeeded(qualified.namespace, qualified.key, relPath, call.line);
      continue;
    }

    const rawTemplate = call.keyPrefix
      ? `${call.keyPrefix}.${call.rawTemplate}`
      : call.rawTemplate;
    if (!shouldAuditKey(relPath, targetNamespace, rawTemplate.split('${')[0])) {
      continue;
    }

    const expandedKeys = expandDynamicKey(rawTemplate, relPath, source);
    if (expandedKeys === null) {
      warningCount++;
      console.log(
        `[WARN] ${relPath}:${call.line} — unsupported dynamic key pattern in namespace "${targetNamespace}": ${rawTemplate}`,
      );
      continue;
    }

    for (const key of expandedKeys) {
      reportMissingIfNeeded(targetNamespace, key, relPath, call.line);
    }
  }
}

console.log('');
console.log('============================================================');
console.log(`  Missing keys: ${missingCount}`);
console.log(`  Warnings:     ${warningCount}`);
console.log('============================================================');

if (missingCount > 0) {
  console.log('');
  console.log('FAIL: Admin translation coverage gaps detected.');
  console.log('  Fix: Add the missing keys to react-frontend/public/locales/en/*.json');
  console.log('  Guardrail: This check blocks repeated admin raw-key regressions.');
  process.exit(1);
}

if (warningCount > 0) {
  console.log('');
  console.log('PASS WITH WARNINGS: All required admin keys were found, but some dynamic patterns');
  console.log('still need explicit audit support if you want 100% coverage.');
  process.exit(0);
}

console.log('');
console.log('PASS: All checked admin translation keys exist.');
process.exit(0);

function reportMissingIfNeeded(namespace, key, relPath, line) {
  const keyset = LOCALE_KEYSETS.get(namespace);
  const hasPluralVariant = keyset && [
    'zero',
    'one',
    'two',
    'few',
    'many',
    'other',
  ].some((suffix) => keyset.has(`${key}_${suffix}`));
  if (!keyset || keyset.has(key) || hasPluralVariant) {
    return;
  }
  missingCount++;
  console.log(`[MISSING] ${namespace}:${key}`);
  console.log(`  at ${relPath}:${line}`);
}

function shouldAuditKey(relPath, namespace, key) {
  const normalized = normalizeSlashes(relPath);
  const rules = [
    {
      file: '/src/admin/components/AdminSidebar.tsx',
      namespace: 'admin_nav',
      prefixes: [''],
    },
    {
      file: '/src/admin/components/BulkActionToolbar.tsx',
      namespace: 'admin',
      prefixes: ['bulk.'],
    },
    {
      file: '/src/admin/modules/content/LandingPageBuilder.tsx',
      namespace: 'admin',
      prefixes: ['content.'],
    },
    {
      file: '/src/admin/modules/config/TranslationConfig.tsx',
      namespace: 'admin',
      prefixes: ['config.translation_'],
    },
    {
      file: '/src/admin/modules/system/AdminSettings.tsx',
      namespace: 'admin',
      prefixes: ['system.'],
    },
    {
      file: '/src/admin/modules/system/CronJobLogs.tsx',
      namespace: 'admin',
      prefixes: ['system.'],
    },
    {
      file: '/src/admin/modules/system/CronJobSetup.tsx',
      namespace: 'admin',
      prefixes: ['system.', 'cron_setup.'],
    },
    {
      file: '/src/admin/modules/config/TenantFeatures.tsx',
      namespace: 'admin',
      prefixes: ['tenant_features.', 'config.tenant_features_', 'config.feature_', 'config.module_', 'config.failed_', 'config.cache_', 'config.job_', 'config.language_', 'config.enabled', 'config.disabled', 'config.label_default_language'],
    },
    {
      file: '/src/admin/modules/config/ModuleConfiguration.tsx',
      namespace: 'admin',
      prefixes: [
        'config.module_configuration_',
        'config.module_config_load_failed',
        'config.module_update_failed',
        'config.module_enabled',
        'config.module_disabled',
        'config.beta',
        'config.refresh',
        'config.search_modules',
        'config.filter_',
        'config.core_modules',
        'config.optional_features',
        'config.no_modules_match',
        'config.clear_filters',
      ],
    },
    {
      file: '/src/admin/modules/config/ModuleCard.tsx',
      namespace: 'admin',
      prefixes: [
        'config.option_count',
        'config.planned_count',
        'config.no_options',
        'config.core',
        'config.configure',
        'config.toggle_module',
      ],
    },
    {
      file: '/src/admin/modules/jobs/JobsAdmin.tsx',
      namespace: 'admin',
      prefixes: ['jobs.'],
    },
    {
      file: '/src/admin/modules/marketplace/MarketplaceAdmin.tsx',
      namespace: 'admin',
      prefixes: ['marketplace.'],
    },
    {
      file: '/src/admin/modules/marketplace/MarketplaceModerationPage.tsx',
      namespace: 'admin',
      prefixes: ['marketplace.'],
    },
    {
      file: '/src/admin/modules/marketplace/MarketplaceSellerAdmin.tsx',
      namespace: 'admin',
      prefixes: ['marketplace.'],
    },
  ];

  for (const rule of rules) {
    if (namespace !== rule.namespace) continue;
    if (!normalized.endsWith(rule.file)) continue;
    if (rule.prefixes.includes('')) return true;
    if (rule.prefixes.some((prefix) => key.startsWith(prefix))) {
      return true;
    }
  }

  return false;
}

function readModuleIds(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  const source = readFileSync(filePath, 'utf8');
  const ids = new Set();
  const regex = /\bid:\s*'([^']+)'/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    ids.add(match[1]);
  }
  return [...ids].sort();
}

function splitQualifiedKey(key, fallbackNamespace) {
  const separator = key.indexOf(':');
  if (separator <= 0) {
    return { namespace: fallbackNamespace, key };
  }
  const namespace = key.slice(0, separator);
  if (!LOCALE_KEYSETS.has(namespace)) {
    return { namespace: fallbackNamespace, key };
  }
  return { namespace, key: key.slice(separator + 1) };
}

function readIndirectTranslationRequirements() {
  const requirements = [];
  const add = (namespace, key, file, line = 1) => {
    requirements.push({ namespace, key, file, line });
  };

  const registrySource = readFileSync(MODULE_REGISTRY_FILE, 'utf8');
  const registryFile = normalizeSlashes(relative(PROJECT_ROOT, MODULE_REGISTRY_FILE));
  for (const id of MODULE_IDS) {
    add('admin_config', `config.module_name_${id}`, registryFile);
    add('admin_config', `config.module_desc_${id}`, registryFile);
  }
  for (const [index, line] of registrySource.split(/\r?\n/).entries()) {
    const option = /\{\s*key:\s*'([^']+)'/.exec(line)?.[1];
    const category = /\bcategory:\s*'([^']+)'/.exec(line)?.[1];
    if (!option || !category) continue;
    const optionToken = slugTranslationToken(option, false);
    add('admin_config', `config.option_${optionToken}_label`, registryFile, index + 1);
    add('admin_config', `config.option_${optionToken}_desc`, registryFile, index + 1);
    add('admin_config', `config.option_category_${category}`, registryFile, index + 1);
    const choices = /\bchoices:\s*\[([^\]]*)\]/.exec(line)?.[1] ?? '';
    for (const match of choices.matchAll(/\bvalue:\s*'([^']+)'/g)) {
      add(
        'admin_config',
        `config.option_choice_${optionToken}_${slugTranslationToken(match[1], true)}`,
        registryFile,
        index + 1,
      );
    }
  }

  const prefixedRegistries = [
    {
      file: join(ADMIN_SRC_DIR, 'data', 'helpContent.ts'),
      namespace: 'admin_help',
      prefix: 'articles.',
    },
    {
      file: join(ADMIN_SRC_DIR, 'components', 'Abbr.tsx'),
      namespace: 'admin_glossary',
      prefix: 'terms.',
    },
    {
      file: join(ADMIN_SRC_DIR, 'modules', 'federation', 'ApiDocumentation.tsx'),
      namespace: 'admin_federation',
      prefix: 'federation.api_doc_',
    },
  ];
  for (const registry of prefixedRegistries) {
    if (!existsSync(registry.file)) continue;
    const source = readFileSync(registry.file, 'utf8');
    const relativeFile = normalizeSlashes(relative(PROJECT_ROOT, registry.file));
    const pattern = new RegExp(`(['\"])(` + escapeRegExp(registry.prefix) + `[^'\"]+)\\1`, 'g');
    for (const match of source.matchAll(pattern)) {
      const line = 1 + countNewlines(source.slice(0, match.index));
      add(registry.namespace, match[2], relativeFile, line);
    }
  }

  const iconSourcePath = join(PROJECT_ROOT, 'react-frontend', 'src', 'components', 'ui', 'DynamicIcon.tsx');
  if (existsSync(iconSourcePath)) {
    const source = readFileSync(iconSourcePath, 'utf8');
    const map = /export const ICON_MAP[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
    const relativeFile = normalizeSlashes(relative(PROJECT_ROOT, iconSourcePath));
    for (const match of map.matchAll(/^\s*([A-Za-z_$][\w$]*),\s*$/gm)) {
      add('admin_nav', `icon_picker.icons.${match[1]}`, relativeFile, 1 + countNewlines(map.slice(0, match.index)));
    }
  }

  const uniqueRequirements = new Map();
  for (const requirement of requirements) {
    uniqueRequirements.set(`${requirement.namespace}:${requirement.key}`, requirement);
  }
  return [...uniqueRequirements.values()];
}

function slugTranslationToken(value, lowerCase) {
  const normalized = (lowerCase ? value.toLowerCase() : value)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'value';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadLocaleKeysets(localeDir) {
  if (!existsSync(localeDir)) {
    throw new Error(`Locale directory not found: ${localeDir}`);
  }

  const keysets = new Map();
  for (const file of readdirSync(localeDir)) {
    if (!file.endsWith('.json')) continue;
    const namespace = file.replace(/\.json$/, '');
    const json = readJsonWithFallbacks(join(localeDir, file));
    keysets.set(namespace, new Set(flattenKeys(json)));
  }
  return keysets;
}

function readJsonWithFallbacks(filePath) {
  const buffer = readFileSync(filePath);
  const attempts = [buffer.toString('utf8'), buffer.toString('latin1')];
  for (const text of attempts) {
    try {
      return JSON.parse(text);
    } catch {
      // try next encoding
    }
  }
  throw new Error(`Failed to parse JSON locale file: ${filePath}`);
}

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function walkFiles(dir, pattern) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, pattern));
      continue;
    }
    if (pattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractTranslationCallsites(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bindings = [];
  const calls = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useTranslation' &&
      ts.isVariableDeclaration(node.parent) &&
      ts.isObjectBindingPattern(node.parent.name)
    ) {
      const bindingElement = node.parent.name.elements.find((element) => {
        const exportedName = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : ts.isIdentifier(element.name)
            ? element.name.text
            : '';
        return exportedName === 't';
      });
      const namespace = readTranslationNamespace(node.arguments[0]);
      if (bindingElement && ts.isIdentifier(bindingElement.name) && namespace) {
        bindings.push({
          alias: bindingElement.name.text,
          namespace,
          keyPrefix: readStringProperty(node.arguments[1], 'keyPrefix') ?? '',
          declarationStart: node.parent.getStart(sourceFile),
          scope: nearestTranslationScope(node.parent),
        });
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments.length > 0) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  }

  function nearestTranslationScope(node) {
    let current = node.parent;
    while (current && !ts.isSourceFile(current)) {
      if (ts.isFunctionLike(current)) return current;
      current = current.parent;
    }
    return sourceFile;
  }

  visit(sourceFile);

  const callsites = [];
  for (const call of calls) {
    const alias = call.expression.text;
    const binding = bindings
      .filter((candidate) =>
        candidate.alias === alias &&
        candidate.declarationStart <= call.getStart(sourceFile) &&
        call.pos >= candidate.scope.pos &&
        call.end <= candidate.scope.end,
      )
      .sort((left, right) =>
        (left.scope.end - left.scope.pos) - (right.scope.end - right.scope.pos) ||
        right.declarationStart - left.declarationStart,
      )[0];
    if (!binding) continue;

    const parsed = parseTranslationArgument(call.arguments[0], sourceFile);
    if (!parsed) continue;
    const location = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
    callsites.push({
      namespace: binding.namespace,
      keyPrefix: binding.keyPrefix,
      overrideNamespace: readStringProperty(call.arguments[1], 'ns'),
      line: location.line + 1,
      ...parsed,
    });
  }

  return dedupeCallsites(callsites);
}

function readTranslationNamespace(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) {
    const first = node.elements.find((element) => ts.isStringLiteralLike(element));
    return first?.text ?? null;
  }
  return null;
}

function readStringProperty(node, propertyName) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const property = node.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && getTsPropertyName(candidate.name) === propertyName,
  );
  return property && ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)
    ? property.initializer.text
    : null;
}

function getTsPropertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : '';
}

function parseTranslationArgument(node, sourceFile) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: 'literal', key: node.text };
  }
  if (ts.isTemplateExpression(node)) {
    let rawTemplate = node.head.text;
    for (const span of node.templateSpans) {
      rawTemplate += `\${${span.expression.getText(sourceFile)}}${span.literal.text}`;
    }
    return { kind: 'template', rawTemplate };
  }
  return null;
}

function dedupeCallsites(calls) {
  const seen = new Set();
  return calls.filter((call) => {
    const id =
      `${call.namespace}|${call.keyPrefix || ''}|${call.overrideNamespace || ''}|${call.line}|` +
      (call.kind === 'literal' ? call.key : call.rawTemplate);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function expandDynamicKey(rawTemplate, relPath, source) {
  const providers = [
    {
      regex: /^config\.module_(name|desc)_\$\{module\.id\}$/,
      values: () => MODULE_IDS,
      build: (prefix, ids) => ids.map((id) => `${prefix}${id}`),
    },
    {
      regex: /^tenant_features\.(label|desc)_\$\{(?:feature|module|key)\}$/,
      values: () => MODULE_IDS,
      build: (prefix, ids) => ids.map((id) => `${prefix}${id}`),
    },
    {
      regex: /^jobs\.status_\$\{key\}$/,
      values: () => extractConstStringArray(source, 'STATUS_TAB_KEYS'),
      build: (prefix, values) => values.map((value) => `${prefix}${value}`),
    },
    {
      regex: /^jobs\.stage_\$\{stage\}$/,
      values: () => extractConstStringArray(source, 'APPLICATION_STAGE_KEYS'),
      build: (prefix, values) => values.map((value) => `${prefix}${value}`),
    },
    {
      regex: /^jobs\.pipeline_status_\$\{s\}$/,
      values: () =>
        unique([
          ...extractConstStringArray(source, 'INTERVIEW_STATUSES'),
          ...extractConstStringArray(source, 'OFFER_STATUSES'),
        ]).filter((value) => value !== 'all'),
      build: (prefix, values) => values.map((value) => `${prefix}${value}`),
    },
    {
      regex: /^system\.lang_\$\{code\}$/,
      values: () => extractConstStringArray(source, 'SUPPORTED_LOCALE_CODES'),
      build: (prefix, values) => values.map((value) => `${prefix}${value}`),
    },
    {
      regex: /^federation\.scope_\$\{key\.replace\(':', '_'\)\}$/,
      values: () => extractConstStringArray(source, 'SCOPE_KEYS'),
      build: (prefix, values) =>
        values.map((value) => `${prefix}${value.replaceAll(':', '_')}`),
    },
    {
      regex: /^federation\.webhook_\$\{key\.replace\('\.', '_'\)\}$/,
      values: () => extractConstStringArray(source, 'ALL_EVENT_KEYS'),
      build: (prefix, values) =>
        values.map((value) => `${prefix}${value.replaceAll('.', '_')}`),
    },
    {
      regex: /^safeguarding\.trigger_\$\{TRIGGER_I18N_KEY\[key\]\}_label$/,
      values: () => extractObjectValues(source, 'TRIGGER_I18N_KEY'),
      build: (prefix, values) => values.map((value) => `${prefix}${value}_label`),
    },
    {
      regex: /^safeguarding\.trigger_\$\{TRIGGER_I18N_KEY\[key\]\}_desc$/,
      values: () => extractObjectValues(source, 'TRIGGER_I18N_KEY'),
      build: (prefix, values) => values.map((value) => `${prefix}${value}_desc`),
    },
  ];

  for (const provider of providers) {
    const match = provider.regex.exec(rawTemplate);
    if (!match) continue;

    const values = provider.values();
    if (!values || values.length === 0) {
      return [];
    }

    const prefix = rawTemplate.split('${')[0];
    return provider.build(prefix, values);
  }

  if (rawTemplate === "visibility_rules.roles.${key || 'any'}") {
    return expandWithFallback(
      'visibility_rules.roles.',
      extractConstStringArray(source, 'ROLE_KEYS'),
      'any',
    );
  }

  if (rawTemplate === "visibility_rules.features.${key || 'none'}") {
    return expandWithFallback(
      'visibility_rules.features.',
      extractConstStringArray(source, 'FEATURE_KEYS'),
      'none',
    );
  }

  if (relPath.endsWith('TenantFeatures.tsx')) {
    if (rawTemplate.startsWith('tenant_features.label_')) {
      return MODULE_IDS.map((id) => `tenant_features.label_${id}`);
    }
    if (rawTemplate.startsWith('tenant_features.desc_')) {
      return MODULE_IDS.map((id) => `tenant_features.desc_${id}`);
    }
  }

  return null;
}

function expandWithFallback(prefix, values, fallback) {
  const result = new Set(values.map((value) => `${prefix}${value}`));
  result.add(`${prefix}${fallback}`);
  return [...result].sort();
}

function unique(values) {
  return [...new Set(values)];
}

function extractConstStringArray(source, constName) {
  const initializer = extractConstInitializer(source, constName);
  if (!initializer || !initializer.startsWith('[')) {
    return [];
  }

  const values = [];
  const regex = /'([^']+)'|"([^"]+)"/g;
  let match;
  while ((match = regex.exec(initializer)) !== null) {
    values.push(match[1] ?? match[2]);
  }
  return [...new Set(values)];
}

function extractObjectValues(source, constName) {
  const initializer = extractConstInitializer(source, constName);
  if (!initializer || !initializer.startsWith('{')) {
    return [];
  }

  const values = [];
  const regex = /:\s*'([^']+)'|:\s*"([^"]+)"/g;
  let match;
  while ((match = regex.exec(initializer)) !== null) {
    values.push(match[1] ?? match[2]);
  }
  return [...new Set(values)];
}

function extractConstInitializer(source, constName) {
  const patterns = [
    `const ${constName} =`,
    `const ${constName}:`,
    `export const ${constName} =`,
    `export const ${constName}:`,
  ];

  for (const pattern of patterns) {
    const start = source.indexOf(pattern);
    if (start === -1) continue;

    const equalsIndex = source.indexOf('=', start);
    if (equalsIndex === -1) continue;

    const openIndex = source.slice(equalsIndex + 1).search(/[\[{]/);
    if (openIndex === -1) continue;

    const absoluteOpenIndex = equalsIndex + 1 + openIndex;
    const opener = source[absoluteOpenIndex];
    const closer = opener === '[' ? ']' : '}';
    const closeIndex = findMatchingBracket(source, absoluteOpenIndex, opener, closer);
    if (closeIndex === -1) continue;

    return source.slice(absoluteOpenIndex, closeIndex + 1);
  }

  return null;
}

function findMatchingBracket(text, openIndex, opener, closer) {
  let depth = 0;
  let quote = null;
  let templateDepth = 0;
  let escaped = false;

  for (let i = openIndex; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (quote === '`' && char === '$' && next === '{') {
        templateDepth++;
        i++;
        continue;
      }
      if (quote === '`' && char === '}' && templateDepth > 0) {
        templateDepth--;
        continue;
      }
      if (char === quote && templateDepth === 0) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === opener) {
      depth++;
    } else if (char === closer) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function countNewlines(text) {
  let count = 0;
  for (const char of text) {
    if (char === '\n') count++;
  }
  return count;
}

function normalizeSlashes(filePath) {
  return filePath.replaceAll('\\', '/');
}
