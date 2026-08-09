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

public sealed class SafeguardingPreferenceDependencyMigrationContractTests
{
    [Fact]
    public void Migration_FailsClosedOnAmbiguousHistoryBeforeCanonicalConstraintChanges()
    {
        var migration = Migration();
        var operations = migration.UpOperations;
        var preflight = operations[0].Should().BeOfType<SqlOperation>().Which.Sql;
        preflight.Should().Contain("GROUP BY \"TenantId\", \"UserId\", \"OptionId\"");
        preflight.Should().Contain("HAVING COUNT(*) > 1");
        preflight.Should().Contain("ERRCODE = 'P0001'");
        preflight.Should().NotContain("DELETE FROM user_safeguarding_preferences");
        preflight.Should().Contain("ConsentGivenAt");
        preflight.Should().Contain("CreatedAt");

        var predecessorConvergence = operations.OfType<SqlOperation>()
            .Skip(1)
            .Single()
            .Sql;
        predecessorConvergence.Should().Contain("pg_constraint");
        predecessorConvergence.Should().Contain("pg_index");
        predecessorConvergence.Should().Contain("constraint_row.conname");
        predecessorConvergence.Should().Contain("ARRAY['TenantId', 'UserId', 'OptionId', 'RevokedAt']");
        predecessorConvergence.Should().Contain("format(");
        predecessorConvergence.Should().NotContain(
            "FK_user_safeguarding_preferences_safeguarding_options_OptionId");

        var selectedValue = operations.OfType<AlterColumnOperation>().Single(operation =>
            operation.Table == "user_safeguarding_preferences" && operation.Name == "SelectedValue");
        selectedValue.MaxLength.Should().Be(255);
        selectedValue.IsNullable.Should().BeFalse();

        var consent = operations.OfType<AlterColumnOperation>().Single(operation =>
            operation.Table == "user_safeguarding_preferences" && operation.Name == "ConsentGivenAt");
        consent.IsNullable.Should().BeFalse();
        consent.DefaultValue.Should().BeNull();

        var unique = operations.OfType<CreateIndexOperation>().Single(operation =>
            operation.Table == "user_safeguarding_preferences"
            && operation.Columns.SequenceEqual(new[] { "TenantId", "UserId", "OptionId" }));
        unique.IsUnique.Should().BeTrue();

        var cascades = operations.OfType<AddForeignKeyOperation>()
            .Where(operation => operation.Table == "user_safeguarding_preferences")
            .ToArray();
        cascades.Should().HaveCount(2);
        cascades.Should().OnlyContain(operation => operation.OnDelete == ReferentialAction.Cascade);
        cascades.Select(operation => operation.PrincipalTable)
            .Should().BeEquivalentTo("tenants", "safeguarding_options");
    }

    [Fact]
    public void Migration_IsForwardOnlyAfterConsentConstraintConvergence()
    {
        var migration = Migration();

        Action inspectRollback = () => _ = migration.DownOperations;

        inspectRollback.Should().Throw<NotSupportedException>();
    }

    private static Migration Migration()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var match = migrations.Migrations.Single(pair => pair.Key.EndsWith(
            "_SafeguardingPreferenceDependencyParity",
            StringComparison.Ordinal));
        return migrations.CreateMigration(match.Value, db.Database.ProviderName!);
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
