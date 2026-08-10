# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [string]$TargetRoot,
    [string]$SourceRoot,
    [string]$AuditDir,
    [string]$OutputDir,
    [switch]$SkipAudit
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
if ([string]::IsNullOrWhiteSpace($AuditDir)) {
    $AuditDir = Join-Path $TargetRoot 'artifacts\canonical-react-contract-audit'
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $TargetRoot 'docs\generated\canonical-react-contracts'
}

New-Item -ItemType Directory -Force -Path $AuditDir, $OutputDir | Out-Null

if (-not $SkipAudit) {
    & (Join-Path $PSScriptRoot 'audit-platform-parity.ps1') `
        -TargetRoot $TargetRoot `
        -SourceRoot $SourceRoot `
        -OutDir $AuditDir
}

$matrixPath = Join-Path $AuditDir 'v15-frontend-api-to-aspnet-matrix.csv'
if (-not (Test-Path -LiteralPath $matrixPath)) {
    throw "Canonical React audit matrix not found: $matrixPath"
}
$callSites = @(Import-Csv -LiteralPath $matrixPath)

function Get-RelativeFrontendPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    $prefix = (Join-Path $SourceRoot 'react-frontend\src') + '\'
    if ($Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        return ($Path.Substring($prefix.Length) -replace '\\', '/')
    }
    return ($Path -replace '\\', '/')
}

$contracts = @(
    $callSites |
        Group-Object method_hint, normalized |
        ForEach-Object {
            $representative = $_.Group | Sort-Object frontend_file, { [int]$_.frontend_line } | Select-Object -First 1
            $files = @($_.Group | ForEach-Object { Get-RelativeFrontendPath $_.frontend_file } | Sort-Object -Unique)
            [pscustomobject]@{
                method = if ([string]::IsNullOrWhiteSpace($representative.method_hint)) { 'UNRESOLVED' } else { $representative.method_hint }
                path = $representative.normalized
                callsite_count = $_.Count
                source_files = ($files -join ';')
                representative_line = [int]$representative.frontend_line
                laravel_status = $representative.laravel_status
                laravel_methods = $representative.laravel_methods
                laravel_handlers = $representative.laravel_handlers
                aspnet_status = $representative.status
                aspnet_methods = $representative.aspnet_methods
                aspnet_controllers = $representative.aspnet_controllers
            }
        } |
        Sort-Object path, method
)

$csvPath = Join-Path $OutputDir 'canonical-react-api-contract-matrix.csv'
$contracts | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding utf8

$aspNetGaps = @($contracts | Where-Object { $_.aspnet_status -in @('missing', 'method-mismatch', 'dynamic-unresolved') })
$laravelGaps = @($contracts | Where-Object { $_.laravel_status -in @('missing', 'method-mismatch', 'dynamic-unresolved') })
$methodUnresolved = @($contracts | Where-Object { $_.method -eq 'UNRESOLVED' })
$targetSha = (& git -C $TargetRoot rev-parse HEAD).Trim()
$sourceSha = (& git -C $SourceRoot rev-parse HEAD).Trim()
$targetDirty = @(& git -C $TargetRoot status --short)
$sourceDirty = @(& git -C $SourceRoot status --short)

$metadata = [ordered]@{
    schema_version = 1
    generated_at = (Get-Date).ToString('o')
    canonical_react_root = (Join-Path $SourceRoot 'react-frontend')
    laravel_sha = $sourceSha
    aspnet_sha = $targetSha
    laravel_dirty = $sourceDirty
    aspnet_dirty = $targetDirty
    callsite_rows = $callSites.Count
    unique_method_path_contracts = $contracts.Count
    method_evidenced_contracts = @($contracts | Where-Object { $_.method -ne 'UNRESOLVED' }).Count
    method_unresolved_contracts = $methodUnresolved.Count
    aspnet_status_counts = [ordered]@{}
    laravel_status_counts = [ordered]@{}
    aspnet_gap_count = $aspNetGaps.Count
    laravel_gap_count = $laravelGaps.Count
    warning = 'Static call-site evidence only. Route presence does not prove payload, response, auth, tenant, side-effect, or runtime parity.'
    aspnet_gaps = $aspNetGaps
    laravel_gaps = $laravelGaps
}

foreach ($group in ($contracts | Group-Object aspnet_status | Sort-Object Name)) {
    $metadata.aspnet_status_counts[$group.Name] = $group.Count
}
foreach ($group in ($contracts | Group-Object laravel_status | Sort-Object Name)) {
    $metadata.laravel_status_counts[$group.Name] = $group.Count
}

$jsonPath = Join-Path $OutputDir 'canonical-react-api-contract-summary.json'
$metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding utf8

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('# Canonical React API Contract Matrix')
$lines.Add('')
$lines.Add("Generated: $($metadata.generated_at)")
$lines.Add('')
$lines.Add("- Laravel SHA: ``$sourceSha``")
$lines.Add("- ASP.NET SHA: ``$targetSha``")
$lines.Add("- Static call-site rows: $($callSites.Count)")
$lines.Add("- Unique method/path contracts: $($contracts.Count)")
$lines.Add("- Method-evidenced contracts: $($metadata.method_evidenced_contracts)")
$lines.Add("- Method-unresolved contracts: $($methodUnresolved.Count)")
$lines.Add("- ASP.NET static route/method gaps: $($aspNetGaps.Count)")
$lines.Add("- Laravel static route/method gaps: $($laravelGaps.Count)")
$lines.Add('')
$lines.Add('This is static call-site evidence, not a parity score. Payloads, response envelopes, status codes, auth, tenancy, uploads, side effects, and unchanged-client runtime remain separate semantic and certification gates.')
$lines.Add('')
$lines.Add('## ASP.NET static gaps')
$lines.Add('')
$lines.Add('| Method | Path | Laravel | ASP.NET | Call sites | Representative source |')
$lines.Add('| --- | --- | --- | --- | ---: | --- |')
foreach ($gap in $aspNetGaps) {
    $safeFiles = ([string]$gap.source_files).Replace('|', '\|')
    $lines.Add("| $($gap.method) | ``$($gap.path)`` | $($gap.laravel_status) $($gap.laravel_methods) | $($gap.aspnet_status) $($gap.aspnet_methods) | $($gap.callsite_count) | ``$safeFiles`` |")
}
$lines.Add('')
$lines.Add('The complete deduplicated matrix is `canonical-react-api-contract-matrix.csv`; machine-readable metadata and both gap sets are in `canonical-react-api-contract-summary.json`.')

$markdownPath = Join-Path $OutputDir 'README.md'
$lines | Set-Content -LiteralPath $markdownPath -Encoding utf8

Write-Host "Canonical React contract matrix written to $OutputDir"
Write-Host "Unique contracts: $($contracts.Count); ASP.NET gaps: $($aspNetGaps.Count); method unresolved: $($methodUnresolved.Count)"
