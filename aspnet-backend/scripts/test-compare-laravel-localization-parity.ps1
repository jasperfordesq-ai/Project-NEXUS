# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $repoRoot 'scripts\compare-laravel-localization-parity.ps1'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-localization-parity-fixture-" + [Guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $fixtureRoot 'laravel'
$targetRoot = Join-Path $fixtureRoot 'aspnet'
$outDir = Join-Path $fixtureRoot 'out'

try {
    New-Item -ItemType Directory -Force -Path $sourceRoot, $targetRoot, $outDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $sourceRoot 'lang\en') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $sourceRoot 'lang\de') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot 'apps\react-frontend\public\locales\en') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot 'apps\react-frontend\public\locales\es') | Out-Null

    @'
{
  "nav": {
    "home": "Home",
    "dashboard": "Dashboard"
  },
  "only_laravel": "Source only"
}
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'lang\en\common.json')

    @'
<?php

return [
    'users' => [
        'title' => 'Users',
    ],
    'missing_php' => 'Missing PHP key',
];
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'lang\en\admin.php')

    @'
{
  "nav": {
    "home": "Start"
  }
}
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'lang\de\common.json')

    @'
{
  "nav": {
    "home": "Home",
    "settings": "Settings"
  },
  "only_dotnet": "Target only"
}
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'apps\react-frontend\public\locales\en\common.json')

    @'
{
  "users": {
    "title": "Users"
  }
}
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'apps\react-frontend\public\locales\en\admin.json')

    @'
{
  "nav": {
    "home": "Inicio"
  }
}
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'apps\react-frontend\public\locales\es\common.json')

    & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -TargetRoot $targetRoot -SourceRoot $sourceRoot -OutDir $outDir
    if ($LASTEXITCODE -ne 0) {
        throw "compare-laravel-localization-parity.ps1 exited with $LASTEXITCODE"
    }

    $jsonPath = Join-Path $outDir 'localization-parity.json'
    $markdownPath = Join-Path $outDir 'localization-parity.md'
    Assert-True (Test-Path -LiteralPath $jsonPath) 'Expected localization-parity.json to be written.'
    Assert-True (Test-Path -LiteralPath $markdownPath) 'Expected localization-parity.md to be written.'

    $report = Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json
    $localeMatrix = @($report.locale_matrix)
    $namespaceMatrix = @($report.namespace_matrix)
    $keyMatrix = @($report.key_matrix)

    Assert-True ($report.summary.laravel_locales -eq 2) 'Expected two Laravel locales.'
    Assert-True ($report.summary.dotnet_locales -eq 2) 'Expected two .NET locales.'
    Assert-True ($report.summary.matched_locales -eq 1) 'Expected one matched locale.'
    Assert-True ($report.summary.missing_locales -eq 1) 'Expected one missing locale.'
    Assert-True ($report.summary.extra_dotnet_locales -eq 1) 'Expected one extra .NET locale.'
    Assert-True ($report.summary.laravel_locale_namespaces -eq 3) 'Expected three Laravel locale namespaces.'
    Assert-True ($report.summary.dotnet_locale_namespaces -eq 3) 'Expected three .NET locale namespaces.'
    Assert-True ($report.summary.matched_locale_namespaces -eq 2) 'Expected two matched locale namespaces.'
    Assert-True ($report.summary.missing_locale_namespaces -eq 1) 'Expected one missing locale namespace.'
    Assert-True ($report.summary.extra_dotnet_locale_namespaces -eq 1) 'Expected one extra .NET locale namespace.'
    Assert-True ($report.summary.matched_keys -eq 2) 'Expected two matched keys.'
    Assert-True ($report.summary.missing_keys -eq 3) 'Expected three missing keys.'
    Assert-True ($report.summary.extra_dotnet_keys -eq 2) 'Expected two extra .NET keys.'

    Assert-True (@($localeMatrix | Where-Object { $_.locale -eq 'de' -and $_.status -eq 'missing' }).Count -eq 1) 'Expected German locale to be missing.'
    Assert-True (@($namespaceMatrix | Where-Object { $_.locale -eq 'de' -and $_.namespace -eq 'common' -and $_.status -eq 'missing' }).Count -eq 1) 'Expected de/common namespace to be missing.'
    Assert-True (@($keyMatrix | Where-Object { $_.locale -eq 'en' -and $_.namespace -eq 'common' -and $_.key -eq 'nav.dashboard' -and $_.status -eq 'missing' }).Count -eq 1) 'Expected en/common nav.dashboard to be missing.'
    Assert-True (@($keyMatrix | Where-Object { $_.locale -eq 'en' -and $_.namespace -eq 'admin' -and $_.key -eq 'users.title' -and $_.status -eq 'matched' }).Count -eq 1) 'Expected PHP-derived users.title key to match.'
    Assert-True (@($keyMatrix | Where-Object { $_.locale -eq 'en' -and $_.namespace -eq 'common' -and $_.key -eq 'nav.settings' -and $_.status -eq 'extra-dotnet' }).Count -eq 1) 'Expected en/common nav.settings to be extra.'

    $markdown = Get-Content -Raw -LiteralPath $markdownPath
    Assert-True ($markdown.Contains('nav.dashboard')) 'Expected markdown report to include missing nav.dashboard key.'

    Write-Host 'compare-laravel-localization-parity tests passed.'
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
