# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

# [!] REWRITTEN 2026-08-14. What this file asserted, and why none of it worked.
#
# It tested `compare-laravel-frontend-parity.ps1` as a two-sided COMPARISON, asserting
# `react_matched_routes`, `accessible_missing_routes`, `extra-dotnet` matrix rows and the
# like. Every one of those assertions was already dead before the Blade removal:
#
#   1. The React comparison fields (`laravel_react_routes`, `react_matched_routes`, ...)
#      stopped being emitted when `apps/react-frontend` was deleted (f27412bb) and React
#      became inventory-only. The script has not published them for months.
#   2. The fixture wrote its Web UK routes to `<targetRoot>/apps/web-uk/src/routes`, but
#      the script resolves `$WebUkRoot` from the SOURCE root (`<sourceRoot>/web-uk/src`).
#      So `Get-WebUkRoutes` found nothing and the script threw on its own empty-side guard.
#
# It never failed CI, because `scripts/verify-platform-contracts.ps1` invokes only the API
# and schema test scripts -- not this one. A test outside CI that nobody runs rots silently;
# that is exactly what happened here.
#
# The accessible surface is now INVENTORIED, NOT COMPARED (Blade was deleted 2026-08-14 --
# see the long note in the script itself). So this file now asserts the contract that
# actually matters: both inventories are populated, and NO verdict is published. The
# authoritative accessible comparison is `npm --prefix web-uk run route:matrix`.

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
    # [!] Under the SOURCE root, matching how the script resolves $WebUkRoot. The old
    # fixture put these under the target root, which is why the script found no Web UK
    # routes and threw.
    New-Item -ItemType Directory -Force -Path (Join-Path $sourceRoot 'web-uk\src\routes') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $sourceRoot 'web-uk\scripts') | Out-Null

    @'
import { Route } from 'react-router-dom';

export function App() {
  return (
    <>
      <Route index element={<Home />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="courses/:id" element={<Course />} />
    </>
  );
}
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'react-frontend\src\App.tsx')

    # No routes/govuk-alpha*.php in this fixture, deliberately: that is the real world
    # after 2026-08-14. The Laravel side must come from the frozen inventory instead.
    @'
{
  "_comment": "Fixture copy of the frozen Blade inventory.",
  "capturedFrom": { "laravelRoutes": 2 },
  "routes": [
    { "method": "GET", "path": "/listings/{param}", "laravelRouteName": "govuk-alpha.listings.show", "laravelHandler": "listing", "laravelParamConstraints": [], "laravelRouteFile": "routes/govuk-alpha.php", "laravelMiddleware": "" },
    { "method": "POST", "path": "/contact", "laravelRouteName": "govuk-alpha.contact.store", "laravelHandler": "storeContact", "laravelParamConstraints": [], "laravelRouteFile": "routes/govuk-alpha.php", "laravelMiddleware": "" }
  ],
  "handlers": {}
}
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'web-uk\scripts\blade-route-inventory.frozen.json')

    @'
const express = require('express');
const listingsRoutes = require('./routes/listings');

const app = express();

app.post('/contact', (req, res) => res.sendStatus(204));
app.use('/listings', listingsRoutes);
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'web-uk\src\server.js')

    @'
const express = require('express');
const router = express.Router();

router.get('/:listingId', (req, res) => res.render('listing'));

module.exports = router;
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'web-uk\src\routes\listings.js')

    & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -TargetRoot $targetRoot -SourceRoot $sourceRoot -OutDir $outDir
    if ($LASTEXITCODE -ne 0) {
        throw "compare-laravel-frontend-parity.ps1 exited with $LASTEXITCODE"
    }

    $jsonPath = Join-Path $outDir 'frontend-parity.json'
    $markdownPath = Join-Path $outDir 'frontend-parity.md'
    Assert-True (Test-Path -LiteralPath $jsonPath) 'Expected frontend-parity.json to be written.'
    Assert-True (Test-Path -LiteralPath $markdownPath) 'Expected frontend-parity.md to be written.'

    $report = Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json
    $summary = $report.summary

    # 1. The Laravel side falls back to the frozen inventory when no govuk-alpha route
    #    files exist. Two routes in the fixture snapshot; two must be reported.
    Assert-True ($summary.laravel_accessible_routes -eq 2) `
        "Expected two Laravel accessible routes from the frozen inventory, got $($summary.laravel_accessible_routes)."
    Assert-True ($summary.accessible_source -eq 'frozen-blade-inventory') `
        'Expected the accessible source to be recorded as the frozen Blade inventory.'

    # 2. The Web UK side is discovered from the source-root sibling.
    Assert-True ($summary.web_uk_accessible_routes -ge 2) `
        "Expected at least two Web UK accessible routes, got $($summary.web_uk_accessible_routes)."

    # 3. React remains inventory-only.
    Assert-True ($summary.shared_react_routes -eq 3) `
        "Expected three shared React routes, got $($summary.shared_react_routes)."
    Assert-True ($summary.react_comparison -eq 'not-applicable-single-shared-frontend') `
        'Expected React to be recorded as inventory-only.'

    # 4. [!] THE ASSERTION THAT MATTERS. No verdict may be published here. Feeding the
    #    frozen snapshot into a comparison produced 406 "missing" and 376 "extra" on
    #    2026-08-14, while the authoritative route matrix reported 707 matched / 0 missing
    #    against the same snapshot -- this script's Web UK route scraper under-discovers
    #    Express routes. If any of these fields comes back, so does that contradiction.
    Assert-True ($summary.accessible_comparison -like 'not-applicable-blade-removed*') `
        'Expected the accessible surface to be recorded as not-compared.'
    foreach ($field in @('accessible_matched_routes', 'accessible_missing_routes', 'accessible_extra_routes', 'dotnet_accessible_routes')) {
        Assert-True ($null -eq $summary.$field) `
            "Expected '$field' to be ABSENT: this report publishes inventories, never a verdict. See the note in compare-laravel-frontend-parity.ps1."
    }
    Assert-True ($null -eq $report.matrix) `
        'Expected no `matrix` in the report: rows are an inventory with no matched/missing status.'
    Assert-True ($null -ne $report.inventory) 'Expected an `inventory` collection in the report.'
    foreach ($row in @($report.inventory)) {
        Assert-True ($null -eq $row.status) `
            "Inventory row $($row.method) $($row.path) carries a 'status' -- no row may imply a verdict."
    }

    # 5. The markdown must say so in words, not just omit the numbers.
    $markdown = Get-Content -Raw -LiteralPath $markdownPath
    Assert-True ($markdown.Contains('inventories')) `
        'Expected the markdown report to state that both surfaces are inventories.'
    Assert-True ($markdown.Contains('route:matrix')) `
        'Expected the markdown report to point at the authoritative accessible comparison.'

    Write-Host 'compare-laravel-frontend-parity tests passed.'
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
