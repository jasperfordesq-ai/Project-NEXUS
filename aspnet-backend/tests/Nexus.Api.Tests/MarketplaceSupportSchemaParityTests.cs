// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class MarketplaceSupportSchemaParityTests
{
    private const string MigrationSuffix = "MarketplaceSupportStorageParity";

    [Fact]
    public void Entities_MapExactLaravelTablesColumnsAndTenantFilters()
    {
        using var db = Context(tenantId: 42);

        AssertColumns<MarketplaceCategoryTemplate>(db, "marketplace_category_templates",
            (nameof(MarketplaceCategoryTemplate.Id), "id"),
            (nameof(MarketplaceCategoryTemplate.TenantId), "tenant_id"),
            (nameof(MarketplaceCategoryTemplate.CategoryId), "category_id"),
            (nameof(MarketplaceCategoryTemplate.Name), "name"),
            (nameof(MarketplaceCategoryTemplate.FieldsJson), "fields"),
            (nameof(MarketplaceCategoryTemplate.CreatedAt), "created_at"),
            (nameof(MarketplaceCategoryTemplate.UpdatedAt), "updated_at"));

        AssertColumns<MarketplaceReportNotification>(db, "marketplace_report_notifications",
            (nameof(MarketplaceReportNotification.Id), "id"),
            (nameof(MarketplaceReportNotification.TenantId), "tenant_id"),
            (nameof(MarketplaceReportNotification.MarketplaceReportId), "marketplace_report_id"),
            (nameof(MarketplaceReportNotification.RecipientUserId), "recipient_user_id"),
            (nameof(MarketplaceReportNotification.EventType), "event_type"),
            (nameof(MarketplaceReportNotification.Channel), "channel"),
            (nameof(MarketplaceReportNotification.DedupeKey), "dedupe_key"),
            (nameof(MarketplaceReportNotification.Status), "status"),
            (nameof(MarketplaceReportNotification.Attempts), "attempts"),
            (nameof(MarketplaceReportNotification.LastError), "last_error"),
            (nameof(MarketplaceReportNotification.LastAttemptedAt), "last_attempted_at"),
            (nameof(MarketplaceReportNotification.SentAt), "sent_at"),
            (nameof(MarketplaceReportNotification.NextRetryAt), "next_retry_at"),
            (nameof(MarketplaceReportNotification.PayloadJson), "payload"),
            (nameof(MarketplaceReportNotification.CreatedAt), "created_at"),
            (nameof(MarketplaceReportNotification.UpdatedAt), "updated_at"));
    }

    [Fact]
    public void Entities_PreserveLaravelLengthsJsonDefaultsIndexesAndTenantRelationships()
    {
        using var db = Context(tenantId: 42);

        var template = Entity<MarketplaceCategoryTemplate>(db);
        template.FindProperty(nameof(MarketplaceCategoryTemplate.TenantId))!.IsNullable.Should().BeTrue();
        template.FindProperty(nameof(MarketplaceCategoryTemplate.CategoryId))!.IsNullable.Should().BeTrue();
        template.FindProperty(nameof(MarketplaceCategoryTemplate.Name))!.GetMaxLength().Should().Be(100);
        template.FindProperty(nameof(MarketplaceCategoryTemplate.FieldsJson))!.GetColumnType().Should().Be("jsonb");
        AssertIndex(template, "marketplace_category_templates_tenant_id_index", false,
            nameof(MarketplaceCategoryTemplate.TenantId));
        AssertForeignKey<MarketplaceCategoryTemplate, MarketplaceCategory>(db, DeleteBehavior.SetNull,
            nameof(MarketplaceCategoryTemplate.CategoryId));

        var notification = Entity<MarketplaceReportNotification>(db);
        notification.FindProperty(nameof(MarketplaceReportNotification.EventType))!.GetMaxLength().Should().Be(40);
        notification.FindProperty(nameof(MarketplaceReportNotification.Channel))!.GetMaxLength().Should().Be(20);
        notification.FindProperty(nameof(MarketplaceReportNotification.DedupeKey))!.GetMaxLength().Should().Be(191);
        notification.FindProperty(nameof(MarketplaceReportNotification.Status))!.GetDefaultValue().Should().Be("pending");
        notification.FindProperty(nameof(MarketplaceReportNotification.Attempts))!.GetDefaultValue().Should().Be(0);
        notification.FindProperty(nameof(MarketplaceReportNotification.PayloadJson))!.GetColumnType().Should().Be("jsonb");
        AssertIndex(notification, "mrn_tenant_dedupe_channel_unique", true,
            nameof(MarketplaceReportNotification.TenantId),
            nameof(MarketplaceReportNotification.DedupeKey),
            nameof(MarketplaceReportNotification.Channel));
        AssertIndex(notification, "mrn_tenant_status_retry_idx", false,
            nameof(MarketplaceReportNotification.TenantId),
            nameof(MarketplaceReportNotification.Status),
            nameof(MarketplaceReportNotification.NextRetryAt));
        AssertForeignKey<MarketplaceReportNotification, MarketplaceReport>(db, DeleteBehavior.Cascade,
            nameof(MarketplaceReportNotification.TenantId),
            nameof(MarketplaceReportNotification.MarketplaceReportId));
        AssertForeignKey<MarketplaceReportNotification, User>(db, DeleteBehavior.Restrict,
            nameof(MarketplaceReportNotification.TenantId),
            nameof(MarketplaceReportNotification.RecipientUserId));

        Entity<MarketplaceReport>(db).GetKeys().Should().Contain(key =>
            key.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(MarketplaceReport.TenantId), nameof(MarketplaceReport.Id) }));
    }

    [Fact]
    public void Migration_CreatesOnlyMarketplaceSupportTablesAndReportTenantKey()
    {
        var migration = Migration();
        var creates = migration.UpOperations.OfType<CreateTableOperation>().ToArray();

        creates.Select(table => table.Name).Should().BeEquivalentTo(
            "marketplace_category_templates",
            "marketplace_report_notifications");
        migration.UpOperations.OfType<AddUniqueConstraintOperation>()
            .Should().ContainSingle(operation => operation.Table == "marketplace_reports"
                && operation.Name == "AK_marketplace_reports_TenantId_Id"
                && operation.Columns.SequenceEqual(new[] { "TenantId", "Id" }));
        migration.UpOperations.Where(operation =>
                operation is DropTableOperation or DropColumnOperation or AlterColumnOperation or SqlOperation)
            .Should().BeEmpty();

        var notifications = creates.Single(table => table.Name == "marketplace_report_notifications");
        notifications.ForeignKeys.Should().Contain(foreignKey =>
            foreignKey.PrincipalTable == "marketplace_reports"
            && foreignKey.Columns.SequenceEqual(new[] { "tenant_id", "marketplace_report_id" })
            && foreignKey.PrincipalColumns!.SequenceEqual(new[] { "TenantId", "Id" })
            && foreignKey.OnDelete == ReferentialAction.Cascade);
    }

    private static Migration Migration()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var match = migrations.Migrations.Single(pair =>
            pair.Key.EndsWith(MigrationSuffix, StringComparison.Ordinal));
        return migrations.CreateMigration(match.Value, db.Database.ProviderName!);
    }

    private static void AssertColumns<TEntity>(
        NexusDbContext db,
        string tableName,
        params (string Property, string Column)[] mappings)
        where TEntity : class
    {
        var entity = Entity<TEntity>(db);
        entity.GetTableName().Should().Be(tableName);
        entity.GetQueryFilter().Should().NotBeNull();
        entity.GetProperties().Select(property => property.Name)
            .Should().BeEquivalentTo(mappings.Select(mapping => mapping.Property));

        var table = StoreObjectIdentifier.Table(tableName, entity.GetSchema());
        foreach (var (property, column) in mappings)
        {
            entity.FindProperty(property)!.GetColumnName(table).Should().Be(column);
        }
    }

    private static void AssertIndex(
        IEntityType entity,
        string databaseName,
        bool unique,
        params string[] properties)
    {
        var index = entity.GetIndexes().Single(candidate =>
            candidate.Properties.Select(property => property.Name).SequenceEqual(properties));
        index.GetDatabaseName().Should().Be(databaseName);
        index.IsUnique.Should().Be(unique);
    }

    private static void AssertForeignKey<TEntity, TPrincipal>(
        NexusDbContext db,
        DeleteBehavior deleteBehavior,
        params string[] properties)
        where TEntity : class
        where TPrincipal : class
    {
        var foreignKey = Entity<TEntity>(db).GetForeignKeys().Single(candidate =>
            candidate.PrincipalEntityType.ClrType == typeof(TPrincipal)
            && candidate.Properties.Select(property => property.Name).SequenceEqual(properties));
        foreignKey.DeleteBehavior.Should().Be(deleteBehavior);
    }

    private static IEntityType Entity<TEntity>(NexusDbContext db) where TEntity : class
    {
        return db.Model.FindEntityType(typeof(TEntity))!;
    }

    private static NexusDbContext Context(int tenantId = 0)
    {
        var tenant = new TenantContext();
        if (tenantId > 0)
        {
            tenant.SetTenant(tenantId);
        }

        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=nexus_schema_metadata;Username=postgres;Password=postgres;Timeout=1")
            .Options;
        return new NexusDbContext(options, tenant);
    }
}
