# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [string]$TargetRoot,
    [string]$SourceRoot,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $TargetRoot 'artifacts\parity\frontend'
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Normalize-FrontendPath {
    param([AllowNull()][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return '/'
    }

    $normalized = $Path.Trim().Trim('"', "'")
    $normalized = $normalized -replace '\\', '/'
    $normalized = $normalized -replace '[?#].*$', ''
    $normalized = $normalized -replace '\{[^}/]+\}', '{param}'
    $normalized = $normalized -replace ':[A-Za-z0-9_]+', '{param}'
    $normalized = $normalized -replace '/+', '/'
    $normalized = $normalized.TrimEnd('/')

    if ($normalized.Length -eq 0) {
        return '/'
    }

    if (-not $normalized.StartsWith('/')) {
        $normalized = "/$normalized"
    }

    return $normalized.ToLowerInvariant()
}

function Join-FrontendPath {
    param(
        [string]$Prefix,
        [string]$Child
    )

    if ([string]::IsNullOrWhiteSpace($Prefix)) {
        return Normalize-FrontendPath $Child
    }

    if ([string]::IsNullOrWhiteSpace($Child) -or $Child -eq '/') {
        return Normalize-FrontendPath $Prefix
    }

    $combined = (($Prefix.Trim('/'), $Child.Trim('/')) | Where-Object { $_ }) -join '/'
    return Normalize-FrontendPath $combined
}

function Add-Route {
    param(
        [System.Collections.Generic.List[object]]$Rows,
        [string]$Origin,
        [string]$Surface,
        [string]$Detail,
        [string]$Method,
        [string]$Path,
        [string]$File
    )

    $normalized = Normalize-FrontendPath $Path
    $Rows.Add([pscustomobject]@{
        origin = $Origin
        surface = $Surface
        detail = $Detail
        method = $Method.ToUpperInvariant()
        path = $normalized
        file = $File
    })
}

function Compress-Routes {
    param([object[]]$Routes)

    $index = @{}
    foreach ($route in $Routes) {
        $key = "$($route.origin)|$($route.surface)|$($route.method)|$($route.path)"
        if (-not $index.ContainsKey($key)) {
            $index[$key] = New-Object System.Collections.Generic.List[object]
        }
        $index[$key].Add($route)
    }

    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($entry in $index.GetEnumerator()) {
        $parts = $entry.Key -split '\|', 4
        $sources = @($entry.Value.ToArray())
        $rows.Add([pscustomobject]@{
            origin = $parts[0]
            surface = $parts[1]
            method = $parts[2]
            path = $parts[3]
            details = (($sources | ForEach-Object { $_.detail } | Sort-Object -Unique) -join ';')
            files = (($sources | ForEach-Object { $_.file } | Sort-Object -Unique) -join ';')
        })
    }

    return @($rows | Sort-Object origin, surface, method, path)
}

function Get-ReactRouteDetail {
    param(
        [string]$ReactRoot,
        [string]$FilePath
    )

    $relative = $FilePath.Substring($ReactRoot.Length).TrimStart('\', '/')
    if ($relative -match '(^|[\\/])super-admin[\\/]') {
        return @{ Detail = 'react-super-admin'; Prefix = '/super-admin' }
    }
    if ($relative -match '(^|[\\/])partner-timebanks[\\/]') {
        return @{ Detail = 'react-partner-timebanks'; Prefix = '/partner-timebanks' }
    }
    if ($relative -match '(^|[\\/])broker[\\/]') {
        return @{ Detail = 'react-broker'; Prefix = '/broker' }
    }
    if ($relative -match '(^|[\\/])admin[\\/]') {
        return @{ Detail = 'react-admin'; Prefix = '/admin' }
    }

    return @{ Detail = 'react-member'; Prefix = '' }
}

function Get-ReactRoutes {
    param(
        [string]$Root,
        [string]$RelativeRoot,
        [string]$Origin
    )

    $reactRoot = Join-Path $Root $RelativeRoot
    if (-not (Test-Path -LiteralPath $reactRoot)) {
        return @()
    }

    $rows = New-Object System.Collections.Generic.List[object]
    $pathPattern = '<Route\s+[^>]*\bpath\s*=\s*["'']([^"'']+)["'']'
    $indexPattern = '<Route\s+[^>]*\bindex\b'

    Get-ChildItem -LiteralPath $reactRoot -Recurse -Include '*.tsx','*.ts','*.jsx','*.js' -File |
        Where-Object { $_.FullName -notmatch '\.(test|spec)\.' } |
        ForEach-Object {
            $file = $_
            $text = Get-Content -Raw -LiteralPath $file.FullName
            $routeInfo = Get-ReactRouteDetail $reactRoot $file.FullName

            foreach ($match in [regex]::Matches($text, $pathPattern)) {
                $path = Join-FrontendPath $routeInfo.Prefix $match.Groups[1].Value
                Add-Route $rows $Origin 'react' $routeInfo.Detail 'GET' $path $file.FullName
            }

            foreach ($match in [regex]::Matches($text, $indexPattern)) {
                $path = if ([string]::IsNullOrWhiteSpace($routeInfo.Prefix)) { '/' } else { $routeInfo.Prefix }
                Add-Route $rows $Origin 'react' $routeInfo.Detail 'GET' $path $file.FullName
            }
        }

    return Compress-Routes $rows
}

function Get-LaravelAccessibleRoutes {
    param([string]$Root)

    $routeRoot = Join-Path $Root 'routes'
    if (-not (Test-Path -LiteralPath $routeRoot)) {
        return @()
    }

    $rows = New-Object System.Collections.Generic.List[object]
    $files = New-Object System.Collections.Generic.List[object]
    $govukAlpha = Join-Path $routeRoot 'govuk-alpha.php'
    if (Test-Path -LiteralPath $govukAlpha) {
        $files.Add((Get-Item -LiteralPath $govukAlpha))
    }

    $parityRoot = Join-Path $routeRoot 'govuk-alpha-parity'
    if (Test-Path -LiteralPath $parityRoot) {
        Get-ChildItem -LiteralPath $parityRoot -Recurse -Filter '*.php' -File |
            ForEach-Object { $files.Add($_) }
    }

    $routePattern = 'Route::(get|post|put|patch|delete|view)\s*\(\s*[''"]([^''"]+)[''"]'
    foreach ($file in $files) {
        $text = Get-Content -Raw -LiteralPath $file.FullName
        foreach ($match in [regex]::Matches($text, $routePattern, 'IgnoreCase')) {
            $method = if ($match.Groups[1].Value.Equals('view', [StringComparison]::OrdinalIgnoreCase)) {
                'GET'
            } else {
                $match.Groups[1].Value.ToUpperInvariant()
            }
            Add-Route $rows 'laravel' 'accessible' 'laravel-govuk-alpha' $method $match.Groups[2].Value $file.FullName
        }
    }

    return Compress-Routes $rows
}

function Get-WebUkRoutes {
    param([string]$Root)

    $webRoot = Join-Path $Root 'apps\web-uk\src'
    if (-not (Test-Path -LiteralPath $webRoot)) {
        return @()
    }

    $rows = New-Object System.Collections.Generic.List[object]
    $serverPath = Join-Path $webRoot 'server.js'
    if (-not (Test-Path -LiteralPath $serverPath)) {
        return @()
    }

    $serverText = Get-Content -Raw -LiteralPath $serverPath
    $directPattern = 'app\.(get|post|put|patch|delete)\s*\(\s*[''"]([^''"]+)[''"]'
    foreach ($match in [regex]::Matches($serverText, $directPattern, 'IgnoreCase')) {
        Add-Route $rows 'dotnet' 'accessible' 'web-uk-direct' $match.Groups[1].Value $match.Groups[2].Value $serverPath
    }

    $requireMap = @{}
    $requirePattern = 'const\s+([A-Za-z0-9_]+)\s*=\s*require\(\s*[''"]\.\/routes\/([^''"]+)[''"]\s*\)'
    foreach ($match in [regex]::Matches($serverText, $requirePattern)) {
        $requireMap[$match.Groups[1].Value] = "$($match.Groups[2].Value).js"
    }

    $usePattern = 'app\.use\s*\(\s*[''"]([^''"]+)[''"]\s*,[^\r\n;]*\b([A-Za-z0-9_]+)\s*\)'
    foreach ($match in [regex]::Matches($serverText, $usePattern)) {
        $prefix = $match.Groups[1].Value
        $variable = $match.Groups[2].Value
        if (-not $requireMap.ContainsKey($variable)) {
            continue
        }

        $routeFile = Join-Path (Join-Path $webRoot 'routes') $requireMap[$variable]
        if (-not (Test-Path -LiteralPath $routeFile)) {
            continue
        }

        $routeText = Get-Content -Raw -LiteralPath $routeFile
        $routerPattern = 'router\.(get|post|put|patch|delete)\s*\(\s*[''"]([^''"]+)[''"]'
        foreach ($routeMatch in [regex]::Matches($routeText, $routerPattern, 'IgnoreCase')) {
            $path = Join-FrontendPath $prefix $routeMatch.Groups[2].Value
            Add-Route $rows 'dotnet' 'accessible' 'web-uk-router' $routeMatch.Groups[1].Value $path $routeFile
        }
    }

    return Compress-Routes $rows
}

function New-RouteIndex {
    param([object[]]$Routes)

    $index = @{}
    foreach ($route in $Routes) {
        $key = "$($route.surface)|$($route.method)|$($route.path)"
        if (-not $index.ContainsKey($key)) {
            $index[$key] = New-Object System.Collections.Generic.List[object]
        }
        $index[$key].Add($route)
    }

    return $index
}

function Get-IndexRows {
    param(
        [hashtable]$Index,
        [string]$Key
    )

    if (-not $Index.ContainsKey($Key)) {
        return @()
    }

    return @($Index[$Key].ToArray())
}

function New-ParityMatrix {
    param(
        [object[]]$SourceRoutes,
        [object[]]$TargetRoutes
    )

    $sourceIndex = New-RouteIndex $SourceRoutes
    $targetIndex = New-RouteIndex $TargetRoutes
    $seen = @{}
    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($route in $SourceRoutes) {
        $key = "$($route.surface)|$($route.method)|$($route.path)"
        $seen[$key] = $true
        $targets = @(Get-IndexRows $targetIndex $key)
        $status = if ($targets.Count -gt 0) { 'matched' } else { 'missing' }

        $rows.Add([pscustomobject]@{
            surface = $route.surface
            method = $route.method
            path = $route.path
            status = $status
            source_details = $route.details
            target_details = (($targets | ForEach-Object { $_.details } | Sort-Object -Unique) -join ';')
            source_files = $route.files
            target_files = (($targets | ForEach-Object { $_.files } | Sort-Object -Unique) -join ';')
        })
    }

    foreach ($route in $TargetRoutes) {
        $key = "$($route.surface)|$($route.method)|$($route.path)"
        if ($seen.ContainsKey($key) -or $sourceIndex.ContainsKey($key)) {
            continue
        }

        $rows.Add([pscustomobject]@{
            surface = $route.surface
            method = $route.method
            path = $route.path
            status = 'extra-dotnet'
            source_details = ''
            target_details = $route.details
            source_files = ''
            target_files = $route.files
        })
    }

    return @($rows | Sort-Object surface, status, method, path)
}

function Count-Matrix {
    param(
        [object[]]$Matrix,
        [string]$Surface,
        [string]$Status
    )

    return @($Matrix | Where-Object { $_.surface -eq $Surface -and $_.status -eq $Status }).Count
}

function Count-Routes {
    param(
        [object[]]$Routes,
        [string]$Surface
    )

    return @($Routes | Where-Object { $_.surface -eq $Surface }).Count
}

function Write-MarkdownReport {
    param(
        [object]$Summary,
        [object[]]$Matrix,
        [string]$Path
    )

    $missing = @($Matrix | Where-Object { $_.status -eq 'missing' })
    $extra = @($Matrix | Where-Object { $_.status -eq 'extra-dotnet' })
    $lines = New-Object System.Collections.Generic.List[string]

    $lines.Add('# Frontend Route Parity Report')
    $lines.Add('')
    $lines.Add("Generated: $($Summary.generated_at)")
    $lines.Add('')
    $lines.Add('| Metric | Count |')
    $lines.Add('| --- | ---: |')
    $lines.Add("| Laravel React routes | $($Summary.laravel_react_routes) |")
    $lines.Add("| .NET React routes | $($Summary.dotnet_react_routes) |")
    $lines.Add("| React matched routes | $($Summary.react_matched_routes) |")
    $lines.Add("| React missing routes | $($Summary.react_missing_routes) |")
    $lines.Add("| React extra routes | $($Summary.react_extra_routes) |")
    $lines.Add("| Laravel accessible routes | $($Summary.laravel_accessible_routes) |")
    $lines.Add("| .NET accessible routes | $($Summary.dotnet_accessible_routes) |")
    $lines.Add("| Accessible matched routes | $($Summary.accessible_matched_routes) |")
    $lines.Add("| Accessible missing routes | $($Summary.accessible_missing_routes) |")
    $lines.Add("| Accessible extra routes | $($Summary.accessible_extra_routes) |")
    $lines.Add('')
    $lines.Add('## Missing Source Routes')
    $lines.Add('')

    if ($missing.Count -eq 0) {
        $lines.Add('No missing frontend routes found by this static comparison.')
    } else {
        $lines.Add('| Surface | Method | Path | Source files |')
        $lines.Add('| --- | --- | --- | --- |')
        foreach ($row in $missing) {
            $lines.Add("| $($row.surface) | $($row.method) | `$($row.path)` | `$($row.source_files)` |")
        }
    }

    $lines.Add('')
    $lines.Add('## Extra .NET Routes')
    $lines.Add('')

    if ($extra.Count -eq 0) {
        $lines.Add('No .NET-only frontend routes found by this static comparison.')
    } else {
        $lines.Add('| Surface | Method | Path | Target files |')
        $lines.Add('| --- | --- | --- | --- |')
        foreach ($row in $extra) {
            $lines.Add("| $($row.surface) | $($row.method) | `$($row.path)` | `$($row.target_files)` |")
        }
    }

    $lines | Set-Content -LiteralPath $Path
}

try {
    Ensure-Directory $OutDir

    $sourceReactRoutes = @(Get-ReactRoutes $SourceRoot 'react-frontend\src' 'laravel')
    $targetReactRoutes = @(Get-ReactRoutes $TargetRoot 'apps\react-frontend\src' 'dotnet')
    $sourceAccessibleRoutes = @(Get-LaravelAccessibleRoutes $SourceRoot)
    $targetAccessibleRoutes = @(Get-WebUkRoutes $TargetRoot)
    $sourceRoutes = @($sourceReactRoutes + $sourceAccessibleRoutes)
    $targetRoutes = @($targetReactRoutes + $targetAccessibleRoutes)
    $matrix = New-ParityMatrix $sourceRoutes $targetRoutes

    $summary = [pscustomobject]@{
        generated_at = (Get-Date).ToString('o')
        target_root = $TargetRoot
        source_root = $SourceRoot
        laravel_react_routes = Count-Routes $sourceRoutes 'react'
        dotnet_react_routes = Count-Routes $targetRoutes 'react'
        react_matched_routes = Count-Matrix $matrix 'react' 'matched'
        react_missing_routes = Count-Matrix $matrix 'react' 'missing'
        react_extra_routes = Count-Matrix $matrix 'react' 'extra-dotnet'
        laravel_accessible_routes = Count-Routes $sourceRoutes 'accessible'
        dotnet_accessible_routes = Count-Routes $targetRoutes 'accessible'
        accessible_matched_routes = Count-Matrix $matrix 'accessible' 'matched'
        accessible_missing_routes = Count-Matrix $matrix 'accessible' 'missing'
        accessible_extra_routes = Count-Matrix $matrix 'accessible' 'extra-dotnet'
    }

    $report = [pscustomobject]@{
        summary = $summary
        matrix = $matrix
    }

    $jsonPath = Join-Path $OutDir 'frontend-parity.json'
    $markdownPath = Join-Path $OutDir 'frontend-parity.md'
    $csvPath = Join-Path $OutDir 'frontend-parity.csv'

    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath
    $matrix | Export-Csv -LiteralPath $csvPath -NoTypeInformation
    Write-MarkdownReport $summary $matrix $markdownPath

    $summary | Format-List
    Write-Host "Frontend parity report written to $jsonPath"
    Write-Host "Frontend parity markdown written to $markdownPath"
} catch {
    Write-Error "Frontend parity comparison failed at line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
    throw
}
