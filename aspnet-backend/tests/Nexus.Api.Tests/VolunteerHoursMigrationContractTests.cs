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

public sealed class VolunteerHoursMigrationContractTests
{
    private const string MigrationId = "20260711192124_VolunteerHoursLedgerParity";

    [Fact]
    public void Migration111_GrandfathersLegacyCaringEvidenceWithoutInventingMoney()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var migration = migrations.CreateMigration(
            migrations.Migrations[MigrationId],
            db.Database.ProviderName!);
        var sql = string.Join(
            "\n",
            migration.UpOperations.OfType<SqlOperation>().Select(operation => operation.Sql));

        sql.Should().Contain("UPDATE vol_logs vl");
        sql.Should().Contain("SET status = 'pending'");
        sql.Should().Contain("payment.type = 'volunteer_payment'");
        sql.Should().Contain("xp.\"Source\" = 'volunteer_hour'");
        sql.Should().Contain(
            "vl.caring_support_relationship_id IS NULL",
            "only non-Caring approved logs are required to have general volunteer-hour XP");
        sql.Should().NotContain(
            "INSERT INTO vol_org_transactions",
            "an upgrade must never invent financial evidence for a legacy approval");
        sql.Should().NotContain(
            "INSERT INTO transactions",
            "an upgrade must never mint personal credits from ambiguous legacy state");
    }

    [Fact]
    public void Migration111_AllowsPositiveCaringFractionsButRetainsMemberMinimum()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var migration = migrations.CreateMigration(
            migrations.Migrations[MigrationId],
            db.Database.ProviderName!);
        var constraint = migration.UpOperations
            .OfType<AddCheckConstraintOperation>()
            .Single(operation => operation.Name == "CK_VolunteerLogs_Hours");

        constraint.Sql.Should().Be(
            "\"hours\" >= 0 AND \"hours\" <= 24 AND (\"caring_support_relationship_id\" IS NOT NULL OR \"hours\" >= 0.25)");
    }

    [Fact]
    public void Migration111_PreservesTenantKeysWhileMatchingLaravelDeleteActions()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var migration = migrations.CreateMigration(
            migrations.Migrations[MigrationId],
            db.Database.ProviderName!);
        var sql = string.Join(
            "\n",
            migration.UpOperations.OfType<SqlOperation>().Select(operation => operation.Sql));

        var volunteerUser = migration.UpOperations
            .OfType<AddForeignKeyOperation>()
            .Single(operation => operation.Name == "FK_vol_logs_users_tenant_id_user_id");
        volunteerUser.OnDelete.Should().Be(ReferentialAction.Cascade);

        sql.Should().Contain("ON DELETE SET NULL (organization_id)");
        sql.Should().Contain("ON DELETE SET NULL (opportunity_id)");
        sql.Should().Contain("ON DELETE SET NULL (vol_log_id)");
        sql.Should().Contain("ON DELETE SET NULL (user_id)");
        sql.Should().Contain("ON DELETE SET NULL (support_recipient_id)");
        sql.Should().Contain("ON DELETE SET NULL (caring_support_relationship_id)");
        sql.Should().Contain("ON DELETE SET NULL (coordinator_id)");
        sql.Should().NotContain(
            "ON DELETE SET NULL (tenant_id",
            "nullable relationship deletion must retain the tenant isolation key");
    }

    [Fact]
    public void Migration111_AddsCanonicalPrivacySafeFeedProjection()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var migration = migrations.CreateMigration(
            migrations.Migrations[MigrationId],
            db.Database.ProviderName!);

        var table = migration.UpOperations
            .OfType<CreateTableOperation>()
            .Single(operation => operation.Name == "feed_activity");
        table.Columns.Select(column => column.Name).Should().BeEquivalentTo(
            "id",
            "tenant_id",
            "user_id",
            "source_type",
            "source_id",
            "group_id",
            "title",
            "content",
            "image_url",
            "metadata",
            "is_visible",
            "created_at",
            "is_hidden");
        table.Columns.Single(column => column.Name == "metadata").ColumnType.Should().Be("jsonb");

        var sourceKey = migration.UpOperations
            .OfType<CreateIndexOperation>()
            .Single(operation => operation.Name == "uq_tenant_source");
        sourceKey.IsUnique.Should().BeTrue();
        sourceKey.Columns.Should().Equal("tenant_id", "source_type", "source_id");

        var privacyColumn = migration.UpOperations
            .OfType<AddColumnOperation>()
            .Single(operation => operation.Table == "users"
                && operation.Name == "show_on_leaderboard");
        privacyColumn.IsNullable.Should().BeTrue();
        privacyColumn.DefaultValue.Should().Be(true);
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
