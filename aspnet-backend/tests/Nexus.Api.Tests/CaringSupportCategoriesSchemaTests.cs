// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class CaringSupportCategoriesSchemaTests
{
    private const string EntityTypeName = "Nexus.Api.Entities.CaringSupportCategory, Nexus.Api";

    [Fact]
    public void CaringSupportCategory_MapsLaravelPilotTaxonomyTable()
    {
        var type = Resolve(EntityTypeName);
        typeof(ITenantEntity).IsAssignableFrom(type).Should().BeTrue();

        using var db = CreateDbContext(CreateTenantContext(42));
        var entity = db.Model.FindEntityType(type);

        entity.Should().NotBeNull("caring_support_categories is a Laravel schema parity table");
        var mappedEntity = entity!;
        mappedEntity.GetTableName().Should().Be("caring_support_categories");
        mappedEntity.GetQueryFilter().Should().NotBeNull("caring support categories must stay tenant isolated");

        Column(mappedEntity, "Id").Should().Be("id");
        Column(mappedEntity, "TenantId").Should().Be("tenant_id");
        Column(mappedEntity, "Name").Should().Be("name");
        Column(mappedEntity, "Slug").Should().Be("slug");
        Column(mappedEntity, "Description").Should().Be("description");
        Column(mappedEntity, "Color").Should().Be("color");
        Column(mappedEntity, "Icon").Should().Be("icon");
        Column(mappedEntity, "IsActive").Should().Be("is_active");
        Column(mappedEntity, "SortOrder").Should().Be("sort_order");
        Column(mappedEntity, "SubstitutionCoefficient").Should().Be("substitution_coefficient");
        Column(mappedEntity, "CreatedAt").Should().Be("created_at");
        Column(mappedEntity, "UpdatedAt").Should().Be("updated_at");

        var coefficient = mappedEntity.FindProperty("SubstitutionCoefficient");
        coefficient.Should().NotBeNull();
        coefficient!.GetPrecision().Should().Be(3);
        coefficient.GetScale().Should().Be(2);
        coefficient.GetDefaultValue().Should().Be(1m);

        HasIndex(mappedEntity, unique: true, "TenantId", "Slug").Should().BeTrue();
        HasIndex(mappedEntity, unique: false, "TenantId", "IsActive", "SortOrder").Should().BeTrue();
    }

    private static bool HasIndex(
        Microsoft.EntityFrameworkCore.Metadata.IEntityType entity,
        bool unique,
        params string[] propertyNames)
    {
        return entity.GetIndexes().Any(index =>
            index.IsUnique == unique
            && index.Properties.Select(property => property.Name).SequenceEqual(propertyNames));
    }

    private static string? Column(Microsoft.EntityFrameworkCore.Metadata.IEntityType entity, string propertyName)
    {
        var table = StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema());
        return entity.FindProperty(propertyName)?.GetColumnName(table);
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"{typeName} should exist for Laravel schema parity");
        return type!;
    }
}
