# Copyright (c) 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [ValidateRange(1, 128)]
    [int]$ShardCount = 48,

    [ValidateRange(1, 128)]
    [int]$ShardIndex = 1,

    [ValidateRange(1, 128)]
    [int]$SliceCount = 1,

    [ValidateRange(1, 128)]
    [int]$SliceIndex = 1,

    [ValidateRange(30, 3600)]
    # The fixture applies the complete migration chain before its first
    # integration case. On constrained Windows hosts that one-time setup can
    # legitimately exceed five minutes without a completed-test heartbeat.
    [int]$HangTimeoutSeconds = 900,

    [switch]$ListOnly,

    [string]$ManifestPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testProject = Join-Path $repoRoot 'tests\Nexus.Api.Tests\Nexus.Api.Tests.csproj'

if ($ShardIndex -gt $ShardCount) {
    throw "ShardIndex ($ShardIndex) cannot exceed ShardCount ($ShardCount)."
}
if ($SliceIndex -gt $SliceCount) {
    throw "SliceIndex ($SliceIndex) cannot exceed SliceCount ($SliceCount)."
}

function Get-TestMethods {
    $output = @(& dotnet test $testProject `
        --configuration Release `
        --no-restore `
        --no-build `
        --list-tests `
        --verbosity quiet 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Test discovery failed with exit code $LASTEXITCODE.`n$($output -join [Environment]::NewLine)"
    }

    $tests = foreach ($line in $output) {
        $name = $line.ToString().Trim()
        if (!$name.StartsWith('Nexus.Api.Tests.', [StringComparison]::Ordinal)) {
            continue
        }

        $methodBase = $name.Split('(')[0].TrimEnd()
        $lastDot = $methodBase.LastIndexOf('.')
        if ($lastDot -le 0) {
            throw "Could not derive a test class from '$name'."
        }

        [pscustomobject]@{
            Name = $name
            MethodName = $methodBase
            ClassName = $methodBase.Substring(0, $lastDot)
        }
    }

    if (!$tests) {
        throw 'Test discovery returned no Nexus.Api.Tests test cases.'
    }

    return @($tests | Group-Object MethodName | ForEach-Object {
        [pscustomobject]@{
            MethodName = $_.Name
            ClassName = $_.Group[0].ClassName
            TestCount = $_.Count
        }
    })
}

function New-ShardManifest([object[]]$methods) {
    $classes = @($methods | Group-Object ClassName | ForEach-Object {
        [pscustomobject]@{
            ClassName = $_.Name
            TestCount = ($_.Group | Measure-Object TestCount -Sum).Sum
            Methods = @($_.Group.MethodName | Sort-Object)
        }
    })

    $buckets = @(for ($index = 1; $index -le $ShardCount; $index++) {
        [pscustomobject]@{
            ShardIndex = $index
            TestCount = 0
            Classes = [Collections.Generic.List[string]]::new()
            Methods = [Collections.Generic.List[string]]::new()
        }
    })

    foreach ($class in @($classes | Sort-Object @{ Expression = 'TestCount'; Descending = $true }, ClassName)) {
        $bucket = $buckets | Sort-Object TestCount, ShardIndex | Select-Object -First 1
        $bucket.Classes.Add($class.ClassName)
        foreach ($methodName in $class.Methods) {
            $bucket.Methods.Add($methodName)
        }
        $bucket.TestCount += $class.TestCount
    }

    return @($buckets | Sort-Object ShardIndex | ForEach-Object {
        [pscustomobject]@{
            shard_index = $_.ShardIndex
            test_count = $_.TestCount
            class_count = $_.Classes.Count
            classes = @($_.Classes | Sort-Object)
            method_count = $_.Methods.Count
            methods = @($_.Methods | Sort-Object)
        }
    })
}

function Remove-OwnedContainer([string]$name) {
    if ($name) {
        & docker rm -f $name 2>$null | Out-Null
    }
}

Push-Location $repoRoot
$containerName = $null
$previousConnection = $env:NEXUS_TEST_POSTGRES
try {
    $methods = @(Get-TestMethods)
    $manifest = @(New-ShardManifest $methods)
    $selected = $manifest[$ShardIndex - 1]
    if ($SliceCount -gt 1) {
        $selectedMethodNames = @($selected.methods | Where-Object {
            $methodIndex = [Array]::IndexOf($selected.methods, $_)
            $methodIndex % $SliceCount -eq ($SliceIndex - 1)
        })
        $methodTestCounts = @{}
        foreach ($method in $methods) {
            $methodTestCounts[$method.MethodName] = $method.TestCount
        }
        $selected = [pscustomobject]@{
            shard_index = $selected.shard_index
            test_count = ($selectedMethodNames | ForEach-Object { $methodTestCounts[$_] } | Measure-Object -Sum).Sum
            method_count = $selectedMethodNames.Count
            methods = $selectedMethodNames
        }
    }

    $manifestDocument = [pscustomobject]@{
        schema_version = 1
        assembly = 'tests/Nexus.Api.Tests/bin/Release/net8.0/Nexus.Api.Tests.dll'
        shard_count = $ShardCount
        discovered_test_count = ($methods | Measure-Object TestCount -Sum).Sum
        discovered_method_count = $methods.Count
        discovered_class_count = @($methods.ClassName | Select-Object -Unique).Count
        allocation = 'largest-class-first greedy balancing, then class name and shard index'
        shards = $manifest
    }

    if ($ManifestPath) {
        $manifestFullPath = if ([IO.Path]::IsPathRooted($ManifestPath)) {
            $ManifestPath
        } else {
            Join-Path $repoRoot $ManifestPath
        }
        $manifestDirectory = Split-Path -Parent $manifestFullPath
        if ($manifestDirectory) {
            New-Item -ItemType Directory -Force -Path $manifestDirectory | Out-Null
        }
        $manifestDocument | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $manifestFullPath
        Write-Host "Manifest: $manifestFullPath"
    }

    Write-Host "Discovered $($manifestDocument.discovered_test_count) tests across $($manifestDocument.discovered_method_count) methods and $($manifestDocument.discovered_class_count) classes."
    $sliceLabel = if ($SliceCount -gt 1) { ", slice $SliceIndex/$SliceCount" } else { "" }
    $selectedClassCount = if ($null -ne $selected.class_count) { $selected.class_count } else { 'sliced' }
    Write-Host "Shard $ShardIndex/$ShardCount$sliceLabel contains $($selected.test_count) tests across $selectedClassCount classes and $($selected.method_count) methods."
    foreach ($className in @($selected.classes)) {
        Write-Host " - $className"
    }

    if ($ListOnly) {
        exit 0
    }

    if (!$env:NEXUS_TEST_POSTGRES) {
        $containerName = "codex-nexus-shard-$PID-$ShardIndex-$SliceIndex"
        $databaseName = "nexus_shard_$PID`_$ShardIndex`_$SliceIndex"
        & docker run --rm -d `
            --name $containerName `
            -e POSTGRES_PASSWORD=postgres `
            -e POSTGRES_DB=$databaseName `
            -p '127.0.0.1::5432' `
            postgres:16.4-bookworm `
            -c fsync=off `
            -c synchronous_commit=off `
            -c full_page_writes=off | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to start the disposable PostgreSQL shard container.'
        }

        $ready = $false
        for ($attempt = 1; $attempt -le 60; $attempt++) {
            & docker exec $containerName pg_isready -U postgres -d $databaseName 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $ready = $true
                break
            }
            Start-Sleep -Milliseconds 500
        }
        if (!$ready) {
            throw 'Disposable PostgreSQL did not become ready within 30 seconds.'
        }

        $portOutput = (& docker port $containerName '5432/tcp').Trim()
        if ($portOutput -notmatch ':(\d+)$') {
            throw "Could not resolve the disposable PostgreSQL port from '$portOutput'."
        }
        $env:NEXUS_TEST_POSTGRES = "Host=127.0.0.1;Port=$($Matches[1]);Database=$databaseName;Username=postgres;Password=postgres;Pooling=false"
    }

    # Exact method filters keep theories together without allowing similarly
    # prefixed class or method names to overlap adjacent shards.
    $filter = ($selected.methods | ForEach-Object { "FullyQualifiedName=$_" }) -join '|'
    $resultLabel = if ($SliceCount -gt 1) {
        "shard-$ShardIndex-of-$ShardCount-slice-$SliceIndex-of-$SliceCount"
    } else {
        "shard-$ShardIndex-of-$ShardCount"
    }
    $resultsDirectory = Join-Path $repoRoot "artifacts\backend-test-shards\$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))-$resultLabel"
    New-Item -ItemType Directory -Force -Path $resultsDirectory | Out-Null

    $testArguments = @(
        'test', $testProject,
        '--configuration', 'Release',
        '--no-restore',
        '--no-build',
        '--filter', $filter,
        '--logger', 'console;verbosity=normal',
        '--logger', "trx;LogFileName=$resultLabel.trx",
        '--results-directory', $resultsDirectory,
        '--blame-hang',
        '--blame-hang-timeout', "$($HangTimeoutSeconds)s",
        '--blame-hang-dump-type', 'none'
    )

    & dotnet @testArguments
    exit $LASTEXITCODE
} finally {
    if ($null -eq $previousConnection) {
        Remove-Item Env:NEXUS_TEST_POSTGRES -ErrorAction SilentlyContinue
    } else {
        $env:NEXUS_TEST_POSTGRES = $previousConnection
    }
    Remove-OwnedContainer $containerName
    Pop-Location
}
