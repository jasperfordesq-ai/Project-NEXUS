# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [string]$TargetRoot,
    [string]$SourceRoot,
    # The shared React app's i18next catalogs. Explicit, because deriving it
    # from $TargetRoot is what made this comparison silently empty.
    [string]$ReactLocalesRoot,
    [string]$OutDir,
    [string[]]$KeyLocales = @('en')
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
$script:LocalizationParseErrors = New-Object System.Collections.Generic.List[object]

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

if ([string]::IsNullOrWhiteSpace($ReactLocalesRoot)) {
    $ReactLocalesRoot = Join-Path $SourceRoot 'react-frontend\public\locales'
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $TargetRoot 'artifacts\parity\localization'
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Join-KeyPath {
    param([string[]]$Parts)

    return (($Parts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join '.').ToLowerInvariant()
}

function Add-Key {
    param(
        [System.Collections.Generic.List[object]]$Rows,
        [string]$Locale,
        [string]$Namespace,
        [string]$Key,
        [string]$File
    )

    if ([string]::IsNullOrWhiteSpace($Key)) {
        return
    }

    $Rows.Add([pscustomobject]@{
        locale = $Locale.ToLowerInvariant()
        namespace = $Namespace.ToLowerInvariant()
        key = $Key.ToLowerInvariant()
        file = $File
    })
}

function Add-NamespacePresence {
    param(
        [System.Collections.Generic.List[object]]$Rows,
        [string]$Locale,
        [string]$Namespace,
        [string]$File
    )

    Add-Key $Rows $Locale $Namespace '__namespace_present__' $File
}

function Add-JsonKeys {
    param(
        [System.Collections.Generic.List[object]]$Rows,
        [string]$Locale,
        [string]$Namespace,
        [object]$Node,
        [string[]]$Prefix,
        [string]$File
    )

    if ($null -eq $Node) {
        Add-Key $Rows $Locale $Namespace (Join-KeyPath $Prefix) $File
        return
    }

    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($property in $Node.PSObject.Properties) {
            Add-JsonKeys $Rows $Locale $Namespace $property.Value @($Prefix + $property.Name) $File
        }
        return
    }

    if ($Node -is [System.Collections.IDictionary]) {
        foreach ($key in $Node.Keys) {
            Add-JsonKeys $Rows $Locale $Namespace $Node[$key] @($Prefix + [string]$key) $File
        }
        return
    }

    if ($Node -is [System.Collections.IEnumerable] -and -not ($Node -is [string])) {
        $index = 0
        foreach ($item in $Node) {
            Add-JsonKeys $Rows $Locale $Namespace $item @($Prefix + [string]$index) $File
            $index++
        }
        return
    }

    Add-Key $Rows $Locale $Namespace (Join-KeyPath $Prefix) $File
}

function Get-PhpTranslationKeys {
    param([string]$File)

    $keys = New-Object System.Collections.Generic.List[string]
    $stack = New-Object System.Collections.Generic.List[string]
    $lines = Get-Content -LiteralPath $File

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('//') -or $trimmed.StartsWith('/*') -or $trimmed.StartsWith('*')) {
            continue
        }

        while ($trimmed -match '^\s*\]') {
            if ($stack.Count -gt 0) {
                $stack.RemoveAt($stack.Count - 1)
            }
            $trimmed = ($trimmed -replace '^\s*\]\s*,?', '').Trim()
            if ($trimmed.Length -eq 0) {
                break
            }
        }

        $match = [regex]::Match($trimmed, '^[\''"]([^''"]+)[\''"]\s*=>\s*(.*)$')
        if (-not $match.Success) {
            continue
        }

        $key = $match.Groups[1].Value
        $value = $match.Groups[2].Value.Trim()
        if ($value.StartsWith('[') -or $value.StartsWith('array(')) {
            $stack.Add($key)
            continue
        }

        $keys.Add((Join-KeyPath @($stack.ToArray() + $key)))
    }

    return @($keys | Sort-Object -Unique)
}

function Get-JsonLikeTranslationKeys {
    param([string]$File)

    $keys = New-Object System.Collections.Generic.List[string]
    $stack = New-Object System.Collections.Generic.List[string]
    $lines = Get-Content -LiteralPath $File

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0) {
            continue
        }

        while ($trimmed.StartsWith('}') -or $trimmed.StartsWith(']')) {
            if ($stack.Count -gt 0) {
                $stack.RemoveAt($stack.Count - 1)
            }
            $trimmed = $trimmed.Substring(1).TrimStart(',', ' ', "`t")
            if ($trimmed.Length -eq 0) {
                break
            }
        }

        $match = [regex]::Match($trimmed, '^"([^"]+)"\s*:\s*(.*)$')
        if (-not $match.Success) {
            continue
        }

        $key = $match.Groups[1].Value
        $value = $match.Groups[2].Value.Trim()
        if ($value.StartsWith('{') -or $value.StartsWith('[')) {
            $stack.Add($key)
            continue
        }

        $keys.Add((Join-KeyPath @($stack.ToArray() + $key)))
    }

    return @($keys | Sort-Object -Unique)
}

function Get-LocalizationKeys {
    param(
        [string]$Root,
        [string]$RelativeRoot,
        [string]$Origin,
        [string[]]$ScannedLocales
    )

    $localeRoot = Join-Path $Root $RelativeRoot
    if (-not (Test-Path -LiteralPath $localeRoot)) {
        # IMPORTANT: this used to `return @()`. Combined with the dead
        # apps\react-frontend path below, that produced a complete,
        # plausible-looking "zero localization parity" report - 0 locales, 0
        # namespaces, 0 keys, and every Laravel key listed as missing - and
        # exited 0. A zero here must mean an empty directory, never an absent
        # one.
        throw "Localization root not found at '$localeRoot'. Refusing to report zero keys for a directory that does not exist; pass the correct root."
    }

    $rows = New-Object System.Collections.Generic.List[object]
    $scannedLocaleIndex = @{}
    foreach ($locale in $ScannedLocales) {
        $scannedLocaleIndex[$locale.ToLowerInvariant()] = $true
    }

    Get-ChildItem -LiteralPath $localeRoot -Directory |
        ForEach-Object {
            $locale = $_.Name.ToLowerInvariant()
            Get-ChildItem -LiteralPath $_.FullName -File -Include '*.json','*.php' |
                ForEach-Object {
                    $file = $_
                    $namespace = [System.IO.Path]::GetFileNameWithoutExtension($file.Name).ToLowerInvariant()
                    Add-NamespacePresence $rows $locale $namespace $file.FullName

                    if ($scannedLocaleIndex.ContainsKey($locale)) {
                        if ($file.Extension.Equals('.json', [StringComparison]::OrdinalIgnoreCase)) {
                            try {
                                $json = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
                                Add-JsonKeys $rows $locale $namespace $json @() $file.FullName
                            } catch {
                                $script:LocalizationParseErrors.Add([pscustomobject]@{
                                    locale = $locale
                                    namespace = $namespace
                                    file = $file.FullName
                                    error = $_.Exception.Message
                                })
                                foreach ($key in Get-JsonLikeTranslationKeys $file.FullName) {
                                    Add-Key $rows $locale $namespace $key $file.FullName
                                }
                            }
                        } elseif ($file.Extension.Equals('.php', [StringComparison]::OrdinalIgnoreCase)) {
                            foreach ($key in Get-PhpTranslationKeys $file.FullName) {
                                Add-Key $rows $locale $namespace $key $file.FullName
                            }
                        }
                    }
                }
        }

    return @($rows.ToArray())
}

function New-SourceIndex {
    param([object[]]$Rows)

    $index = @{}
    foreach ($row in $Rows) {
        if ($row.key -eq '__namespace_present__') {
            continue
        }
        $key = "$($row.locale)|$($row.namespace)|$($row.key)"
        if (-not $index.ContainsKey($key)) {
            $index[$key] = New-Object System.Collections.Generic.List[object]
        }
        $index[$key].Add($row)
    }

    return $index
}

function New-LocaleMatrix {
    param(
        [object[]]$SourceRows,
        [object[]]$TargetRows
    )

    $sourceLocales = @($SourceRows | ForEach-Object { $_.locale } | Sort-Object -Unique)
    $targetLocales = @($TargetRows | ForEach-Object { $_.locale } | Sort-Object -Unique)
    $all = @($sourceLocales + $targetLocales | Sort-Object -Unique)
    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($locale in $all) {
        $inSource = $sourceLocales -contains $locale
        $inTarget = $targetLocales -contains $locale
        $status = if ($inSource -and $inTarget) {
            'matched'
        } elseif ($inSource) {
            'missing'
        } else {
            'extra-dotnet'
        }

        $rows.Add([pscustomobject]@{
            locale = $locale
            status = $status
        })
    }

    return @($rows.ToArray())
}

function New-NamespaceMatrix {
    param(
        [object[]]$SourceRows,
        [object[]]$TargetRows
    )

    $sourcePairs = @($SourceRows | ForEach-Object { "$($_.locale)|$($_.namespace)" } | Sort-Object -Unique)
    $targetPairs = @($TargetRows | ForEach-Object { "$($_.locale)|$($_.namespace)" } | Sort-Object -Unique)
    $all = @($sourcePairs + $targetPairs | Sort-Object -Unique)
    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($pair in $all) {
        $parts = $pair -split '\|', 2
        $inSource = $sourcePairs -contains $pair
        $inTarget = $targetPairs -contains $pair
        $status = if ($inSource -and $inTarget) {
            'matched'
        } elseif ($inSource) {
            'missing'
        } else {
            'extra-dotnet'
        }

        $rows.Add([pscustomobject]@{
            locale = $parts[0]
            namespace = $parts[1]
            status = $status
        })
    }

    return @($rows.ToArray())
}

function New-KeyMatrix {
    param(
        [object[]]$SourceRows,
        [object[]]$TargetRows,
        [object[]]$NamespaceMatrix
    )

    $matchedNamespaces = @{}
    foreach ($row in $NamespaceMatrix | Where-Object { $_.status -eq 'matched' }) {
        $matchedNamespaces["$($row.locale)|$($row.namespace)"] = $true
    }

    $sourceIndex = New-SourceIndex $SourceRows
    $targetIndex = New-SourceIndex $TargetRows
    $allKeyIndex = @{}
    foreach ($key in $sourceIndex.Keys) {
        $allKeyIndex[$key] = $true
    }
    foreach ($key in $targetIndex.Keys) {
        $allKeyIndex[$key] = $true
    }
    $allKeys = @($allKeyIndex.Keys)
    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($compound in $allKeys) {
        $parts = $compound -split '\|', 3
        $namespaceKey = "$($parts[0])|$($parts[1])"
        if (-not $matchedNamespaces.ContainsKey($namespaceKey)) {
            continue
        }

        $inSource = $sourceIndex.ContainsKey($compound)
        $inTarget = $targetIndex.ContainsKey($compound)
        $status = if ($inSource -and $inTarget) {
            'matched'
        } elseif ($inSource) {
            'missing'
        } else {
            'extra-dotnet'
        }

        $sourceFiles = if ($inSource) {
            (($sourceIndex[$compound].ToArray() | ForEach-Object { $_.file } | Sort-Object -Unique) -join ';')
        } else {
            ''
        }
        $targetFiles = if ($inTarget) {
            (($targetIndex[$compound].ToArray() | ForEach-Object { $_.file } | Sort-Object -Unique) -join ';')
        } else {
            ''
        }

        $rows.Add([pscustomobject]@{
            locale = $parts[0]
            namespace = $parts[1]
            key = $parts[2]
            status = $status
            source_files = $sourceFiles
            target_files = $targetFiles
        })
    }

    return @($rows.ToArray())
}

function Count-Unique {
    param(
        [object[]]$Rows,
        [scriptblock]$Selector
    )

    $index = @{}
    foreach ($row in $Rows) {
        $key = & $Selector $row
        if (-not [string]::IsNullOrWhiteSpace($key) -and [string]$key -notmatch '\|__namespace_present__$|^__namespace_present__$') {
            $index[[string]$key] = $true
        }
    }

    return $index.Count
}

function Count-Status {
    param(
        [object[]]$Rows,
        [string]$Status
    )

    return @($Rows | Where-Object { $_.status -eq $Status }).Count
}

function Write-MarkdownReport {
    param(
        [object]$Summary,
        [object[]]$LocaleMatrix,
        [object[]]$NamespaceMatrix,
        [object[]]$KeyMatrix,
        [object[]]$ParseErrors,
        [string]$Path
    )

    $missingLocales = @($LocaleMatrix | Where-Object { $_.status -eq 'missing' })
    $missingNamespaces = @($NamespaceMatrix | Where-Object { $_.status -eq 'missing' })
    $missingKeys = @($KeyMatrix | Where-Object { $_.status -eq 'missing' })
    $lines = New-Object System.Collections.Generic.List[string]

    $lines.Add('# Localization Parity Report')
    $lines.Add('')
    $lines.Add("Generated: $($Summary.generated_at)")
    $lines.Add('')
    $lines.Add('| Metric | Count |')
    $lines.Add('| --- | ---: |')
    $lines.Add("| Key-scanned locales | $($Summary.key_scanned_locales) |")
    $lines.Add("| Laravel locales | $($Summary.laravel_locales) |")
    $lines.Add("| .NET locales | $($Summary.dotnet_locales) |")
    $lines.Add("| Matched locales | $($Summary.matched_locales) |")
    $lines.Add("| Missing locales | $($Summary.missing_locales) |")
    $lines.Add("| Extra .NET locales | $($Summary.extra_dotnet_locales) |")
    $lines.Add("| Laravel locale namespaces | $($Summary.laravel_locale_namespaces) |")
    $lines.Add("| .NET locale namespaces | $($Summary.dotnet_locale_namespaces) |")
    $lines.Add("| Matched locale namespaces | $($Summary.matched_locale_namespaces) |")
    $lines.Add("| Missing locale namespaces | $($Summary.missing_locale_namespaces) |")
    $lines.Add("| Extra .NET locale namespaces | $($Summary.extra_dotnet_locale_namespaces) |")
    $lines.Add("| Matched keys | $($Summary.matched_keys) |")
    $lines.Add("| Missing keys | $($Summary.missing_keys) |")
    $lines.Add("| Extra .NET keys | $($Summary.extra_dotnet_keys) |")
    $lines.Add("| Parse-error files | $($Summary.parse_error_files) |")
    $lines.Add('')
    $lines.Add('## Missing Locales')
    $lines.Add('')
    if ($missingLocales.Count -eq 0) {
        $lines.Add('No missing locales found by this static comparison.')
    } else {
        foreach ($row in $missingLocales) {
            $lines.Add(('- `{0}`' -f $row.locale))
        }
    }

    $lines.Add('')
    $lines.Add('## Missing Locale Namespaces')
    $lines.Add('')
    if ($missingNamespaces.Count -eq 0) {
        $lines.Add('No missing locale namespaces found by this static comparison.')
    } else {
        $lines.Add('| Locale | Namespace |')
        $lines.Add('| --- | --- |')
        foreach ($row in $missingNamespaces | Select-Object -First 100) {
            $lines.Add(('| {0} | `{1}` |' -f $row.locale, $row.namespace))
        }
    }

    $lines.Add('')
    $lines.Add('## Missing Keys In Matched Namespaces')
    $lines.Add('')
    if ($missingKeys.Count -eq 0) {
        $lines.Add('No missing keys found by this static comparison.')
    } else {
        $lines.Add('| Locale | Namespace | Key |')
        $lines.Add('| --- | --- | --- |')
        foreach ($row in $missingKeys | Select-Object -First 150) {
            $lines.Add(('| {0} | `{1}` | `{2}` |' -f $row.locale, $row.namespace, $row.key))
        }
    }

    $lines.Add('')
    $lines.Add('## Parse Errors')
    $lines.Add('')
    if ($ParseErrors.Count -eq 0) {
        $lines.Add('No locale parse errors found by this static comparison.')
    } else {
        $lines.Add('| Locale | Namespace | File | Error |')
        $lines.Add('| --- | --- | --- | --- |')
        foreach ($row in $ParseErrors | Select-Object -First 50) {
            $message = ([string]$row.error) -replace '\r?\n', ' '
            if ($message.Length -gt 160) {
                $message = $message.Substring(0, 160) + '...'
            }
            $lines.Add(('| {0} | `{1}` | `{2}` | {3} |' -f $row.locale, $row.namespace, $row.file, $message))
        }
    }

    $lines | Set-Content -LiteralPath $Path
}

try {
    Ensure-Directory $OutDir

    $sourceRows = @(Get-LocalizationKeys $SourceRoot 'lang' 'laravel' $KeyLocales)
    # The shared React app's i18next catalogs. Unlike the route comparison in
    # audit-platform-parity.ps1, this IS a genuine two-sided comparison - Laravel
    # lang/ files against the frontend's catalogs, both of which exist - so it is
    # repointed, not retired.
    #
    # IMPORTANT: this read <TargetRoot>\apps\react-frontend\public\locales until
    # 2026-08-10. That app was deleted upstream in f27412bb, and $TargetRoot is
    # aspnet-backend/ in any case, so it never resolved.
    $targetRows = @(Get-LocalizationKeys $ReactLocalesRoot '' 'dotnet' $KeyLocales)
    $sourceKeyRows = @($sourceRows | Where-Object { $_.key -ne '__namespace_present__' })
    $targetKeyRows = @($targetRows | Where-Object { $_.key -ne '__namespace_present__' })
    $localeMatrix = New-LocaleMatrix $sourceRows $targetRows
    $namespaceMatrix = New-NamespaceMatrix $sourceRows $targetRows
    $keyMatrix = New-KeyMatrix $sourceKeyRows $targetKeyRows $namespaceMatrix

    $summary = [pscustomobject]@{
        generated_at = (Get-Date).ToString('o')
        target_root = $TargetRoot
        source_root = $SourceRoot
        key_scanned_locales = (($KeyLocales | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique) -join ',')
        laravel_locales = Count-Unique $sourceRows { param($row) $row.locale }
        dotnet_locales = Count-Unique $targetRows { param($row) $row.locale }
        matched_locales = Count-Status $localeMatrix 'matched'
        missing_locales = Count-Status $localeMatrix 'missing'
        extra_dotnet_locales = Count-Status $localeMatrix 'extra-dotnet'
        laravel_locale_namespaces = Count-Unique $sourceRows { param($row) ('{0}|{1}' -f $row.locale, $row.namespace) }
        dotnet_locale_namespaces = Count-Unique $targetRows { param($row) ('{0}|{1}' -f $row.locale, $row.namespace) }
        matched_locale_namespaces = Count-Status $namespaceMatrix 'matched'
        missing_locale_namespaces = Count-Status $namespaceMatrix 'missing'
        extra_dotnet_locale_namespaces = Count-Status $namespaceMatrix 'extra-dotnet'
        laravel_keys = Count-Unique $sourceKeyRows { param($row) ('{0}|{1}|{2}' -f $row.locale, $row.namespace, $row.key) }
        dotnet_keys = Count-Unique $targetKeyRows { param($row) ('{0}|{1}|{2}' -f $row.locale, $row.namespace, $row.key) }
        matched_keys = Count-Status $keyMatrix 'matched'
        missing_keys = Count-Status $keyMatrix 'missing'
        extra_dotnet_keys = Count-Status $keyMatrix 'extra-dotnet'
        parse_error_files = $script:LocalizationParseErrors.Count
    }

    $report = [pscustomobject]@{
        summary = $summary
        locale_matrix = $localeMatrix
        namespace_matrix = $namespaceMatrix
        key_matrix = $keyMatrix
        parse_errors = @($script:LocalizationParseErrors.ToArray())
    }

    $jsonPath = Join-Path $OutDir 'localization-parity.json'
    $markdownPath = Join-Path $OutDir 'localization-parity.md'
    $localeCsvPath = Join-Path $OutDir 'localization-locales.csv'
    $namespaceCsvPath = Join-Path $OutDir 'localization-namespaces.csv'
    $keyCsvPath = Join-Path $OutDir 'localization-keys.csv'

    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath
    $localeMatrix | Export-Csv -LiteralPath $localeCsvPath -NoTypeInformation
    $namespaceMatrix | Export-Csv -LiteralPath $namespaceCsvPath -NoTypeInformation
    $keyMatrix | Export-Csv -LiteralPath $keyCsvPath -NoTypeInformation
    Write-MarkdownReport $summary $localeMatrix $namespaceMatrix $keyMatrix @($script:LocalizationParseErrors.ToArray()) $markdownPath

    $summary | Format-List
    Write-Host "Localization parity report written to $jsonPath"
    Write-Host "Localization parity markdown written to $markdownPath"
} catch {
    Write-Error "Localization parity comparison failed at line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
    throw
}
