# Copyright (c) 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

<#
.SYNOPSIS
    Counts action methods that return a success-shaped payload while doing no work.

.DESCRIPTION
    The 2026-08-15 audit found 349 controller actions that answer with plausible
    200s - Ok(new { ... }), Created(...), StatusCode(20x) - while their entire
    body performs no data access at all: no _db, no await, no service call.

    This is the most damaging defect class in this backend, and the reason every
    route-level comparison reported near-total parity: the routes exist and
    answer, so an inventory sees success. Only body inspection or runtime proof
    can see the difference. The test suite cannot either - the route-alias tests
    assert "not 404, not 405", which a stub satisfies.

    This script makes the number visible and SHRINK-ONLY. It is enforced in both
    directions, like the db-column and quarantine ratchets: exceeding the
    baseline fails, and beating it also fails until the baseline is lowered in
    the same commit. That stops the count silently creeping back up after a
    cleanup, and stops a stale baseline hiding regressions.

    Remediation guidance is in docs/PRODUCTION_READINESS_REMEDIATION.md (R-1).
    Triage each stub into: implement for real (a client calls it), delete the
    route (nothing calls it), or declare it deliberately and record it here.

.PARAMETER RepositoryRoot
    Root of the aspnet-backend tree. Defaults to the parent of this script.

.PARAMETER WriteBaseline
    Rewrite the baseline file from the current scan. Use ONLY when the count has
    genuinely improved, and commit the baseline in the same commit as the fix.

.PARAMETER Detail
    List every stub found, grouped by file.
#>
[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [switch]$WriteBaseline,
    [switch]$Detail
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}

$controllersPath = Join-Path $RepositoryRoot 'src/Nexus.Api/Controllers'
$baselinePath = Join-Path $RepositoryRoot 'scripts/noop-stubs-baseline.json'

if (-not (Test-Path $controllersPath)) {
    Write-Error "Controllers directory not found: $controllersPath"
    exit 2
}

# A method body counts as doing REAL work if it touches data or delegates.
# Deliberately broad: the goal is to flag only the unambiguous do-nothing cases.
$workPattern = '_db\b|await\b|Service\.|_repo|_mediator|DbContext|SaveChanges|_fileUpload|_token|_cache|_mail|_publisher|HttpContext\.'
# A response counts as success-shaped if it claims success to the caller.
$successPattern = 'Ok\(\s*new\s*\{|Ok\(\s*new\s+[A-Za-z]|Created\(|StatusCode\(\s*20|NoContent\('
$actionPattern = '\[Http(Get|Post|Put|Delete|Patch)\b'
$signaturePattern = 'public\s+(async\s+)?[A-Za-z0-9_<>\[\],\?\s\.]+\s+\w+\s*\('

$findings = New-Object System.Collections.Generic.List[object]

foreach ($file in Get-ChildItem -Path $controllersPath -Filter '*.cs' -File | Sort-Object Name) {
    $lines = [System.IO.File]::ReadAllLines($file.FullName)
    $i = 0

    while ($i -lt $lines.Length) {
        if ($lines[$i] -notmatch $actionPattern) { $i++; continue }

        $routeLine = $lines[$i].Trim()

        # Walk forward to the method signature, skipping further attributes.
        $j = $i
        while ($j -lt $lines.Length -and $lines[$j] -notmatch $signaturePattern) {
            $j++
            if (($j - $i) -gt 12) { break }
        }
        if ($j -ge $lines.Length -or ($j - $i) -gt 12) { $i++; continue }

        $methodName = if ($lines[$j] -match '\s(\w+)\s*\(') { $Matches[1] } else { '?' }

        if ($lines[$j] -match '=>' -and $lines[$j] -match ';') {
            # Expression-bodied member: the signature line IS the body.
            $body = $lines[$j]
            $endLine = $j
        }
        else {
            $depth = 0
            $started = $false
            $sb = New-Object System.Text.StringBuilder
            $k = $j
            while ($k -lt $lines.Length) {
                $depth += ([regex]::Matches($lines[$k], '\{')).Count
                $depth -= ([regex]::Matches($lines[$k], '\}')).Count
                [void]$sb.AppendLine($lines[$k])
                if ($lines[$k] -match '\{') { $started = $true }
                if ($started -and $depth -le 0) { break }
                $k++
                if (($k - $j) -gt 200) { break }
            }
            $body = $sb.ToString()
            $endLine = $k
        }

        if ($body -match $successPattern -and $body -notmatch $workPattern) {
            $findings.Add([pscustomobject]@{
                file   = $file.Name
                line   = $j + 1
                method = $methodName
                route  = if ($routeLine.Length -gt 110) { $routeLine.Substring(0, 110) } else { $routeLine }
            })
        }

        $i = $endLine + 1
    }
}

$total = $findings.Count
$byFile = $findings | Group-Object file | Sort-Object Count -Descending

Write-Host "No-op success-shaped action methods: $total" -ForegroundColor Cyan
foreach ($group in ($byFile | Select-Object -First 12)) {
    Write-Host ("  {0,4}  {1}" -f $group.Count, $group.Name)
}

if ($Detail) {
    Write-Host ''
    foreach ($group in $byFile) {
        Write-Host "--- $($group.Name)" -ForegroundColor Yellow
        foreach ($item in $group.Group) {
            Write-Host ("  {0}:{1}  {2}  {3}" -f $item.file, $item.line, $item.method, $item.route)
        }
    }
}

if ($WriteBaseline) {
    $payload = [ordered]@{
        '_comment'    = 'Shrink-only. See docs/PRODUCTION_READINESS_REMEDIATION.md (R-1). Lower this in the SAME commit that removes stubs; never raise it.'
        generated_at  = (Get-Date -Format 'yyyy-MM-dd')
        total         = $total
        by_file       = ($byFile | ForEach-Object { [ordered]@{ file = $_.Name; count = $_.Count } })
    }
    $payload | ConvertTo-Json -Depth 6 | Set-Content -Path $baselinePath -Encoding utf8
    Write-Host "Baseline written: $baselinePath (total $total)" -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $baselinePath)) {
    Write-Error "Baseline missing: $baselinePath. Run with -WriteBaseline to create it."
    exit 2
}

$baseline = (Get-Content $baselinePath -Raw | ConvertFrom-Json).total

if ($total -gt $baseline) {
    Write-Host ''
    Write-Error @"
NO-OP STUB COUNT INCREASED: $total (baseline $baseline).

A new controller action returns a success-shaped payload while doing no work.
That is the defect class this ratchet exists to stop: it answers 200, so every
route inventory and the route-alias tests report it as working, while the
feature does nothing at all.

Run with -Detail to list them. Either implement the endpoint, or delete the
route so callers get an honest 404 instead of a convincing lie.
"@
    exit 1
}

if ($total -lt $baseline) {
    Write-Host ''
    Write-Error @"
NO-OP STUB COUNT IMPROVED: $total (baseline $baseline).

Lower the baseline in this same commit so the gain is locked in:
    pwsh ./aspnet-backend/scripts/check-noop-stubs.ps1 -WriteBaseline
"@
    exit 1
}

Write-Host "Matches baseline ($baseline). No new no-op stubs." -ForegroundColor Green
exit 0
