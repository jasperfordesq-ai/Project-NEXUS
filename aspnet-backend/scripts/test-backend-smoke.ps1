# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

& powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\verify-base.ps1') -SkipFrontend
exit $LASTEXITCODE
