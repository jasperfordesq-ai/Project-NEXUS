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

public sealed class EngagementRecognitionSchemaParityTests
{
    private const string MigrationSuffix = "EngagementRecognitionStorageParity";

    [Fact]
    public void Entities_MapExactLaravelTablesColumnsAndTenantFilters()
    {
        using var db = Context(42);
        AssertMapping(Entity<MonthlyEngagement>(db), "monthly_engagement", new[]
        {
            (nameof(MonthlyEngagement.Id), "id"),
            (nameof(MonthlyEngagement.TenantId), "tenant_id"),
            (nameof(MonthlyEngagement.UserId), "user_id"),
            (nameof(MonthlyEngagement.YearMonth), "year_month"),
            (nameof(MonthlyEngagement.WasActive), "was_active"),
            (nameof(MonthlyEngagement.ActivityCount), "activity_count"),
            (nameof(MonthlyEngagement.RecognizedAt), "recognized_at"),
            (nameof(MonthlyEngagement.CreatedAt), "created_at"),
            (nameof(MonthlyEngagement.UpdatedAt), "updated_at"),
        });
        AssertMapping(Entity<SeasonalRecognition>(db), "seasonal_recognition", new[]
        {
            (nameof(SeasonalRecognition.Id), "id"),
            (nameof(SeasonalRecognition.TenantId), "tenant_id"),
            (nameof(SeasonalRecognition.UserId), "user_id"),
            (nameof(SeasonalRecognition.Season), "season"),
            (nameof(SeasonalRecognition.MonthsActive), "months_active"),
            (nameof(SeasonalRecognition.RecognizedAt), "recognized_at"),
            (nameof(SeasonalRecognition.CreatedAt), "created_at"),
            (nameof(SeasonalRecognition.UpdatedAt), "updated_at"),
        });
    }

    [Fact]
    public void Entities_PreserveLaravelLengthsDefaultsIndexesAndTenantSafeUsers()
    {
        using var db = Context(42);
        var monthly = Entity<MonthlyEngagement>(db);
        monthly.FindProperty(nameof(MonthlyEngagement.YearMonth))!.GetMaxLength().Should().Be(7);
        monthly.FindProperty(nameof(MonthlyEngagement.WasActive))!.GetDefaultValue().Should().Be(false);
        monthly.FindProperty(nameof(MonthlyEngagement.ActivityCount))!.GetDefaultValue().Should().Be(0);
        AssertIndex(monthly, "uniq_monthly_engagement", true,
            nameof(MonthlyEngagement.TenantId), nameof(MonthlyEngagement.UserId), nameof(MonthlyEngagement.YearMonth));
        AssertIndex(monthly, "idx_me_tenant", false, nameof(MonthlyEngagement.TenantId));
        AssertIndex(monthly, "idx_me_user_month", false,
            nameof(MonthlyEngagement.UserId), nameof(MonthlyEngagement.YearMonth));
        AssertTenantSafeUser(monthly, nameof(MonthlyEngagement.TenantId), nameof(MonthlyEngagement.UserId));

        var seasonal = Entity<SeasonalRecognition>(db);
        seasonal.FindProperty(nameof(SeasonalRecognition.Season))!.GetMaxLength().Should().Be(20);
        seasonal.FindProperty(nameof(SeasonalRecognition.MonthsActive))!.GetDefaultValue().Should().Be((short)0);
        AssertIndex(seasonal, "uniq_seasonal_recognition", true,
            nameof(SeasonalRecognition.TenantId), nameof(SeasonalRecognition.UserId), nameof(SeasonalRecognition.Season));
        AssertIndex(seasonal, "idx_sr_tenant", false, nameof(SeasonalRecognition.TenantId));
        AssertTenantSafeUser(seasonal, nameof(SeasonalRecognition.TenantId), nameof(SeasonalRecognition.UserId));
    }

    [Fact]
    public void Migration_CreatesOnlyTheEngagementRecognitionTables()
    {
        var migration = Migration();
        migration.UpOperations.OfType<CreateTableOperation>()
            .Select(operation => operation.Name)
            .Should().BeEquivalentTo("monthly_engagement", "seasonal_recognition");
        migration.UpOperations.Where(operation => operation is not CreateTableOperation)
            .Should().OnlyContain(operation => operation is CreateIndexOperation);
        migration.UpOperations.Where(operation =>
                operation is DropTableOperation or DropColumnOperation or AlterColumnOperation or SqlOperation)
            .Should().BeEmpty();
    }

    private static void AssertMapping(IEntityType entity, string tableName, (string Property, string Column)[] mappings)
    {
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

    private static void AssertIndex(IEntityType entity, string databaseName, bool unique, params string[] properties)
    {
        var index = entity.GetIndexes().Single(candidate => candidate.GetDatabaseName() == databaseName);
        index.IsUnique.Should().Be(unique);
        index.Properties.Select(property => property.Name).Should().Equal(properties);
    }

    private static void AssertTenantSafeUser(IEntityType entity, string tenantProperty, string userProperty)
    {
        entity.GetForeignKeys().Should().Contain(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(User)
            && foreignKey.Properties.Select(property => property.Name).SequenceEqual(new[] { tenantProperty, userProperty })
            && foreignKey.PrincipalKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(User.TenantId), nameof(User.Id) })
            && foreignKey.DeleteBehavior == DeleteBehavior.Restrict);
    }

    private static Migration Migration()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var match = migrations.Migrations.Single(pair =>
            pair.Key.EndsWith(MigrationSuffix, StringComparison.Ordinal));
        return migrations.CreateMigration(match.Value, db.Database.ProviderName!);
    }

    private static IEntityType Entity<T>(NexusDbContext db) where T : class => db.Model.FindEntityType(typeof(T))!;

    private static NexusDbContext Context(int tenantId = 0)
    {
        var tenant = new TenantContext();
        if (tenantId > 0) tenant.SetTenant(tenantId);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=nexus_schema_metadata;Username=postgres;Password=postgres;Timeout=1")
            .Options;
        return new NexusDbContext(options, tenant);
    }
}
