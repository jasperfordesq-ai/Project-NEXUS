# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [string]$ArtifactRoot,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    $ArtifactRoot = Join-Path $repoRoot 'artifacts\parity'
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $ArtifactRoot 'backlog'
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Read-JsonReport {
    param(
        [string]$Path,
        [System.Collections.Generic.List[string]]$MissingArtifacts
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        $MissingArtifacts.Add($Path)
        return $null
    }

    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Get-GapArea {
    param(
        [string]$Surface,
        [string]$Evidence,
        [string]$Source
    )

    $text = ("$Surface $Evidence $Source").ToLowerInvariant()

    if ($text -match 'caring|kiss|municipal|warmth') {
        return 'Caring Community / National KISS'
    }
    if ($text -match 'veriff|onfido|jumio|idenfy|identity') {
        return 'Identity verification providers'
    }
    if ($text -match 'marketplace|merchant|seller|escrow|coupon|advert|promotion|order|pickup') {
        return 'Marketplace / commerce'
    }
    if ($text -match 'verein|club|dues|federation') {
        return 'Verein / Clubs'
    }
    if ($text -match 'regional[-_ /]?analytics') {
        return 'Regional Analytics'
    }
    if ($text -match 'partner') {
        return 'Partner API / portal'
    }
    if ($text -match 'mailchimp|audience|campaign|newsletter') {
        return 'Mailchimp-like communications'
    }
    if ($Surface -match '^localization') {
        return 'Localization'
    }
    if ($Surface -eq 'frontend-accessible' -or $text -match 'govuk|accessible') {
        return 'Accessible frontend'
    }

    return 'Unclassified parity gap'
}

function Get-GapPriority {
    param(
        [string]$Surface,
        [string]$Area
    )

    if ($Surface -eq 'api') {
        return 'P0'
    }

    if ($Area -in @('Caring Community / National KISS', 'Regional Analytics', 'Verein / Clubs') -and
        $Surface -in @('schema', 'frontend-accessible')) {
        return 'P0'
    }

    if ($Surface -eq 'localization-locale') {
        return 'P2'
    }

    return 'P1'
}

function Get-AcceptanceCriteria {
    param(
        [string]$Surface,
        [string]$Evidence
    )

    switch ($Surface) {
        'api' {
            return "Implement or verify ``$Evidence`` in ASP.NET with matching method/path or a documented compatible alias; auth, tenant isolation, request validation, response shape, error shape, and regression tests match the Laravel source contract."
        }
        'schema' {
            return "Add an EF entity/table mapping and committed migration for ``$Evidence``, or document an accepted alias; tests or migration checks prove tenant isolation, relationships, indexes, and required constraints needed by the Laravel workflow."
        }
        'frontend-react' {
            return "Expose the .NET APIs the React route ``$Evidence`` consumes, and cover them with focused integration verification. Do not add the route to this repository: the in-repo React copy was deleted 2026-08-09 and the canonical React frontend lives in the staging repository."
        }
        'frontend-accessible' {
            return "Add or map the accessible route ``$Evidence`` in ``apps/web-uk``, preserve GOV.UK-style progressive enhancement behavior, and verify backing API, auth, tenant, and feature-gate behavior."
        }
        'localization-locale' {
            return "Add the missing locale ``$Evidence`` across the primary React locale tree and ensure fallback behavior, language switcher visibility, and translated critical workflows are verified."
        }
        'localization-namespace' {
            return "Add the missing locale namespace ``$Evidence`` or document an accepted namespace alias; verify no visible route in the mapped workflow falls back to raw translation keys."
        }
        'localization-key' {
            return "Add the missing translation key ``$Evidence`` or document an accepted key alias; verify the associated UI/email/notification renders human-readable text."
        }
        default {
            return "Implement or document a compatible .NET equivalent for ``$Evidence``, then add focused verification for the affected workflow."
        }
    }
}

function Add-BacklogItem {
    param(
        [System.Collections.Generic.List[object]]$Items,
        [string]$Surface,
        [string]$Evidence,
        [string]$Source,
        [string]$Title
    )

    $area = Get-GapArea $Surface $Evidence $Source
    $priority = Get-GapPriority $Surface $area
    $Items.Add([pscustomobject]@{
        id = ''
        priority = $priority
        area = $area
        surface = $Surface
        title = $Title
        evidence = $Evidence
        source = $Source
        acceptance_criteria = Get-AcceptanceCriteria $Surface $Evidence
        status = 'open'
    })
}

function Add-ApiItems {
    param(
        [object]$Report,
        [System.Collections.Generic.List[object]]$Items
    )

    if ($null -eq $Report) {
        return
    }

    foreach ($row in @($Report.matrix | Where-Object { $_.status -eq 'missing' })) {
        $evidence = ("{0} {1}" -f $row.method, $row.normalized_path).Trim()
        Add-BacklogItem $Items 'api' $evidence $row.source_file "Implement API parity for $evidence"
    }
}

function Add-SchemaItems {
    param(
        [object]$Report,
        [System.Collections.Generic.List[object]]$Items
    )

    if ($null -eq $Report) {
        return
    }

    foreach ($row in @($Report.matrix | Where-Object { $_.status -eq 'missing' })) {
        Add-BacklogItem $Items 'schema' $row.table $row.laravel_files "Implement schema parity for $($row.table)"
    }
}

function Add-FrontendItems {
    param(
        [object]$Report,
        [System.Collections.Generic.List[object]]$Items
    )

    if ($null -eq $Report) {
        return
    }

    foreach ($row in @($Report.matrix | Where-Object { $_.status -eq 'missing' })) {
        $surface = if ($row.surface -eq 'accessible') { 'frontend-accessible' } else { 'frontend-react' }
        $evidence = ("{0} {1}" -f $row.method, $row.path).Trim()
        Add-BacklogItem $Items $surface $evidence $row.source_files "Implement $($row.surface) frontend parity for $evidence"
    }
}

function Add-LocalizationItems {
    param(
        [object]$Report,
        [System.Collections.Generic.List[object]]$Items
    )

    if ($null -eq $Report) {
        return
    }

    foreach ($row in @($Report.locale_matrix | Where-Object { $_.status -eq 'missing' })) {
        Add-BacklogItem $Items 'localization-locale' $row.locale '' "Add missing locale $($row.locale)"
    }

    foreach ($row in @($Report.namespace_matrix | Where-Object { $_.status -eq 'missing' })) {
        $evidence = ("{0}/{1}" -f $row.locale, $row.namespace)
        Add-BacklogItem $Items 'localization-namespace' $evidence '' "Add missing locale namespace $evidence"
    }

    foreach ($row in @($Report.key_matrix | Where-Object { $_.status -eq 'missing' })) {
        $evidence = ("{0}/{1}:{2}" -f $row.locale, $row.namespace, $row.key)
        Add-BacklogItem $Items 'localization-key' $evidence $row.source_files "Add missing translation key $evidence"
    }
}

function Count-Items {
    param(
        [object[]]$Items,
        [scriptblock]$Predicate
    )

    return @($Items | Where-Object $Predicate).Count
}

function Write-MarkdownReport {
    param(
        [object]$Summary,
        [object[]]$Items,
        [string]$Path
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('# Laravel Parity Implementation Backlog')
    $lines.Add('')
    $lines.Add("Generated: $($Summary.generated_at)")
    $lines.Add('')
    $lines.Add('| Metric | Count |')
    $lines.Add('| --- | ---: |')
    $lines.Add("| Total items | $($Summary.total_items) |")
    $lines.Add("| P0 items | $($Summary.p0_items) |")
    $lines.Add("| P1 items | $($Summary.p1_items) |")
    $lines.Add("| P2 items | $($Summary.p2_items) |")
    $lines.Add("| API items | $($Summary.api_items) |")
    $lines.Add("| Schema items | $($Summary.schema_items) |")
    $lines.Add("| Frontend items | $($Summary.frontend_items) |")
    $lines.Add("| Localization items | $($Summary.localization_items) |")
    $lines.Add('')

    $areaGroups = @($Items | Group-Object area | Sort-Object @{ Expression = 'Count'; Descending = $true }, Name)
    $lines.Add('## Area Summary')
    $lines.Add('')
    if ($areaGroups.Count -eq 0) {
        $lines.Add('No backlog items found from the current parity artifacts.')
    } else {
        $lines.Add('| Area | Items |')
        $lines.Add('| --- | ---: |')
        foreach ($group in $areaGroups) {
            $lines.Add("| $($group.Name) | $($group.Count) |")
        }
    }

    foreach ($priority in @('P0', 'P1', 'P2')) {
        $priorityItems = @($Items | Where-Object { $_.priority -eq $priority })
        $lines.Add('')
        $lines.Add("## $priority Items")
        $lines.Add('')
        if ($priorityItems.Count -eq 0) {
            $lines.Add("No $priority items found.")
            continue
        }

        $lines.Add('| ID | Area | Surface | Evidence | Acceptance criteria |')
        $lines.Add('| --- | --- | --- | --- | --- |')
        foreach ($item in $priorityItems) {
            $criteria = ([string]$item.acceptance_criteria) -replace '\r?\n', ' '
            $sourceEvidence = ([string]$item.evidence) -replace '\|', '\|'
            $lines.Add(('| {0} | {1} | {2} | `{3}` | {4} |' -f $item.id, $item.area, $item.surface, $sourceEvidence, $criteria))
        }
    }

    if ($Summary.missing_artifacts.Count -gt 0) {
        $lines.Add('')
        $lines.Add('## Missing Input Artifacts')
        $lines.Add('')
        foreach ($artifact in $Summary.missing_artifacts) {
            $lines.Add(('- `{0}`' -f $artifact))
        }
    }

    $lines | Set-Content -LiteralPath $Path
}

try {
    Ensure-Directory $OutDir

    $missingArtifacts = New-Object System.Collections.Generic.List[string]
    $items = New-Object System.Collections.Generic.List[object]

    $apiReport = Read-JsonReport (Join-Path $ArtifactRoot 'api\api-parity.json') $missingArtifacts
    $schemaReport = Read-JsonReport (Join-Path $ArtifactRoot 'schema\schema-parity.json') $missingArtifacts
    $frontendReport = Read-JsonReport (Join-Path $ArtifactRoot 'frontend\frontend-parity.json') $missingArtifacts
    $localizationReport = Read-JsonReport (Join-Path $ArtifactRoot 'localization\localization-parity.json') $missingArtifacts

    Add-ApiItems $apiReport $items
    Add-SchemaItems $schemaReport $items
    Add-FrontendItems $frontendReport $items
    Add-LocalizationItems $localizationReport $items

    $sortedItems = @($items.ToArray() | Sort-Object priority, area, surface, evidence)
    for ($i = 0; $i -lt $sortedItems.Count; $i++) {
        $sortedItems[$i].id = ('PB-{0:D5}' -f ($i + 1))
    }

    $summary = [pscustomobject]@{
        generated_at = (Get-Date).ToString('o')
        artifact_root = $ArtifactRoot
        total_items = $sortedItems.Count
        p0_items = Count-Items $sortedItems { $_.priority -eq 'P0' }
        p1_items = Count-Items $sortedItems { $_.priority -eq 'P1' }
        p2_items = Count-Items $sortedItems { $_.priority -eq 'P2' }
        api_items = Count-Items $sortedItems { $_.surface -eq 'api' }
        schema_items = Count-Items $sortedItems { $_.surface -eq 'schema' }
        frontend_items = Count-Items $sortedItems { $_.surface -like 'frontend-*' }
        localization_items = Count-Items $sortedItems { $_.surface -like 'localization-*' }
        missing_artifacts = @($missingArtifacts.ToArray())
    }

    $report = [pscustomobject]@{
        summary = $summary
        items = $sortedItems
    }

    $jsonPath = Join-Path $OutDir 'parity-backlog.json'
    $csvPath = Join-Path $OutDir 'parity-backlog.csv'
    $markdownPath = Join-Path $OutDir 'parity-backlog.md'

    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath
    $sortedItems | Export-Csv -LiteralPath $csvPath -NoTypeInformation
    Write-MarkdownReport $summary $sortedItems $markdownPath

    $summary | Format-List
    Write-Host "Parity backlog report written to $jsonPath"
    Write-Host "Parity backlog markdown written to $markdownPath"
} catch {
    Write-Error "Parity backlog export failed at line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
    throw
}
