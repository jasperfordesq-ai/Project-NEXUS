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

public sealed class HealthCheckHistorySchemaParityTests
{
    private const string MigrationSuffix = "HealthCheckHistoryStorageParity";

    [Fact]
    public void Entity_MapsExactLaravelTableColumnsAndTenantFilter()
    {
        using var db = Context(42);
        var entity = Entity(db);
        var mappings = new[]
        {
            (nameof(HealthCheckHistory.Id), "id"),
            (nameof(HealthCheckHistory.TenantId), "tenant_id"),
            (nameof(HealthCheckHistory.Status), "status"),
            (nameof(HealthCheckHistory.ChecksJson), "checks"),
            (nameof(HealthCheckHistory.LatencyMs), "latency_ms"),
            (nameof(HealthCheckHistory.CreatedAt), "created_at"),
        };

        entity.GetTableName().Should().Be("health_check_history");
        entity.GetQueryFilter().Should().NotBeNull();
        entity.GetProperties().Select(property => property.Name)
            .Should().BeEquivalentTo(mappings.Select(mapping => mapping.Item1));
        var table = StoreObjectIdentifier.Table("health_check_history", entity.GetSchema());
        foreach (var (property, column) in mappings)
        {
            entity.FindProperty(property)!.GetColumnName(table).Should().Be(column);
        }
    }

    [Fact]
    public void Entity_PreservesLaravelJsonTimestampIndexAndTenantRelationship()
    {
        using var db = Context(42);
        var entity = Entity(db);
        entity.FindProperty(nameof(HealthCheckHistory.Status))!.GetMaxLength().Should().Be(16);
        entity.FindProperty(nameof(HealthCheckHistory.ChecksJson))!.GetColumnType().Should().Be("jsonb");
        entity.FindProperty(nameof(HealthCheckHistory.CreatedAt))!.GetDefaultValueSql()
            .Should().Be("CURRENT_TIMESTAMP");
        entity.GetIndexes().Should().ContainSingle(index =>
            index.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(HealthCheckHistory.TenantId) }));
        entity.GetForeignKeys().Should().ContainSingle(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(Tenant)
            && foreignKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(HealthCheckHistory.TenantId) })
            && foreignKey.DeleteBehavior == DeleteBehavior.Restrict);
    }

    [Fact]
    public void Migration_CreatesOnlyHealthCheckHistory()
    {
        var migration = Migration();
        migration.UpOperations.OfType<CreateTableOperation>().Should().ContainSingle()
            .Which.Name.Should().Be("health_check_history");
        migration.UpOperations.Where(operation => operation is not CreateTableOperation)
            .Should().OnlyContain(operation => operation is CreateIndexOperation);
        migration.UpOperations.Where(operation =>
                operation is DropTableOperation or DropColumnOperation or AlterColumnOperation or SqlOperation)
            .Should().BeEmpty();
    }

    private static Migration Migration()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var match = migrations.Migrations.Single(pair =>
            pair.Key.EndsWith(MigrationSuffix, StringComparison.Ordinal));
        return migrations.CreateMigration(match.Value, db.Database.ProviderName!);
    }

    private static IEntityType Entity(NexusDbContext db) => db.Model.FindEntityType(typeof(HealthCheckHistory))!;

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
