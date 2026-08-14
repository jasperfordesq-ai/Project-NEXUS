# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

#
# Every consumer root is an explicit, validated parameter.
#
# IMPORTANT: This script used to accept only -SourceRoot / -TargetRoot and derive the
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
# hard failure - see Assert-ConsumerRoot.
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

# [!] The Laravel Blade accessible frontend this reads was DELETED on 2026-08-14, so the
# route files below no longer exist and this function returned an EMPTY list. The caller's
# guard then threw "Refusing to report a comparison against nothing" and failed the
# Platform contracts workflow -- correct behaviour, and the reason this was caught.
#
# The final Blade route inventory is frozen at
# web-uk/scripts/blade-route-inventory.frozen.json (707 routes, captured while Blade still
# existed) and is read when the live files are absent, which is now always. That keeps the
# accessible comparison genuinely two-sided: web-uk's live Express routes against what the
# accessible frontend served on the day Blade was retired.
#
# Do NOT "fix" this by deleting the guard or by letting an empty source pass. The guard
# exists so a vacuous comparison can never be reported as parity evidence.
function Get-FrozenBladeAccessibleRoutes {
    param([string]$Root)

    $frozen = Join-Path $Root 'web-uk/scripts/blade-route-inventory.frozen.json'
    if (-not (Test-Path -LiteralPath $frozen)) {
        return @()
    }

    $inventory = Get-Content -Raw -LiteralPath $frozen | ConvertFrom-Json
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($route in $inventory.routes) {
        Add-Route $rows 'laravel' 'accessible' 'laravel-blade-frozen-inventory' $route.method $route.path $frozen
    }

    return Compress-Routes $rows
}

function Get-LaravelAccessibleRoutes {
    param([string]$Root)

    $routeRoot = Join-Path $Root 'routes'
    if (-not (Test-Path -LiteralPath $routeRoot)) {
        return (Get-FrozenBladeAccessibleRoutes $Root)
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

    # [!] THIS is the branch that actually fires after the 2026-08-14 Blade removal, not the
    # missing-`routes/` check above: `routes/` still exists (api.php, web.php, console.php
    # all live there) -- it is only the two govuk-alpha entries that are gone. So the
    # directory test passes, `$files` is empty, the regex loop finds nothing, and the
    # function returns an empty list. Fall back here or the caller's guard throws.
    if ($files.Count -eq 0) {
        return (Get-FrozenBladeAccessibleRoutes $Root)
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
        [object[]]$Inventory,
        [string]$Path
    )

    $lines = New-Object System.Collections.Generic.List[string]

    $lines.Add('# Frontend Route Inventory')
    $lines.Add('')
    $lines.Add("Generated: $($Summary.generated_at)")
    $lines.Add('')
    $lines.Add('| Metric | Count |')
    $lines.Add('| --- | ---: |')
    $lines.Add("| Shared React routes (inventory only) | $($Summary.shared_react_routes) |")
    $lines.Add("| Laravel accessible routes (frozen Blade snapshot) | $($Summary.laravel_accessible_routes) |")
    $lines.Add("| Web UK accessible routes | $($Summary.web_uk_accessible_routes) |")
    $lines.Add('')
    $lines.Add('## Why there are no matched/missing/extra counts here')
    $lines.Add('')
    $lines.Add('**Neither surface in this report is a comparison. Both are inventories.**')
    $lines.Add('')
    $lines.Add('React is a single frontend shared by both backends, so there is no second')
    $lines.Add('React app to compare it against.')
    $lines.Add('')
    $lines.Add('The accessible surface stopped being a two-sided comparison on 2026-08-14,')
    $lines.Add('when the Laravel Blade accessible frontend was deleted. The Laravel side above')
    $lines.Add('is a frozen snapshot of what Blade served on its final day')
    $lines.Add('(`web-uk/scripts/blade-route-inventory.frozen.json`), not live code.')
    $lines.Add('')
    $lines.Add('[!] **The authoritative accessible route comparison is')
    $lines.Add('`npm --prefix web-uk run route:matrix`**, which compares web-uk against that')
    $lines.Add('same snapshot with matching path normalisation and reports 707 matched, 0')
    $lines.Add('missing. It is enforced by `scripts/check-generated-artefacts-current.js`.')
    $lines.Add('')
    $lines.Add('This report deliberately does not publish a second, contradictory verdict.')
    $lines.Add('Measured on 2026-08-14, comparing here reported 406 accessible routes')
    $lines.Add('"missing" and 376 "extra" -- because this script''s Web UK route scraper')
    $lines.Add('under-discovers Express routes (`/about` and `/accessibility` both came back')
    $lines.Add('"missing" while plainly existing). Publishing that alongside 707/0 would be')
    $lines.Add('invented evidence.')
    $lines.Add('')
    $lines.Add('Every root above is asserted to exist before this report is written, so a zero')
    $lines.Add('here means zero routes, never a missing folder.')

    $lines | Set-Content -LiteralPath $Path
}

try {
    Ensure-Directory $OutDir

    # React is a SINGLE shared consumer: one app that must work against either
    # backend. It is inventoried, never compared - a Laravel-side vs .NET-side
    # React comparison stopped being a real question when apps/react-frontend
    # was deleted (f27412bb), and reporting one would be invented evidence.
    $sharedReactRoutes = @(Get-ReactRoutes $ReactRoot 'shared')

    # [!] The accessible surface is now INVENTORIED, NOT COMPARED -- the same treatment, for
    # the same reason, that React above already gets.
    #
    # It was a genuine two-sided comparison while the Laravel Blade accessible frontend
    # existed. Blade was deleted on 2026-08-14, so the Laravel side is now a frozen
    # snapshot (web-uk/scripts/blade-route-inventory.frozen.json) rather than live code.
    #
    # [!] Do not restore the comparison here, and specifically do not restore it by
    # deleting the guards below. Measured on 2026-08-14, feeding the frozen snapshot into
    # this comparison reported 406 accessible routes "missing" and 376 "extra" -- while
    # `npm --prefix web-uk run route:matrix`, against the SAME snapshot, reports 707
    # matched and 0 missing. The difference is `Get-WebUkRoutes` under-discovering
    # web-uk's Express routes: `/about` and `/accessibility` came back "missing" when both
    # plainly exist. That inaccuracy was invisible before, because with an empty Laravel
    # side the guard threw and no numbers were ever produced.
    #
    # So there is exactly ONE authoritative accessible route comparison, and it is
    # `npm --prefix web-uk run route:matrix` (checked by
    # scripts/check-generated-artefacts-current.js). Reporting a second, weaker one that
    # contradicts it would be invented evidence -- precisely what the React note above
    # refuses to do.
    $sourceRoutes = @(Get-LaravelAccessibleRoutes $SourceRoot)
    $targetRoutes = @(Get-WebUkRoutes $WebUkRoot)

    # Both guards stay. They no longer gate a comparison, but an empty inventory still
    # means the scrapers have silently stopped finding anything, and that must fail loudly
    # rather than publish zeroes.
    if ($sourceRoutes.Count -eq 0) {
        throw "No Laravel accessible routes found under '$SourceRoot' and no frozen Blade inventory at web-uk/scripts/blade-route-inventory.frozen.json. Refusing to report an inventory of nothing."
    }
    if ($targetRoutes.Count -eq 0) {
        throw "No Web UK routes found under '$WebUkRoot'. Refusing to report an inventory of nothing."
    }

    $summary = [pscustomobject]@{
        generated_at = (Get-Date).ToString('o')
        target_root = $TargetRoot
        source_root = $SourceRoot
        react_root = $ReactRoot
        web_uk_root = $WebUkRoot
        shared_react_routes = $sharedReactRoutes.Count
        react_comparison = 'not-applicable-single-shared-frontend'
        laravel_accessible_routes = Count-Routes $sourceRoutes 'accessible'
        web_uk_accessible_routes = Count-Routes $targetRoutes 'accessible'
        accessible_comparison = 'not-applicable-blade-removed-2026-08-14-see-web-uk-route-matrix'
        accessible_source = 'frozen-blade-inventory'
    }

    # An INVENTORY, not a matrix: every row is labelled with the side it came from and
    # carries no matched/missing/extra verdict. The `status` field is deliberately absent
    # so nothing downstream can read a verdict that was never computed.
    $inventory = New-Object System.Collections.Generic.List[object]
    foreach ($row in $sourceRoutes) { $inventory.Add($row) }
    foreach ($row in $targetRoutes) { $inventory.Add($row) }

    $report = [pscustomobject]@{
        summary = $summary
        inventory = $inventory
    }

    $jsonPath = Join-Path $OutDir 'frontend-parity.json'
    $markdownPath = Join-Path $OutDir 'frontend-parity.md'
    $csvPath = Join-Path $OutDir 'frontend-parity.csv'

    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath
    $inventory | Export-Csv -LiteralPath $csvPath -NoTypeInformation
    Write-MarkdownReport $summary $inventory $markdownPath

    $summary | Format-List
    Write-Host "Frontend parity report written to $jsonPath"
    Write-Host "Frontend parity markdown written to $markdownPath"
} catch {
    Write-Error "Frontend parity comparison failed at line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
    throw
}
