# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

# Full backend test run with a zero-tests guard.
#
# 🔴 Why the guard exists: on a machine where Windows App Control (Smart App
# Control) blocks locally built assemblies, `dotnet test` prints
# "Skipping: ... An Application Control policy has blocked this file.
# (0x800711C7)", runs NOTHING, and exits 0 — a clean-looking run that proved
# nothing. Documented in docs/PRODUCTION_READINESS_REMEDIATION.md ("Two ways
# this backend's tests can appear to pass without running"). This runner now
# refuses to report success unless it can see a `Passed!`/`Failed!` summary
# with at least one executed test.

[CmdletBinding()]
param(
    [int]$HangTimeoutSeconds = 300,
    # Optional xUnit filter, e.g. 'FullyQualifiedName~HealthControllerTests'.
    # Used by the guard's own red-proof: an impossible filter must FAIL.
    [string]$Filter = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $repoRoot
try {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\cleanup-testhost.ps1')

    $testArgs = @(
        'test'
        '--logger', 'console;verbosity=normal'
        '--blame-hang'
        '--blame-hang-timeout', "$($HangTimeoutSeconds)s"
        '--blame-hang-dump-type', 'none'
    )
    if ($Filter -ne '') {
        $testArgs += @('--filter', $Filter)
    }

    # Tee the output so the human still sees the live run while the guard
    # reads the same lines afterwards. ErrorActionPreference must be Continue
    # around the native call: with 'Stop', the FIRST line dotnet writes to
    # stderr (xUnit prints every [FAIL] there) becomes a terminating
    # NativeCommandError and aborts the whole suite mid-run — which is how a
    # 40-minute run died at minute 14 on its first failing test.
    $outputLines = New-Object System.Collections.Generic.List[string]
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & dotnet @testArgs 2>&1 | ForEach-Object {
            $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ }
            $outputLines.Add($line)
            Write-Host $line
        }
        $dotnetExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousEap
    }

    # Guard 1: the App Control signature — DLLs refused, zero tests run.
    $blocked = $outputLines | Where-Object { $_ -match '0x800711C7|Application Control policy has blocked' }
    if ($blocked) {
        Write-Host ("ERROR: App Control blocked the test assemblies - NO tests ran. " +
            "This is a machine policy (Smart App Control), not a code result. " +
            "First blocked line: " + ($blocked | Select-Object -First 1))
        exit 3
    }

    # Guard 2: require an executed-test summary with Passed > 0 (or real
    # failures, which are a legitimate red). "No test matches" and silent
    # zero-test runs exit 0 from dotnet — they must not exit 0 from here.
    # VSTest prints one of TWO summary formats depending on run shape:
    #   "Passed!  - Failed:     0, Passed:  3915, Skipped: ..." (aggregate)
    #   "Test Run Successful." + "Total tests: 3" + "     Passed: 3" (single)
    $totalPassed = 0
    $totalFailed = 0
    foreach ($line in $outputLines) {
        if ($line -match '(?:Passed|Failed)!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+)') {
            $totalFailed += [int]$Matches[1]
            $totalPassed += [int]$Matches[2]
        } elseif ($line -match '^\s*Passed:\s+(\d+)\s*$') {
            $totalPassed += [int]$Matches[1]
        } elseif ($line -match '^\s*Failed:\s+(\d+)\s*$') {
            $totalFailed += [int]$Matches[1]
        }
    }

    if (($totalPassed + $totalFailed) -eq 0) {
        Write-Host ("ERROR: No tests were executed (no summary line found). " +
            "A run that executes zero tests proves nothing and must not read as green.")
        exit 3
    }

    Write-Host ("test-backend-full: executed summary - Passed: {0}, Failed: {1}" -f $totalPassed, $totalFailed)
    exit $dotnetExit
} finally {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\cleanup-testhost.ps1')
    Pop-Location
}
