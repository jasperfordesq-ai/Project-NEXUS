# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testRoot = Join-Path $repoRoot 'tests\Nexus.Api.Tests'

$staleHosts = Get-Process testhost -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($testRoot, [System.StringComparison]::OrdinalIgnoreCase) }

foreach ($hostProcess in $staleHosts) {
    Write-Host "Stopping stale testhost $($hostProcess.Id): $($hostProcess.Path)"
    Stop-Process -Id $hostProcess.Id -Force
}
