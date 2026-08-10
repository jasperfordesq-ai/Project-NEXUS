// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Nexus.Api.Data;

namespace Nexus.Api.Tests;

public sealed class XpShopRedemptionMigrationContractTests
{
    private const string MigrationId = "20260713093000_RepairFreshDatabaseCompatibility";

    [Fact]
    public void Migration_RepairsTheFreshDatabaseSchemaRequiredByDevelopmentSeeding()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var migration = migrations.CreateMigration(
            migrations.Migrations[MigrationId],
            db.Database.ProviderName!);

        var sql = migration.UpOperations.Should().ContainSingle().Which
            .Should().BeOfType<SqlOperation>().Which.Sql;

        sql.Should().Contain("CREATE TABLE IF NOT EXISTS \"XpShopRedemptions\"");
        sql.Should().Contain("FOREIGN KEY (\"TenantId\") REFERENCES tenants (\"Id\") ON DELETE CASCADE");
        sql.Should().Contain("FOREIGN KEY (\"UserId\") REFERENCES users (\"Id\") ON DELETE CASCADE");
        sql.Should().Contain("CREATE INDEX IF NOT EXISTS \"IX_XpShopRedemptions_TenantId\"");
        sql.Should().Contain("CREATE INDEX IF NOT EXISTS \"IX_XpShopRedemptions_UserId\"");
        sql.Should().Contain("ADD COLUMN IF NOT EXISTS \"P256dh\" character varying(200) NULL");
        sql.Should().Contain("ADD COLUMN IF NOT EXISTS \"Auth\" character varying(64) NULL");
    }

    private static NexusDbContext Context()
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql(
                "Host=127.0.0.1;Port=1;Database=nexus_discovery_only;Username=postgres;Password=postgres;Timeout=1")
            .Options;
        return new NexusDbContext(options, new TenantContext());
    }
}
