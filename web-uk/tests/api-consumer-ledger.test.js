// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  displayPath,
  generateApiConsumerLedger,
  laravelApiRouteIndex,
  normalizePath,
  parseJavaScript,
  staticValue,
  wrapperEndpoint,
  WRAPPERS
} = require('../scripts/generate-api-consumer-ledger');

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

describe('frontend API consumer ledger generator', () => {
  let root;
  let webUkRoot;
  let laravelRoot;
  let outDir;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-uk-api-ledger-'));
    webUkRoot = path.join(root, 'web-uk');
    laravelRoot = path.join(root, 'laravel');
    outDir = path.join(root, 'generated');

    writeFile(path.join(webUkRoot, 'src', 'lib', 'api.js'), `
async function request() {}
async function getEvent(token, id) {
  return request(\`/api/v2/events/\${encodeURIComponent(id)}\`, {
    headers: { Authorization: \`Bearer \${token}\` }
  });
}
async function callEventApi(token, method, path = '', data = undefined) {
  const normalizedPath = path ? (path.startsWith('/') ? path : \`/\${path}\`) : '';
  const options = { method, headers: { Authorization: \`Bearer \${token}\` } };
  if (data !== undefined) options.body = JSON.stringify(data);
  return request(\`/api/v2/events\${normalizedPath}\`, options);
}
module.exports = { getEvent, callEventApi };
`);

    writeFile(path.join(webUkRoot, 'src', 'routes', 'events.js'), `
const { URLSearchParams } = require('url');
const { getEvent, callEventApi } = require('../lib/api');
async function show(token, id) { return getEvent(token, id); }
async function eventApi(token, method, path, data = undefined) {
  return data === undefined
    ? callEventApi(token, method, path)
    : callEventApi(token, method, path, data);
}
async function runEventAction(token, method, path, data = undefined) {
  return eventApi(token, method, path, data);
}
async function runConfiguredEvent(token, options) {
  return eventApi(token, options.method, options.path, options.data);
}
async function publish(token, id) {
  return runConfiguredEvent(token, {
    method: 'POST',
    path: \`/\${id}/publish\`,
    data: { confirmation: 'publish' }
  });
}
async function create(token) {
  return runEventAction(token, 'POST', '', { title: 'Test event' });
}
async function legacy(token) {
  return runEventAction(token, 'GET', '/legacy');
}
module.exports = { show, publish, create, legacy };
`);

    writeFile(path.join(webUkRoot, 'tests', 'events.test.js'), `
describe('events contract', () => {
  it('uses getEvent and callEventApi', () => {
    expect('/api/v2/events/42/publish').toContain('/publish');
  });
});
`);

    writeFile(path.join(webUkRoot, 'tests', 'api.test.js'), `
describe('direct API client contract', () => {
  it('asserts the concrete helper calls', async () => {
    await api.getEvent('token', 42);
    await api.callEventApi('token', 'GET', '/legacy');
  });
});
`);

    writeFile(path.join(laravelRoot, 'openapi.json'), JSON.stringify({
      openapi: '3.0.3',
      paths: {
        '/api/v2/events': {
          post: {
            operationId: 'Events_store',
            'x-controller-action': 'App\\Http\\Controllers\\Api\\EventsController@store',
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/EventStoreRequest' } }
              }
            },
            responses: { 201: { description: 'created' }, 422: { description: 'invalid' } }
          }
        },
        '/api/v2/events/{id}': {
          get: {
            operationId: 'Events_show',
            'x-controller-action': 'App\\Http\\Controllers\\Api\\EventsController@show',
            security: [{ bearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true }],
            responses: { 200: { description: 'ok' }, 404: { description: 'missing' } }
          }
        },
        '/api/v2/events/{id}/publish': {
          post: {
            operationId: 'Events_publish',
            'x-controller-action': 'App\\Http\\Controllers\\Api\\EventsController@publish',
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/EventPublishRequest' } }
              }
            },
            responses: { 200: { description: 'ok' }, 422: { description: 'invalid' } }
          }
        }
      }
    }, null, 2));

    writeFile(path.join(laravelRoot, 'routes', 'api.php'), `<?php
Route::get('/v2/events/legacy', [EventsController::class, 'legacy']);
`);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('normalizes endpoint placeholders without discarding method identity', () => {
    const ast = parseJavaScript('const value = `/api/v2/events/${encodeURIComponent(id)}`;');
    const template = ast.body[0].declarations[0].init;
    expect(staticValue(template)).toBe('/api/v2/events/{id}');
    expect(normalizePath('/api/v2/events/{eventId}?include=people')).toBe('/api/v2/events/{param}');
  });

  it('normalizes display-only query placeholders without changing path matching', () => {
    const opaqueQuery = '/api/v2/blog??{query}';
    const arithmeticQuery = '/api/v2/federation/connections?status={statusFilter}&limit={perPage}1&offset={dynamic}';

    expect(displayPath(opaqueQuery)).toBe('/api/v2/blog?{query}');
    expect(displayPath(arithmeticQuery)).toBe('/api/v2/federation/connections?status={param}&limit={param}&offset={param}');
    expect(normalizePath(opaqueQuery)).toBe('/api/v2/blog');
    expect(normalizePath(arithmeticQuery)).toBe('/api/v2/federation/connections');
  });

  it('models the Laravel gamification helper achievement-prefix exception', () => {
    expect(wrapperEndpoint(WRAPPERS.callGamificationApi, '/achievements/progress'))
      .toBe('/api/achievements/progress');
    expect(wrapperEndpoint(WRAPPERS.callGamificationApi, '/profile'))
      .toBe('/api/v2/gamification/profile');
  });

  it('indexes direct Laravel API route declarations without treating them as OpenAPI', () => {
    const index = laravelApiRouteIndex(`<?php
Route::get('/v2/events/{id}/history', [EventsController::class, 'history']);
Route::post('/auth/login', [AuthController::class, 'login']);
// Route::delete('/v2/events/{id}', [EventsController::class, 'destroy']);
`);

    expect(index.get('GET|/api/v2/events/{param}/history')).toEqual({
      routePath: '/api/v2/events/{id}/history'
    });
    expect(index.get('POST|/api/auth/login')).toEqual({ routePath: '/api/auth/login' });
    expect(index.has('DELETE|/api/v2/events/{param}')).toBe(false);
  });

  it('matches direct and wrapper callsites to Laravel and records safety evidence', () => {
    const report = generateApiConsumerLedger({
      webUkRoot,
      laravelRoot,
      outDir,
      provenance: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        laravelRepositoryRoot: laravelRoot,
        laravelCommitSha: '3333333333333333333333333333333333333333',
        laravelWorkingTreeDirty: false,
        webUkRepositoryRoot: webUkRoot,
        webUkPath: '.',
        webUkRepositoryCommitSha: '4444444444444444444444444444444444444444',
        webUkRepositoryWorkingTreeDirty: false,
        caveat: 'Deterministic unit-test provenance.'
      }
    });
    const createRow = report.rows.find((row) => row.method === 'POST' && row.path === '/api/v2/events');
    const getRow = report.rows.find((row) => row.method === 'GET' && row.path === '/api/v2/events/{param}');
    const publishRow = report.rows.find((row) => row.method === 'POST' && row.path === '/api/v2/events/{param}/publish');
    const legacyRow = report.rows.find((row) => row.method === 'GET' && row.path === '/api/v2/events/legacy');

    expect(report.summary.contracts).toBe(4);
    expect(report.summary.matchedOpenApi).toBe(3);
    expect(report.summary.missingOpenApi).toBe(1);
    expect(report.summary.routeDeclaredOpenApiOmissions).toBe(1);
    expect(report.summary.routeDeclaredOpenApiOmissionHelpersWithoutDirectApiAssertions).toBe(0);
    expect(report.summary.withoutDirectApiHelperAssertions).toBe(0);
    expect(report.summary.uniqueHelpersWithoutDirectApiAssertions).toBe(0);
    expect(report.summary.stateChangingWithoutDirectApiHelperAssertions).toBe(0);
    expect(report.summary.withoutLaravelRouteDeclaration).toBe(0);
    expect(report.summary.dynamicUnresolved).toBe(0);
    expect(report.generatedAt).toBe('2026-07-14T00:00:00.000Z');
    expect(report.provenance).toEqual(expect.objectContaining({
      laravelCommitSha: '3333333333333333333333333333333333333333',
      webUkRepositoryCommitSha: '4444444444444444444444444444444444444444'
    }));
    expect(report.sources.apiSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.sources.laravelOpenApiSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(createRow.laravel).toEqual(expect.objectContaining({
      operationId: 'Events_store'
    }));
    expect(getRow).toEqual(expect.objectContaining({
      apiHelper: 'getEvent',
      sideEffects: 'read-only by HTTP method',
      cleanup: 'not applicable'
    }));
    expect(getRow.laravel).toEqual(expect.objectContaining({
      operationId: 'Events_show',
      controllerAction: 'App\\Http\\Controllers\\Api\\EventsController@show'
    }));
    expect(getRow.frontendConsumers).toEqual(['src/routes/events.js']);
    expect(getRow.tests).toEqual(['tests/api.test.js', 'tests/events.test.js']);

    expect(publishRow).toEqual(expect.objectContaining({
      apiHelper: 'callEventApi',
      sideEffects: 'state-changing; mocked source-contract assertion required; live Laravel runtime is optional separate work',
      cleanup: 'assert intended final state in mocked Web UK tests; do not create or clean up live Laravel fixtures in this goal',
      requestShape: 'application/json schema:EventPublishRequest'
    }));
    expect(publishRow.statusCodes).toEqual(['200', '422']);
    expect(legacyRow.laravel).toEqual(expect.objectContaining({
      status: 'route-declared-openapi-omission',
      path: '/api/v2/events/legacy'
    }));
    expect(legacyRow.directApiHelperAssertion).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'frontend-api-consumer-ledger.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'frontend-api-consumer-ledger.md'))).toBe(true);
    const json = JSON.parse(fs.readFileSync(path.join(outDir, 'frontend-api-consumer-ledger.json'), 'utf8'));
    const markdown = fs.readFileSync(path.join(outDir, 'frontend-api-consumer-ledger.md'), 'utf8');
    expect(json.sources.apiSha256).toBe(report.sources.apiSha256);
    expect(json.sources.laravelOpenApiSha256).toBe(report.sources.laravelOpenApiSha256);
    expect(json.sources.laravelApiRoutesSha256).toBe(report.sources.laravelApiRoutesSha256);
    expect(markdown).toContain('Status: **Generated snapshot — static consumer inventory, not certification**');
    expect(markdown).toContain('Laravel commit SHA: `3333333333333333333333333333333333333333`');
    expect(markdown).toContain('Web UK repository working tree dirty: no');
    expect(markdown).toContain('Provenance caveat: Deterministic unit-test provenance.');
    expect(markdown).toContain('Unique OpenAPI-omitted helpers without direct API-client assertions: 0');
    expect(markdown).toContain('Rows without direct API-helper assertions: 0');
    expect(markdown).toContain('## Finite direct-assertion manifest');
    expect(markdown).toContain('| - | - | - | - | Complete |');
  });
});
