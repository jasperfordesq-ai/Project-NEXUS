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

// Callees whose template-literal argument is an API path.
const API_CALL = /\b(?:call\w*|api\.\w+|\w+Api\w*)\(/g;
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

describe('F-113 API paths encode interpolated values', () => {
  test('every value interpolated into an API call path is encodeURIComponent-wrapped', () => {
    const offenders = [];
    for (const file of routeFiles()) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      for (const call of source.matchAll(API_CALL)) {
        const window = source.slice(call.index + call[0].length, call.index + call[0].length + 400);
        const argsEnd = window.indexOf(');');
        for (const literal of templateLiterals(argsEnd > 0 ? window.slice(0, argsEnd) : window)) {
          if (!literal.startsWith('/')) continue;
          const queryAt = literal.indexOf('?');
          for (const expression of topLevelExpressions(literal)) {
            if (queryAt >= 0 && expression.start > queryAt) continue;
            if (SAFE_EXPRESSION.test(expression.text) || QUERY_BUILDER.test(expression.text)) continue;
            const line = source.slice(0, call.index).split('\n').length;
            offenders.push(`${path.relative(SRC, file)}:${line} \${${expression.text}} in \`${literal.slice(0, 80)}\``);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
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
