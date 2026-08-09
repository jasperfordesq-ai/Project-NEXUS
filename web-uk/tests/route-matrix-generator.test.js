// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  generateAccessibleRouteMatrix
} = require('../scripts/generate-accessible-route-matrix');

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function fixtureProvenance(sourceRoot, targetRoot) {
  return {
    generatedAt: '2026-07-14T00:00:00.000Z',
    laravelRepositoryRoot: sourceRoot,
    laravelCommitSha: '1111111111111111111111111111111111111111',
    laravelWorkingTreeDirty: true,
    webUkRepositoryRoot: targetRoot,
    webUkPath: 'apps/web-uk',
    webUkRepositoryCommitSha: '2222222222222222222222222222222222222222',
    webUkRepositoryWorkingTreeDirty: false,
    caveat: 'Laravel working tree was dirty when generated. Commit SHAs identify HEAD only; generated content may include uncommitted changes from the dirty working tree.'
  };
}

describe('accessible route matrix generator', () => {
  let fixtureRoot;
  let sourceRoot;
  let targetRoot;
  let outDir;

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'web-uk-route-matrix-'));
    sourceRoot = path.join(fixtureRoot, 'laravel');
    targetRoot = path.join(fixtureRoot, 'aspnet');
    outDir = path.join(fixtureRoot, 'out');

    writeFile(path.join(sourceRoot, 'routes', 'govuk-alpha.php'), `
<?php
use App\\Http\\Controllers\\GovukAlpha\\AlphaController;
use Illuminate\\Support\\Facades\\Route;

Route::get('/dashboard', [AlphaController::class, 'dashboard'])->name('dashboard');
Route::get('/onboarding', [AlphaController::class, 'onboarding'])->name('onboarding');
Route::post('/report-a-problem', [AlphaController::class, 'storeReportProblem'])
    ->middleware('throttle:10,1')
    ->name('report-problem.store');
`);

    writeFile(path.join(sourceRoot, 'routes', 'govuk-alpha-parity', 'resources.php'), `
<?php
Route::get('/resources', [AlphaController::class, 'resourcesLibrary'])
    ->name('resources.index');
`);

    writeFile(path.join(sourceRoot, 'app', 'Http', 'Controllers', 'GovukAlpha', 'AlphaController.php'), `
<?php
class AlphaController
{
    public function dashboard(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('dashboard'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug]);
        }

        return $this->view('accessible-frontend::dashboard', [
            'title' => 'Dashboard',
        ]);
    }

    public function onboarding(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::onboarding', [
            'title' => 'Onboarding',
        ]);
    }

    public function storeReportProblem(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        return redirect()->route('govuk-alpha.home', ['tenantSlug' => $tenantSlug]);
    }
}
`);

    writeFile(path.join(sourceRoot, 'app', 'Http', 'Controllers', 'GovukAlpha', 'Concerns', 'ResourcesParity.php'), `
<?php
trait ResourcesParity
{
    public function resourcesLibrary(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('resources'), 403);

        return $this->view('accessible-frontend::resources-library', [
            'title' => 'Resources',
        ]);
    }
}
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'server.js'), `
const express = require('express');
const dashboardRoutes = require('./routes/dashboard');
const staticPageRoutes = require('./routes/static-pages');
const app = express();

app.post('/report-a-problem', (req, res) => res.redirect('/'));
app.use('/dashboard', dashboardRoutes);
app.use(staticPageRoutes);
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'routes', 'dashboard.js'), `
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('dashboard/index', { title: 'Dashboard' });
});

module.exports = router;
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'routes', 'static-pages.js'), `
const express = require('express');
const router = express.Router();

const pages = {
  '/resources': {
    title: 'Resources'
  }
};

router.get(Object.keys(pages), (req, res) => {
  res.render('static-page', pages[req.path]);
});

module.exports = router;
`);
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('maps Laravel routes to Blade views and Express equivalents', () => {
    const report = generateAccessibleRouteMatrix({
      sourceRoot,
      targetRoot,
      outDir,
      provenance: fixtureProvenance(sourceRoot, targetRoot)
    });
    const route = (method, routePath) => report.matrix.find(
      (row) => row.method === method && row.path === routePath
    );

    expect(report.summary.laravelRoutes).toBe(4);
    expect(report.summary.webUkRoutes).toBe(3);
    expect(report.summary.matchedRoutes).toBe(3);
    expect(report.summary.missingRoutes).toBe(1);
    expect(report.provenance).toEqual(expect.objectContaining({
      laravelCommitSha: '1111111111111111111111111111111111111111',
      laravelWorkingTreeDirty: true,
      webUkRepositoryCommitSha: '2222222222222222222222222222222222222222',
      webUkRepositoryWorkingTreeDirty: false
    }));

    expect(route('GET', '/dashboard')).toEqual(expect.objectContaining({
      status: 'matched',
      laravelHandler: 'dashboard',
      laravelView: 'dashboard',
      webUkView: 'dashboard/index',
      auth: 'auth-required',
      gates: 'feature:dashboard'
    }));

    expect(route('GET', '/resources')).toEqual(expect.objectContaining({
      status: 'matched',
      laravelHandler: 'resourcesLibrary',
      laravelView: 'resources-library',
      webUkView: 'static-page',
      gates: 'module:resources'
    }));

    expect(route('GET', '/onboarding')).toEqual(expect.objectContaining({
      status: 'missing',
      laravelHandler: 'onboarding',
      laravelView: 'onboarding'
    }));

    expect(fs.existsSync(path.join(outDir, 'accessible-route-matrix.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'accessible-route-matrix.csv'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'accessible-route-matrix.md'))).toBe(true);
    const json = JSON.parse(fs.readFileSync(path.join(outDir, 'accessible-route-matrix.json'), 'utf8'));
    const markdown = fs.readFileSync(path.join(outDir, 'accessible-route-matrix.md'), 'utf8');
    expect(json.generatedAt).toBe('2026-07-14T00:00:00.000Z');
    expect(json.provenance.laravelCommitSha).toBe('1111111111111111111111111111111111111111');
    expect(markdown).toContain('Status: **Generated snapshot — structural route inventory, not certification**');
    expect(markdown).toContain('Web UK repository commit SHA: `2222222222222222222222222222222222222222`');
    expect(markdown).toContain('Laravel working tree dirty: yes');
    expect(markdown).toContain('Provenance caveat: Laravel working tree was dirty when generated.');
  });

  it('discovers every router in a combined app.use mount', () => {
    writeFile(path.join(sourceRoot, 'routes', 'govuk-alpha-parity', 'ideation.php'), `
<?php
Route::get('/ideation', [AlphaController::class, 'ideation'])
    ->name('ideation.index');
Route::get('/ideation/{challenge}', [AlphaController::class, 'ideationChallenge'])
    ->name('ideation.show');
Route::post('/ideation/{challenge}/ideas', [AlphaController::class, 'submitIdea'])
    ->name('ideation.ideas.store');
`);

    writeFile(path.join(sourceRoot, 'app', 'Http', 'Controllers', 'GovukAlpha', 'Concerns', 'IdeationParity.php'), `
<?php
trait IdeationParity
{
    public function ideation(Request $request, string $tenantSlug): Response
    {
        return $this->view('accessible-frontend::ideation', []);
    }

    public function ideationChallenge(Request $request, string $tenantSlug, int $challenge): Response
    {
        return $this->view('accessible-frontend::ideation-detail', []);
    }

    public function submitIdea(Request $request, string $tenantSlug, int $challenge): RedirectResponse
    {
        return redirect('/ideation/' . $challenge);
    }
}
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'server.js'), `
const express = require('express');
const dashboardRoutes = require('./routes/dashboard');
const ideationRoutes = require('./routes/ideation');
const ideationActionRoutes = require('./routes/ideation-actions');
const prepRoutes = require('./routes/laravel-prep-pages');
const staticPageRoutes = require('./routes/static-pages');
const app = express();

app.post('/report-a-problem', (req, res) => res.redirect('/'));
app.use('/dashboard', dashboardRoutes);
app.use('/ideation', doubleCsrfProtection, postOnly(formLimiter), ideationRoutes, ideationActionRoutes);
app.use(prepRoutes);
app.use(staticPageRoutes);
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'routes', 'ideation.js'), `
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('ideation/index', { title: 'Ideas' });
});

router.get('/:id(\\\\d+)', (req, res) => {
  res.render('ideation/detail', { title: 'Idea' });
});

module.exports = router;
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'routes', 'ideation-actions.js'), `
const express = require('express');
const router = express.Router();

router.post('/:id/ideas', (req, res) => {
  res.redirect('/ideation/' + req.params.id);
});

module.exports = router;
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'routes', 'laravel-prep-pages.js'), `
const prepPages = [
  { method: 'GET', expressPath: '/ideation' },
  { method: 'GET', expressPath: '/ideation/:id(\\\\d+)' }
];

module.exports.prepPages = prepPages;
`);

    const report = generateAccessibleRouteMatrix({
      sourceRoot,
      targetRoot,
      outDir,
      provenance: fixtureProvenance(sourceRoot, targetRoot)
    });
    const route = (method, routePath) => report.matrix.find(
      (row) => row.method === method && row.path === routePath
    );

    expect(route('GET', '/ideation')).toEqual(expect.objectContaining({
      status: 'matched',
      webUkView: 'ideation/index',
      webUkFile: expect.stringContaining('ideation.js')
    }));
    expect(route('GET', '/ideation/{param}')).toEqual(expect.objectContaining({
      status: 'matched',
      webUkView: 'ideation/detail',
      webUkFile: expect.stringContaining('ideation.js')
    }));
    expect(route('POST', '/ideation/{param}/ideas')).toEqual(expect.objectContaining({
      status: 'matched',
      webUkFile: expect.stringContaining('ideation-actions.js')
    }));
  });

  it('labels streamed download routes without inventing a Nunjucks view', () => {
    writeFile(path.join(sourceRoot, 'routes', 'govuk-alpha-parity', 'groups.php'), `
<?php
Route::get('/groups/{group}/files/{file}/download', [AlphaController::class, 'groupsDownloadFile'])
    ->name('groups.files.download');
`);

    writeFile(path.join(sourceRoot, 'app', 'Http', 'Controllers', 'GovukAlpha', 'Concerns', 'GroupsParity.php'), `
<?php
trait GroupsParity
{
    public function groupsDownloadFile(Request $request, string $tenantSlug, int $group, int $file)
    {
        return Storage::disk('local')->download('group-files/example.pdf');
    }
}
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'server.js'), `
const express = require('express');
const groupsRoutes = require('./routes/groups');
const app = express();

app.use('/groups', groupsRoutes);
`);

    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'routes', 'groups.js'), `
const express = require('express');
const router = express.Router();

router.get('/:id(\\\\d+)/files/:fileId(\\\\d+)/download', (req, res) => {
  res.set('content-type', 'application/pdf');
  return res.send(Buffer.from('pdf'));
});

module.exports = router;
`);

    const report = generateAccessibleRouteMatrix({
      sourceRoot,
      targetRoot,
      outDir,
      provenance: fixtureProvenance(sourceRoot, targetRoot)
    });
    const route = report.matrix.find(
      (row) => row.method === 'GET' && row.path === '/groups/{param}/files/{param}/download'
    );

    expect(route).toEqual(expect.objectContaining({
      status: 'matched',
      webUkView: 'streamed-download',
      webUkFile: expect.stringContaining('groups.js')
    }));
  });

  it('separates local infrastructure helpers from true route parity extras', () => {
    writeFile(path.join(targetRoot, 'apps', 'web-uk', 'src', 'server.js'), `
const express = require('express');
const dashboardRoutes = require('./routes/dashboard');
const app = express();

app.get('/health', (req, res) => res.type('text/plain').send('OK'));
app.get('/service-unavailable', (req, res) => res.status(503).render('errors/503'));
app.post('/session/touch', (req, res) => res.json({ ok: true }));
app.get('/local-only-page', (req, res) => res.render('local-only'));
app.use('/dashboard', dashboardRoutes);
`);

    const report = generateAccessibleRouteMatrix({
      sourceRoot,
      targetRoot,
      outDir,
      provenance: fixtureProvenance(sourceRoot, targetRoot)
    });
    const byPath = (method, routePath) => report.matrix.find(
      (row) => row.method === method && row.path === routePath
    );

    expect(report.summary.webUkRoutes).toBe(5);
    expect(report.summary.extraWebUkRoutes).toBe(1);
    expect(report.summary.ignoredInfrastructureRoutes).toBe(3);

    expect(byPath('GET', '/health')).toEqual(expect.objectContaining({
      status: 'ignored-web-uk-infrastructure',
      webUkRouteKind: 'infrastructure'
    }));
    expect(byPath('GET', '/service-unavailable')).toEqual(expect.objectContaining({
      status: 'ignored-web-uk-infrastructure',
      webUkRouteKind: 'infrastructure'
    }));
    expect(byPath('POST', '/session/touch')).toEqual(expect.objectContaining({
      status: 'ignored-web-uk-infrastructure',
      webUkRouteKind: 'infrastructure'
    }));
    expect(byPath('GET', '/local-only-page')).toEqual(expect.objectContaining({
      status: 'extra-web-uk',
      webUkRouteKind: ''
    }));
  });
});
