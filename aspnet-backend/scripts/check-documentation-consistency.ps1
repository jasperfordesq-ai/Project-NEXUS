# Copyright (c) 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford

[CmdletBinding()]
param(
    [Parameter()]
    [string]$RepositoryRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}

$root = [System.IO.Path]::GetFullPath($RepositoryRoot)
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure {
    param([Parameter(Mandatory)][string]$Message)
    $script:failures.Add($Message)
}

function Get-DocumentText {
    param([Parameter(Mandatory)][string]$RelativePath)

    $path = Join-Path $root $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Add-Failure "Missing required documentation file: $RelativePath"
        return $null
    }

    return [System.IO.File]::ReadAllText($path)
}

function Assert-Contains {
    param(
        [Parameter(Mandatory)][string]$RelativePath,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory)][string]$Pattern,
        [Parameter(Mandatory)][string]$Description
    )

    if ($Text -notmatch $Pattern) {
        Add-Failure "${RelativePath}: $Description"
    }
}

function Assert-NotContains {
    param(
        [Parameter(Mandatory)][string]$RelativePath,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory)][string]$Pattern,
        [Parameter(Mandatory)][string]$Description
    )

    if ($Text -match $Pattern) {
        Add-Failure "${RelativePath}: $Description"
    }
}

function Get-NonHistoricalRegion {
    param([Parameter(Mandatory)][string]$Text)

    if ($Text -match '(?im)^(?:>\s*)?Status:\s*\*{0,2}Historical (?:checkpoint|archive)') {
        return $null
    }

    $builder = [System.Text.StringBuilder]::new()
    $includeSection = $true
    foreach ($line in [regex]::Split($Text, "`r?`n")) {
        if ($line -match '^##\s+') {
            $includeSection = $line -notmatch '(?i)^##\s+Historical\b'
        }
        if ($includeSection) {
            [void]$builder.AppendLine($line)
        }
    }

    return $builder.ToString()
}

function Get-OpeningRegion {
    param(
        [Parameter(Mandatory)][string]$Text,
        [int]$LineCount = 20
    )

    return (([regex]::Split($Text, "`r?`n") | Select-Object -First $LineCount) -join "`n")
}

$entryPointPaths = @(
    'AGENTS.md',
    'README.md',
    'CLAUDE.md',
    'docs/README.md',
    'apps/web-uk/AGENTS.md',
    'apps/web-uk/CLAUDE.md',
    'apps/web-uk/README.md'
)

$audienceDocumentationPaths = @(
    'docs/user/README.md',
    'docs/user/GETTING_STARTED.md',
    'docs/user/COMMUNITY_FEATURES.md',
    'docs/user/ACCOUNT_SECURITY_PRIVACY.md',
    'docs/user/ACCESSIBILITY_LANGUAGE_SUPPORT.md',
    'docs/admin/README.md',
    'docs/api/README.md',
    'docs/system/README.md',
    'docs/system/LOCAL_DEVELOPMENT.md',
    'docs/system/CONFIGURATION.md',
    'docs/system/TESTING.md',
    'docs/system/SECURITY_AND_TENANCY.md',
    'docs/system/OPERATIONS.md',
    'docs/system/INCIDENT_RESPONSE.md',
    'SUPPORT.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md'
)

foreach ($relativePath in $audienceDocumentationPaths) {
    [void](Get-DocumentText $relativePath)
}

foreach ($relativePath in $entryPointPaths) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }

    Assert-Contains $relativePath $text 'CURRENT_ASPNET_CONTRACT_STATUS\.md' `
        'must link the canonical ASP.NET contract status.'
    Assert-Contains $relativePath $text 'CURRENT_LARAVEL_FIRST_PARITY_STATUS\.md' `
        'must link the canonical Web UK status.'
    Assert-Contains $relativePath $text 'PROJECT_PAUSE_HANDOFF_2026-07-15\.md' `
        'must link the canonical paused-development handoff.'
}

$statusLikeDocuments = @(
    'CHANGELOG.md',
    'CODE_OF_CONDUCT.md',
    'PHASE63_73_DEPLOY_NOTES.md',
    'docs/CURRENT_ASPNET_CONTRACT_STATUS.md',
    'docs/CURRENT_SCHEMA_READINESS.md',
    'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md',
    'docs/BACKEND_LOCALIZATION_CONTRACT.md',
    'docs/DOCUMENTATION_HEALTH_REPORT.md',
    'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md',
    'docs/ARCHITECTURE.md',
    'docs/API_PARITY.md',
    'docs/SCHEMA_PARITY.md',
    'docs/FRONTEND_PARITY.md',
    'docs/LOCALIZATION_PARITY.md',
    'docs/LARAVEL_PARITY_MAP.md',
    'docs/PARITY_BACKLOG.md',
    'docs/MODULES.md',
    'docs/REACT_FRONTEND_RETIREMENT.md',
    'docs/ACCESSIBLE_SHARED_FRONTEND.md',
    'docs/database-migrations.md',
    'docs/REGISTRATION_POLICY_ENGINE.md',
    'docs/CURRENT_LARAVEL_PARITY_HANDOFF.md',
    'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md',
    'apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md',
    'apps/web-uk/docs/ACCESSIBILITY_CERTIFICATION.md',
    'apps/web-uk/docs/ACCESSIBLE_SHARED_FRONTEND.md',
    'apps/web-uk/docs/BACKEND_SWITCHING_CONTRACT.md',
    'apps/web-uk/docs/BLADE_COMPONENT_PORT_AUDIT.md',
    'apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md',
    'apps/web-uk/docs/MANUAL_ACCESSIBILITY_EVIDENCE.md',
    'apps/web-uk/docs/TENANT_ROUTING_PARITY.md',
    'apps/web-uk/docs/FRONTEND_AUDIT_REPORT.md',
    'apps/web-uk/docs/FRONTEND_BUILD_LOG.md',
    'apps/web-uk/docs/generated/accessible-route-matrix.md',
    'apps/web-uk/docs/generated/frontend-api-consumer-ledger.md',
    'apps/web-uk/DOCKER_CONTRACT.md',
    'apps/web-uk/docs/PRODUCTION_RELEASE_RUNBOOK.md',
    'docs/DOCUMENTATION_GOVERNANCE.md'
)
$statusLikeDocuments += $audienceDocumentationPaths

foreach ($relativePath in $statusLikeDocuments) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }

    $opening = Get-OpeningRegion $text 16
    Assert-Contains $relativePath $opening `
        '(?im)^Status:\s*\*\*(?:Canonical current|Maintained(?: [A-Za-z-]+){0,3} (?:reference|index)|Generated snapshot|Historical (?:checkpoint|archive))\b' `
        'must expose an approved documentation-state label within its first 16 lines.'
}

$claude = Get-DocumentText 'CLAUDE.md'
if ($null -ne $claude) {
    Assert-NotContains 'CLAUDE.md' $claude `
        '(?is)\b(?:(?:start|begin)\s+(?:by\s+)?(?:with\s+)?|resume\s+(?:from|with|at)\s+)`?(?:apps/web-uk/docs/)?CURRENT_WEB_UK_HANDOFF\.md' `
        'must not direct resumed Web UK work to the historical handoff.'
}

$docsIndex = Get-DocumentText 'docs/README.md'
if ($null -ne $docsIndex) {
    foreach ($entry in @('user/README.md', 'admin/README.md', 'api/README.md', 'system/README.md', '../SUPPORT.md', '../SECURITY.md', '../CODE_OF_CONDUCT.md', '../CHANGELOG.md')) {
        Assert-Contains 'docs/README.md' $docsIndex ([regex]::Escape($entry)) `
            "must link the system-wide audience entry point '$entry'."
    }
    $oldHandoffRows = $docsIndex -split "`r?`n" |
        Where-Object { $_ -match 'CURRENT_WEB_UK_HANDOFF\.md' }
    foreach ($row in $oldHandoffRows) {
        if ($row -notmatch '(?i)historical|archive|superseded') {
            Add-Failure 'docs/README.md: CURRENT_WEB_UK_HANDOFF.md must be labelled historical or archived in the index.'
        }
    }
}

$maintainedSafetyDocuments = @(
    'AGENTS.md',
    'CLAUDE.md',
    'README.md',
    'docs/README.md',
    'docs/CURRENT_ASPNET_CONTRACT_STATUS.md',
    'docs/DOCUMENTATION_GOVERNANCE.md',
    'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md',
    'docs/ARCHITECTURE.md',
    'docs/ACCESSIBLE_SHARED_FRONTEND.md',
    'docs/FRONTEND_PARITY.md',
    'docs/REACT_FRONTEND_RETIREMENT.md',
    'apps/web-uk/AGENTS.md',
    'apps/web-uk/CLAUDE.md',
    'apps/web-uk/README.md',
    'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md',
    'apps/web-uk/docs/BACKEND_SWITCHING_CONTRACT.md',
    'apps/web-uk/docs/ACCESSIBILITY_CERTIFICATION.md'
)

$ordinaryDatabaseExceptionPatterns = @(
    '(?is)explicit\s+authori[sz]ation\s+with\s+(?:verified\s+)?cleanup',
    '(?is)(?:disposable|dedicated)\s+(?:Laravel\s+)?environment.{0,100}\bor\b.{0,100}explicit\s+authori[sz]ation.{0,120}cleanup',
    '(?is)(?:ordinary|production-derived).{0,160}(?:database|snapshot).{0,220}\bor\b.{0,100}(?:authori[sz](?:ation|ed)).{0,120}cleanup'
)

foreach ($relativePath in $maintainedSafetyDocuments) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }

    $currentSafetyText = Get-NonHistoricalRegion $text
    if ($null -eq $currentSafetyText) { continue }

    foreach ($pattern in $ordinaryDatabaseExceptionPatterns) {
        Assert-NotContains $relativePath $currentSafetyText $pattern `
            'must not offer authorization plus cleanup as an exception for ordinary Laravel database testing.'
    }
}

$architecture = Get-DocumentText 'docs/ARCHITECTURE.md'
if ($null -ne $architecture) {
    Assert-Contains 'docs/ARCHITECTURE.md' $architecture `
        '(?i)two-frontends-by-two-backends' `
        'must explicitly define the two-frontends-by-two-backends model.'
    Assert-Contains 'docs/ARCHITECTURE.md' $architecture `
        '(?i)Laravel backend' `
        'must include the Laravel backend in the current architecture.'
    Assert-Contains 'docs/ARCHITECTURE.md' $architecture `
        '(?i)ASP\.NET backend' `
        'must include the ASP.NET backend in the current architecture.'
    Assert-Contains 'docs/ARCHITECTURE.md' $architecture `
        '(?i)canonical React' `
        'must include the unchanged canonical React client.'
    Assert-Contains 'docs/ARCHITECTURE.md' $architecture `
        '(?i)(?:accessible Web UK|Web UK accessible)' `
        'must include the unchanged accessible Web UK client.'
}

$status = Get-DocumentText 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md'
if ($null -ne $status) {
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        '<!--\s*doc-consistency:\s*ASPNET_CURRENT_BANKED_SCORE=712/1000\s*-->' `
        'must expose the canonical 712/1000 banked-score marker.'
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        '(?i)current banked score is\s+\*{0,2}712/1000' `
        'must state the current banked score as 712/1000.'
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        '2,601/2,601' `
        'must preserve the current active route-representation result.'
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        '(?i)eleven backend commits|All eleven contribute' `
        'must disclose the published-but-unscored post-scorecard backend delta.'
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        'df8c8b96c80804785e9c84f9f7c75337088d6024' `
        'must identify the published but unscored schema merge exactly.'
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        'dbafc5c329c55a15b4329ff90804d725dbf8b089' `
        'must identify the green exact-SHA test/evidence boundary.'
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        '29451087913' `
        'must identify the terminal-green required CI run.'
}

$schemaStatus = Get-DocumentText 'docs/CURRENT_SCHEMA_READINESS.md'
if ($null -ne $schemaStatus) {
    Assert-Contains 'docs/CURRENT_SCHEMA_READINESS.md' $schemaStatus `
        '<!--\s*doc-consistency:\s*SCHEMA_CURRENT_PRODUCT_SHA=c767050a3eabd064bdf647695b9699b98186342b\s*-->' `
        'must preserve the current schema implementation boundary.'
    Assert-Contains 'docs/CURRENT_SCHEMA_READINESS.md' $schemaStatus `
        '<!--\s*doc-consistency:\s*SCHEMA_CURRENT_RUNTIME_MIGRATIONS=163\s*-->' `
        'must preserve the current runtime migration count.'
    foreach ($greenBoundary in @('dbafc5c329c55a15b4329ff90804d725dbf8b089', '29451087913')) {
        Assert-Contains 'docs/CURRENT_SCHEMA_READINESS.md' $schemaStatus `
            ([regex]::Escape($greenBoundary)) `
            "must preserve the green CI boundary '$greenBoundary'."
    }
}

$pauseHandoff = Get-DocumentText 'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md'
if ($null -ne $pauseHandoff) {
    Assert-Contains 'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md' $pauseHandoff `
        '<!--\s*doc-consistency:\s*PROJECT_PAUSE_DATE=2026-07-15\s*-->' `
        'must preserve the exact pause-date marker.'
    Assert-Contains 'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md' $pauseHandoff `
        '<!--\s*doc-consistency:\s*PROJECT_PAUSE_STATE=PAUSED\s*-->' `
        'must preserve the paused-state marker.'
    foreach ($requiredLink in @(
        'ADR-0001-contract-identical-backends.md',
        'CURRENT_ASPNET_CONTRACT_STATUS.md',
        'CURRENT_SCHEMA_READINESS.md',
        'CURRENT_LARAVEL_FIRST_PARITY_STATUS.md',
        'FULL_PARITY_REMEDIATION_RUNBOOK.md'
    )) {
        Assert-Contains 'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md' $pauseHandoff `
            ([regex]::Escape($requiredLink)) `
            "must link the cold-start authority '$requiredLink'."
    }
    foreach ($boundary in @(
        'c767050a3eabd064bdf647695b9699b98186342b',
        '903d03d3db78bbf87129ad35728be3b72819acaf',
        '712/1000',
        '129/150',
        'dbafc5c329c55a15b4329ff90804d725dbf8b089',
        '29451087913',
        'pause/2026-07-15-final',
        'PROJECT_PAUSE_STATE=PAUSED'
    )) {
        Assert-Contains 'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md' $pauseHandoff `
            ([regex]::Escape($boundary)) `
            "must preserve the pause boundary '$boundary'."
    }
    Assert-Contains 'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md' $pauseHandoff `
        '(?i)externally contract-identical' `
        'must state the corrected backend objective.'
    Assert-Contains 'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md' $pauseHandoff `
        '(?i)opening\s+(?:or\s+cloning\s+)?the\s+repository\s+does\s+not\s+resume' `
        'must make the pause fence explicit.'
}

foreach ($relativePath in @('CLAUDE.md', 'docs/API_PARITY.md', 'docs/MODULES.md', 'docs/LARAVEL_PARITY_MAP.md')) {
    $greenCiText = Get-DocumentText $relativePath
    if ($null -eq $greenCiText) { continue }
    Assert-Contains $relativePath $greenCiText 'dbafc5c3' `
        'must acknowledge the green general exact-SHA aggregate.'
    Assert-NotContains $relativePath $greenCiText `
        '(?i)(?:the\s+)?complete(?:-suite|\s+suite).{0,50}exact-SHA\s+CI.{0,50}remain(?:s)?\s+(?:open|a\s+certification\s+gap)' `
        'must not describe the now-green general complete-suite exact-SHA CI gate as still open.'
}

$webUkStatus = Get-DocumentText 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md'
if ($null -ne $webUkStatus) {
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        '<!--\s*doc-consistency:\s*WEBUK_CURRENT_BANKED_SCORE=663/1000\s*-->' `
        'must expose the canonical 663/1000 banked-score marker.'
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        '(?i)Laravel-first banked score[^\r\n]*663/1000' `
        'must state the Web UK banked score as 663/1000.'
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        '688/689' `
        'must preserve the canonical generated route summary.'
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        '668 contracts:\s*451 OpenAPI matches,\s*217 unmatched,\s*0 dynamic' `
        'must preserve the canonical frontend-consumer ledger summary.'
    foreach ($boundary in @('Banked baseline', 'Published but unscored', 'Current repository boundary')) {
        $boundaryPattern = [regex]::Escape($boundary)
        Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
            $boundaryPattern `
            "must retain the '$boundary' repository-state boundary."
    }
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        '(?i)W2 has no percentage|W2 percentage `not assigned`' `
        'must not reuse the W1 bank as the corrected Goal W2 percentage.'
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        '38 later Web UK commits' `
        'must retain the published-but-unscored post-W1 Web UK boundary.'
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        'remaining finish-line gate count `3`' `
        'must expose the complete W2 finish line instead of only the implementation package.'
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        '(?i)Accessibility-copy source/parity decision' `
        'must retain the explicit Laravel accessibility-copy decision gate.'
    Assert-Contains 'apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md' $webUkStatus `
        '7,629 references, 5,814 unique keys, 0 unresolved' `
        'must retain the post-suppression static locale result.'
}

$generatedArtifactPaths = @(
    'apps/web-uk/docs/generated/accessible-route-matrix.json',
    'apps/web-uk/docs/generated/accessible-route-matrix.md',
    'apps/web-uk/docs/generated/frontend-api-consumer-ledger.json',
    'apps/web-uk/docs/generated/frontend-api-consumer-ledger.md'
)
foreach ($relativePath in $generatedArtifactPaths) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }
    Assert-Contains $relativePath $text `
        '(?i)(?:"generatedAt"\s*:|Generated(?: at)?\s*:)' `
        'must record a generation timestamp.'
    Assert-Contains $relativePath $text `
        '(?i)(?:"laravelCommitSha"\s*:\s*"|Laravel commit SHA:\s*`)[0-9a-f]{40}' `
        'must record the exact Laravel commit SHA.'
    Assert-Contains $relativePath $text `
        '(?i)(?:"webUkRepositoryCommitSha"\s*:\s*"|Web UK repository commit SHA:\s*`)[0-9a-f]{40}' `
        'must record the exact Web UK repository commit SHA.'
    Assert-Contains $relativePath $text `
        '(?i)(?:"(?:laravelWorkingTreeDirty|webUkRepositoryWorkingTreeDirty)"\s*:|working tree dirty:)' `
        'must disclose source working-tree state.'
    Assert-Contains $relativePath $text `
        '(?i)(?:"caveat"\s*:|Provenance caveat:)' `
        'must include an explicit provenance caveat.'
}

$routeMatrixJson = Get-DocumentText 'apps/web-uk/docs/generated/accessible-route-matrix.json'
if ($null -ne $routeMatrixJson) {
    Assert-Contains 'apps/web-uk/docs/generated/accessible-route-matrix.json' $routeMatrixJson `
        '"laravelRoutes"\s*:\s*689' `
        'must preserve the canonical Laravel accessible-route count.'
    Assert-Contains 'apps/web-uk/docs/generated/accessible-route-matrix.json' $routeMatrixJson `
        '"matchedRoutes"\s*:\s*688' `
        'must preserve the canonical matched-route count.'
    Assert-Contains 'apps/web-uk/docs/generated/accessible-route-matrix.json' $routeMatrixJson `
        '"missingRoutes"\s*:\s*1' `
        'must preserve the canonical missing-route count.'
}

$consumerLedgerJson = Get-DocumentText 'apps/web-uk/docs/generated/frontend-api-consumer-ledger.json'
if ($null -ne $consumerLedgerJson) {
    foreach ($expectation in @(
        @{ Pattern = '"contracts"\s*:\s*668'; Description = 'must preserve the canonical contract count.' },
        @{ Pattern = '"matchedOpenApi"\s*:\s*451'; Description = 'must preserve the canonical OpenAPI-match count.' },
        @{ Pattern = '"missingOpenApi"\s*:\s*217'; Description = 'must preserve the canonical unmatched count.' },
        @{ Pattern = '"dynamicUnresolved"\s*:\s*0'; Description = 'must preserve the zero-dynamic-callsite result.' }
    )) {
        Assert-Contains 'apps/web-uk/docs/generated/frontend-api-consumer-ledger.json' $consumerLedgerJson `
            $expectation.Pattern $expectation.Description
    }
    Assert-NotContains 'apps/web-uk/docs/generated/frontend-api-consumer-ledger.json' $consumerLedgerJson `
        '\?\?\{param\}|limit=\{param\}1' `
        'must not contain malformed displayed query shapes.'
}

$webUkDependentStatusDocuments = @(
    'apps/web-uk/docs/BACKEND_SWITCHING_CONTRACT.md',
    'apps/web-uk/docs/BLADE_COMPONENT_PORT_AUDIT.md',
    'apps/web-uk/docs/ACCESSIBLE_SHARED_FRONTEND.md',
    'apps/web-uk/docs/TENANT_ROUTING_PARITY.md',
    'apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md'
)

foreach ($relativePath in $webUkDependentStatusDocuments) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }

    $opening = Get-OpeningRegion $text 80
    Assert-NotContains $relativePath $opening `
        '(?i)\b(?:663/1000|660/1000|622/1000|688/689|1,709/1,709|1,706/1,706|1,661/1,661)\b|(?:668|663)\s+contracts' `
        'must link the canonical Web UK status instead of mirroring live score/count/test totals near its title.'
}

$governance = Get-DocumentText 'docs/DOCUMENTATION_GOVERNANCE.md'
if ($null -ne $governance) {
    Assert-Contains 'docs/DOCUMENTATION_GOVERNANCE.md' $governance `
        'CURRENT_ASPNET_CONTRACT_STATUS\.md' `
        'must name the canonical ASP.NET status.'
    Assert-Contains 'docs/DOCUMENTATION_GOVERNANCE.md' $governance `
        'CURRENT_LARAVEL_FIRST_PARITY_STATUS\.md' `
        'must name the canonical Web UK status.'
    Assert-Contains 'docs/DOCUMENTATION_GOVERNANCE.md' $governance `
        '(?i)Operational Inventory Is Not Product Authority' `
        'must distinguish deployment inventory from product authority.'
    Assert-Contains 'docs/DOCUMENTATION_GOVERNANCE.md' $governance `
        '\.claude/production-containers\.md' `
        'must name the authoritative operational container inventory.'
}

$documentationHealth = Get-DocumentText 'docs/DOCUMENTATION_HEALTH_REPORT.md'
if ($null -ne $documentationHealth) {
    Assert-Contains 'docs/DOCUMENTATION_HEALTH_REPORT.md' $documentationHealth `
        '<!--\s*doc-consistency:\s*DOCUMENTATION_HEALTH_BASELINE=D3\s*-->' `
        'must expose the pause-readiness Baseline D3 marker.'
    Assert-Contains 'docs/DOCUMENTATION_HEALTH_REPORT.md' $documentationHealth `
        '<!--\s*doc-consistency:\s*DOCUMENTATION_HEALTH_REVALIDATION=D3-R1\s*-->' `
        'must expose the current D3-R1 revalidation marker.'
    $healthScoreMarker = [regex]::Match(
        $documentationHealth,
        '<!--\s*doc-consistency:\s*DOCUMENTATION_HEALTH_SCORE=(?<score>\d{1,4})/1000\s*-->'
    )
    if (-not $healthScoreMarker.Success) {
        Add-Failure 'docs/DOCUMENTATION_HEALTH_REPORT.md: must expose a D3 health-score marker with a fixed /1000 denominator.'
    }
    else {
        $declaredHealthScore = [int]$healthScoreMarker.Groups['score'].Value
        if ($declaredHealthScore -lt 0 -or $declaredHealthScore -gt 1000) {
            Add-Failure 'docs/DOCUMENTATION_HEALTH_REPORT.md: declared D3 health score must be between 0 and 1000.'
        }
        Assert-Contains 'docs/DOCUMENTATION_HEALTH_REPORT.md' $documentationHealth `
            ("(?m)^## Baseline D3 (?:-|\u2014) {0}/1000\r?$" -f $declaredHealthScore) `
            'must keep the D3 heading synchronized with the declared marker.'
        Assert-Contains 'docs/DOCUMENTATION_HEALTH_REPORT.md' $documentationHealth `
            ("(?i)Documentation Health Baseline D3 scores the paused repository \*\*{0}/1000\*\*" -f $declaredHealthScore) `
            'must keep the D3 summary synchronized with the declared marker.'

        $healthTable = [regex]::Match(
            $documentationHealth,
            '(?ms)^\| D3 category \| Score \| Evidence \|\r?\n^\| ---.*?\r?\n(?<rows>.*?)^\| \*\*Total\*\* \| \*\*(?<total>\d{1,4})/1000\*\*'
        )
        if (-not $healthTable.Success) {
            Add-Failure 'docs/DOCUMENTATION_HEALTH_REPORT.md: must expose a parseable D3 category table and total.'
        }
        else {
            $earnedSum = 0
            $maximumSum = 0
            $categoryRows = [regex]::Matches(
                $healthTable.Groups['rows'].Value,
                '(?m)^\| (?!\*\*)(?<category>[^|]+?) \| (?<earned>\d{1,4})/(?<maximum>\d{1,4}) \|'
            )
            if ($categoryRows.Count -eq 0) {
                Add-Failure 'docs/DOCUMENTATION_HEALTH_REPORT.md: D3 category table contains no scored rows.'
            }
            foreach ($row in $categoryRows) {
                $earned = [int]$row.Groups['earned'].Value
                $maximum = [int]$row.Groups['maximum'].Value
                if ($earned -gt $maximum) {
                    Add-Failure "docs/DOCUMENTATION_HEALTH_REPORT.md: D3 category '$($row.Groups['category'].Value.Trim())' exceeds its maximum."
                }
                $earnedSum += $earned
                $maximumSum += $maximum
            }

            $tableTotal = [int]$healthTable.Groups['total'].Value
            if ($maximumSum -ne 1000) {
                Add-Failure "docs/DOCUMENTATION_HEALTH_REPORT.md: D3 category maxima must sum to 1000 (found $maximumSum)."
            }
            if ($earnedSum -ne $declaredHealthScore -or $tableTotal -ne $declaredHealthScore) {
                Add-Failure "docs/DOCUMENTATION_HEALTH_REPORT.md: D3 marker, category sum, and displayed total must agree (marker $declaredHealthScore, rows $earnedSum, total $tableTotal)."
            }
        }
    }
    foreach ($baseline in @('Baseline D1', 'Baseline U1', 'Baseline S1', 'Baseline D2', 'Baseline D3')) {
        Assert-Contains 'docs/DOCUMENTATION_HEALTH_REPORT.md' $documentationHealth ([regex]::Escape($baseline)) `
            "must preserve the named audit baseline '$baseline'."
    }
    Assert-Contains 'docs/DOCUMENTATION_HEALTH_REPORT.md' $documentationHealth `
        '(?i)documentation health only' `
        'must keep documentation health separate from product readiness.'
}

$restartIncident = Get-DocumentText 'docs/RESTART_INCIDENT_2026-07-15.md'
if ($null -ne $restartIncident) {
    foreach ($expectation in @(
        @{ Pattern = '02:44:42\.746'; Description = 'must preserve the exact first planned-restart time.' },
        @{ Pattern = '02:49:14\.500'; Description = 'must preserve the exact final operating-system start.' },
        @{ Pattern = 'KB5101650'; Description = 'must identify the installed Windows security update.' },
        @{ Pattern = 'KB5100998'; Description = 'must identify the installed .NET Framework update.' },
        @{ Pattern = '(?i)no Kernel-Power event\s+41'; Description = 'must distinguish the planned sequence from an unexpected power loss.' },
        @{ Pattern = '(?i)zero banked points'; Description = 'must retain the interrupted-work scoring boundary.' }
    )) {
        Assert-Contains 'docs/RESTART_INCIDENT_2026-07-15.md' $restartIncident `
            $expectation.Pattern $expectation.Description
    }
}

$rootReadme = Get-DocumentText 'README.md'
if ($null -ne $rootReadme) {
    foreach ($entry in @('docs/user/README.md', 'docs/admin/README.md', 'docs/api/README.md', 'docs/system/README.md', 'SUPPORT.md', 'SECURITY.md')) {
        Assert-Contains 'README.md' $rootReadme ([regex]::Escape($entry)) `
            "must link the system-wide audience entry point '$entry'."
    }
}

if ($null -ne $claude) {
    Assert-Contains 'CLAUDE.md' $claude 'NexusV2!Demo#2026' `
        'must document the current fictitious Development seed password.'
    # The frozen React port assertion was removed on 2026-08-09 with
    # apps/react-frontend. CLAUDE.md correctly no longer documents 127.0.0.1:5273.
    Assert-NotContains 'CLAUDE.md' $claude 'Test123!' `
        'must not retain the obsolete development seed password.'
}

$webUkReadme = Get-DocumentText 'apps/web-uk/README.md'
if ($null -ne $webUkReadme) {
    Assert-NotContains 'apps/web-uk/README.md' $webUkReadme `
        '(?im)^## Test Credentials|/components\b|/connections/pending\b|GET\s+/logout\b|GET\s+/listings/:id/delete\b|POST\s+/members/:id/connect\b' `
        'must not restore the stale hand-maintained route/credentials section.'
    Assert-Contains 'apps/web-uk/README.md' $webUkReadme `
        '(?i)Generate the current inventories' `
        'must direct route/API readers to generated inventories.'
}

$productionServer = Get-DocumentText '.claude/production-server.md'
if ($null -ne $productionServer) {
    Assert-Contains '.claude/production-server.md' $productionServer `
        'production-containers\.md' `
        'must point operators to the authoritative production container map.'
    Assert-Contains '.claude/production-server.md' $productionServer `
        '(?is)Apache.{0,80}not\s+nginx' `
        'must state that the production reverse proxy is Apache, not nginx.'
    Assert-Contains '.claude/production-server.md' $productionServer `
        '(?is)no\s+safe\s+blanket.{0,120}docker\s+compose\s+build.{0,40}docker\s+compose\s+up' `
        'must reject a blanket Docker Compose production procedure.'
    Assert-NotContains '.claude/production-server.md' $productionServer `
        '(?im)^\s*(?:sudo\s+)?docker\s+compose\s+(?:build|up|down)\b' `
        'must not advertise blanket Docker Compose build, up, or down commands.'
}

$productionEnvironmentExample = Get-DocumentText '.env.production.example'
if ($null -ne $productionEnvironmentExample) {
    foreach ($key in @('ConnectionStrings__DefaultConnection', 'Jwt__Secret', 'Jwt__Issuer', 'Jwt__Audience', 'FileUpload__UploadsRoot', 'Meilisearch__BaseUrl', 'RabbitMq__Host', 'RabbitMq__Port', 'RabbitMq__Username', 'RabbitMq__Password', 'RabbitMq__VirtualHost', 'RabbitMq__ExchangeName', 'SendGrid__Enabled', 'Gmail__Enabled', 'Gmail__SenderEmail', 'RABBITMQ_PASS')) {
        Assert-Contains '.env.production.example' $productionEnvironmentExample ([regex]::Escape($key)) `
            "must contain current configuration key '$key'."
    }
    Assert-NotContains '.env.production.example' $productionEnvironmentExample `
        'PHASE63_73_DEPLOY_NOTES|Meilisearch__Host|RabbitMq__Uri|RABBITMQ_PASSWORD|RabbitMq__Enabled=true|RabbitMq__Port=5671' `
        'must not retain obsolete deployment references or configuration keys.'
    Assert-NotContains '.env.production.example' $productionEnvironmentExample `
        '(?m)^(?:POSTGRES_PASSWORD|API_DOMAIN|PLATFORM_FRONTEND_DOMAIN|UK_FRONTEND_DOMAIN|ADMIN_FRONTEND_DOMAIN)=' `
        'must not claim unused legacy Compose interpolation variables.'
}

$deployWorkflow = Get-DocumentText '.github/workflows/deploy.yml'
if ($null -ne $deployWorkflow) {
    $deployLines = [regex]::Split($deployWorkflow, "`r?`n")
    $onIndex = [Array]::IndexOf($deployLines, 'on:')
    $deployEvents = [System.Collections.Generic.List[string]]::new()
    if ($onIndex -lt 0) {
        Add-Failure '.github/workflows/deploy.yml: must contain an explicit on block.'
    }
    else {
        for ($i = $onIndex + 1; $i -lt $deployLines.Count; $i++) {
            $line = $deployLines[$i]
            if ($line -match '^[A-Za-z_][A-Za-z0-9_-]*\s*:') { break }
            if ($line -match '^  (?<event>[A-Za-z_][A-Za-z0-9_-]*)\s*:') {
                $deployEvents.Add($Matches['event'])
            }
        }
    }
    if ($deployEvents.Count -ne 1 -or $deployEvents[0] -ne 'workflow_dispatch') {
        Add-Failure ".github/workflows/deploy.yml: trigger set must be manual-only workflow_dispatch (found: $($deployEvents -join ', '))."
    }
    Assert-Contains '.github/workflows/deploy.yml' $deployWorkflow `
        '(?m)^\s*confirm_production\s*:' `
        'must require an explicit production-confirmation input.'
    Assert-Contains '.github/workflows/deploy.yml' $deployWorkflow `
        '(?m)^\s*if:\s*\$\{\{\s*false\s*\}\}\s*$' `
        'must retain the hard deployment hold while the legacy body remains unapproved.'
    Assert-Contains '.github/workflows/deploy.yml' $deployWorkflow `
        '\^\[0-9a-fA-F\]\{40\}\$' `
        'must reject anything other than an exact full commit SHA.'
    Assert-Contains '.github/workflows/deploy.yml' $deployWorkflow `
        '(?ms)env:\s*\r?\n\s*COMMIT_SHA:\s*\$\{\{\s*inputs\.commit_sha\s*\}\}.*if ! \[\[ "\$COMMIT_SHA" =~ \^\[0-9a-fA-F\]\{40\}\$ \]\]' `
        'must pass the dispatch input through the environment before shell validation.'
    Assert-NotContains '.github/workflows/deploy.yml' $deployWorkflow `
        '(?m)^\s*(?:SHA|COMMIT_SHA)="\$\{\{\s*inputs\.commit_sha\s*\}\}"' `
        'must not interpolate the untrusted dispatch input directly into shell source.'
    $validationIndex = $deployWorkflow.IndexOf('name: Validate exact deploy version', [StringComparison]::Ordinal)
    $checkoutIndex = $deployWorkflow.IndexOf('uses: actions/checkout@', [StringComparison]::Ordinal)
    if ($validationIndex -lt 0 -or $checkoutIndex -lt 0 -or $validationIndex -gt $checkoutIndex) {
        Add-Failure '.github/workflows/deploy.yml: exact-SHA validation must occur before checkout.'
    }
    Assert-Contains '.github/workflows/deploy.yml' $deployWorkflow `
        '(?is)name:\s*Verify checked-out SHA.*git rev-parse HEAD.*ACTUAL_SHA.*EXPECTED_SHA' `
        'must verify that checkout resolved to the authorized full SHA.'
}

$healthWorkflow = Get-DocumentText '.github/workflows/health-check.yml'
if ($null -ne $healthWorkflow) {
    Assert-Contains '.github/workflows/health-check.yml' $healthWorkflow `
        'docs/system/INCIDENT_RESPONSE\.md' `
        'must point alerts to maintained read-only incident guidance.'
    Assert-NotContains '.github/workflows/health-check.yml' $healthWorkflow `
        'docker compose restart|RECOVERY_GUIDE\.md' `
        'must not tell an alert recipient to restart production or consult a missing guide.'
    Assert-Contains '.github/workflows/health-check.yml' $healthWorkflow `
        '(?ms)^permissions:\s*\r?\n\s*contents:\s*read\s*\r?\n\s*issues:\s*write' `
        'must request the issue-write permission required by its alert path.'
    foreach ($stepOutput in @('api_health.outputs.status', 'uk_health.outputs.status', 'app_health.outputs.status')) {
        Assert-Contains '.github/workflows/health-check.yml' $healthWorkflow ([regex]::Escape($stepOutput)) `
            "must include '$stepOutput' in the all-component failure condition."
    }
    Assert-NotContains '.github/workflows/health-check.yml' $healthWorkflow `
        '(?m)^\s*labels:|body=\$BODY|echo\s+"body=' `
        'must not depend on unprovisioned labels or write an untrusted response body to workflow outputs.'
}

$publicAccessibility = Get-DocumentText 'apps/web-uk/src/views/legal/accessibility.njk'
if ($null -ne $publicAccessibility) {
    Assert-Contains 'apps/web-uk/src/views/legal/accessibility.njk' $publicAccessibility `
        'accessibility\.limitations_body' `
        'must keep translated limitations visible.'
    Assert-NotContains 'apps/web-uk/src/views/legal/accessibility.njk' $publicAccessibility `
        'accessibility\.features_title|accessibility\.testing_body|accessibility\.commitment_body' `
        'must not publish unsupported feature, commitment, or manual-testing assurances.'
}

$publicHome = Get-DocumentText 'apps/web-uk/src/views/home.njk'
if ($null -ne $publicHome) {
    Assert-NotContains 'apps/web-uk/src/views/home.njk' $publicHome `
        'home\.supporting_text' `
        'must not publish the unsupported Home keyboard/screen-reader assurance.'
}

$productionCompose = Get-DocumentText 'compose.prod.yml'
if ($null -ne $productionCompose) {
    Assert-Contains 'compose.prod.yml' $productionCompose `
        '(?is)DEPLOYMENT HOLD.{0,500}web-uk\s*:.{0,900}API_BASE_URL=http://api:8080' `
        'must retain the deployment hold beside the uncertified Web UK ASP.NET override.'
    Assert-Contains 'compose.prod.yml' $productionCompose `
        '(?i)operator reference only' `
        'must identify the profile as operator reference rather than a production procedure.'
    Assert-NotContains 'compose.prod.yml' $productionCompose `
        '(?im)^#\s*(?:cp\s+compose\.prod|docker\s+compose\s+(?:up|build|down))\b' `
        'must not publish an executable blanket Compose usage recipe.'
}

$webUkCompose = Get-DocumentText 'apps/web-uk/compose.yml'
if ($null -ne $webUkCompose) {
    Assert-Contains 'apps/web-uk/compose.yml' $webUkCompose `
        '(?i)local production-image (?:mode|service)' `
        'must label the prod profile as local production-image testing.'
    Assert-NotContains 'apps/web-uk/compose.yml' $webUkCompose `
        '(?im)^\s*#.*\bProduction (?:mode|service)\b' `
        'must not describe the local profile as a production deployment mode or service.'
}

$historicalDeployNotes = Get-DocumentText 'PHASE63_73_DEPLOY_NOTES.md'
if ($null -ne $historicalDeployNotes) {
    Assert-Contains 'PHASE63_73_DEPLOY_NOTES.md' (Get-OpeningRegion $historicalDeployNotes 16) `
        '(?i)Historical checkpoint.{0,80}do not execute' `
        'must remain quarantined as a non-executable historical checkpoint.'
    Assert-NotContains 'PHASE63_73_DEPLOY_NOTES.md' $historicalDeployNotes `
        '(?im)^\s*(?:sudo\s+)?(?:docker\s+compose|git\s+checkout|dotnet\s+ef)\b' `
        'must not contain executable production, rollback, or migration commands.'
}

$migrationGuide = Get-DocumentText 'docs/database-migrations.md'
if ($null -ne $migrationGuide) {
    Assert-Contains 'docs/database-migrations.md' $migrationGuide `
        '(?is)runtime-only.{0,180}no \.NET SDK|no \.NET SDK.{0,180}runtime-only' `
        'must explain why container EF commands are unsupported.'
    Assert-Contains 'docs/database-migrations.md' $migrationGuide `
        '(?i)verified disposable PostgreSQL' `
        'must require a verified disposable PostgreSQL target for host EF work.'
    Assert-Contains 'docs/database-migrations.md' $migrationGuide `
        '(?is)no executable\s+production migration or restore command' `
        'must fail closed instead of publishing a generic production migration/restore sequence.'
    Assert-NotContains 'docs/database-migrations.md' $migrationGuide `
        '(?im)^\s*(?:make migrate(?:\s|$)|docker compose exec api dotnet ef)' `
        'must not advertise the unsupported Make/container EF workflow.'
}

$legacyMakefile = Get-DocumentText 'Makefile'
if ($null -ne $legacyMakefile) {
    Assert-Contains 'Makefile' $legacyMakefile `
        '(?ms)ifneq \(\$\(filter-out help,\$\(MAKECMDGOALS\)\),\)\s*\$\(error Unsupported legacy Makefile target\.' `
        'must unconditionally reject every explicit target except help.'
    Assert-NotContains 'Makefile' $legacyMakefile `
        'ALLOW_UNSUPPORTED_LEGACY_MAKEFILE' `
        'must not expose a bypass that re-enables unsupported targets.'
}

$quarantinedProductionCompose = Get-DocumentText 'compose.production.yml'
if ($null -ne $quarantinedProductionCompose) {
    Assert-Contains 'compose.production.yml' $quarantinedProductionCompose `
        '(?i)QUARANTINED HISTORICAL INTEGRATION TOPOLOGY' `
        'must clearly quarantine the obsolete whole-stack topology.'
    Assert-Contains 'compose.production.yml' $quarantinedProductionCompose `
        '(?m)^services:\s*\{\}\s*$' `
        'must expose zero executable services.'
}

$quarantinedFullStackCompose = Get-DocumentText 'compose.fullstack.yml'
if ($null -ne $quarantinedFullStackCompose) {
    Assert-Contains 'compose.fullstack.yml' $quarantinedFullStackCompose `
        '(?i)QUARANTINED LEGACY FULL-STACK LOCAL TOPOLOGY' `
        'must clearly quarantine the obsolete duplicate local topology.'
    Assert-Contains 'compose.fullstack.yml' $quarantinedFullStackCompose `
        '(?m)^services:\s*\{\}\s*$' `
        'must expose zero executable services.'
}

$runbook = Get-DocumentText 'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md'
if ($null -ne $runbook) {
    $runbookOpening = ($runbook -split '(?m)^## Historical Published Evidence\s*$')[0]
    Assert-NotContains 'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md' $runbookOpening `
        '\b712/1000\b' `
        'must link the canonical ASP.NET status rather than mirror its live score in maintained opening text.'
    Assert-Contains 'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md' $runbook `
        '(?m)^## Current Remediation Queue\s*$' `
        'must point readers to the canonical per-workstream queues.'
    Assert-NotContains 'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md' $runbook `
        '(?m)^## Workstream [AB]:' `
        'must not expose the stale Workstream A/B snapshots as current top-level queues.'
    Assert-NotContains 'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md' $runbook `
        '(?i)implementation score and certification-confidence score' `
        'must not request competing overall implementation and certification scores.'
    Assert-NotContains 'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md' $runbook `
        '(?i)Current provisional global scores' `
        'must not describe retired checkpoint scores as current.'
}

if ($null -ne $status) {
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        '(?m)^## Finite Ordered Backend Queue\s*$' `
        'must own the live finite backend queue.'
    Assert-Contains 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md' $status `
        '(?m)^8\. \*\*Certify both unchanged clients\.\*\*' `
        'must retain the complete ordered backend queue through package 8.'
}

foreach ($relativePath in @('CLAUDE.md', 'docs/README.md', 'docs/CURRENT_ASPNET_CONTRACT_STATUS.md')) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }
    Assert-NotContains $relativePath $text `
        '(?is)FULL_PARITY_REMEDIATION_RUNBOOK\.md.{0,160}(?:prioritized|ordered)\s+(?:autonomous\s+)?(?:remediation\s+)?(?:work|queue)' `
        'must not assign the live queue to the shared rubric/runbook.'
}

$historicalOpenings = @(
    'docs/CURRENT_LARAVEL_PARITY_HANDOFF.md',
    'apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md'
)
foreach ($relativePath in $historicalOpenings) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }
    $opening = Get-OpeningRegion $text 60
    Assert-NotContains $relativePath $opening `
        '(?i)\b(?:712/1000|710/1000|708/1000|701/1000|698/1000|684/1000|680/1000|663/1000|660/1000|622/1000|688/689|1,709/1,709|1,706/1,706|1,661/1,661)\b|(?:668|663)\s+contracts' `
        'must not copy live workstream scores or generated totals into its archive banner.'
}

$provenanceReferences = @(
    'docs/API_PARITY.md',
    'docs/SCHEMA_PARITY.md',
    'docs/FRONTEND_PARITY.md',
    'docs/LOCALIZATION_PARITY.md',
    'docs/LARAVEL_PARITY_MAP.md'
)
foreach ($relativePath in $provenanceReferences) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }
    $opening = Get-OpeningRegion $text 24
    Assert-Contains $relativePath $opening `
        '903d03d3db78bbf87129ad35728be3b72819acaf' `
        'must identify the exact Laravel source commit for maintained evidence.'
    Assert-Contains $relativePath $opening `
        '(?i)provenance-incomplete' `
        'must quarantine older unprovenanced counts as historical.'
}

$currentScoreDocuments = @(
    'README.md',
    'CLAUDE.md',
    'docs/README.md',
    'docs/ARCHITECTURE.md',
    'docs/CURRENT_ASPNET_CONTRACT_STATUS.md',
    'docs/CURRENT_SCHEMA_READINESS.md',
    'docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md',
    'docs/FULL_PARITY_REMEDIATION_RUNBOOK.md',
    'docs/CURRENT_LARAVEL_PARITY_HANDOFF.md',
    'docs/LARAVEL_PARITY_MAP.md'
)

foreach ($relativePath in $currentScoreDocuments) {
    $text = Get-DocumentText $relativePath
    if ($null -eq $text) { continue }

    $currentRegion = Get-NonHistoricalRegion $text
    if ($null -eq $currentRegion) { continue }

    $currentScoreClaims = [regex]::Matches(
        $currentRegion,
        '(?i)\b(?:current|latest)\s+(?:(?:overall|published|ASP\.NET|fixed-rubric|banked)\s+){0,5}(?:score|bank)\s+(?:is|:)\s+\*{0,2}(?<points>\d{1,4})/1000'
    )
    foreach ($claim in $currentScoreClaims) {
        if ([int]$claim.Groups['points'].Value -ne 712) {
            Add-Failure "${relativePath}: contains a current overall score that contradicts 712/1000."
        }
    }
    Assert-NotContains $relativePath $currentRegion `
        '(?i)Implementation remains\s+\*\*875/1000\*\*' `
        'contains a retired implementation score outside a historical-checkpoint section.'
    Assert-NotContains $relativePath $currentRegion `
        '(?i)Certification confidence (?:advances|remains) to\s+\*\*755/1000\*\*' `
        'contains a retired certification score outside a historical-checkpoint section.'
    Assert-NotContains $relativePath $currentRegion `
        '(?i)combined finish-line estimate is\s+\*\*80%' `
        'contains a retired combined estimate outside a historical-checkpoint section.'
}

if ($failures.Count -gt 0) {
    Write-Host "Documentation consistency check failed ($($failures.Count) issue(s)):" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host " - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host 'Documentation consistency check passed.' -ForegroundColor Green
Write-Host 'Validated D3/D3-R1 pause readiness, audience hubs, canonical scores/state boundaries, green CI evidence, 2x2 architecture, generated provenance, current credentials/ports/config keys, Web UK resume authority, Laravel database safety, and production/deployment quarantines.'
