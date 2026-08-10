# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $repoRoot 'scripts\compare-laravel-schema-parity.ps1'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-schema-parity-fixture-" + [Guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $fixtureRoot 'laravel'
$targetRoot = Join-Path $fixtureRoot 'aspnet'
$outDir = Join-Path $fixtureRoot 'out'

try {
    New-Item -ItemType Directory -Force -Path $sourceRoot, $targetRoot, $outDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $sourceRoot 'database\migrations') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $sourceRoot 'app\Models') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot 'src\Nexus.Api\Data\Configurations') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot 'src\Nexus.Api\Entities') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot 'src\Nexus.Api\Migrations') | Out-Null

    @'
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
        });

        Schema::create('job_alerts', function (Blueprint $table) {
            $table->id();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('timezone')->nullable();
        });
    }
};
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'database\migrations\2026_01_01_000000_create_fixture_tables.php')

    @'
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CustomProfile extends Model
{
    protected $table = 'custom_profiles';
}
'@ | Set-Content -LiteralPath (Join-Path $sourceRoot 'app\Models\CustomProfile.php')

    @'
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Fixture.Data.Configurations;

public sealed class FixtureConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> entity)
    {
        entity.ToTable("users");
        entity.OwnsOne(x => x.Settings).ToTable("dotnet_only");
    }
}
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'src\Nexus.Api\Data\Configurations\FixtureConfiguration.cs')

    @'
using System.ComponentModel.DataAnnotations.Schema;

namespace Fixture.Entities;

[Table("custom_profiles")]
public sealed class CustomProfile
{
}
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'src\Nexus.Api\Entities\CustomProfile.cs')

    @'
using Microsoft.EntityFrameworkCore.Migrations;

namespace Fixture.Migrations;

public partial class Initial : Migration
{
}
'@ | Set-Content -LiteralPath (Join-Path $targetRoot 'src\Nexus.Api\Migrations\20260101000000_Initial.cs')

    & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -TargetRoot $targetRoot -SourceRoot $sourceRoot -OutDir $outDir
    if ($LASTEXITCODE -ne 0) {
        throw "compare-laravel-schema-parity.ps1 exited with $LASTEXITCODE"
    }

    $jsonPath = Join-Path $outDir 'schema-parity.json'
    $markdownPath = Join-Path $outDir 'schema-parity.md'
    Assert-True (Test-Path -LiteralPath $jsonPath) 'Expected schema-parity.json to be written.'
    Assert-True (Test-Path -LiteralPath $markdownPath) 'Expected schema-parity.md to be written.'

    $report = Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json
    $matrix = @($report.matrix)

    Assert-True ($report.summary.laravel_migrations -eq 1) 'Expected one Laravel migration.'
    Assert-True ($report.summary.aspnet_migrations -eq 1) 'Expected one ASP.NET migration.'
    Assert-True ($report.summary.laravel_created_tables -eq 2) 'Expected two Laravel created tables.'
    Assert-True ($report.summary.laravel_touched_tables -eq 1) 'Expected one Laravel touched table.'
    Assert-True ($report.summary.laravel_model_tables -eq 1) 'Expected one Laravel model table.'
    Assert-True ($report.summary.laravel_source_tables -eq 3) 'Expected three source tables.'
    Assert-True ($report.summary.aspnet_tables -eq 3) 'Expected three ASP.NET tables.'
    Assert-True ($report.summary.matched_tables -eq 2) 'Expected two matched tables.'
    Assert-True ($report.summary.missing_tables -eq 1) 'Expected one missing Laravel table.'
    Assert-True ($report.summary.extra_aspnet_tables -eq 1) 'Expected one extra ASP.NET table.'

    Assert-True (@($matrix | Where-Object { $_.table -eq 'users' -and $_.status -eq 'matched' }).Count -eq 1) 'Expected users table to match.'
    Assert-True (@($matrix | Where-Object { $_.table -eq 'custom_profiles' -and $_.status -eq 'matched' }).Count -eq 1) 'Expected custom_profiles model table to match.'
    Assert-True (@($matrix | Where-Object { $_.table -eq 'job_alerts' -and $_.status -eq 'missing' }).Count -eq 1) 'Expected job_alerts to be missing.'
    Assert-True (@($matrix | Where-Object { $_.table -eq 'dotnet_only' -and $_.status -eq 'extra-aspnet' }).Count -eq 1) 'Expected dotnet_only to be extra.'

    $markdown = Get-Content -Raw -LiteralPath $markdownPath
    Assert-True ($markdown.Contains('job_alerts')) 'Expected markdown report to include missing job_alerts table.'
    Assert-True (-not $markdown.Contains('$(@{')) 'Markdown must not contain a literal PowerShell object expression.'

    $expectedMissingRow = '| `job_alerts` | migration-create | `{0}` |' -f (Join-Path $sourceRoot 'database\migrations\2026_01_01_000000_create_fixture_tables.php')
    $expectedExtraRow = '| `dotnet_only` | ef-totable | `{0}` |' -f (Join-Path $targetRoot 'src\Nexus.Api\Data\Configurations\FixtureConfiguration.cs')
    Assert-True ($markdown.Contains($expectedMissingRow)) 'Expected a rendered Markdown row for missing job_alerts table.'
    Assert-True ($markdown.Contains($expectedExtraRow)) 'Expected a rendered Markdown row for extra dotnet_only table.'

    Write-Host 'compare-laravel-schema-parity tests passed.'
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
