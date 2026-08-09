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

public sealed class CookieInventorySchemaParityTests
{
    private const string MigrationSuffix = "CookieInventoryStorageParity";

    [Fact]
    public void Entity_MapsExactLaravelTableColumnsWithoutHidingGlobalRows()
    {
        using var db = Context(42);
        var entity = Entity(db);
        var mappings = new[]
        {
            (nameof(CookieInventoryItem.Id), "id"),
            (nameof(CookieInventoryItem.CookieName), "cookie_name"),
            (nameof(CookieInventoryItem.Category), "category"),
            (nameof(CookieInventoryItem.Purpose), "purpose"),
            (nameof(CookieInventoryItem.Duration), "duration"),
            (nameof(CookieInventoryItem.ThirdParty), "third_party"),
            (nameof(CookieInventoryItem.TenantId), "tenant_id"),
            (nameof(CookieInventoryItem.IsActive), "is_active"),
            (nameof(CookieInventoryItem.CreatedAt), "created_at"),
            (nameof(CookieInventoryItem.UpdatedAt), "updated_at"),
        };

        entity.GetTableName().Should().Be("cookie_inventory");
        entity.GetQueryFilter().Should().BeNull("global rows have a null tenant_id and must remain visible");
        entity.GetProperties().Select(property => property.Name)
            .Should().BeEquivalentTo(mappings.Select(mapping => mapping.Item1));
        var table = StoreObjectIdentifier.Table("cookie_inventory", entity.GetSchema());
        foreach (var (property, column) in mappings)
        {
            entity.FindProperty(property)!.GetColumnName(table).Should().Be(column);
        }
    }

    [Fact]
    public void Entity_PreservesLaravelTypesDefaultsIndexesAndOptionalTenantRelationship()
    {
        using var db = Context(42);
        var entity = Entity(db);

        AssertLength(entity, nameof(CookieInventoryItem.CookieName), 255);
        AssertLength(entity, nameof(CookieInventoryItem.Category), 20);
        AssertLength(entity, nameof(CookieInventoryItem.Duration), 100);
        AssertLength(entity, nameof(CookieInventoryItem.ThirdParty), 255);
        entity.FindProperty(nameof(CookieInventoryItem.Purpose))!.GetColumnType().Should().Be("text");
        entity.FindProperty(nameof(CookieInventoryItem.TenantId))!.IsNullable.Should().BeTrue();
        entity.FindProperty(nameof(CookieInventoryItem.IsActive))!.GetDefaultValue().Should().Be(true);
        entity.FindProperty(nameof(CookieInventoryItem.CreatedAt))!.GetDefaultValueSql().Should().Be("CURRENT_TIMESTAMP");
        entity.FindProperty(nameof(CookieInventoryItem.UpdatedAt))!.GetDefaultValueSql().Should().Be("CURRENT_TIMESTAMP");

        AssertIndex(entity, true, nameof(CookieInventoryItem.CookieName), nameof(CookieInventoryItem.TenantId));
        AssertIndex(entity, false, nameof(CookieInventoryItem.Category));
        AssertIndex(entity, false, nameof(CookieInventoryItem.TenantId));
        AssertIndex(entity, false, nameof(CookieInventoryItem.IsActive));
        entity.GetForeignKeys().Should().ContainSingle(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(Tenant)
            && foreignKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(CookieInventoryItem.TenantId) })
            && foreignKey.DeleteBehavior == DeleteBehavior.Restrict);
    }

    [Fact]
    public void Migration_CreatesOnlyCookieInventory()
    {
        var migration = Migration();
        migration.UpOperations.OfType<CreateTableOperation>().Should().ContainSingle()
            .Which.Name.Should().Be("cookie_inventory");
        migration.UpOperations.Where(operation => operation is not CreateTableOperation)
            .Should().OnlyContain(operation => operation is CreateIndexOperation);
        migration.UpOperations.Where(operation =>
                operation is DropTableOperation or DropColumnOperation or AlterColumnOperation or SqlOperation)
            .Should().BeEmpty();
    }

    private static void AssertLength(IEntityType entity, string property, int length) =>
        entity.FindProperty(property)!.GetMaxLength().Should().Be(length);

    private static void AssertIndex(IEntityType entity, bool unique, params string[] properties) =>
        entity.GetIndexes().Should().Contain(index =>
            index.IsUnique == unique
            && index.Properties.Select(property => property.Name).SequenceEqual(properties));

    private static Migration Migration()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var match = migrations.Migrations.Single(pair =>
            pair.Key.EndsWith(MigrationSuffix, StringComparison.Ordinal));
        return migrations.CreateMigration(match.Value, db.Database.ProviderName!);
    }

    private static IEntityType Entity(NexusDbContext db) => db.Model.FindEntityType(typeof(CookieInventoryItem))!;

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
