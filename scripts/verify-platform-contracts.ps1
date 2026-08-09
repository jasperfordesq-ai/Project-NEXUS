# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [switch]$SkipDotNet,
    [switch]$SkipReact,
    [switch]$SkipWebUk
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$aspNetRoot = Join-Path $root 'aspnet-backend'
$webUkRoot = Join-Path $root 'web-uk'
$reportRoot = Join-Path $root '.local-docs-archive\platform-contracts\latest'

function Invoke-NativeCheck {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Host "==> $Name"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null

Invoke-NativeCheck 'API comparison fixture tests' {
    & (Join-Path $aspNetRoot 'scripts\test-compare-laravel-api-parity.ps1')
}
Invoke-NativeCheck 'Schema comparison fixture tests' {
    & (Join-Path $aspNetRoot 'scripts\test-compare-laravel-schema-parity.ps1')
}
Invoke-NativeCheck 'Laravel to ASP.NET API inventory' {
    & (Join-Path $aspNetRoot 'scripts\compare-laravel-api-parity.ps1') `
        -SourceRoot $root `
        -TargetRoot $aspNetRoot `
        -OutDir (Join-Path $reportRoot 'api')
}
Invoke-NativeCheck 'Laravel to ASP.NET schema inventory' {
    & (Join-Path $aspNetRoot 'scripts\compare-laravel-schema-parity.ps1') `
        -SourceRoot $root `
        -TargetRoot $aspNetRoot `
        -OutDir (Join-Path $reportRoot 'schema')
}

if (-not $SkipDotNet) {
    Invoke-NativeCheck 'ASP.NET build' {
        dotnet build (Join-Path $aspNetRoot 'Nexus.sln') --configuration Release
    }
    Invoke-NativeCheck 'ASP.NET tests' {
        dotnet test (Join-Path $aspNetRoot 'Nexus.sln') --configuration Release --no-build
    }
}

if (-not $SkipReact) {
    Invoke-NativeCheck 'React dual-backend preparation checks' {
        npm.cmd --prefix (Join-Path $root 'react-frontend') run check:dual-backend-prep
    }
}

if (-not $SkipWebUk) {
    Invoke-NativeCheck 'Web UK brand check' {
        npm.cmd --prefix $webUkRoot run brand:check
    }
    Invoke-NativeCheck 'Web UK lint' {
        npm.cmd --prefix $webUkRoot run lint
    }
    Invoke-NativeCheck 'Web UK tests' {
        npm.cmd --prefix $webUkRoot test -- --runInBand
    }
}

Write-Host "Platform contract verification completed. Reports: $reportRoot"
