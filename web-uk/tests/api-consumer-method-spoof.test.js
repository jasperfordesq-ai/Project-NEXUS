// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateApiConsumerLedger } = require('../scripts/generate-api-consumer-ledger');

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

describe('frontend API consumer Laravel method spoofing', () => {
  let root;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('matches a multipart POST carrying _method=PUT to the declared PUT operation', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-uk-api-method-spoof-'));
    const webUkRoot = path.join(root, 'web-uk');
    const laravelRoot = path.join(root, 'laravel');
    const outDir = path.join(root, 'generated');

    writeFile(path.join(webUkRoot, 'src', 'lib', 'api.js'), `
async function request() {}
async function updateEpisode(token, showId, episodeId, audio) {
  const form = new FormData();
  form.append('_method', 'PUT');
  form.append('audio', audio);
  return request(\`/api/v2/podcasts/\${showId}/episodes/\${episodeId}\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${token}\` },
    body: form
  });
}
module.exports = { updateEpisode };
`);
    writeFile(path.join(webUkRoot, 'src', 'routes', 'podcasts.js'), `
const { updateEpisode } = require('../lib/api');
async function update(token, showId, episodeId, audio) {
  return updateEpisode(token, showId, episodeId, audio);
}
module.exports = { update };
`);
    writeFile(path.join(webUkRoot, 'tests', 'podcasts.test.js'), `
describe('podcast update contract', () => {
  it('uses updateEpisode', () => expect('updateEpisode').toContain('update'));
});
`);
    writeFile(path.join(laravelRoot, 'openapi.json'), JSON.stringify({
      openapi: '3.0.3',
      paths: {
        '/api/v2/podcasts/{showId}/episodes/{episodeId}': {
          put: {
            summary: 'Update an owned podcast episode',
            requestBody: {
              content: {
                'multipart/form-data': { schema: { type: 'object' } }
              }
            },
            responses: {
              200: { description: 'updated' },
              404: { description: 'missing' },
              422: { description: 'invalid' }
            }
          }
        }
      }
    }, null, 2));

    const report = generateApiConsumerLedger({
      webUkRoot,
      laravelRoot,
      outDir,
      provenance: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        laravelRepositoryRoot: laravelRoot,
        laravelCommitSha: 'laravel-fixture-sha',
        laravelWorkingTreeDirty: false,
        webUkRepositoryRoot: webUkRoot,
        webUkPath: '.',
        webUkRepositoryCommitSha: 'web-uk-fixture-sha',
        webUkRepositoryWorkingTreeDirty: false,
        caveat: 'Deterministic unit-test provenance.'
      }
    });

    expect(report.summary).toEqual(expect.objectContaining({
      contracts: 1,
      matchedOpenApi: 1,
      missingOpenApi: 0,
      dynamicUnresolved: 0
    }));
    expect(report.rows[0]).toEqual(expect.objectContaining({
      method: 'PUT',
      path: '/api/v2/podcasts/{param}/episodes/{param}',
      apiHelper: 'updateEpisode',
      requestShape: 'multipart/form-data object',
      statusCodes: ['200', '404', '422']
    }));
    expect(report.rows[0].laravel.status).toBe('matched-openapi');
  });
});
