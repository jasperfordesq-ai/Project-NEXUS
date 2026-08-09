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
    $OutDir = Join-Path $TargetRoot 'artifacts\parity\schema'
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Normalize-TableName {
    param([AllowNull()][string]$Table)

    if ([string]::IsNullOrWhiteSpace($Table)) {
        return ''
    }

    return ($Table.Trim().Trim('"', "'") -replace '\s+', '').ToLowerInvariant()
}

function Add-TableSource {
    param(
        [hashtable]$Index,
        [string]$Table,
        [string]$Kind,
        [string]$File
    )

    $normalized = Normalize-TableName $Table
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return
    }

    if (-not $Index.ContainsKey($normalized)) {
        $Index[$normalized] = New-Object System.Collections.Generic.List[object]
    }

    $Index[$normalized].Add([pscustomobject]@{
        kind = $Kind
        file = $File
    })
}

function Get-UniqueTableCount {
    param(
        [object[]]$Rows,
        [string]$Kind
    )

    return @($Rows | Where-Object { $_.kind -eq $Kind } | ForEach-Object { $_.table } | Sort-Object -Unique).Count
}

function Convert-IndexToRows {
    param([hashtable]$Index)

    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($entry in $Index.GetEnumerator()) {
        foreach ($source in $entry.Value) {
            $rows.Add([pscustomobject]@{
                table = $entry.Key
                kind = $source.kind
                file = $source.file
            })
        }
    }

    return @($rows | Sort-Object table, kind, file)
}

function Get-LaravelSchemaEvidence {
    param([string]$Root)

    $migrationRoot = Join-Path $Root 'database\migrations'
    if (-not (Test-Path -LiteralPath $migrationRoot)) {
        throw "Laravel migration root not found: $migrationRoot"
    }

    $index = @{}
    $migrations = @(Get-ChildItem -LiteralPath $migrationRoot -Recurse -Filter '*.php' -File)
    $schemaPattern = 'Schema::(create|table)\s*\(\s*[''"]([^''"]+)[''"]'

    foreach ($file in $migrations) {
        $text = Get-Content -Raw -LiteralPath $file.FullName
        foreach ($match in [regex]::Matches($text, $schemaPattern, 'IgnoreCase')) {
            $kind = if ($match.Groups[1].Value.Equals('create', [StringComparison]::OrdinalIgnoreCase)) {
                'migration-create'
            } else {
                'migration-table'
            }

            Add-TableSource $index $match.Groups[2].Value $kind $file.FullName
        }
    }

    $modelsRoot = Join-Path $Root 'app\Models'
    if (Test-Path -LiteralPath $modelsRoot) {
        $tablePattern = '(?:protected|public)\s+\$table\s*=\s*[''"]([^''"]+)[''"]\s*;'
        Get-ChildItem -LiteralPath $modelsRoot -Recurse -Filter '*.php' -File |
            ForEach-Object {
                $file = $_
                $text = Get-Content -Raw -LiteralPath $file.FullName
                foreach ($match in [regex]::Matches($text, $tablePattern, 'IgnoreCase')) {
                    Add-TableSource $index $match.Groups[1].Value 'model-table' $file.FullName
                }
            }
    }

    $rows = Convert-IndexToRows $index
    return [pscustomobject]@{
        migrations = $migrations.Count
        rows = $rows
    }
}

function Get-AspNetSchemaEvidence {
    param([string]$Root)

    $apiRoot = Join-Path $Root 'src\Nexus.Api'
    if (-not (Test-Path -LiteralPath $apiRoot)) {
        throw "ASP.NET API root not found: $apiRoot"
    }

    $index = @{}
    $toTablePattern = '\.ToTable\s*\(\s*"([^"]+)"'
    $tableAttributePattern = '\[Table\s*\(\s*"([^"]+)"'
    $createTablePattern = 'CreateTable\s*\(\s*name:\s*"([^"]+)"'

    Get-ChildItem -LiteralPath $apiRoot -Recurse -Filter '*.cs' -File |
        Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } |
        ForEach-Object {
            $file = $_
            $text = Get-Content -Raw -LiteralPath $file.FullName
            foreach ($match in [regex]::Matches($text, $toTablePattern)) {
                Add-TableSource $index $match.Groups[1].Value 'ef-totable' $file.FullName
            }

            foreach ($match in [regex]::Matches($text, $tableAttributePattern)) {
                Add-TableSource $index $match.Groups[1].Value 'table-attribute' $file.FullName
            }

            foreach ($match in [regex]::Matches($text, $createTablePattern)) {
                Add-TableSource $index $match.Groups[1].Value 'migration-create' $file.FullName
            }
        }

    $migrationRoot = Join-Path $apiRoot 'Migrations'
    $migrationCount = 0
    if (Test-Path -LiteralPath $migrationRoot) {
        $migrationCount = @(Get-ChildItem -LiteralPath $migrationRoot -Filter '*.cs' -File |
            Where-Object { $_.Name -notlike '*.Designer.cs' -and $_.Name -notlike '*ModelSnapshot.cs' }).Count
    }

    $rows = Convert-IndexToRows $index
    return [pscustomobject]@{
        migrations = $migrationCount
        rows = $rows
    }
}

function New-TableMatrix {
    param(
        [object[]]$LaravelRows,
        [object[]]$AspNetRows
    )

    $laravelTables = @{}
    $aspNetTables = @{}

    foreach ($row in $LaravelRows) {
        if (-not $laravelTables.ContainsKey($row.table)) {
            $laravelTables[$row.table] = New-Object System.Collections.Generic.List[object]
        }
        $laravelTables[$row.table].Add($row)
    }

    foreach ($row in $AspNetRows) {
        if (-not $aspNetTables.ContainsKey($row.table)) {
            $aspNetTables[$row.table] = New-Object System.Collections.Generic.List[object]
        }
        $aspNetTables[$row.table].Add($row)
    }

    $allTables = @($laravelTables.Keys + $aspNetTables.Keys | Sort-Object -Unique)
    $matrix = New-Object System.Collections.Generic.List[object]

    foreach ($table in $allTables) {
        $inLaravel = $laravelTables.ContainsKey($table)
        $inAspNet = $aspNetTables.ContainsKey($table)
        $status = if ($inLaravel -and $inAspNet) {
            'matched'
        } elseif ($inLaravel) {
            'missing'
        } else {
            'extra-aspnet'
        }

        $laravelSources = if ($inLaravel) {
            @($laravelTables[$table].ToArray())
        } else {
            @()
        }
        $aspNetSources = if ($inAspNet) {
            @($aspNetTables[$table].ToArray())
        } else {
            @()
        }

        $matrix.Add([pscustomobject]@{
            table = $table
            status = $status
            laravel_kinds = (($laravelSources | ForEach-Object { $_.kind } | Sort-Object -Unique) -join ';')
            aspnet_kinds = (($aspNetSources | ForEach-Object { $_.kind } | Sort-Object -Unique) -join ';')
            laravel_files = (($laravelSources | ForEach-Object { $_.file } | Sort-Object -Unique) -join ';')
            aspnet_files = (($aspNetSources | ForEach-Object { $_.file } | Sort-Object -Unique) -join ';')
        })
    }

    return @($matrix | Sort-Object status, table)
}

function Write-MarkdownReport {
    param(
        [object]$Summary,
        [object[]]$Matrix,
        [string]$Path
    )

    $missing = @($Matrix | Where-Object { $_.status -eq 'missing' })
    $extra = @($Matrix | Where-Object { $_.status -eq 'extra-aspnet' })
    $lines = New-Object System.Collections.Generic.List[string]

    $lines.Add('# Schema Parity Report')
    $lines.Add('')
    $lines.Add("Generated: $($Summary.generated_at)")
    $lines.Add('')
    $lines.Add('| Metric | Count |')
    $lines.Add('| --- | ---: |')
    $lines.Add("| Laravel migrations | $($Summary.laravel_migrations) |")
    $lines.Add("| ASP.NET EF migrations | $($Summary.aspnet_migrations) |")
    $lines.Add("| Laravel created tables | $($Summary.laravel_created_tables) |")
    $lines.Add("| Laravel touched tables | $($Summary.laravel_touched_tables) |")
    $lines.Add("| Laravel explicit model tables | $($Summary.laravel_model_tables) |")
    $lines.Add("| Laravel source tables | $($Summary.laravel_source_tables) |")
    $lines.Add("| ASP.NET tables | $($Summary.aspnet_tables) |")
    $lines.Add("| Matched tables | $($Summary.matched_tables) |")
    $lines.Add("| Missing Laravel tables | $($Summary.missing_tables) |")
    $lines.Add("| Extra ASP.NET tables | $($Summary.extra_aspnet_tables) |")
    $lines.Add('')
    $lines.Add('## Missing Laravel Tables')
    $lines.Add('')

    if ($missing.Count -eq 0) {
        $lines.Add('No missing Laravel tables found by this static comparison.')
    } else {
        $lines.Add('| Table | Laravel source kinds | Laravel files |')
        $lines.Add('| --- | --- | --- |')
        foreach ($row in $missing) {
            $lines.Add(('| `{0}` | {1} | `{2}` |' -f $row.table, $row.laravel_kinds, $row.laravel_files))
        }
    }

    $lines.Add('')
    $lines.Add('## Extra ASP.NET Tables')
    $lines.Add('')

    if ($extra.Count -eq 0) {
        $lines.Add('No ASP.NET-only tables found by this static comparison.')
    } else {
        $lines.Add('| Table | ASP.NET source kinds | ASP.NET files |')
        $lines.Add('| --- | --- | --- |')
        foreach ($row in $extra) {
            $lines.Add(('| `{0}` | {1} | `{2}` |' -f $row.table, $row.aspnet_kinds, $row.aspnet_files))
        }
    }

    $lines | Set-Content -LiteralPath $Path
}

try {
    Ensure-Directory $OutDir

    $laravelEvidence = Get-LaravelSchemaEvidence $SourceRoot
    $aspNetEvidence = Get-AspNetSchemaEvidence $TargetRoot
    $laravelRows = @($laravelEvidence.rows)
    $aspNetRows = @($aspNetEvidence.rows)
    $matrix = New-TableMatrix $laravelRows $aspNetRows

    $summary = [pscustomobject]@{
        generated_at = (Get-Date).ToString('o')
        target_root = $TargetRoot
        source_root = $SourceRoot
        laravel_migrations = $laravelEvidence.migrations
        aspnet_migrations = $aspNetEvidence.migrations
        laravel_created_tables = Get-UniqueTableCount $laravelRows 'migration-create'
        laravel_touched_tables = Get-UniqueTableCount $laravelRows 'migration-table'
        laravel_model_tables = Get-UniqueTableCount $laravelRows 'model-table'
        laravel_source_tables = @($laravelRows | ForEach-Object { $_.table } | Sort-Object -Unique).Count
        aspnet_tables = @($aspNetRows | ForEach-Object { $_.table } | Sort-Object -Unique).Count
        matched_tables = @($matrix | Where-Object { $_.status -eq 'matched' }).Count
        missing_tables = @($matrix | Where-Object { $_.status -eq 'missing' }).Count
        extra_aspnet_tables = @($matrix | Where-Object { $_.status -eq 'extra-aspnet' }).Count
    }

    $report = [pscustomobject]@{
        summary = $summary
        matrix = $matrix
    }

    $jsonPath = Join-Path $OutDir 'schema-parity.json'
    $markdownPath = Join-Path $OutDir 'schema-parity.md'
    $csvPath = Join-Path $OutDir 'schema-parity.csv'

    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath
    $matrix | Export-Csv -LiteralPath $csvPath -NoTypeInformation
    Write-MarkdownReport $summary $matrix $markdownPath

    $summary | Format-List
    Write-Host "Schema parity report written to $jsonPath"
    Write-Host "Schema parity markdown written to $markdownPath"
} catch {
    Write-Error "Schema parity comparison failed at line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
    throw
}
