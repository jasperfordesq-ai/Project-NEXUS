# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

#
# Every consumer root is an explicit, validated parameter.
#
# 🔴 This script used to accept only -SourceRoot / -TargetRoot and derive the
# consumer directories from them, and BOTH derivations were dead:
#   - Get-WebUkRoutes looked under <TargetRoot>\apps\web-uk\src. web-uk/ became
#     a top-level sibling in the 2026-08-09 monorepo move.
#   - Get-ReactRoutes was asked for <TargetRoot>\apps\react-frontend\src, which
#     was deliberately deleted upstream in f27412bb ("delete dead
#     apps/react-frontend and its wiring") because there is now ONE React
#     frontend serving both backends.
# Both helpers returned an empty collection for a missing directory, so the
# script reported "0 routes, nothing missing" and exited 0. That is the whole
# reason it could be green while comparing nothing. Missing roots are now a
# hard failure — see Assert-ConsumerRoot.
#
[CmdletBinding()]
param(
    [string]$TargetRoot,
    [string]$SourceRoot,
    # The single shared React frontend. Inventoried, not compared: there is no
    # second React app to compare it against, by design.
    [string]$ReactRoot,
    # The Web UK accessible frontend, a sibling of aspnet-backend/.
    [string]$WebUkRoot,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

if ([string]::IsNullOrWhiteSpace($ReactRoot)) {
    $ReactRoot = Join-Path $SourceRoot 'react-frontend\src'
}

if ([string]::IsNullOrWhiteSpace($WebUkRoot)) {
    $WebUkRoot = Join-Path $SourceRoot 'web-uk\src'
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $TargetRoot 'artifacts\parity\frontend'
}

function Assert-ConsumerRoot {
    param(
        [string]$Name,
        [string]$Path,
        [string]$RequiredFile
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Name not found at '$Path'. This comparison is meaningless without it; pass the correct root rather than letting it report zero routes."
    }

    if ($RequiredFile) {
        $full = Join-Path $Path $RequiredFile
        if (-not (Test-Path -LiteralPath $full)) {
            throw "$Name at '$Path' is missing '$RequiredFile'. Refusing to report an empty comparison."
        }
    }
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
        [string]$ReactSrcRoot,
        [string]$Origin
    )

    Assert-ConsumerRoot 'React frontend' $ReactSrcRoot

    $reactRoot = $ReactSrcRoot

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
    param([string]$WebRoot)

    # Caller has already asserted this exists; keep the guard as a contract
    # check rather than a silent `return @()`.
    Assert-ConsumerRoot 'Web UK frontend' $WebRoot 'server.js'

    $rows = New-Object System.Collections.Generic.List[object]
    $serverPath = Join-Path $WebRoot 'server.js'

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
    $lines.Add("| Shared React routes (inventory only) | $($Summary.shared_react_routes) |")
    $lines.Add("| Laravel accessible routes | $($Summary.laravel_accessible_routes) |")
    $lines.Add("| .NET accessible routes | $($Summary.dotnet_accessible_routes) |")
    $lines.Add("| Accessible matched routes | $($Summary.accessible_matched_routes) |")
    $lines.Add("| Accessible missing routes | $($Summary.accessible_missing_routes) |")
    $lines.Add("| Accessible extra routes | $($Summary.accessible_extra_routes) |")
    $lines.Add('')
    $lines.Add('React is a single frontend shared by both backends, so it is')
    $lines.Add('inventoried rather than compared; there is no second React app to')
    $lines.Add('compare it against. Only the accessible surface is a two-sided')
    $lines.Add('comparison. Every root above is asserted to exist before this report')
    $lines.Add('is written, so a zero here means zero routes, never a missing folder.')
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

    # React is a SINGLE shared consumer: one app that must work against either
    # backend. It is inventoried, never compared — a Laravel-side vs .NET-side
    # React comparison stopped being a real question when apps/react-frontend
    # was deleted (f27412bb), and reporting one would be invented evidence.
    $sharedReactRoutes = @(Get-ReactRoutes $ReactRoot 'shared')

    # The accessible surface IS a genuine two-sided comparison: Laravel's
    # accessible frontend routes against the Web UK Express routes.
    $sourceRoutes = @(Get-LaravelAccessibleRoutes $SourceRoot)
    $targetRoutes = @(Get-WebUkRoutes $WebUkRoot)

    if ($sourceRoutes.Count -eq 0) {
        throw "No Laravel accessible routes found under '$SourceRoot'. Refusing to report a comparison against nothing."
    }
    if ($targetRoutes.Count -eq 0) {
        throw "No Web UK routes found under '$WebUkRoot'. Refusing to report a comparison against nothing."
    }

    $matrix = New-ParityMatrix $sourceRoutes $targetRoutes

    $summary = [pscustomobject]@{
        generated_at = (Get-Date).ToString('o')
        target_root = $TargetRoot
        source_root = $SourceRoot
        react_root = $ReactRoot
        web_uk_root = $WebUkRoot
        shared_react_routes = $sharedReactRoutes.Count
        react_comparison = 'not-applicable-single-shared-frontend'
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
