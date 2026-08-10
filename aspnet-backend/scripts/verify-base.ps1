# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [switch]$FullFrontend,
    [switch]$DockerBuild,
    [switch]$SkipBackend,
    [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# The monorepo root is one level above aspnet-backend/; web-uk/ sits beside it.
$monorepoRoot = (Resolve-Path (Join-Path $repoRoot '..')).Path
$webUkRoot = Join-Path $monorepoRoot 'web-uk'
$failures = New-Object System.Collections.Generic.List[string]

function Invoke-Check {
    param(
        [string]$Name,
        [string]$Command,
        [string]$WorkingDirectory = $repoRoot
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        Invoke-Expression $Command
        if ($LASTEXITCODE -ne 0) {
            throw "Exit code $LASTEXITCODE"
        }
        Write-Host "PASS: $Name" -ForegroundColor Green
    } catch {
        $failures.Add("$Name - $($_.Exception.Message)")
        Write-Host "FAIL: $Name" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
    } finally {
        Pop-Location
    }
}

Invoke-Check 'Docker Compose config' 'docker compose config --quiet'

if (-not $SkipBackend) {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\cleanup-testhost.ps1')
    Invoke-Check 'ASP.NET build' 'dotnet build --no-restore'
    Invoke-Check 'Backend health smoke tests' 'dotnet test tests\Nexus.Api.Tests\Nexus.Api.Tests.csproj --no-build --filter "FullyQualifiedName~HealthControllerTests" --logger "console;verbosity=minimal"'
    Invoke-Check 'Backend service smoke tests' 'dotnet test tests\Nexus.Api.Tests\Nexus.Api.Tests.csproj --no-build --filter "FullyQualifiedName~Services.GamificationServiceTests" --logger "console;verbosity=minimal"'
    & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\cleanup-testhost.ps1')
}

if (-not $SkipFrontend) {
    # Web UK is a SIBLING of aspnet-backend in the platform monorepo, not a
    # child of it. Before 2026-08-10 this block invoked apps\admin (deleted
    # before the move) and apps\web-uk (the pre-move path), so the whole
    # frontend section pointed at directories that do not exist — it could only
    # ever fail, while the testing docs presented it as the local gate.
    if (-not (Test-Path -LiteralPath $webUkRoot)) {
        throw "Web UK not found at '$webUkRoot'. Run this from a full monorepo checkout, or pass -SkipFrontend."
    }

    Invoke-Check 'web-uk brand check' 'npm run brand:check' $webUkRoot
    Invoke-Check 'web-uk lint' 'npm run lint' $webUkRoot

    if ($FullFrontend) {
        Invoke-Check 'web-uk tests' 'npm test -- --runInBand' $webUkRoot
    }
}

if ($DockerBuild) {
    Invoke-Check 'API Docker build' 'docker compose build api'
}

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Host "Base verification completed with $($failures.Count) failure(s):" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host " - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host "Base verification passed." -ForegroundColor Green
