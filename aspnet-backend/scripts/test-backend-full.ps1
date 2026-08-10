# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [int]$HangTimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $repoRoot
try {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\cleanup-testhost.ps1')
    dotnet test `
        --logger "console;verbosity=normal" `
        --blame-hang `
        --blame-hang-timeout "$($HangTimeoutSeconds)s" `
        --blame-hang-dump-type none
    exit $LASTEXITCODE
} finally {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\cleanup-testhost.ps1')
    Pop-Location
}
