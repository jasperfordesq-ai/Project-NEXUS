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

public sealed class MessagingRestrictionMigrationContractTests
{
    [Fact]
    public void Migration_AddsOnlyContentFreeAdministrativeMessagingFlag()
    {
        var migration = Migration();
        var addition = migration.UpOperations.Should().ContainSingle().Which
            .Should().BeOfType<AddColumnOperation>().Which;

        addition.Table.Should().Be("user_monitoring_restrictions");
        addition.Name.Should().Be("messaging_disabled");
        addition.ClrType.Should().Be(typeof(bool));
        addition.IsNullable.Should().BeFalse();
        addition.DefaultValue.Should().Be(false);
    }

    [Fact]
    public void Migration_IsForwardOnlyBecauseRollbackWouldDiscardSafetyRestrictions()
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
            "_MessagingDisabledRestrictionParity",
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
