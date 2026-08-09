# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $repoRoot 'scripts\export-laravel-parity-backlog.ps1'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-parity-backlog-fixture-" + [Guid]::NewGuid().ToString('N'))
$artifactRoot = Join-Path $fixtureRoot 'artifacts\parity'
$outDir = Join-Path $fixtureRoot 'out'

try {
    New-Item -ItemType Directory -Force -Path `
        (Join-Path $artifactRoot 'api'), `
        (Join-Path $artifactRoot 'schema'), `
        (Join-Path $artifactRoot 'frontend'), `
        (Join-Path $artifactRoot 'localization'), `
        $outDir | Out-Null

    [pscustomobject]@{
        summary = [pscustomobject]@{
            missing_operations = 2
        }
        matrix = @(
            [pscustomobject]@{
                source = 'openapi'
                method = 'POST'
                normalized_path = '/api/caring-community/warmth-checks'
                route_shape = '/api/caring-community/warmth-checks'
                status = 'missing'
                source_file = 'C:\platforms\htdocs\staging\openapi.json'
                source_handler = ''
            },
            [pscustomobject]@{
                source = 'openapi'
                method = 'POST'
                normalized_path = '/api/identity/veriff/webhook'
                route_shape = '/api/identity/veriff/webhook'
                status = 'missing'
                source_file = 'C:\platforms\htdocs\staging\openapi.json'
                source_handler = ''
            },
            [pscustomobject]@{
                source = 'openapi'
                method = 'GET'
                normalized_path = '/api/matched'
                route_shape = '/api/matched'
                status = 'matched'
                source_file = 'C:\platforms\htdocs\staging\openapi.json'
                source_handler = ''
            }
        )
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $artifactRoot 'api\api-parity.json')

    [pscustomobject]@{
        summary = [pscustomobject]@{
            missing_tables = 1
        }
        matrix = @(
            [pscustomobject]@{
                table = 'caring_warmth_checks'
                status = 'missing'
                laravel_kinds = 'migration-create'
                laravel_files = 'C:\platforms\htdocs\staging\database\migrations\2026_01_01_000000_create_caring_warmth_checks.php'
            }
        )
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $artifactRoot 'schema\schema-parity.json')

    [pscustomobject]@{
        summary = [pscustomobject]@{
            react_missing_routes = 1
            accessible_missing_routes = 1
        }
        matrix = @(
            [pscustomobject]@{
                surface = 'react'
                method = 'GET'
                path = '/marketplace/orders'
                status = 'missing'
                source_files = 'C:\platforms\htdocs\staging\react-frontend\src\App.tsx'
            },
            [pscustomobject]@{
                surface = 'accessible'
                method = 'GET'
                path = '/caring-community'
                status = 'missing'
                source_files = 'C:\platforms\htdocs\staging\routes\govuk-alpha.php'
            }
        )
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $artifactRoot 'frontend\frontend-parity.json')

    [pscustomobject]@{
        summary = [pscustomobject]@{
            missing_locales = 1
            missing_locale_namespaces = 1
            missing_keys = 1
        }
        locale_matrix = @(
            [pscustomobject]@{
                locale = 'pl'
                status = 'missing'
            }
        )
        namespace_matrix = @(
            [pscustomobject]@{
                locale = 'en'
                namespace = 'caring_community'
                status = 'missing'
            }
        )
        key_matrix = @(
            [pscustomobject]@{
                locale = 'en'
                namespace = 'admin'
                key = 'caring.dashboard.title'
                status = 'missing'
                source_files = 'C:\platforms\htdocs\staging\lang\en\admin.php'
            }
        )
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $artifactRoot 'localization\localization-parity.json')

    & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ArtifactRoot $artifactRoot -OutDir $outDir
    if ($LASTEXITCODE -ne 0) {
        throw "export-laravel-parity-backlog.ps1 exited with $LASTEXITCODE"
    }

    $jsonPath = Join-Path $outDir 'parity-backlog.json'
    $csvPath = Join-Path $outDir 'parity-backlog.csv'
    $markdownPath = Join-Path $outDir 'parity-backlog.md'
    Assert-True (Test-Path -LiteralPath $jsonPath) 'Expected parity-backlog.json to be written.'
    Assert-True (Test-Path -LiteralPath $csvPath) 'Expected parity-backlog.csv to be written.'
    Assert-True (Test-Path -LiteralPath $markdownPath) 'Expected parity-backlog.md to be written.'

    $report = Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json
    $items = @($report.items)

    Assert-True ($report.summary.total_items -eq 8) 'Expected eight backlog items from missing fixture rows.'
    Assert-True ($report.summary.p0_items -eq 4) 'Expected four P0 backlog items for critical user-facing/former-exclusion gaps.'
    Assert-True ($report.summary.p1_items -eq 3) 'Expected three P1 backlog items.'
    Assert-True ($report.summary.p2_items -eq 1) 'Expected one P2 backlog item.'

    $caringApi = @($items | Where-Object { $_.surface -eq 'api' -and $_.evidence -eq 'POST /api/caring-community/warmth-checks' })[0]
    Assert-True ($null -ne $caringApi) 'Expected caring API item.'
    Assert-True ($caringApi.priority -eq 'P0') 'Expected caring API item to be P0.'
    Assert-True ($caringApi.area -eq 'Caring Community / National KISS') 'Expected caring API item area classification.'
    Assert-True ($caringApi.acceptance_criteria -match 'tenant isolation') 'Expected API acceptance criteria to mention tenant isolation.'

    $identityApi = @($items | Where-Object { $_.surface -eq 'api' -and $_.evidence -eq 'POST /api/identity/veriff/webhook' })[0]
    Assert-True ($identityApi.area -eq 'Identity verification providers') 'Expected identity provider area classification.'

    $locale = @($items | Where-Object { $_.surface -eq 'localization-locale' -and $_.evidence -eq 'pl' })[0]
    Assert-True ($locale.priority -eq 'P2') 'Expected missing locale to be P2.'

    $markdown = Get-Content -Raw -LiteralPath $markdownPath
    Assert-True ($markdown.Contains('Caring Community / National KISS')) 'Expected markdown to include area summary.'
    Assert-True ($markdown.Contains('POST /api/caring-community/warmth-checks')) 'Expected markdown to include caring API evidence.'

    Write-Host 'export-laravel-parity-backlog tests passed.'
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
