// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Dead barrel-mock scanner.
 *
 * THE DEFECT
 * ----------
 * A test mocks a barrel and overrides one of its exports:
 *
 *   vi.mock('@/components/ui', async (importOriginal) => ({
 *     ...(await importOriginal()),
 *     useConfirm: () => mockConfirm,
 *   }));
 *
 * …but the component under test imports that symbol by its DIRECT path:
 *
 *   import { useConfirm } from '@/components/ui/ConfirmDialog';
 *
 * Vitest's module registry is keyed per-specifier, so the override never
 * applies: the real module loads. The test then either throws (a hook wants a
 * provider the test never mounted), asserts on data-testids only the stub
 * stamped, or queries an ARIA role the real HeroUI component does not expose.
 *
 * HOW THIS SCANNER DECIDES A KEY IS DEAD
 * --------------------------------------
 *  1. Parse the barrel index and build `barrel export name -> {file, original
 *     name}`, tracking aliases (`Textarea as TextArea`) so the direct-path
 *     import is matched under its real name. Keys the barrel does NOT re-export
 *     fall back to a name index over the barrel directory: `@/contexts` never
 *     exports usePusher / usePresence / useMenuContext, so a factory overriding
 *     them on the barrel is dead for every consumer by construction.
 *  2. In each test file, collect `vi.mock(<barrel>, factory)` and extract the
 *     keys the factory EXPLICITLY writes. A spread of `await importOriginal()`
 *     contributes nothing; `(await import('@/test/uiMock')).uiMock` with no
 *     added properties declares zero overrides. A factory that hands off to a
 *     TOTAL-SHAPE HELPER — this repo's `createMockContexts()` from
 *     src/test/mock-contexts.ts, used by ~640 `vi.mock('@/contexts', …)` sites —
 *     is decoded by parsing the helper: it returns `{ ...DEFAULTS, ...overrides }`,
 *     so it is NOT a partial mock. Every DEFAULTS key is an override on the
 *     barrel, and every one of them is dead for a module that imports the symbol
 *     from its direct path. Any factory shape the scanner CANNOT decode is
 *     counted in `unresolvedFactories` and printed, so blind spots stay loud.
 *  3. BFS the test file's import graph (static + dynamic, '@/' alias aware),
 *     recording depth. Modules the test file also mocks are traversal barriers:
 *     they never load, so their imports cannot resolve anything.
 *  4. A key K is DEAD for module M when M has a real (non type-only,
 *     non-re-export) named import of K's ORIGINAL name from K's OWN source file
 *     under the barrel directory — unless the test file also mocks that exact
 *     direct path, in which case the author already handled it.
 *
 * DEPTH SCOPE (why the gate stops at depth 2 by default)
 * -----------------------------------------------------
 * Static reachability is not rendering. At depth 0–2 the leaking module is the
 * component under test or something it composes directly, so the dead override
 * really does bite. Past that, the graph fans out through routers and app
 * shells into modules a given test never mounts (`PageMeta` five hops down an
 * admin router). Those rows are still computed and reported, but as
 * informational `deepRows` outside the ratchet — otherwise the gate would fire
 * on unrelated import-graph churn and get switched off. `--max-depth` /
 * `--all-depths` widen the enforced scope.
 *
 * Deliberately conservative — a false negative is cheap, a false positive gets
 * the scanner switched off. Not flagged: type-only imports, `export … from`
 * re-exports, namespace imports, computed keys, `Object.assign` factories,
 * bare `vi.mock(spec)` auto-mocks, files that also mock the direct path, the
 * plain uiMock form, and anything imported only by `src/test/**` harness code
 * (test-utils deliberately mounts real providers). Those exclusions are
 * DECIDED, not accidental: everything else undecodable lands in
 * `unresolvedFactories` instead of being waved through.
 *
 * CLI
 *   node scripts/audit-dead-mocks.mjs                # human report + ratchet
 *   node scripts/audit-dead-mocks.mjs --json         # machine JSON on stdout
 *   node scripts/audit-dead-mocks.mjs --baseline     # (re)generate baseline
 *   node scripts/audit-dead-mocks.mjs --check        # terse ratchet only
 *   node scripts/audit-dead-mocks.mjs --root <dir>   # alternate frontend root
 *   node scripts/audit-dead-mocks.mjs --max-depth 3  # widen the enforced scope
 *   node scripts/audit-dead-mocks.mjs --all-depths   # enforce every depth
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASELINE_RELATIVE_PATH = 'src/test/dead-barrel-mocks.baseline.json';

/** Barrels whose overrides are known to leak. `dir` is relative to src/. */
export const AUDITED_BARRELS = [
  { dir: 'components/ui', specifier: '@/components/ui' },
  { dir: 'contexts', specifier: '@/contexts' },
  // Added 2026-07-28. This barrel was the scanner's largest blind spot, and it
  // was costing real coverage rather than merely being untidy: the dominant
  // cause of quarantined admin suites is a stub on '@/admin/components'
  // rendering data-testid="page-header" / "stat-card" / "data-table" while the
  // page imports the same component by its own path (often relative, e.g.
  // `from '../components/PageHeader'`), so the stub never installs, the real
  // component renders without those testids, and the query fails. None of those
  // testids exists in any non-test file. f022b3721 already proved the defect
  // reaches admin components; this makes it measured instead of anecdotal.
  { dir: 'admin/components', specifier: '@/admin/components' },
];

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx'];
const INDEX_BASENAMES = ['index.ts', 'index.tsx', 'index.mts', 'index.js', 'index.jsx'];
const TEST_FILE_PATTERN = /\.test\.tsx?$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '__snapshots__', 'dist', 'coverage']);

/** Depth at which static reachability stops predicting actual rendering. */
export const DEFAULT_MAX_ENFORCED_DEPTH = 2;

/**
 * R1 — control flow. Overriding these changes what renders or whether a hook
 * throws; a dead override here is why a suite goes red. Context gate hooks are
 * R1 because the real ones throw without their provider
 * (TenantContext.tsx throws unconditionally outside <TenantProvider>).
 */
const RISK_R1_EXACT = new Set([
  'Tab',
  'Tabs',
  'Tooltip',
  'useAuth',
  'useAuthOptional',
  'useConfirm',
  'useCookieConsent',
  'useDisclosure',
  'useFeature',
  'useMenuContext',
  'useModule',
  'useNotifications',
  'useNotificationsOptional',
  'usePresence',
  'usePresenceOptional',
  'usePusher',
  'usePusherOptional',
  'useTenant',
  'useTheme',
  'useToast',
]);
const RISK_R1_PREFIXES = ['Dialog', 'Drawer', 'Dropdown', 'Modal', 'Popover'];

/**
 * R2 — identity. The real component exposes a different ARIA role or DOM shape
 * than the stub (single-select ToggleButtonGroup is role="radiogroup" with
 * role="radio" children; a real SearchField input is role="searchbox").
 */
const RISK_R2_EXACT = new Set([
  'Autocomplete',
  'ComboBox',
  'GlassCard',
  'Radio',
  'RadioGroup',
  'SearchField',
  'Switch',
  'ToggleButton',
  'ToggleButtonGroup',
]);
const RISK_R2_PREFIXES = ['Select', 'Table'];

export function classifyRisk(key) {
  if (RISK_R1_EXACT.has(key)) return 'R1';
  if (RISK_R2_EXACT.has(key)) return 'R2';
  if (RISK_R1_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'R1';
  if (RISK_R2_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'R2';
  return 'R3';
}

export const RISK_LABELS = {
  R1: 'control-flow',
  R2: 'identity',
  R3: 'cosmetic',
};

// ─── filesystem helpers ──────────────────────────────────────────────────────

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function collectTestFiles(directory, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectTestFiles(entryPath, files);
      continue;
    }

    if (TEST_FILE_PATTERN.test(entry.name)) files.push(entryPath);
  }

  return files;
}

function collectSourceFilesUnder(directory, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectSourceFilesUnder(entryPath, files);
      continue;
    }

    if (/\.tsx?$/.test(entry.name) && !TEST_FILE_PATTERN.test(entry.name)) files.push(entryPath);
  }

  return files;
}

// ─── AST helpers ─────────────────────────────────────────────────────────────

function parseSourceFile(filePath) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isViMockCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const method = callee.name.text;
  if (method !== 'mock' && method !== 'doMock') return false;
  return ts.isIdentifier(callee.expression) && callee.expression.text === 'vi';
}

/** `vi.mock('spec', …)` and `vi.mock(import('spec'), …)`. */
function getMockedSpecifier(callExpression) {
  const first = callExpression.arguments[0];
  if (!first) return undefined;
  if (ts.isStringLiteralLike(first)) return first.text;

  if (ts.isCallExpression(first) && first.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const inner = first.arguments[0];
    if (inner && ts.isStringLiteralLike(inner)) return inner.text;
  }

  return undefined;
}

function unwrapParentheses(node) {
  let current = node;
  while (current && ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/**
 * Explicit keys an object literal writes. Spreads contribute nothing (that is
 * the whole point: `...(await importOriginal())` is not an override) and
 * computed names are skipped rather than guessed at.
 */
function objectLiteralKeys(objectLiteral, keys) {
  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) continue;

    const name = property.name;
    if (!name) continue;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
      keys.add(name.text);
    }
  }
}

/**
 * `const { createMockContexts } = require('@/test/mock-contexts')` and
 * `const { createMockContexts: cmc } = await import('@/test/mock-contexts')`.
 *
 * Test files reach for the shared mock helper this way as often as by static
 * import — including INSIDE the vi.mock factory, which is hoisted above
 * top-level imports. Missing these bindings would leave those factories
 * undecodable for no good reason.
 */
function collectDestructuredImportBindings(sourceFile, filePath, resolveSpecifier) {
  const bindings = [];

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      let initializer = unwrapParentheses(node.initializer);
      while (initializer && ts.isAwaitExpression(initializer)) {
        initializer = unwrapParentheses(initializer.expression);
      }

      let specifier;
      if (initializer && ts.isCallExpression(initializer)) {
        const callee = initializer.expression;
        const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
        const argument = initializer.arguments[0];
        if ((isImport || isRequire) && argument && ts.isStringLiteralLike(argument)) {
          specifier = argument.text;
        }
      }

      const resolved = specifier ? resolveSpecifier(specifier, filePath) : undefined;
      if (resolved) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const propertyName = element.propertyName;
          const imported =
            propertyName && (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName))
              ? propertyName.text
              : element.name.text;
          bindings.push({ imported, local: element.name.text, resolved });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return bindings;
}

/** A module-level `const NAME = { … }` object literal, or undefined. */
function moduleLevelObjectLiteral(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== name) continue;
      const initializer = unwrapParentheses(declaration.initializer);
      if (initializer && ts.isObjectLiteralExpression(initializer)) return initializer;
    }
  }
  return undefined;
}

function isExportedStatement(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

/** The exported function (declaration or arrow const) named `exportedName`. */
function findExportedFunction(sourceFile, exportedName) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      isExportedStatement(statement) &&
      statement.name?.text === exportedName
    ) {
      return statement;
    }
    if (!ts.isVariableStatement(statement) || !isExportedStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== exportedName) continue;
      const initializer = unwrapParentheses(declaration.initializer);
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        return initializer;
      }
    }
  }
  return undefined;
}

/**
 * The FULL key set of a "total-shape" mock helper, or undefined when the module
 * does not look like one.
 *
 * src/test/mock-contexts.ts is the case that matters:
 *
 *   const DEFAULTS = { useAuth: …, useTenant: …, … 15 hooks in all };
 *   export function createMockContexts(overrides = {}) {
 *     const merged = { ...DEFAULTS, ...overrides };
 *     return merged;
 *   }
 *
 * `vi.mock('@/contexts', () => createMockContexts({ useTenant: … }))` therefore
 * replaces the WHOLE barrel, not just the hook the author named. Treating it as
 * a zero-override handoff hid every one of those ~640 call sites; the keys
 * returned here are what makes them visible. The `...overrides` spread resolves
 * to a parameter, not a module-level literal, so it contributes nothing — the
 * caller's explicit argument keys are collected separately at the call site.
 */
export function collectTotalHelperKeys(filePath, exportedName) {
  if (!filePath || !isFile(filePath)) return undefined;

  let sourceFile;
  try {
    sourceFile = parseSourceFile(filePath);
  } catch {
    return undefined;
  }

  const fn = findExportedFunction(sourceFile, exportedName);
  if (!fn?.body) return undefined;

  let returned;
  if (!ts.isBlock(fn.body)) {
    const expression = unwrapParentheses(fn.body);
    if (expression && ts.isObjectLiteralExpression(expression)) returned = expression;
  } else {
    for (const statement of fn.body.statements) {
      if (!ts.isReturnStatement(statement)) continue;
      const expression = unwrapParentheses(statement.expression);
      if (expression && ts.isObjectLiteralExpression(expression)) returned = expression;
      else if (expression && ts.isIdentifier(expression)) {
        returned = resolveLocalObjectLiteral(fn.body, expression) ?? returned;
      }
    }
  }
  if (!returned) return undefined;

  const keys = new Set();
  objectLiteralKeys(returned, keys);
  for (const property of returned.properties) {
    if (!ts.isSpreadAssignment(property)) continue;
    const spread = unwrapParentheses(property.expression);
    if (!spread || !ts.isIdentifier(spread)) continue;
    const literal = moduleLevelObjectLiteral(sourceFile, spread.text);
    if (literal) objectLiteralKeys(literal, keys);
  }

  return keys.size > 0 ? keys : undefined;
}

/** Resolve `return someLocal;` back to a block-local object literal. */
function resolveLocalObjectLiteral(block, identifier) {
  for (const statement of block.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== identifier.text) continue;
      const initializer = unwrapParentheses(declaration.initializer);
      if (initializer && ts.isObjectLiteralExpression(initializer)) return initializer;
    }
  }
  return undefined;
}

/**
 * Recognised factory shapes. Anything NOT on this list decodes to 'unknown',
 * which sets `resolvable: false` and shows up in the scan's
 * `unresolvedFactories` — a decode failure must never masquerade as
 * "understood, zero overrides".
 */
export const FACTORY_FORMS = new Set([
  'auto-mock', // `vi.mock(spec)` with no factory at all
  'block-return', // block body returning an object literal / block-local object
  'object-literal', // `() => ({ … })`
  'total-helper-call', // `() => createMockContexts({ … })` — whole barrel shape
  'ui-mock-handoff', // `async () => (await import('@/test/uiMock')).uiMock`
]);

/**
 * @param {ts.Node|undefined} factory
 * @param {ts.SourceFile} sourceFile
 * @param {{ resolveHelperKeys?: (localName: string) => Set<string>|undefined }} [options]
 * @returns {{ keys: Set<string>, usesUiMockForm: boolean, resolvable: boolean, form: string }}
 */
export function extractFactoryOverrides(factory, sourceFile, options = {}) {
  const keys = new Set();
  const result = { form: 'unknown', keys, resolvable: false, usesUiMockForm: false };

  const finish = (form) => {
    result.form = form;
    result.resolvable = FACTORY_FORMS.has(form);
    return result;
  };

  // A bare `vi.mock('@/components/ui')` auto-mock: no factory to decode, and a
  // documented non-target of this scanner.
  if (!factory) return finish('auto-mock');

  const factoryText = factory.getText(sourceFile);
  result.usesUiMockForm = factoryText.includes('@/test/uiMock');

  // e.g. `vi.mock('@/contexts', someFactoryVariable)` — the shape is off in
  // another binding. Not decoded, so say so.
  if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) return finish('unknown');

  /**
   * Decode the expression a factory hands back. `block` is the enclosing block
   * when there is one, so `return localObject;` can be resolved.
   */
  const decode = (raw, block) => {
    let expression = unwrapParentheses(raw);
    while (expression && ts.isAwaitExpression(expression)) {
      expression = unwrapParentheses(expression.expression);
    }
    if (!expression) return 'unknown';

    if (ts.isObjectLiteralExpression(expression)) {
      objectLiteralKeys(expression, keys);
      return 'object-literal';
    }

    if (ts.isCallExpression(expression)) {
      // Whatever the callee turns out to be, an object-literal ARGUMENT holds
      // the author's explicit overrides: `createMockContexts({ useTenant: … })`.
      for (const argument of expression.arguments) {
        const arg = unwrapParentheses(argument);
        if (arg && ts.isObjectLiteralExpression(arg)) objectLiteralKeys(arg, keys);
      }

      // A total-shape helper replaces the whole barrel, so union its own keys.
      const callee = expression.expression;
      const helperKeys = ts.isIdentifier(callee) ? options.resolveHelperKeys?.(callee.text) : undefined;
      if (helperKeys) {
        for (const key of helperKeys) keys.add(key);
        return 'total-helper-call';
      }

      // `async () => (await import('@/test/uiMock')).uiMock` spelled as a call.
      if (result.usesUiMockForm) return 'ui-mock-handoff';

      // An undecodable helper. Explicit argument keys (if any) still counted
      // above, but the full shape is unknown — do NOT claim it is resolved.
      return 'unknown';
    }

    if (ts.isPropertyAccessExpression(expression)) {
      // The sanctioned uiMock handoff. Any other member expression is a shape
      // the scanner has not been taught.
      return result.usesUiMockForm ? 'ui-mock-handoff' : 'unknown';
    }

    if (ts.isIdentifier(expression)) {
      const literal = block ? resolveLocalObjectLiteral(block, expression) : undefined;
      if (literal) {
        objectLiteralKeys(literal, keys);
        return 'block-return';
      }
      // `const { uiMock } = await import('@/test/uiMock'); return uiMock;` —
      // the block spelling of the sanctioned handoff.
      if (result.usesUiMockForm) return 'ui-mock-handoff';
      // A total-shape helper pulled in by require()/dynamic import inside the
      // factory, then called: `const { createMockContexts } = require(…)`.
      const helperKeys = options.resolveHelperKeys?.(expression.text);
      if (helperKeys) {
        for (const key of helperKeys) keys.add(key);
        return 'total-helper-call';
      }
    }

    return 'unknown';
  };

  const body = factory.body;

  if (!ts.isBlock(body)) return finish(decode(body, undefined));

  let decodedForm;
  let sawUnknownReturn = false;
  const visit = (node) => {
    if (ts.isReturnStatement(node)) {
      // A bare `return;` carries no shape — ignore it rather than calling the
      // whole factory undecodable.
      if (!node.expression) return;
      const decoded = decode(node.expression, body);
      if (decoded === 'unknown') sawUnknownReturn = true;
      else decodedForm = decoded === 'object-literal' ? 'block-return' : decoded;
      return;
    }
    // Do not walk into nested functions — their returns are component render
    // results, not factory shape.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);
  return finish(sawUnknownReturn || !decodedForm ? 'unknown' : decodedForm);
}

// ─── module resolution + per-file analysis ───────────────────────────────────

function createModuleGraph(sourceRoot) {
  const cache = new Map();

  function resolveSpecifier(specifier, importerPath) {
    let base;
    if (specifier.startsWith('@/')) {
      base = path.join(sourceRoot, specifier.slice(2));
    } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      base = path.resolve(path.dirname(importerPath), specifier);
    } else {
      return undefined;
    }

    if (isFile(base)) return base;
    for (const extension of RESOLVE_EXTENSIONS) {
      if (isFile(base + extension)) return base + extension;
    }
    for (const basename of INDEX_BASENAMES) {
      const candidate = path.join(base, basename);
      if (isFile(candidate)) return candidate;
    }
    return undefined;
  }

  function analyze(filePath) {
    const cached = cache.get(filePath);
    if (cached) return cached;

    const analysis = {
      dynamicEdges: [],
      mocks: [],
      namedImports: [],
      staticEdges: [],
    };
    cache.set(filePath, analysis);

    let sourceFile;
    try {
      sourceFile = parseSourceFile(filePath);
    } catch {
      return analysis;
    }
    analysis.sourceFile = sourceFile;

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        const resolved = resolveSpecifier(specifier, filePath);
        const declarationIsTypeOnly = Boolean(statement.importClause?.isTypeOnly);

        // `import type { X } from 'm'` is fully elided — the module never loads.
        if (resolved && !declarationIsTypeOnly) analysis.staticEdges.push(resolved);

        const bindings = statement.importClause?.namedBindings;
        if (resolved && !declarationIsTypeOnly && bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            analysis.namedImports.push({
              imported: (element.propertyName ?? element.name).text,
              local: element.name.text,
              resolved,
              specifier,
            });
          }
        }
        continue;
      }

      // `export { X } from './Y'` / `export * from './Y'` keep the graph
      // reachable but are re-exports, never consumption.
      if (ts.isExportDeclaration(statement)) {
        if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
        if (statement.isTypeOnly) continue;
        const resolved = resolveSpecifier(statement.moduleSpecifier.text, filePath);
        if (resolved) analysis.staticEdges.push(resolved);
      }
    }

    const visit = (node) => {
      if (isViMockCall(node)) {
        const specifier = getMockedSpecifier(node);
        if (specifier) {
          analysis.mocks.push({
            factory: node.arguments[1],
            node,
            resolved: resolveSpecifier(specifier, filePath),
            specifier,
          });
        }
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const resolved = resolveSpecifier(node.arguments[0].text, filePath);
        if (resolved) analysis.dynamicEdges.push(resolved);
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    return analysis;
  }

  return { analyze, resolveSpecifier };
}

/**
 * Barrel export name -> the file and original name it comes from.
 * `export { Textarea as TextArea } from './Textarea'` maps TextArea to
 * { file: src/components/ui/Textarea.tsx, original: 'Textarea' }.
 */
function buildBarrelExportMap(barrelIndexPath, graph) {
  const map = new Map();
  const wildcardSources = [];
  if (!barrelIndexPath || !isFile(barrelIndexPath)) return { map, wildcardSources };

  const sourceFile = parseSourceFile(barrelIndexPath);

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.isTypeOnly) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;

    const resolved = graph.resolveSpecifier(statement.moduleSpecifier.text, barrelIndexPath);
    if (!resolved) continue;

    if (!statement.exportClause) {
      wildcardSources.push(resolved);
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;

    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const exposed = element.name.text;
      const original = (element.propertyName ?? element.name).text;
      const sources = map.get(exposed) ?? [];
      sources.push({ file: resolved, original });
      map.set(exposed, sources);
    }
  }

  return { map, wildcardSources };
}

/** Value (non-type) export names a single module provides to importers. */
function collectValueExportNames(filePath) {
  const names = new Set();
  let sourceFile;
  try {
    sourceFile = parseSourceFile(filePath);
  } catch {
    return names;
  }

  const isExported = (node) =>
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      isExported(statement) &&
      statement.name
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause) {
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        names.add(element.name.text);
      }
    }
  }

  return names;
}

/**
 * Fallback for keys the barrel index does not re-export. `@/contexts` exposes
 * no usePusher/usePresence/useMenuContext, so overriding them on the barrel can
 * only ever be dead — every consumer necessarily uses the direct path.
 */
function buildDirectoryExportIndex(directoryPath, barrelIndexPath) {
  const index = new Map();

  for (const filePath of collectSourceFilesUnder(directoryPath)) {
    if (filePath === barrelIndexPath) continue;
    for (const name of collectValueExportNames(filePath)) {
      const files = index.get(name) ?? [];
      files.push(filePath);
      index.set(name, files);
    }
  }

  return index;
}

// ─── the scan ────────────────────────────────────────────────────────────────

export function scan(options = {}) {
  const root = options.root ? path.resolve(options.root) : DEFAULT_ROOT;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_ENFORCED_DEPTH;
  const sourceRoot = path.join(root, 'src');
  const graph = createModuleGraph(sourceRoot);

  const barrels = [];
  /**
   * Audited barrels whose index file could not be resolved. Silently skipping
   * these is how a repo refactor (rename/move/split `src/components/ui/index.ts`)
   * would disarm the whole ratchet with a green, empty scan — so they are
   * surfaced on the result, printed, and asserted on by
   * src/components/ui/BarrelMock.contract.test.ts.
   */
  const unresolvedBarrels = [];
  for (const barrel of AUDITED_BARRELS) {
    const indexPath = graph.resolveSpecifier(barrel.specifier, path.join(sourceRoot, '__entry__.ts'));
    if (!indexPath) {
      unresolvedBarrels.push(barrel.specifier);
      continue;
    }
    const directoryPath = path.join(sourceRoot, barrel.dir);
    const { map, wildcardSources } = buildBarrelExportMap(indexPath, graph);
    barrels.push({
      ...barrel,
      directoryPath,
      directoryExportIndex: buildDirectoryExportIndex(directoryPath, indexPath),
      exportMap: map,
      indexPath,
      wildcardSources,
    });
  }

  const relative = (absolute) => toPosix(path.relative(root, absolute));
  const aliasHint = (absolute) =>
    `@/${toPosix(path.relative(sourceRoot, absolute)).replace(/\.(tsx?|mts|jsx?)$/, '')}`;

  const testFiles = collectTestFiles(sourceRoot).sort();
  const allRows = [];
  /** Overrides suppressed because the author also mocked the direct path. */
  const correctlyHandled = new Set();
  /** Factory shapes the scanner could not decode — its own blind spots. */
  const unresolvedFactories = [];

  const helperKeyCache = new Map();
  const totalHelperKeysFor = (filePath, exportedName) => {
    const cacheKey = `${filePath}|${exportedName}`;
    if (!helperKeyCache.has(cacheKey)) {
      helperKeyCache.set(cacheKey, collectTotalHelperKeys(filePath, exportedName));
    }
    return helperKeyCache.get(cacheKey);
  };

  for (const testFile of testFiles) {
    const testAnalysis = graph.analyze(testFile);
    if (testAnalysis.mocks.length === 0) continue;

    const mockedFiles = new Set(
      testAnalysis.mocks.map((mock) => mock.resolved).filter(Boolean),
    );

    // `createMockContexts` -> the full key set of src/test/mock-contexts.ts,
    // following whatever local name the test bound it under, whether by static
    // import, require(), or dynamic import.
    const helperBindings = [
      ...testAnalysis.namedImports,
      ...(testAnalysis.sourceFile
        ? collectDestructuredImportBindings(testAnalysis.sourceFile, testFile, graph.resolveSpecifier)
        : []),
    ];
    const resolveHelperKeys = (localName) => {
      for (const entry of helperBindings) {
        if (entry.local !== localName) continue;
        const helperKeys = totalHelperKeysFor(entry.resolved, entry.imported);
        if (helperKeys) return helperKeys;
      }
      return undefined;
    };

    const relevantMocks = [];
    for (const barrel of barrels) {
      for (const mock of testAnalysis.mocks) {
        if (mock.specifier !== barrel.specifier) continue;
        const overrides = extractFactoryOverrides(mock.factory, testAnalysis.sourceFile, {
          resolveHelperKeys,
        });
        if (!overrides.resolvable) {
          unresolvedFactories.push({
            barrel: barrel.specifier,
            form: overrides.form,
            testFile: relative(testFile),
          });
        }
        if (overrides.keys.size === 0) continue;
        relevantMocks.push({ barrel, mock, overrides });
      }
    }
    if (relevantMocks.length === 0) continue;

    // BFS the graph the test actually loads. Mocked modules never execute, so
    // they are barriers, not nodes.
    const depths = new Map([[testFile, 0]]);
    let frontier = [testFile];
    while (frontier.length > 0) {
      const next = [];
      for (const current of frontier) {
        const analysis = graph.analyze(current);
        const depth = depths.get(current) ?? 0;
        for (const edge of [...analysis.staticEdges, ...analysis.dynamicEdges]) {
          if (depths.has(edge)) continue;
          if (mockedFiles.has(edge)) continue;
          depths.set(edge, depth + 1);
          next.push(edge);
        }
      }
      frontier = next;
    }

    for (const { barrel, overrides } of relevantMocks) {
      for (const key of [...overrides.keys].sort()) {
        const sources = barrel.exportMap.get(key) ?? [];
        let candidateSources = sources;
        if (candidateSources.length === 0) {
          // Not re-exported by the barrel: fall back to files under the barrel
          // directory (plus any `export *` sources) that really export the name.
          const fallbackFiles = [
            ...(barrel.directoryExportIndex.get(key) ?? []),
            ...barrel.wildcardSources,
          ];
          candidateSources = [...new Set(fallbackFiles)].map((file) => ({ file, original: key }));
        }
        if (candidateSources.length === 0) continue;

        for (const source of candidateSources) {
          if (!source.file.startsWith(barrel.directoryPath + path.sep)) continue;
          if (source.file === barrel.indexPath) continue;

          // The author already mocked the direct path: correctly handled.
          if (mockedFiles.has(source.file)) {
            correctlyHandled.add(`${relative(testFile)}|${barrel.specifier}|${key}`);
            continue;
          }

          for (const [modulePath, depth] of depths) {
            // src/test/** is harness code that deliberately mounts the real
            // providers (test-utils supplies a real ToastProvider).
            if (toPosix(modulePath).includes('/src/test/')) continue;

            const analysis = graph.analyze(modulePath);
            const consumes = analysis.namedImports.some(
              (entry) => entry.resolved === source.file && entry.imported === source.original,
            );
            if (!consumes) continue;

            allRows.push({
              alsoMocksDirectPath: false,
              barrel: barrel.specifier,
              barrelExportsKey: sources.length > 0,
              deadKey: key,
              depth,
              directPath: aliasHint(source.file),
              importedName: source.original,
              importingModule: relative(modulePath),
              riskClass: classifyRisk(key),
              testFile: relative(testFile),
              testWrapsRealProvider: wrapsRealProvider(graph, depths, source.file),
              usesUiMockForm: overrides.usesUiMockForm,
            });
          }
        }
      }
    }
  }

  allRows.sort(
    (a, b) =>
      a.testFile.localeCompare(b.testFile) ||
      a.barrel.localeCompare(b.barrel) ||
      a.deadKey.localeCompare(b.deadKey) ||
      a.importingModule.localeCompare(b.importingModule),
  );

  const rows = allRows.filter((row) => row.depth <= maxDepth);
  const deepRows = allRows.filter((row) => row.depth > maxDepth);

  return {
    auditedBarrelCount: barrels.length,
    correctlyHandledCount: correctlyHandled.size,
    deepRows,
    deepSummary: summarize(deepRows),
    maxDepth,
    root,
    rows,
    summary: summarize(rows),
    testFileCount: testFiles.length,
    unresolvedBarrels,
    unresolvedFactories,
    unresolvedFactoryCount: unresolvedFactories.length,
  };
}

/** True when a real `*Provider` from the same module is loaded by this graph. */
function wrapsRealProvider(graph, depths, sourceFile) {
  for (const modulePath of depths.keys()) {
    const analysis = graph.analyze(modulePath);
    for (const entry of analysis.namedImports) {
      if (entry.resolved === sourceFile && entry.imported.endsWith('Provider')) return true;
    }
  }
  return false;
}

export function summarize(rows) {
  const byBarrel = {};
  const byDepth = {};
  const byRisk = { R1: 0, R2: 0, R3: 0 };
  const keyCounts = new Map();
  const offenderFiles = new Set();
  const offenderFilesByBarrel = {};

  for (const row of rows) {
    byBarrel[row.barrel] = (byBarrel[row.barrel] ?? 0) + 1;
    const depthKey = String(row.depth);
    byDepth[depthKey] = (byDepth[depthKey] ?? 0) + 1;
    byRisk[row.riskClass] += 1;
    keyCounts.set(`${row.barrel} ${row.deadKey}`, (keyCounts.get(`${row.barrel} ${row.deadKey}`) ?? 0) + 1);
    offenderFiles.add(row.testFile);
    offenderFilesByBarrel[row.barrel] = offenderFilesByBarrel[row.barrel] ?? new Set();
    offenderFilesByBarrel[row.barrel].add(row.testFile);
  }

  const offenderFileCountByBarrel = {};
  for (const [barrel, files] of Object.entries(offenderFilesByBarrel)) {
    offenderFileCountByBarrel[barrel] = files.size;
  }

  return {
    byBarrel,
    byDepth,
    byRisk,
    offenderFileCount: offenderFiles.size,
    offenderFileCountByBarrel,
    rowCount: rows.length,
    topDeadKeys: [...keyCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)
      .map(([key, count]) => ({ count, key })),
  };
}

// ─── baseline / ratchet ──────────────────────────────────────────────────────

export function rowKey(row) {
  return `${row.testFile}|${row.barrel}|${row.deadKey}`;
}

export function toBaseline(result) {
  const offenders = {};
  for (const row of result.rows) {
    offenders[row.testFile] = offenders[row.testFile] ?? {};
    const keys = offenders[row.testFile][row.barrel] ?? [];
    if (!keys.includes(row.deadKey)) keys.push(row.deadKey);
    offenders[row.testFile][row.barrel] = keys;
  }

  const sortedOffenders = {};
  for (const testFile of Object.keys(offenders).sort()) {
    const barrels = {};
    for (const barrel of Object.keys(offenders[testFile]).sort()) {
      barrels[barrel] = offenders[testFile][barrel].sort();
    }
    sortedOffenders[testFile] = barrels;
  }

  return {
    _README:
      'GENERATED FILE — never hand-edit. Shrink-only ratchet of dead barrel-mock ' +
      'overrides (a vi.mock on @/components/ui or @/contexts whose override the ' +
      'module under test bypasses by importing the symbol from its direct path). ' +
      'Regenerate with: npm run audit:dead-mocks -- --baseline. ' +
      'Enforced by src/components/ui/BarrelMock.contract.test.ts (runs in the ' +
      'blocking test:ui-contracts CI step) and npm run audit:dead-mocks.',
    offenders: sortedOffenders,
    totals: {
      offenderFileCount: result.summary.offenderFileCount,
      rowCount: result.summary.rowCount,
    },
  };
}

export function baselinePath(root = DEFAULT_ROOT) {
  return path.join(root, BASELINE_RELATIVE_PATH);
}

export function loadBaseline(root = DEFAULT_ROOT, explicitPath) {
  const file = explicitPath ? path.resolve(explicitPath) : baselinePath(root);
  if (!isFile(file)) return { baseline: undefined, file };
  return { baseline: JSON.parse(fs.readFileSync(file, 'utf8')), file };
}

export function baselineKeySet(baseline) {
  const keys = new Set();
  for (const [testFile, barrels] of Object.entries(baseline?.offenders ?? {})) {
    for (const [barrel, deadKeys] of Object.entries(barrels)) {
      for (const deadKey of deadKeys) keys.add(`${testFile}|${barrel}|${deadKey}`);
    }
  }
  return keys;
}

/**
 * Shrink-only comparison. `newOffenders` are triples absent from the baseline;
 * `countRegression` catches the same triple multiplying across modules.
 */
export function compareToBaseline(result, baseline) {
  if (!baseline) {
    return {
      countRegression: false,
      fixedKeys: [],
      hasBaseline: false,
      newOffenders: [],
      ok: true,
    };
  }

  const known = baselineKeySet(baseline);
  const seen = new Set();
  const newOffenders = [];

  for (const row of result.rows) {
    const key = rowKey(row);
    seen.add(key);
    if (!known.has(key) && !newOffenders.some((entry) => rowKey(entry) === key)) {
      newOffenders.push(row);
    }
  }

  const baselineRowCount = baseline?.totals?.rowCount ?? known.size;
  const countRegression = result.summary.rowCount > baselineRowCount;

  return {
    baselineRowCount,
    countRegression,
    fixedKeys: [...known].filter((key) => !seen.has(key)).sort(),
    hasBaseline: true,
    newOffenders,
    ok: newOffenders.length === 0 && !countRegression,
  };
}

export function describeRow(row) {
  return (
    `${row.testFile}\n` +
    `    vi.mock('${row.barrel}') overrides '${row.deadKey}' [${row.riskClass} ${RISK_LABELS[row.riskClass]}]\n` +
    `    but ${row.importingModule} (depth ${row.depth}) imports ` +
    `'${row.importedName}' from '${row.directPath}' — the override never applies.\n` +
    `    FIX: mock '${row.directPath}' too (or import '${row.deadKey}' from '${row.barrel}' in the module).`
  );
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {
    baselineFile: undefined,
    maxDepth: DEFAULT_MAX_ENFORCED_DEPTH,
    mode: 'report',
    root: DEFAULT_ROOT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.mode = 'json';
    } else if (arg === '--baseline') {
      options.mode = 'baseline';
    } else if (arg === '--check') {
      options.mode = 'check';
    } else if (arg === '--all-depths') {
      options.maxDepth = Number.POSITIVE_INFINITY;
    } else if (arg === '--max-depth') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0) throw new Error('--max-depth requires a non-negative integer');
      options.maxDepth = value;
      index += 1;
    } else if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root requires a directory');
      options.root = path.resolve(process.cwd(), value);
      index += 1;
    } else if (arg === '--baseline-file') {
      const value = argv[index + 1];
      if (!value) throw new Error('--baseline-file requires a path');
      options.baselineFile = path.resolve(process.cwd(), value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/audit-dead-mocks.mjs [--json|--baseline|--check] ' +
        '[--root <react-frontend-dir>] [--baseline-file <path>] ' +
        '[--max-depth <n>|--all-depths]',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printReport(result) {
  const { summary } = result;
  const depthLabel = Number.isFinite(result.maxDepth) ? `depth <= ${result.maxDepth}` : 'all depths';
  console.log(
    `Dead barrel-mock overrides (enforced scope: ${depthLabel}): ${summary.rowCount} rows across ` +
    `${summary.offenderFileCount} test files (${result.testFileCount} test files scanned).`,
  );

  const barrelParts = Object.entries(summary.byBarrel)
    .sort()
    .map(([barrel, count]) => `${barrel} ${count} rows / ${summary.offenderFileCountByBarrel[barrel]} files`);
  console.log(`  by barrel: ${barrelParts.join(' | ') || 'none'}`);

  const depthParts = Object.entries(summary.byDepth)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([depth, count]) => `depth ${depth}: ${count}`);
  console.log(`  by depth:  ${depthParts.join(' | ') || 'none'}`);
  console.log(
    `  by risk:   R1 control-flow ${summary.byRisk.R1} | ` +
    `R2 identity ${summary.byRisk.R2} | R3 cosmetic ${summary.byRisk.R3}`,
  );
  if (summary.topDeadKeys.length > 0) {
    console.log(
      `  top keys:  ${summary.topDeadKeys.map(({ count, key }) => `${key} (${count})`).join(', ')}`,
    );
  }
  if (result.deepSummary.rowCount > 0) {
    console.log(
      `  deep (informational, NOT ratcheted): ${result.deepSummary.rowCount} rows across ` +
      `${result.deepSummary.offenderFileCount} test files beyond ${depthLabel} — statically ` +
      'reachable but usually never rendered by the test.',
    );
  }
  console.log(
    `  suppressed: ${result.correctlyHandledCount} override(s) the author correctly handled ` +
    'by also mocking the direct path.',
  );

  // Blind spots, printed unconditionally: a zero here is a claim the scanner
  // decoded every factory it saw, and a non-zero is the list to go teach it.
  console.log(
    `  unresolvedFactories: ${result.unresolvedFactoryCount} vi.mock factor(ies) on an audited ` +
    'barrel whose shape could not be decoded (overrides there are INVISIBLE to this audit).',
  );
  if (result.unresolvedFactoryCount > 0) {
    const shown = result.unresolvedFactories.slice(0, 10);
    for (const entry of shown) {
      console.log(`    ? ${entry.testFile} -> vi.mock('${entry.barrel}') [${entry.form}]`);
    }
    if (result.unresolvedFactories.length > shown.length) {
      console.log(`    … and ${result.unresolvedFactories.length - shown.length} more (use --json).`);
    }
  }
  console.log(
    `  barrels audited: ${result.auditedBarrelCount}/${AUDITED_BARRELS.length}` +
    (result.unresolvedBarrels.length > 0
      ? ` — UNRESOLVED: ${result.unresolvedBarrels.join(', ')}`
      : ''),
  );

  const byFile = new Map();
  for (const row of result.rows) {
    const bucket = byFile.get(row.testFile) ?? [];
    bucket.push(row);
    byFile.set(row.testFile, bucket);
  }

  const LIMIT = 40;
  let printed = 0;
  for (const [testFile, fileRows] of byFile) {
    if (printed >= LIMIT) break;
    printed += 1;
    console.log('');
    console.log(`${printed}. ${testFile}`);
    for (const row of fileRows) {
      console.log(
        `   [${row.riskClass}] ${row.barrel} -> '${row.deadKey}' dead for ` +
        `${row.importingModule} (depth ${row.depth}); mock '${row.directPath}'`,
      );
    }
  }
  if (byFile.size > printed) {
    console.log('');
    console.log(`… and ${byFile.size - printed} more offending test files (use --json for all).`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = scan({ maxDepth: options.maxDepth, root: options.root });

  if (options.mode === 'json') {
    console.log(JSON.stringify({ ...result, rows: result.rows }, null, 2));
    return;
  }

  // An audited barrel whose index vanished means the scan covered less than it
  // claims. Refusing to write a truncated baseline (and failing the ratchet) is
  // the difference between "the repo is clean" and "the scanner went blind".
  if (result.unresolvedBarrels.length > 0) {
    console.error(
      `Dead barrel-mock scan is BLIND: could not resolve ${result.unresolvedBarrels.join(', ')} ` +
      `under ${toPosix(path.relative(process.cwd(), path.join(result.root, 'src')))}. ` +
      'Fix AUDITED_BARRELS (or the barrel path) before trusting or regenerating this audit.',
    );
    process.exitCode = 1;
    return;
  }

  if (options.mode === 'baseline') {
    const file = options.baselineFile ?? baselinePath(options.root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(toBaseline(result), null, 2)}\n`, 'utf8');
    console.log(
      `Wrote baseline ${toPosix(path.relative(options.root, file))}: ` +
      `${result.summary.rowCount} rows across ${result.summary.offenderFileCount} test files.`,
    );
    return;
  }

  const { baseline, file } = loadBaseline(options.root, options.baselineFile);
  const comparison = compareToBaseline(result, baseline);

  if (options.mode !== 'check') printReport(result);

  if (!comparison.hasBaseline) {
    console.warn(
      `No baseline at ${toPosix(path.relative(options.root, file))} — run with --baseline to create it.`,
    );
    return;
  }

  if (comparison.newOffenders.length > 0) {
    console.error('');
    console.error(
      `Dead barrel-mock ratchet FAILED: ${comparison.newOffenders.length} new offender(s).`,
    );
    for (const row of comparison.newOffenders) {
      console.error('');
      console.error(`  ${describeRow(row)}`);
    }
    process.exitCode = 1;
  }

  if (comparison.countRegression) {
    console.error('');
    console.error(
      `Dead barrel-mock ratchet FAILED: row count rose from ` +
      `${comparison.baselineRowCount} to ${result.summary.rowCount}. This baseline is shrink-only.`,
    );
    process.exitCode = 1;
  }

  if (comparison.ok) {
    if (comparison.fixedKeys.length > 0) {
      console.log('');
      console.log(
        `${comparison.fixedKeys.length} baselined offender(s) are now fixed — ` +
        'regenerate the baseline to lock the win in (npm run audit:dead-mocks -- --baseline).',
      );
    }
    console.log('');
    console.log(
      `Dead barrel-mock ratchet OK (${result.summary.rowCount} rows ` +
      `<= baseline ${comparison.baselineRowCount}, no new offenders).`,
    );
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main();
