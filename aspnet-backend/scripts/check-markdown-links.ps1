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
$gitPaths = & git -C $root ls-files --cached --others --exclude-standard -- '*.md'
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to enumerate repository Markdown files with git ls-files.'
}

$markdownPaths = @($gitPaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$failures = [System.Collections.Generic.List[string]]::new()
$linkCount = 0

foreach ($relativeMarkdownPath in $markdownPaths) {
    $markdownPath = Join-Path $root $relativeMarkdownPath
    if (-not (Test-Path -LiteralPath $markdownPath -PathType Leaf)) { continue }

    $text = [System.IO.File]::ReadAllText($markdownPath)
    $matches = [regex]::Matches(
        $text,
        '(?m)!?\[[^\]]*\]\((?<target><[^>]+>|[^\s\)]+)(?:\s+["''][^"'']*["''])?\)'
    )

    foreach ($match in $matches) {
        $target = $match.Groups['target'].Value.Trim('<', '>')
        if ($target -match '^(?i:https?|mailto|data|javascript):' -or
            $target.StartsWith('#') -or
            $target.StartsWith('/')) {
            continue
        }

        $target = ($target -split '[#?]', 2)[0]
        if ([string]::IsNullOrWhiteSpace($target)) { continue }
        if ([System.IO.Path]::IsPathRooted($target)) { continue }

        $linkCount++
        $decodedTarget = [uri]::UnescapeDataString($target).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $candidate = [System.IO.Path]::GetFullPath(
            (Join-Path (Split-Path -Parent $markdownPath) $decodedTarget)
        )
        if (-not (Test-Path -LiteralPath $candidate)) {
            $lineNumber = 1 + ([regex]::Matches($text.Substring(0, $match.Index), "`n")).Count
            $failures.Add("${relativeMarkdownPath}:${lineNumber}: missing relative link target '$target'")
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host "Markdown link check failed ($($failures.Count) missing target(s)):" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host " - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host 'Markdown link check passed.' -ForegroundColor Green
Write-Host "Validated $linkCount relative link(s) across $($markdownPaths.Count) Markdown file(s)."
