// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-113: a route id parameter that is not digits-only lets a crafted link such as
 * `/exchanges/1%2f..%2f..%2fadmin` (Express decodes %2f to `/`, fetch then
 * collapses `..`) aim the member's own authenticated API call at a different
 * endpoint. Two rules close that for every route file, not just the ones the
 * audit happened to read:
 *
 *   1. every `:…id` / `:…Id` route parameter carries a `(\d+)` constraint, so a
 *      non-numeric value never reaches a handler; and
 *   2. every value interpolated into the path of an API call is wrapped in
 *      `encodeURIComponent` (or coerced to a number), so even a value that does
 *      reach one cannot add path segments.
 *
 * F-306 (F-113 residual) widened both rules, because the guard was blind in two
 * places a future change could reopen F-113 without turning it red:
 *
 *   - rule 1 only looked at parameters named `…id`. Now EVERY route parameter
 *     needs an inline constraint or an entry in REVIEWED_UNCONSTRAINED_PARAMS
 *     saying why its value cannot reach an API path unencoded.
 *   - rule 2 never read `src/lib/api.js`, where every API path is assembled.
 *     It now scans that file's call sites too, and every `/api…` path literal
 *     in it (rule 3), not only literals passed straight to a `call…()` helper.
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const SRC = path.join(__dirname, '..', 'src');

function routeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(SRC, 'routes'));
  out.push(path.join(SRC, 'server.js'));
  return out;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

const ROUTE_CALL = /\b(?:router|app)\.(?:get|post|put|patch|delete|all|use|route)\(\s*(['"`])([^'"`]*)\1/g;
const ID_PARAM = /:([A-Za-z]*[iI]d)(?![A-Za-z0-9_])(\()?/g;

describe('F-113 route id parameters are digits-only', () => {
  test('every :id / :…Id route parameter has a numeric constraint', () => {
    const offenders = [];
    for (const file of routeFiles()) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      for (const match of source.matchAll(ROUTE_CALL)) {
        for (const param of match[2].matchAll(ID_PARAM)) {
          if (!param[2]) {
            const line = source.slice(0, match.index).split('\n').length;
            offenders.push(`${path.relative(SRC, file)}:${line} ${match[2]}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// F-306: every route parameter — not only `…id` — needs an inline constraint,
// or a reviewed entry here saying why its value cannot reach an API path
// unencoded. Adding a parameter to this list is a security review, not a
// formality: name the line that neutralises it.
const REVIEWED_UNCONSTRAINED_PARAMS = {
  'routes/achievements.js :key': 'encodeURIComponent(key) at the callGamificationApi call',
  'routes/legal.js :type': 'mapped through the SLUG_TO_TYPE allow-list by slugType(); unknown -> 404',
  'routes/public-info.js :slug': 'findRelease() look-up in the bundled changelog; never sent to the API',
  'routes/venues.js :token': 'rejected unless it matches PASS_TOKEN before any API call',
};

const ANY_PARAM = /:([A-Za-z_][A-Za-z0-9_]*)(\()?/g;

function unconstrainedParams(source, relativeFile) {
  const found = [];
  const code = stripComments(source);
  for (const match of code.matchAll(ROUTE_CALL)) {
    for (const param of match[2].matchAll(ANY_PARAM)) {
      if (param[2]) continue;
      const line = code.slice(0, match.index).split('\n').length;
      found.push({ key: `${relativeFile} :${param[1]}`, where: `${relativeFile}:${line} ${match[2]}` });
    }
  }
  return found;
}

describe('F-306 every route parameter is constrained or reviewed', () => {
  test('no route parameter reaches a handler unconstrained without a recorded review', () => {
    const offenders = [];
    const seen = new Set();
    for (const file of routeFiles()) {
      const relative = path.relative(SRC, file).split(path.sep).join('/');
      for (const param of unconstrainedParams(fs.readFileSync(file, 'utf8'), relative)) {
        seen.add(param.key);
        if (!REVIEWED_UNCONSTRAINED_PARAMS[param.key]) offenders.push(param.where);
      }
    }
    expect(offenders).toEqual([]);
    // A reviewed entry that no longer matches a route is stale and must go.
    expect(Object.keys(REVIEWED_UNCONSTRAINED_PARAMS).filter((key) => !seen.has(key))).toEqual([]);
  });

  test('the check sees a non-id parameter the F-113 rule could not', () => {
    const fixture = "router.get('/things/:slug', handler);\nrouter.get('/things/:thingId(\\\\d+)', handler);";
    expect(unconstrainedParams(fixture, 'routes/fixture.js').map((p) => p.key)).toEqual(['routes/fixture.js :slug']);
  });
});

// Callees whose template-literal argument is an API path.
// F-306: `download…()` helpers take an API path too (downloadGroupFile).
const API_CALL = /\b(?:call\w*|download\w*|api\.\w+|\w+Api\w*)\(/g;
const SAFE_EXPRESSION = /^\s*(?:encodeURIComponent\(|Number\(|parseInt\(|positiveInt\()/;
// Query-string builders (and `suffix` variables) return `?…`, not a path segment.
const QUERY_BUILDER = /^\s*[\w.]*(?:Query|query|QueryString|queryString|suffix|Suffix)\s*(?:\(|$)|\.toString\(\)\s*$/;

function templateLiterals(text) {
  const literals = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') { i += 1; continue; }
    let depth = 0;
    let j = i + 1;
    for (; j < text.length; j += 1) {
      if (text[j] === '\\') { j += 1; continue; }
      if (text[j] === '$' && text[j + 1] === '{') { depth += 1; j += 1; continue; }
      if (text[j] === '}' && depth > 0) { depth -= 1; continue; }
      if (text[j] === '`' && depth === 0) break;
    }
    literals.push(text.slice(i + 1, j));
    i = j + 1;
  }
  return literals;
}

function topLevelExpressions(literal) {
  const expressions = [];
  let i = 0;
  while (i < literal.length) {
    if (literal[i] === '$' && literal[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      for (; j < literal.length && depth > 0; j += 1) {
        if (literal[j] === '{') depth += 1;
        else if (literal[j] === '}') depth -= 1;
      }
      expressions.push({ start: i, text: literal.slice(i + 2, j - 1) });
      i = j;
    } else {
      i += 1;
    }
  }
  return expressions;
}

function unencodedCallSites(rawSource, relativeFile, isApiClient = false) {
  const offenders = [];
  const source = stripComments(rawSource);
  for (const call of source.matchAll(API_CALL)) {
    // A helper's own definition (`async function callListingApi(`) is not a
    // call site; its body is checked by rule 3.
    if (/function\s+$/.test(source.slice(Math.max(0, call.index - 20), call.index))) continue;
    const window = source.slice(call.index + call[0].length, call.index + call[0].length + 400);
    const argsEnd = window.indexOf(');');
    for (const literal of templateLiterals(argsEnd > 0 ? window.slice(0, argsEnd) : window)) {
      if (!literal.startsWith('/')) continue;
      // In the API client, full `/api…` paths are rule 3's job (it knows the pass-through helpers).
      if (isApiClient && literal.startsWith('/api')) continue;
      const queryAt = literal.indexOf('?');
      for (const expression of topLevelExpressions(literal)) {
        if (queryAt >= 0 && expression.start > queryAt) continue;
        if (SAFE_EXPRESSION.test(expression.text) || QUERY_BUILDER.test(expression.text)) continue;
        const line = source.slice(0, call.index).split('\n').length;
        offenders.push(`${relativeFile}:${line} \${${expression.text}} in \`${literal.slice(0, 80)}\``);
      }
    }
  }
  return offenders;
}

const API_CLIENT = path.join(SRC, 'lib', 'api.js');

describe('F-113 API paths encode interpolated values', () => {
  test('every value interpolated into an API call path is encodeURIComponent-wrapped', () => {
    const offenders = [];
    // F-306: src/lib/api.js makes call…Api() calls of its own; scan it too.
    for (const file of [...routeFiles(), API_CLIENT]) {
      offenders.push(...unencodedCallSites(fs.readFileSync(file, 'utf8'), path.relative(SRC, file).split(path.sep).join('/'), file === API_CLIENT));
    }
    expect(offenders).toEqual([]);
  });
});

// F-306 rule 3: every `/api…` path literal assembled in src/lib/api.js. An
// interpolation before the query string must be encoded or numeric, a query
// fragment (`cond ? \`?…\` : ''`), or the path argument of a pass-through
// helper whose own callers rule 2 checks — its name must be a call…() / …Api…()
// callee, or it must be listed here with the helper that calls it.
const PASS_THROUGH_VARIABLE = /^\s*(?:normalizedPath|normalized|path)\s*$/;
const QUERY_TERNARY = /^[^`]*\?\s*`\?/;
const CHECKED_CALLEE = /^(?:call\w*|download\w*|\w+Api\w*)$/;
const INTERNAL_PATH_HELPERS = {
  gamificationEndpoint: 'called only by callGamificationApi(), whose callers rule 2 checks',
};

function enclosingFunctionName(source, index) {
  const before = source.slice(0, index);
  const matches = [...before.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(|^const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm)];
  const last = matches[matches.length - 1];
  return last ? (last[1] || last[2]) : '';
}

function unencodedApiClientPaths(rawSource, relativeFile) {
  const offenders = [];
  const source = stripComments(rawSource);
  let cursor = 0;
  for (const literal of templateLiterals(source)) {
    const at = source.indexOf('`' + literal + '`', cursor);
    cursor = at >= 0 ? at + literal.length : cursor;
    if (!literal.startsWith('/api')) continue;
    const queryAt = literal.indexOf('?');
    for (const expression of topLevelExpressions(literal)) {
      if (queryAt >= 0 && expression.start > queryAt) continue;
      if (SAFE_EXPRESSION.test(expression.text) || QUERY_BUILDER.test(expression.text)) continue;
      if (QUERY_TERNARY.test(expression.text)) continue;
      if (PASS_THROUGH_VARIABLE.test(expression.text)) {
        const owner = enclosingFunctionName(source, at);
        if (CHECKED_CALLEE.test(owner) || INTERNAL_PATH_HELPERS[owner]) continue;
      }
      const line = source.slice(0, Math.max(at, 0)).split('\n').length;
      offenders.push(`${relativeFile}:${line} \${${expression.text}} in \`${literal.slice(0, 80)}\``);
    }
  }
  return offenders;
}

describe('F-306 the API client assembles only encoded paths', () => {
  test('every /api path literal in src/lib/api.js encodes what it interpolates', () => {
    expect(unencodedApiClientPaths(fs.readFileSync(API_CLIENT, 'utf8'), 'lib/api.js')).toEqual([]);
  });

  test('the check sees an unencoded helper the F-113 rule could not', () => {
    const fixture = [
      'async function getThing(token, id) {',
      '  return request(`/api/v2/things/${id}`, { headers: {} });',
      '}',
      'async function getSafeThing(token, id) {',
      '  const endpoint = `/api/v2/things/${encodeURIComponent(id)}${query ? `?${query}` : \'\'}`;',
      '  return request(endpoint);',
      '}',
      'async function callThingApi(token, method, path = \'\') {',
      '  const normalizedPath = path.startsWith(\'/\') ? path : `/${path}`;',
      '  return request(`/api/v2/things${normalizedPath}`);',
      '}',
      'function thingEndpoint(path) {',
      '  return `/api/v2/things${path}`;',
      '}',
    ].join('\n');
    expect(unencodedApiClientPaths(fixture, 'fixture.js')).toEqual([
      'fixture.js:2 ${id} in `/api/v2/things/${id}`',
      'fixture.js:13 ${path} in `/api/v2/things${path}`',
    ]);
    // …and the call-site rule now reads the client file as well.
    expect(unencodedCallSites('callThingApi(token, \'GET\', `/${id}/edit`);', 'fixture.js')).toHaveLength(1);
  });
});

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getExchangeConfig: jest.fn(),
    getExchanges: jest.fn(),
    getExchange: jest.fn().mockResolvedValue({ data: {} }),
    getExchangeRatings: jest.fn().mockResolvedValue({ data: { ratings: [], has_rated: false } }),
    performExchangeAction: jest.fn(),
    rateExchange: jest.fn()
  };
});
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.token = 'token:test'; next(); }
}));
jest.mock('../src/lib/request-profile', () => ({ getRequestProfile: jest.fn().mockResolvedValue(null) }));

describe('F-113 a crafted id never reaches the API', () => {
  const api = require('../src/lib/api');

  function createApp() {
    const exchangesRouter = require('../src/routes/exchanges');
    const app = express();
    app.use((req, res, next) => {
      res.locals.t = (key) => key;
      res.render = (view) => res.json({ view });
      next();
    });
    app.use('/exchanges', exchangesRouter);
    app.use((req, res) => res.status(404).json({ notFound: true }));
    return app;
  }

  beforeEach(() => jest.clearAllMocks());

  test.each(['/exchanges/1%2f..%2f..%2fadmin', '/exchanges/abc'])('%s is a 404 without an API call', async (url) => {
    const res = await request(createApp()).get(url);
    expect(res.status).toBe(404);
    expect(api.getExchange).not.toHaveBeenCalled();
  });

  test('a numeric id still reaches the handler', async () => {
    await request(createApp()).get('/exchanges/42');
    expect(api.getExchange).toHaveBeenCalledWith('token:test', 42);
  });
});
