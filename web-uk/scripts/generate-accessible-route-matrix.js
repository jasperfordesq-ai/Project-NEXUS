// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');
const { collectGeneratorProvenance } = require('./generator-provenance');

const LOCAL_INFRASTRUCTURE_ROUTES = new Set([
  'GET|/health',
  // 🔴 `/version` is machine-only, exactly like `/health`: it reports which
  // accessible frontend answered, and it is what the deploy smoke test and the
  // cutover check match on. It is not a member-facing page, so counting it as an
  // "extra web-uk route" put an infrastructure endpoint into the number that is
  // supposed to mean "a page Blade does not have" — noise in the one figure this
  // artefact exists to keep honest. Classified 2026-08-12.
  'GET|/version',
  'GET|/service-unavailable',
  'POST|/session/touch'
]);

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listFiles(dirPath, predicate) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, predicate));
    } else if (!predicate || predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeRoutePath(routePath) {
  let normalized = String(routePath || '/').trim();
  normalized = normalized.replace(/\\/g, '/');
  normalized = normalized.replace(/[?#].*$/, '');
  normalized = normalized.replace(/:([A-Za-z0-9_]+)(\([^)]*\))?/g, '{param}');
  normalized = normalized.replace(/\{[^}/]+\}/g, '{param}');
  normalized = normalized.replace(/\/+/g, '/');

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.replace(/\/$/, '');
  return normalized || '/';
}

function joinRoutePath(prefix, child) {
  const cleanPrefix = String(prefix || '').trim();
  const cleanChild = String(child || '').trim();

  if (!cleanPrefix) {
    return normalizeRoutePath(cleanChild || '/');
  }

  if (!cleanChild || cleanChild === '/') {
    return normalizeRoutePath(cleanPrefix);
  }

  return normalizeRoutePath(`${cleanPrefix.replace(/\/$/, '')}/${cleanChild.replace(/^\//, '')}`);
}

// 🔴 ORDER MATTERS. Line comments MUST be stripped before block comments — see
// the long note in generate-api-consumer-ledger.js. The reverse order lets a
// `/*` inside an ordinary `//` comment open a block comment that eats every
// route up to the next `*/`. On routes/api.php that hid 30.1% of all routes.
function stripPhpComments(text) {
  return text
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function collectPhpStatements(text, token) {
  const statements = [];
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf(token, index);
    if (start === -1) {
      break;
    }

    let quote = '';
    let escaped = false;

    for (let cursor = start; cursor < text.length; cursor += 1) {
      const char = text[cursor];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = '';
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (char === ';') {
        statements.push(text.slice(start, cursor + 1));
        index = cursor + 1;
        break;
      }

      if (cursor === text.length - 1) {
        index = text.length;
      }
    }
  }

  return statements;
}

function extractRouteName(statement) {
  const match = statement.match(/->name\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  return match ? match[1] : '';
}

function extractMiddleware(statement) {
  return [...statement.matchAll(/->middleware\s*\(\s*([^)]*?)\s*\)/g)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
    .join('; ');
}

function extractRouteParamNames(routePath) {
  return [...String(routePath || '').matchAll(/\{([^}/]+)\}/g)]
    .map((match) => match[1].replace(/\?$/, ''));
}

function extractWhereNumberParams(statement) {
  return new Set([...statement.matchAll(/->whereNumber\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1]));
}

// 🔴 The Blade accessible frontend this compared against was DELETED on 2026-08-14.
// Its final route inventory is frozen in blade-route-inventory.frozen.json and is
// read below whenever the live route files are absent — which is now always.
//
// Read this before "simplifying" either loader away. Both were existsSync-guarded,
// so with Blade gone they did not crash: they silently produced ZERO Laravel routes.
// That is worse than a crash. Every one of web-uk's 723 routes became "extra-web-uk",
// laravelRoutes/matchedRoutes dropped to 0, the committed artefact no longer matched
// a regeneration (so `check-generated-artefacts-current.js` could never pass again),
// and — the part that actually matters — a web-uk route that got DELETED would have
// been reported as "no Laravel route to match" rather than as a regression.
//
// Against the frozen snapshot the comparison keeps its teeth in the only direction
// that still exists: has web-uk stopped serving something the accessible frontend
// served on the day Blade was retired?
const FROZEN_BLADE_INVENTORY = path.join(__dirname, 'blade-route-inventory.frozen.json');

function readFrozenBladeInventory() {
  if (!fs.existsSync(FROZEN_BLADE_INVENTORY)) {
    throw new Error(
      `Frozen Blade route inventory missing: ${FROZEN_BLADE_INVENTORY}\n` +
      'The Blade accessible frontend was deleted on 2026-08-14, so this snapshot is the\n' +
      'only remaining Laravel side of the comparison. Restore it from git rather than\n' +
      'letting the matrix regenerate with zero Laravel routes.'
    );
  }

  return JSON.parse(fs.readFileSync(FROZEN_BLADE_INVENTORY, 'utf8'));
}

function parseLaravelRoutes(sourceRoot) {
  const routeRoot = path.join(sourceRoot, 'routes');
  const routeFiles = [];
  const core = path.join(routeRoot, 'govuk-alpha.php');
  const parityRoot = path.join(routeRoot, 'govuk-alpha-parity');

  if (fs.existsSync(core)) {
    routeFiles.push(core);
  }

  routeFiles.push(...listFiles(parityRoot, (filePath) => filePath.endsWith('.php')).sort());

  if (routeFiles.length === 0) {
    return readFrozenBladeInventory().routes;
  }

  const routes = [];

  for (const filePath of routeFiles) {
    const text = stripPhpComments(readText(filePath));
    const statements = collectPhpStatements(text, 'Route::');

    for (const statement of statements) {
      const match = statement.match(/Route::(get|post|put|patch|delete|view)\s*\(\s*['"]([^'"]+)['"]/i);
      if (!match) {
        continue;
      }

      const handlerMatch = statement.match(/\[AlphaController::class\s*,\s*['"]([^'"]+)['"]\]/);
      const routeMethod = match[1].toLowerCase() === 'view' ? 'GET' : match[1].toUpperCase();
      const paramNames = extractRouteParamNames(match[2]);
      const whereNumberParams = extractWhereNumberParams(statement);

      routes.push({
        method: routeMethod,
        path: normalizeRoutePath(match[2]),
        laravelParamConstraints: paramNames.map((paramName) => (whereNumberParams.has(paramName) ? 'number' : '')),
        laravelHandler: handlerMatch ? handlerMatch[1] : '',
        laravelRouteName: extractRouteName(statement),
        laravelRouteFile: filePath,
        laravelMiddleware: extractMiddleware(statement)
      });
    }
  }

  return compressRoutes(routes, (route) => `laravel|${route.method}|${route.path}|${route.laravelHandler}`);
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function parseControllerMethods(sourceRoot) {
  const controllerRoot = path.join(sourceRoot, 'app', 'Http', 'Controllers', 'GovukAlpha');
  const files = listFiles(controllerRoot, (filePath) => filePath.endsWith('.php'));

  // Same frozen fallback as parseLaravelRoutes(), same reason — see the note there.
  // Without it every matrix row loses its view, auth, tenant-scoping and gate
  // columns, which is most of what makes the artefact readable as evidence.
  if (files.length === 0) {
    return new Map(Object.entries(readFrozenBladeInventory().handlers));
  }

  const methods = new Map();

  for (const filePath of files) {
    const text = stripPhpComments(readText(filePath));
    const functionPattern = /public\s+function\s+([A-Za-z0-9_]+)\s*\(/g;
    let match;

    while ((match = functionPattern.exec(text)) !== null) {
      const openBrace = text.indexOf('{', match.index);
      if (openBrace === -1) {
        continue;
      }

      const closeBrace = findMatchingBrace(text, openBrace);
      if (closeBrace === -1) {
        continue;
      }

      const body = text.slice(openBrace + 1, closeBrace);
      methods.set(match[1], {
        filePath,
        body,
        view: extractLaravelView(body),
        auth: inferAuth(body),
        gates: extractGates(body),
        apiNeeds: extractApiNeeds(body),
        tenantScoped: body.includes('assertTenantSlug')
      });

      functionPattern.lastIndex = closeBrace + 1;
    }
  }

  return methods;
}

function extractLaravelView(body) {
  const match = body.match(/(?:\$this->)?view\s*\(\s*['"]accessible-frontend::([^'"]+)['"]/);
  return match ? match[1] : '';
}

function inferAuth(body) {
  if (/currentUserId\s*\(\s*\)\s*={2,3}\s*null/.test(body) && /govuk-alpha\.login|auth-required/.test(body)) {
    return 'auth-required';
  }

  if (/currentUserId\s*\(\s*\)/.test(body) || /Auth::/.test(body)) {
    return 'auth-optional';
  }

  return 'public-or-unknown';
}

function extractGates(body) {
  const gates = new Set();
  const gatePattern = /TenantContext::has(Feature|Module)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = gatePattern.exec(body)) !== null) {
    gates.add(`${match[1] === 'Feature' ? 'feature' : 'module'}:${match[2]}`);
  }

  return [...gates].sort().join('; ');
}

function extractApiNeeds(body) {
  const needs = new Set();
  const apiControllerPattern = /app\s*\(\s*\\?App\\Http\\Controllers\\Api\\([^:]+)::class\s*\)\s*->\s*([A-Za-z0-9_]+)/g;
  const servicePattern = /app\s*\(\s*\\?App\\Services\\([^:]+)::class\s*\)/g;
  const instanceServicePattern = /\$this->([A-Za-z0-9_]+Service)\s*->\s*([A-Za-z0-9_]+)/g;
  let match;

  while ((match = apiControllerPattern.exec(body)) !== null) {
    needs.add(`api:${match[1]}::${match[2]}`);
  }

  while ((match = servicePattern.exec(body)) !== null) {
    needs.add(`service:${match[1]}`);
  }

  while ((match = instanceServicePattern.exec(body)) !== null) {
    needs.add(`service:${match[1]}::${match[2]}`);
  }

  return [...needs].sort().join('; ');
}

function firstRenderView(source) {
  const match = source.match(/res\.render\s*\(\s*['"]([^'"]+)['"]/);
  return match ? match[1] : '';
}

function parseRequireMap(serverText) {
  const requireMap = new Map();
  const requirePattern = /const\s+([A-Za-z0-9_]+)\s*=\s*require\s*\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)/g;
  let match;

  while ((match = requirePattern.exec(serverText)) !== null) {
    requireMap.set(match[1], `${match[2]}.js`);
  }

  return requireMap;
}

function parseAppUses(serverText, requireMap) {
  const uses = [];
  const usePattern = /app\.use\s*\(\s*([^;\n]+)\)/g;
  let match;

  while ((match = usePattern.exec(serverText)) !== null) {
    const args = match[1];
    const prefixMatch = args.match(/^\s*['"]([^'"]+)['"]\s*,/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    const identifiers = [...args.matchAll(/\b([A-Za-z0-9_]+)\b/g)]
      .map((idMatch) => idMatch[1])
      .filter((identifier) => requireMap.has(identifier) || identifier === 'staticPageRoutes');
    const routeVars = [...new Set(identifiers)];

    for (const routeVar of routeVars) {
      uses.push({ prefix, routeVar });
    }
  }

  return uses;
}

function parseDirectAppRoutes(serverText, serverPath) {
  const routes = [];
  const directPattern = /app\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = directPattern.exec(serverText)) !== null) {
    if (isCommentedOut(serverText, match.index)) continue;
    const nextRouteIndex = findNextRouteBoundary(serverText, match.index + 1);
    const snippet = serverText.slice(match.index, nextRouteIndex);

    routes.push({
      method: match[1].toUpperCase(),
      path: normalizeRoutePath(match[2]),
      webUkFile: serverPath,
      webUkView: firstRenderView(snippet)
    });
  }

  return routes;
}

/**
 * Is this match inside a comment rather than in real code?
 *
 * 🔴 Route discovery is a TEXTUAL match on the registration call, so prose that
 * quotes one is picked up as a working route. That produced a phantom
 * `GET /...` row in the matrix from a comment in `src/routes/legal.js` warning
 * about exactly this hazard. A phantom extra route is not harmless: it inflates
 * the extra-route count, which is one of the numbers the parity score reads.
 *
 * Line-level test only. A registration call genuinely sitting inside a block
 * comment would need the whole file tokenised, and a commented-out route on its
 * own line already starts with `//` or a continuation `*`.
 */
function isCommentedOut(text, index) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const before = text.slice(lineStart, index).trimStart();
  return before.startsWith('//') || before.startsWith('*');
}

function findNextRouteBoundary(text, start) {
  const candidates = ['\napp.get', '\napp.post', '\napp.put', '\napp.patch', '\napp.delete', '\napp.use', '\nrouter.get', '\nrouter.post'];
  const indexes = candidates
    .map((candidate) => text.indexOf(candidate, start))
    .filter((index) => index !== -1);

  return indexes.length ? Math.min(...indexes) : text.length;
}

/**
 * Refuse to scan a route file whose Express router is not called `router`.
 *
 * The route scanner below matches a literal `router.` token. That is fine while
 * every file follows the convention and catastrophic the moment one does not: the
 * file yields no routes, the matrix reports fewer than exist, and nothing fails.
 * The generated count feeds the production-readiness score, so under-reporting
 * silently is worse than not generating at all.
 *
 * Also catches the subtler case: a file that clearly creates a router but from
 * which the scanner extracts nothing.
 */
function assertRouterIsConventionallyNamed(routeFile, text) {
  const declarationPattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\s*\.\s*)?Router\s*\(/g;
  const declaredNames = [];

  let declaration;
  while ((declaration = declarationPattern.exec(text)) !== null) {
    if (isCommentedOut(text, declaration.index)) continue;
    declaredNames.push(declaration[1]);
  }

  const misnamed = [...new Set(declaredNames)].filter((name) => name !== 'router');
  if (misnamed.length > 0) {
    throw new Error(
      `${routeFile}: Express router declared as ${misnamed.map((name) => `\`${name}\``).join(', ')} rather than \`router\`. `
      + 'The route-matrix scanner matches the literal token `router.`, so every route in this file would be '
      + 'invisible and the matrix would report a smaller count with no failure. Rename the variable to `router`, '
      + 'or teach the scanner the new name — do not leave it silently unscanned.'
    );
  }

  if (declaredNames.length > 0 && !/\brouter\s*\.\s*(?:get|post|put|patch|delete)\s*\(/.test(text)) {
    throw new Error(
      `${routeFile}: declares an Express router but the scanner found no \`router.<method>(\` call in it. `
      + 'Either the file registers its routes in a form this scanner cannot see, or it is dead. '
      + 'Both need a human decision — the matrix must not silently omit it.'
    );
  }
}

function parseRouterFile(routeFile, prefix) {
  if (path.basename(routeFile) === 'laravel-prep-pages.js') {
    delete require.cache[require.resolve(routeFile)];
    const moduleExports = require(routeFile);
    if (Array.isArray(moduleExports.prepPages)) {
      return moduleExports.prepPages.map((page) => ({
        method: 'GET',
        path: joinRoutePath(prefix, page.expressPath),
        webUkFile: routeFile,
        webUkView: 'static-page'
      }));
    }
  }

  const text = readText(routeFile);

  // 🔴 This scanner matches the LITERAL token `router.`, so a file that names its
  // Express router anything else contributes ZERO routes and the matrix quietly
  // under-reports. That has already happened once: three working routes were
  // invisible for weeks, and the count feeds the readiness score. Fail loudly
  // instead of scanning on and reporting a smaller number as if it were the truth.
  assertRouterIsConventionallyNamed(routeFile, text);

  const routes = [];
  const routerPattern = /router\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = routerPattern.exec(text)) !== null) {
    if (isCommentedOut(text, match.index)) continue;
    const nextRouteIndex = findNextRouteBoundary(text, match.index + 1);
    const snippet = text.slice(match.index, nextRouteIndex);

    routes.push({
      method: match[1].toUpperCase(),
      path: joinRoutePath(prefix, match[2]),
      webUkFile: routeFile,
      webUkView: firstRenderView(snippet) || (match[2].includes('/download') ? 'streamed-download' : '')
    });
  }

  return routes;
}

function parseStaticPageRoutes(routeFile, prefix) {
  if (!fs.existsSync(routeFile)) {
    return [];
  }

  const text = readText(routeFile);
  const pagesStart = text.indexOf('const pages');
  const pagesEnd = text.indexOf('router.get', pagesStart === -1 ? 0 : pagesStart);
  const pagesSource = pagesStart === -1
    ? text
    : text.slice(pagesStart, pagesEnd === -1 ? text.length : pagesEnd);
  const routes = [];
  const keyPattern = /['"]([^'"]+)['"]\s*:/g;
  let match;

  while ((match = keyPattern.exec(pagesSource)) !== null) {
    if (!match[1].startsWith('/')) {
      continue;
    }

    routes.push({
      method: 'GET',
      path: joinRoutePath(prefix, match[1]),
      webUkFile: routeFile,
      webUkView: 'static-page'
    });
  }

  return routes;
}

function parseWebUkRoutes(webUkRoot) {
  const webRoot = path.join(webUkRoot, 'src');
  const serverPath = path.join(webRoot, 'server.js');

  if (!fs.existsSync(serverPath)) {
    return [];
  }

  const serverText = readText(serverPath);
  const requireMap = parseRequireMap(serverText);
  const routes = parseDirectAppRoutes(serverText, serverPath);
  const uses = parseAppUses(serverText, requireMap);

  for (const use of uses) {
    const routeFileName = requireMap.get(use.routeVar);
    if (!routeFileName) {
      continue;
    }

    const routeFile = path.join(webRoot, 'routes', routeFileName);
    if (use.routeVar === 'staticPageRoutes') {
      // 🔴 BOTH parsers, and the second one was missing until 2026-08-17.
      //
      // parseStaticPageRoutes only mines the `const pages = {…}` literal for keys.
      // While that map was the file's whole content that was sufficient, but the
      // file now also declares a REAL route (`/page/:slug`, a community's own CMS
      // page). Mining the map alone reported ZERO routes for the file, so a live
      // member-facing page was invisible to the matrix — and the matrix count feeds
      // the readiness score, which is precisely the silent under-reporting the
      // comments above `assertRouterIsConventionallyNamed` warn about.
      //
      // compressRoutes dedupes the two sources, and isFallbackRoute makes a real
      // route win over a `static-page` fallback of the same path.
      routes.push(...parseStaticPageRoutes(routeFile, use.prefix));
      if (fs.existsSync(routeFile)) {
        routes.push(...parseRouterFile(routeFile, use.prefix));
      }
    } else if (fs.existsSync(routeFile)) {
      routes.push(...parseRouterFile(routeFile, use.prefix));
    }
  }

  return compressRoutes(routes, (route) => `web|${route.method}|${route.path}`);
}

function compressRoutes(routes, keyFn) {
  const map = new Map();

  for (const route of routes) {
    const key = keyFn(route);
    if (!map.has(key)) {
      map.set(key, { ...route });
      continue;
    }

    const existing = map.get(key);
    const existingIsFallback = isFallbackRoute(existing);
    const routeIsFallback = isFallbackRoute(route);

    if (existingIsFallback && !routeIsFallback) {
      map.set(key, { ...route });
      continue;
    }

    if (!existingIsFallback && routeIsFallback) {
      continue;
    }

    for (const [field, value] of Object.entries(route)) {
      if (!value || existing[field] === value) {
        continue;
      }
      if (!existing[field]) {
        existing[field] = value;
      } else {
        const values = new Set(String(existing[field]).split('; ').filter(Boolean));
        values.add(value);
        existing[field] = [...values].sort().join('; ');
      }
    }
  }

  return [...map.values()].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function isFallbackRoute(route) {
  if (!route || route.webUkView !== 'static-page' || !route.webUkFile) {
    return false;
  }

  const fileName = path.basename(route.webUkFile);
  return fileName === 'static-pages.js' || fileName === 'laravel-prep-pages.js';
}

function buildMatrix(laravelRoutes, webUkRoutes, methodDetails) {
  const webIndex = new Map(webUkRoutes.map((route) => [`${route.method}|${route.path}`, route]));
  const seen = new Set();
  const matrix = [];

  for (const route of laravelRoutes) {
    const key = `${route.method}|${route.path}`;
    const target = webIndex.get(key);
    const method = methodDetails.get(route.laravelHandler) || {};

    seen.add(key);
    matrix.push({
      method: route.method,
      path: route.path,
      family: routeFamily(route.path),
      status: target ? 'matched' : 'missing',
      laravelRouteName: route.laravelRouteName,
      laravelHandler: route.laravelHandler,
      laravelView: method.view || '',
      laravelParamConstraints: route.laravelParamConstraints || [],
      laravelRouteFile: route.laravelRouteFile,
      laravelControllerFile: method.filePath || '',
      laravelMiddleware: route.laravelMiddleware,
      auth: method.auth || 'unknown',
      tenantScoped: method.tenantScoped === true ? 'yes' : 'unknown',
      gates: method.gates || '',
      apiNeeds: method.apiNeeds || '',
      webUkPath: target ? target.path : '',
      webUkView: target ? target.webUkView : '',
      webUkFile: target ? target.webUkFile : ''
    });
  }

  for (const target of webUkRoutes) {
    const key = `${target.method}|${target.path}`;
    if (seen.has(key)) {
      continue;
    }

    const isInfrastructureRoute = LOCAL_INFRASTRUCTURE_ROUTES.has(key);
    matrix.push({
      method: target.method,
      path: target.path,
      family: routeFamily(target.path),
      status: isInfrastructureRoute ? 'ignored-web-uk-infrastructure' : 'extra-web-uk',
      laravelRouteName: '',
      laravelHandler: '',
      laravelView: '',
      laravelParamConstraints: [],
      laravelRouteFile: '',
      laravelControllerFile: '',
      laravelMiddleware: '',
      auth: '',
      tenantScoped: '',
      gates: '',
      apiNeeds: '',
      webUkPath: target.path,
      webUkView: target.webUkView,
      webUkFile: target.webUkFile,
      webUkRouteKind: isInfrastructureRoute ? 'infrastructure' : ''
    });
  }

  return matrix.sort((a, b) => `${a.status}|${a.family}|${a.method}|${a.path}`.localeCompare(`${b.status}|${b.family}|${b.method}|${b.path}`));
}

function routeFamily(routePath) {
  const first = normalizeRoutePath(routePath).split('/').filter(Boolean)[0];
  return first || 'home';
}

function summarize(matrix, laravelRoutes, webUkRoutes, sourceRoot, targetRoot, generatedAt) {
  const count = (status) => matrix.filter((row) => row.status === status).length;
  const familyCounts = {};

  for (const row of matrix) {
    if (!familyCounts[row.family]) {
      familyCounts[row.family] = { matched: 0, missing: 0, extraWebUk: 0, ignoredInfrastructure: 0 };
    }

    if (row.status === 'matched') {
      familyCounts[row.family].matched += 1;
    } else if (row.status === 'missing') {
      familyCounts[row.family].missing += 1;
    } else if (row.status === 'extra-web-uk') {
      familyCounts[row.family].extraWebUk += 1;
    } else if (row.status === 'ignored-web-uk-infrastructure') {
      familyCounts[row.family].ignoredInfrastructure += 1;
    }
  }

  return {
    generatedAt,
    sourceRoot,
    targetRoot,
    // 🔴 THESE COUNTS DO NOT SUM, AND THAT IS CORRECT. Read this before "fixing" it.
    //
    // `matchedRoutes` counts LARAVEL rows that found a web-uk route.
    // `webUkRoutes` counts DISTINCT web-uk routes.
    //
    // So matched + extra + ignored can exceed webUkRoutes when two Laravel routes
    // legitimately share one web-uk route. Today that is exactly one case:
    // `GET /` is registered twice in routes/govuk-alpha.php — once as `home` and
    // once as `govuk-alpha.tenant-chooser` — and web-uk serves both from a single
    // `/` route. Hence 707 + 12 + 3 = 722 against 721 web-uk routes.
    //
    // Checked on 2026-08-11 after the arithmetic was flagged as a possible
    // double-count: it is not one, and no route is missing or misclassified.
    laravelRoutes: laravelRoutes.length,
    webUkRoutes: webUkRoutes.length,
    matchedRoutes: count('matched'),
    missingRoutes: count('missing'),
    extraWebUkRoutes: count('extra-web-uk'),
    ignoredInfrastructureRoutes: count('ignored-web-uk-infrastructure'),
    familyCounts
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(rows, filePath) {
  const headers = [
    'status',
    'method',
    'path',
    'family',
    'laravelRouteName',
    'laravelHandler',
    'laravelView',
    'laravelParamConstraints',
    'auth',
    'tenantScoped',
    'gates',
    'apiNeeds',
    'webUkView',
    'webUkRouteKind',
    'laravelRouteFile',
    'laravelControllerFile',
    'webUkFile',
    'laravelMiddleware'
  ];
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
  ];

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function writeMarkdown(summary, matrix, filePath, provenance) {
  const familyRows = Object.entries(summary.familyCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, counts]) => `| ${family} | ${counts.matched} | ${counts.missing} | ${counts.extraWebUk} | ${counts.ignoredInfrastructure} |`);
  const missingRows = matrix
    .filter((row) => row.status === 'missing')
    .map((row) => `| ${row.method} | \`${row.path}\` | ${row.family} | ${row.laravelHandler || ''} | ${row.laravelView || ''} | ${row.auth || ''} | ${row.gates || ''} |`);
  const extraRows = matrix
    .filter((row) => row.status === 'extra-web-uk')
    .map((row) => `| ${row.method} | \`${row.path}\` | ${row.family} | ${row.webUkView || ''} | ${row.webUkFile || ''} |`);
  const ignoredRows = matrix
    .filter((row) => row.status === 'ignored-web-uk-infrastructure')
    .map((row) => `| ${row.method} | \`${row.path}\` | ${row.family} | ${row.webUkRouteKind || ''} |`);

  const lines = [
    '# Generated Laravel Accessible Route Matrix',
    '',
    'Status: **Generated snapshot — structural route inventory, not certification**',
    '',
    `Generated: ${summary.generatedAt}`,
    `Laravel commit SHA: \`${provenance.laravelCommitSha}\``,
    `Web UK repository commit SHA: \`${provenance.webUkRepositoryCommitSha}\``,
    `Laravel working tree dirty: ${provenance.laravelWorkingTreeDirty ? 'yes' : 'no'}`,
    `Web UK repository working tree dirty: ${provenance.webUkRepositoryWorkingTreeDirty ? 'yes' : 'no'}`,
    `Provenance caveat: ${provenance.caveat}`,
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Laravel accessible routes | ${summary.laravelRoutes} |`,
    `| web-uk routes | ${summary.webUkRoutes} |`,
    `| Matched routes | ${summary.matchedRoutes} |`,
    `| Missing routes | ${summary.missingRoutes} |`,
    `| Extra web-uk routes | ${summary.extraWebUkRoutes} |`,
    `| Ignored web-uk infrastructure routes | ${summary.ignoredInfrastructureRoutes} |`,
    '',
    '## Family Counts',
    '',
    '| Family | Matched | Missing | Extra web-uk | Ignored infrastructure |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...familyRows,
    '',
    '## Missing Laravel Routes',
    '',
    '| Method | Path | Family | Handler | Blade view | Auth | Gates |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(missingRows.length ? missingRows : ['| - | - | - | - | - | - | - |']),
    '',
    '## Extra Web UK Routes',
    '',
    '| Method | Path | Family | Web UK view | Web UK file |',
    '| --- | --- | --- | --- | --- |',
    ...(extraRows.length ? extraRows : ['| - | - | - | - | - |']),
    '',
    '## Ignored Web UK Infrastructure Routes',
    '',
    '| Method | Path | Family | Kind |',
    '| --- | --- | --- | --- |',
    ...(ignoredRows.length ? ignoredRows : ['| - | - | - | - |']),
    ''
  ];

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// Record file paths relative to the nearest known root, with forward slashes,
// so the generated artifacts are byte-identical on every machine and in CI.
//
// 🔴 They used to be written absolute. The committed matrix therefore carried
// one developer's directory layout, which is both noise in every diff and
// actively misleading once the tree moves — the CSV that shipped before the
// consolidation still pointed at a checkout path that no longer exists.
// Roots are tried most-general first so a monorepo path keeps its sibling
// prefix (`web-uk/src/server.js`, not a bare `src/server.js`).
function toRelativePath(filePath, roots) {
  if (!filePath) {
    return '';
  }

  for (const root of roots) {
    if (!root) {
      continue;
    }

    const relative = path.relative(root, filePath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
  }

  return filePath;
}

function relativizeMatrixPaths(matrix, roots) {
  return matrix.map((row) => ({
    ...row,
    laravelRouteFile: toRelativePath(row.laravelRouteFile, roots),
    laravelControllerFile: toRelativePath(row.laravelControllerFile, roots),
    webUkFile: toRelativePath(row.webUkFile, roots)
  }));
}

// Defaults follow the monorepo layout: this script lives at web-uk/scripts/, so
// web-uk/ is one level up and the repository root is two. Laravel is AT that
// repository root, which is why sourceRoot defaults to the same path.
//
// 🔴 These three were previously hardcoded to the pre-consolidation layout: a
// targetRoot of `<repo>/..`, a webUkRoot of `<targetRoot>/apps/web-uk`, and a
// sourceRoot of the literal string 'C:\platforms\htdocs\staging' — one
// developer's Laravel checkout. Running it anywhere else silently produced an
// empty or wrong matrix rather than failing, which is how the committed CSV
// ended up carrying absolute paths from a machine layout that no longer exists.
// Keep every root derived from __dirname or an explicit option; never reintroduce
// an absolute path.
function generateAccessibleRouteMatrix(options = {}) {
  const webUkRoot = options.webUkRoot || path.resolve(__dirname, '..');
  const targetRoot = options.targetRoot || path.resolve(__dirname, '..', '..');
  const sourceRoot = options.sourceRoot || targetRoot;
  const outDir = options.outDir || path.join(webUkRoot, 'docs', 'generated');
  const provenance = options.provenance || collectGeneratorProvenance({
    laravelRoot: sourceRoot,
    webUkRoot,
    generatedAt: options.generatedAt
  });
  const laravelRoutes = parseLaravelRoutes(sourceRoot);
  const methodDetails = parseControllerMethods(sourceRoot);
  const webUkRoutes = parseWebUkRoutes(webUkRoot).filter((route) => (
    path.basename(route.webUkFile || '') !== 'laravel-prep-pages.js'
  ));
  const matrix = relativizeMatrixPaths(
    buildMatrix(laravelRoutes, webUkRoutes, methodDetails),
    [targetRoot, sourceRoot, webUkRoot]
  );
  const summary = summarize(
    matrix,
    laravelRoutes,
    webUkRoutes,
    sourceRoot,
    targetRoot,
    provenance.generatedAt
  );
  const report = { generatedAt: provenance.generatedAt, provenance, summary, matrix };

  ensureDir(outDir);
  fs.writeFileSync(
    path.join(outDir, 'accessible-route-matrix.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  writeCsv(matrix, path.join(outDir, 'accessible-route-matrix.csv'));
  writeMarkdown(summary, matrix, path.join(outDir, 'accessible-route-matrix.md'), provenance);

  return report;
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--source-root') {
      options.sourceRoot = next;
      index += 1;
    } else if (arg === '--target-root') {
      options.targetRoot = next;
      index += 1;
    } else if (arg === '--web-uk-root') {
      options.webUkRoot = next;
      index += 1;
    } else if (arg === '--out-dir') {
      options.outDir = next;
      index += 1;
    }
  }

  return options;
}

if (require.main === module) {
  const report = generateAccessibleRouteMatrix(parseArgs(process.argv.slice(2)));
  console.log(`Laravel accessible routes: ${report.summary.laravelRoutes}`);
  console.log(`web-uk routes: ${report.summary.webUkRoutes}`);
  console.log(`matched: ${report.summary.matchedRoutes}`);
  console.log(`missing: ${report.summary.missingRoutes}`);
  console.log(`extra web-uk: ${report.summary.extraWebUkRoutes}`);
  console.log(`ignored web-uk infrastructure: ${report.summary.ignoredInfrastructureRoutes}`);
}

module.exports = {
  generateAccessibleRouteMatrix,
  normalizeRoutePath
};
