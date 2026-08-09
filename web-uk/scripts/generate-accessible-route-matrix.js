// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');
const { collectGeneratorProvenance } = require('./generator-provenance');

const LOCAL_INFRASTRUCTURE_ROUTES = new Set([
  'GET|/health',
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

function stripPhpComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
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

function parseLaravelRoutes(sourceRoot) {
  const routeRoot = path.join(sourceRoot, 'routes');
  const routeFiles = [];
  const core = path.join(routeRoot, 'govuk-alpha.php');
  const parityRoot = path.join(routeRoot, 'govuk-alpha-parity');

  if (fs.existsSync(core)) {
    routeFiles.push(core);
  }

  routeFiles.push(...listFiles(parityRoot, (filePath) => filePath.endsWith('.php')).sort());

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

function findNextRouteBoundary(text, start) {
  const candidates = ['\napp.get', '\napp.post', '\napp.put', '\napp.patch', '\napp.delete', '\napp.use', '\nrouter.get', '\nrouter.post'];
  const indexes = candidates
    .map((candidate) => text.indexOf(candidate, start))
    .filter((index) => index !== -1);

  return indexes.length ? Math.min(...indexes) : text.length;
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
  const routes = [];
  const routerPattern = /router\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = routerPattern.exec(text)) !== null) {
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

function parseWebUkRoutes(targetRoot) {
  const webRoot = path.join(targetRoot, 'apps', 'web-uk', 'src');
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
      routes.push(...parseStaticPageRoutes(routeFile, use.prefix));
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

function generateAccessibleRouteMatrix(options = {}) {
  const targetRoot = options.targetRoot || path.resolve(__dirname, '..', '..', '..');
  const sourceRoot = options.sourceRoot || 'C:\\platforms\\htdocs\\staging';
  const outDir = options.outDir || path.join(targetRoot, 'apps', 'web-uk', 'docs', 'generated');
  const provenance = options.provenance || collectGeneratorProvenance({
    laravelRoot: sourceRoot,
    webUkRoot: path.join(targetRoot, 'apps', 'web-uk'),
    generatedAt: options.generatedAt
  });
  const laravelRoutes = parseLaravelRoutes(sourceRoot);
  const methodDetails = parseControllerMethods(sourceRoot);
  const webUkRoutes = parseWebUkRoutes(targetRoot).filter((route) => (
    path.basename(route.webUkFile || '') !== 'laravel-prep-pages.js'
  ));
  const matrix = buildMatrix(laravelRoutes, webUkRoutes, methodDetails);
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
