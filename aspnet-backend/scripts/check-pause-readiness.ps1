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

$root = [IO.Path]::GetFullPath($RepositoryRoot)
$failures = [Collections.Generic.List[string]]::new()

function Add-Failure {
    param([Parameter(Mandatory)][string]$Message)
    $script:failures.Add($Message)
}

function Invoke-GitLines {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = @(& git -C $root @Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed."
    }
    return @($output)
}

try {
    $branch = (Invoke-GitLines @('branch', '--show-current') | Select-Object -First 1)
    if ($branch -ne 'main') {
        Add-Failure "Current branch must be main (found '$branch')."
    }

    $localBranches = @(Invoke-GitLines @('for-each-ref', '--format=%(refname:short)', 'refs/heads'))
    if ($localBranches.Count -ne 1 -or $localBranches[0] -ne 'main') {
        Add-Failure "Local branches must contain main only (found: $($localBranches -join ', '))."
    }

    $worktreeLines = @(Invoke-GitLines @('worktree', 'list', '--porcelain') |
        Where-Object { $_ -like 'worktree *' })
    if ($worktreeLines.Count -ne 1) {
        Add-Failure "Exactly one worktree must remain (found $($worktreeLines.Count))."
    }
    elseif ([IO.Path]::GetFullPath($worktreeLines[0].Substring(9)) -ne $root) {
        Add-Failure "The sole worktree must be the repository root (found '$($worktreeLines[0])')."
    }

    $stashes = @(Invoke-GitLines @('stash', 'list'))
    if ($stashes.Count -ne 0) {
        Add-Failure "Stash list must be empty (found $($stashes.Count))."
    }

    $status = @(Invoke-GitLines @('status', '--porcelain=v1', '--untracked-files=all'))
    if ($status.Count -ne 0) {
        Add-Failure "Working tree must be clean (found: $($status -join '; '))."
    }

    $head = (Invoke-GitLines @('rev-parse', 'HEAD') | Select-Object -First 1)
    $originMain = (Invoke-GitLines @('rev-parse', 'origin/main') | Select-Object -First 1)
    if ($head -ne $originMain) {
        Add-Failure "HEAD must equal origin/main (HEAD $head; origin/main $originMain)."
    }

    $allowedRemoteBranches = @(
        'origin',
        'origin/HEAD',
        'origin/main',
        'origin/dependabot/github_actions/docker/setup-buildx-action-4',
        'origin/dependabot/npm_and_yarn/apps/web-uk/npm_and_yarn-7f2e6e7f81'
    )
    $remoteBranches = @(Invoke-GitLines @('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'))
    $unexpectedRemoteBranches = @($remoteBranches | Where-Object { $_ -notin $allowedRemoteBranches })
    $missingRemoteBranches = @($allowedRemoteBranches | Where-Object { $_ -notin $remoteBranches })
    # Some Git versions omit the symbolic origin/HEAD from for-each-ref.
    $missingRemoteBranches = @($missingRemoteBranches | Where-Object { $_ -ne 'origin/HEAD' })
    if ($unexpectedRemoteBranches.Count -gt 0) {
        Add-Failure "Unexpected remote branches remain: $($unexpectedRemoteBranches -join ', ')."
    }
    if ($missingRemoteBranches.Count -gt 0) {
        Add-Failure "Expected pause-time remote branches are missing: $($missingRemoteBranches -join ', ')."
    }

    $archiveTargets = [ordered]@{
        'archive/pre-pause/reaudit-0459' = 'aa9c2264fb38fd097bdf9d228a6003820fc6b495'
        'archive/pre-pause/reaudit-0514' = '875761c3bb039c345678ae49390ad3352984ccd0'
        'archive/pre-pause/webuk-org-prototype-latest' = '98865d3c2008ad06a95c0539987b8483a266be27'
        'archive/pre-pause/webuk-org-prototype-earlier' = '978c12dd32292fb73835e3cf5c027f406706b57f'
        'archive/pre-pause/webuk-resource-prototype' = 'eedc63da4e0bc865be5014f936a43c3cbbdf527a'
        'archive/pre-pause/schema-parity-final' = '97b8a4a004362aef8356e8d76333f1efc9d44b36'
        'archive/pre-pause/webuk-laravel-parity-final' = '699530a59aedcf62cb392fd2b9154136b7a36a63'
        'archive/pre-pause/legacy-master-tip' = '82f63a1f38c941d3c6770b0d24244fbe5e68ed86'
        'archive/pre-pause/stash-schema-current-lineage' = '4ee270c40abbea36d1e82e988925e7a20019a3df'
        'archive/pre-pause/stash-schema-verein-slice' = '77a963e64f0950ba87d9546d64492fb0720698e3'
        'archive/pre-pause/stash-webuk-org-replayed' = 'e8ed59d0069855d3aedd526e02f9fe99d2d95deb'
        'archive/pre-pause/stash-webuk-org-before-backend' = '69df388d3696aa18e920272b743dd9c5077b2d1e'
        'archive/pre-pause/stash-webuk-regenerated' = '98187b826a5f38154739f83489fd8b83399bb4df'
        'archive/pre-pause/stash-webuk-before-backend' = '14c3850fae6dd264ebb6f5de51311fa138f49a2a'
        'archive/pre-pause/stash-fix2-wip' = '34e61aeb90a134f54e4f97f22171d61b891939b5'
        'archive/pre-pause/stash-api-partners-wip' = 'd36769bc3befa238251de9404f55adddd1bf4bac'
        'archive/pre-pause/unfinished-ci-sharding' = 'e1018a3434a152f9dc7a952effcfacb9cf3a8f6b'
        'archive/pre-pause/ci-sharding-candidate' = 'a0ab8ed290e07efe2ceaa4babc3d66535f9dc892'
    }
    foreach ($entry in $archiveTargets.GetEnumerator()) {
        $matchingTag = @(Invoke-GitLines @('tag', '--list', $entry.Key))
        if ($matchingTag.Count -eq 0) {
            Add-Failure "Missing required archive tag '$($entry.Key)'."
            continue
        }
        $resolved = @(Invoke-GitLines @('rev-parse', "$($entry.Key)^{}"))
        if ($resolved[0] -ne $entry.Value) {
            Add-Failure "Archive tag '$($entry.Key)' points to $($resolved[0]), expected $($entry.Value)."
        }
    }

    # Every closed pause boundary is pinned here and must never move. When a new
    # pause is established, pin the outgoing current tag into this table and set
    # $currentPauseTagName to the new one. Do not repoint an existing tag.
    $historicalPauseTags = [ordered]@{
        'pause/2026-07-15' = '84d7eefc7a79202aae55d4a47b899023d1747d2c'
        'pause/2026-07-15-final' = '896aac9477e772bd4b4fef39bf25ba9fd413838a'
        'pause/2026-08-09' = '1c83801ac2f84f4760f51a3050b856bf1b987b23'
    }

    # The newest dated pause tag marks the current clean boundary and must sit at
    # HEAD. It is expected to be absent from HEAD while authorized work is in
    # flight; that is ordinary progress, not damage.
    $currentPauseTagName = 'pause/2026-08-09-final'

    foreach ($entry in $historicalPauseTags.GetEnumerator()) {
        $matchingTag = @(Invoke-GitLines @('tag', '--list', $entry.Key))
        if ($matchingTag.Count -eq 0) {
            Add-Failure "Missing historical annotated tag '$($entry.Key)'."
            continue
        }
        $tagType = @(Invoke-GitLines @('cat-file', '-t', $entry.Key))
        if ($tagType[0] -ne 'tag') {
            Add-Failure "Historical $($entry.Key) must be an annotated tag."
        }
        $resolved = @(Invoke-GitLines @('rev-parse', "$($entry.Key)^{}"))
        if ($resolved[0] -ne $entry.Value) {
            Add-Failure "Historical tag $($entry.Key) moved from $($entry.Value) (found $($resolved[0]))."
        }
    }

    $matchingCurrentPauseTag = @(Invoke-GitLines @('tag', '--list', $currentPauseTagName))
    if ($matchingCurrentPauseTag.Count -eq 0) {
        Add-Failure "Missing current annotated pause tag '$currentPauseTagName'."
    }
    else {
        $currentPauseTagType = @(Invoke-GitLines @('cat-file', '-t', $currentPauseTagName))
        if ($currentPauseTagType[0] -ne 'tag') {
            Add-Failure "Current $currentPauseTagName must be an annotated tag."
        }
        $currentPauseTag = @(Invoke-GitLines @('rev-parse', "$currentPauseTagName^{}"))
        if ($currentPauseTag[0] -ne $head) {
            Add-Failure "Tag $currentPauseTagName must point to HEAD $head (found $($currentPauseTag[0]))."
        }
    }

    foreach ($debrisPath in @('_nul', 'cmd.exe')) {
        if (Test-Path -LiteralPath (Join-Path $root $debrisPath)) {
            Add-Failure "Ignored scratch path remains: $debrisPath."
        }
    }
    $malformedRobocopy = @(Get-ChildItem -LiteralPath $root -Force |
        Where-Object { $_.Name -like 'robocopy*' })
    if ($malformedRobocopy.Count -gt 0) {
        Add-Failure "Malformed robocopy scratch path remains: $($malformedRobocopy.Name -join ', ')."
    }

    & (Join-Path $PSScriptRoot 'check-documentation-consistency.ps1') -RepositoryRoot $root
    if ($LASTEXITCODE -ne 0) {
        Add-Failure 'Documentation consistency check failed.'
    }
    & (Join-Path $PSScriptRoot 'check-markdown-links.ps1') -RepositoryRoot $root
    if ($LASTEXITCODE -ne 0) {
        Add-Failure 'Markdown link check failed.'
    }
}
catch {
    Add-Failure $_.Exception.Message
}

if ($failures.Count -gt 0) {
    Write-Error ("Pause readiness check failed:`n - " + ($failures -join "`n - "))
    exit 1
}

Write-Host 'Pause readiness check passed.'
Write-Host 'Validated one clean main worktree, no local topic branches or stashes, HEAD=origin/main, intentional remote heads only, exact archive tags, immutable historical pause tags, current dated pause tag at HEAD, debris removal, documentation consistency, and Markdown links.'
