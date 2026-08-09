# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [string]$ArtifactsDir
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ArtifactsDir)) {
    $scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $repoRoot = (Resolve-Path (Join-Path $scriptRoot '..')).Path
    $ArtifactsDir = Join-Path $repoRoot 'artifacts\parity-audit'
}

$matrixPath = Join-Path $ArtifactsDir 'frontend-api-to-aspnet-matrix.csv'
if (-not (Test-Path -LiteralPath $matrixPath)) {
    throw "Matrix not found: $matrixPath. Run scripts/audit-platform-parity.ps1 first."
}

$rows = Import-Csv -LiteralPath $matrixPath

$summaryPath = Join-Path $ArtifactsDir 'frontend-api-contract-summary.csv'
$missingPath = Join-Path $ArtifactsDir 'frontend-api-missing-static.csv'

$rows |
    Group-Object app, status |
    ForEach-Object {
        $parts = $_.Name -split ', '
        [pscustomobject]@{
            app = $parts[0]
            status = $parts[1]
            count = $_.Count
        }
    } |
    Sort-Object app, status |
    Export-Csv -LiteralPath $summaryPath -NoTypeInformation

$rows |
    Where-Object { $_.status -eq 'missing' } |
    Group-Object app, normalized |
    ForEach-Object {
        $first = $_.Group[0]
        [pscustomobject]@{
            app = $first.app
            normalized = $first.normalized
            references = $_.Count
            sample_file = $first.frontend_file
            sample_line = $first.frontend_line
        }
    } |
    Sort-Object app, @{ Expression = 'references'; Descending = $true }, normalized |
    Export-Csv -LiteralPath $missingPath -NoTypeInformation

Write-Host "Frontend API contract summary written to $summaryPath"
Write-Host "Static missing frontend API references written to $missingPath"

Write-Host ""
Write-Host "Summary:"
Import-Csv -LiteralPath $summaryPath | Format-Table -AutoSize

Write-Host ""
Write-Host "Top missing static API references:"
Import-Csv -LiteralPath $missingPath |
    Select-Object -First 25 |
    Format-Table app, normalized, references, sample_file, sample_line -AutoSize
