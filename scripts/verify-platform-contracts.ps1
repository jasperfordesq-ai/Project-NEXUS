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

# IMPORTANT: The frontend comparison was written but never invoked - not here, not
# anywhere - so the central question of the consolidation (do the frontends
# still line up with the backends?) was checked by nothing, while this script
# reported success. Wired in 2026-08-10.
#
# What this gates on, and what it does NOT:
#   GATES: every consumer root exists and is readable. The comparator throws if
#     one is missing, which is the exact failure mode that let it pass while
#     comparing nothing.
#   DOES NOT GATE: the parity counts themselves. They are a deliberately crude
#     static match and currently report several hundred differences on both
#     sides; web-uk's own generated docs call these counts backlog evidence,
#     not a certification. Turning that into a blocking threshold would be
#     inventing a contract nobody has agreed. Read the report instead.
Invoke-NativeCheck 'Laravel to frontend consumer parity' {
    & (Join-Path $aspNetRoot 'scripts\compare-laravel-frontend-parity.ps1') `
        -SourceRoot $root `
        -TargetRoot $aspNetRoot `
        -ReactRoot (Join-Path $root 'react-frontend\src') `
        -WebUkRoot (Join-Path $webUkRoot 'src') `
        -OutDir (Join-Path $reportRoot 'frontend')
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
