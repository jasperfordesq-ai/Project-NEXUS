# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $repoRoot 'scripts\compare-laravel-frontend-parity.ps1'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-frontend-parity-fixture-" + [Guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $fixtureRoot 'laravel'
$targetRoot = Join-Path $fixtureRoot 'aspnet'
$outDir = Join-Path $fixtureRoot 'out'

try {
    New-Item -ItemType Directory -Force -Path $sourceRoot, $targetRoot, $outDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $sourceRoot 'react-frontend\src') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $sourceRoot 'routes\govuk-alpha-parity') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot 'apps\react-frontend\src') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot 'apps\web-uk\src\routes') | Out-Null

    @'
import { Route } from 'react-router-dom';

export function App() {
  return (
    <>
      <Route index element={<Home />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="courses/:id" element={<Course />} />
      <Route path="missing-react" element={<Missing />} />
    </>
  );
}
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'react-frontend\src\App.tsx')

    @'
<?php

use Illuminate\Support\Facades\Route;

Route::get('/listings/{id}', [AlphaController::class, 'listing']);
Route::post('/contact', [AlphaController::class, 'storeContact']);
Route::get('/missing-accessible', [AlphaController::class, 'missing']);
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'routes\govuk-alpha.php')

    @'
<?php

Route::get('/kb/{id}', [AlphaController::class, 'kbArticle']);
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'routes\govuk-alpha-parity\kb.php')

    @'
import { Route } from 'react-router-dom';

export function App() {
  return (
    <>
      <Route index element={<Home />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="courses/:courseId" element={<Course />} />
      <Route path="extra-react" element={<Extra />} />
    </>
  );
}
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'apps\react-frontend\src\App.tsx')

    @'
const express = require('express');
const listingsRoutes = require('./routes/listings');
const kbRoutes = require('./routes/kb');

const app = express();

app.post('/contact', (req, res) => res.sendStatus(204));
app.get('/extra-accessible', (req, res) => res.sendStatus(200));
app.use('/listings', listingsRoutes);
app.use('/kb', kbRoutes);
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'apps\web-uk\src\server.js')

    @'
const express = require('express');
const router = express.Router();

router.get('/:listingId', (req, res) => res.render('listing'));

module.exports = router;
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'apps\web-uk\src\routes\listings.js')

    @'
const express = require('express');
const router = express.Router();

router.get('/:articleId', (req, res) => res.render('kb'));

module.exports = router;
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'apps\web-uk\src\routes\kb.js')

    & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -TargetRoot $targetRoot -SourceRoot $sourceRoot -OutDir $outDir
    if ($LASTEXITCODE -ne 0) {
        throw "compare-laravel-frontend-parity.ps1 exited with $LASTEXITCODE"
    }

    $jsonPath = Join-Path $outDir 'frontend-parity.json'
    $markdownPath = Join-Path $outDir 'frontend-parity.md'
    Assert-True (Test-Path -LiteralPath $jsonPath) 'Expected frontend-parity.json to be written.'
    Assert-True (Test-Path -LiteralPath $markdownPath) 'Expected frontend-parity.md to be written.'

    $report = Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json
    $matrix = @($report.matrix)

    Assert-True ($report.summary.laravel_react_routes -eq 4) 'Expected four Laravel React routes.'
    Assert-True ($report.summary.dotnet_react_routes -eq 4) 'Expected four .NET React routes.'
    Assert-True ($report.summary.react_matched_routes -eq 3) 'Expected three matched React routes.'
    Assert-True ($report.summary.react_missing_routes -eq 1) 'Expected one missing React route.'
    Assert-True ($report.summary.react_extra_routes -eq 1) 'Expected one extra React route.'
    Assert-True ($report.summary.laravel_accessible_routes -eq 4) 'Expected four Laravel accessible routes.'
    Assert-True ($report.summary.dotnet_accessible_routes -eq 4) 'Expected four .NET accessible routes.'
    Assert-True ($report.summary.accessible_matched_routes -eq 3) 'Expected three matched accessible routes.'
    Assert-True ($report.summary.accessible_missing_routes -eq 1) 'Expected one missing accessible route.'
    Assert-True ($report.summary.accessible_extra_routes -eq 1) 'Expected one extra accessible route.'

    Assert-True (@($matrix | Where-Object { $_.surface -eq 'react' -and $_.method -eq 'GET' -and $_.path -eq '/courses/{param}' -and $_.status -eq 'matched' }).Count -eq 1) 'Expected dynamic React route to match by shape.'
    Assert-True (@($matrix | Where-Object { $_.surface -eq 'react' -and $_.path -eq '/missing-react' -and $_.status -eq 'missing' }).Count -eq 1) 'Expected missing React route.'
    Assert-True (@($matrix | Where-Object { $_.surface -eq 'accessible' -and $_.method -eq 'GET' -and $_.path -eq '/kb/{param}' -and $_.status -eq 'matched' }).Count -eq 1) 'Expected accessible parity route file to match.'
    Assert-True (@($matrix | Where-Object { $_.surface -eq 'accessible' -and $_.method -eq 'GET' -and $_.path -eq '/missing-accessible' -and $_.status -eq 'missing' }).Count -eq 1) 'Expected missing accessible route.'
    Assert-True (@($matrix | Where-Object { $_.surface -eq 'accessible' -and $_.method -eq 'GET' -and $_.path -eq '/extra-accessible' -and $_.status -eq 'extra-dotnet' }).Count -eq 1) 'Expected extra accessible route.'

    $markdown = Get-Content -Raw -LiteralPath $markdownPath
    Assert-True ($markdown.Contains('missing-accessible')) 'Expected markdown report to include missing accessible route.'

    Write-Host 'compare-laravel-frontend-parity tests passed.'
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
