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
    Invoke-Check 'admin tests' 'npm test' (Join-Path $repoRoot 'apps\admin')
    Invoke-Check 'admin build' 'npm run build' (Join-Path $repoRoot 'apps\admin')
    Invoke-Check 'web-uk brand check' 'npm run brand:check' (Join-Path $repoRoot 'apps\web-uk')

    if ($FullFrontend) {
        Invoke-Check 'web-uk tests' 'npm test -- --runInBand' (Join-Path $repoRoot 'apps\web-uk')
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
