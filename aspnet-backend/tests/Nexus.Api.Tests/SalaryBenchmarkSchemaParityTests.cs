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

public sealed class SalaryBenchmarkSchemaParityTests
{
    private const string MigrationSuffix = "SalaryBenchmarkStorageParity";

    [Fact]
    public void Entity_MapsCurrentLaravelColumnsWithoutHidingGlobalRows()
    {
        using var db = Context(42);
        var entity = Entity(db);
        var mappings = new[]
        {
            (nameof(SalaryBenchmark.Id), "id"),
            (nameof(SalaryBenchmark.TenantId), "tenant_id"),
            (nameof(SalaryBenchmark.RoleKeyword), "role_keyword"),
            (nameof(SalaryBenchmark.Industry), "industry"),
            (nameof(SalaryBenchmark.Location), "location"),
            (nameof(SalaryBenchmark.SalaryMin), "salary_min"),
            (nameof(SalaryBenchmark.SalaryMax), "salary_max"),
            (nameof(SalaryBenchmark.SalaryMedian), "salary_median"),
            (nameof(SalaryBenchmark.SalaryType), "salary_type"),
            (nameof(SalaryBenchmark.Currency), "currency"),
            (nameof(SalaryBenchmark.Year), "year"),
            (nameof(SalaryBenchmark.Source), "source"),
            (nameof(SalaryBenchmark.CreatedAt), "created_at"),
        };

        entity.GetTableName().Should().Be("salary_benchmarks");
        entity.GetQueryFilter().Should().BeNull("global benchmarks have a null tenant_id and must remain visible");
        entity.GetProperties().Select(property => property.Name)
            .Should().BeEquivalentTo(mappings.Select(mapping => mapping.Item1));
        var table = StoreObjectIdentifier.Table("salary_benchmarks", entity.GetSchema());
        foreach (var (property, column) in mappings)
        {
            entity.FindProperty(property)!.GetColumnName(table).Should().Be(column);
        }
    }

    [Fact]
    public void Entity_PreservesCurrentLaravelTypesDefaultsIndexesAndOptionalTenant()
    {
        using var db = Context(42);
        var entity = Entity(db);

        AssertLength(entity, nameof(SalaryBenchmark.RoleKeyword), 100);
        AssertLength(entity, nameof(SalaryBenchmark.Industry), 100);
        AssertLength(entity, nameof(SalaryBenchmark.Location), 100);
        AssertLength(entity, nameof(SalaryBenchmark.SalaryType), 10);
        AssertLength(entity, nameof(SalaryBenchmark.Currency), 10);
        AssertLength(entity, nameof(SalaryBenchmark.Source), 200);
        AssertMoney(entity, nameof(SalaryBenchmark.SalaryMin));
        AssertMoney(entity, nameof(SalaryBenchmark.SalaryMax));
        AssertMoney(entity, nameof(SalaryBenchmark.SalaryMedian));
        entity.FindProperty(nameof(SalaryBenchmark.TenantId))!.IsNullable.Should().BeTrue();
        entity.FindProperty(nameof(SalaryBenchmark.SalaryType))!.GetDefaultValue().Should().Be("annual");
        entity.FindProperty(nameof(SalaryBenchmark.Currency))!.GetDefaultValue().Should().Be("EUR");
        entity.FindProperty(nameof(SalaryBenchmark.Year))!.GetDefaultValue().Should().Be((short)2026);
        entity.FindProperty(nameof(SalaryBenchmark.CreatedAt))!.GetDefaultValueSql().Should().Be("CURRENT_TIMESTAMP");

        AssertIndex(entity, nameof(SalaryBenchmark.RoleKeyword));
        AssertIndex(entity, nameof(SalaryBenchmark.TenantId));
        entity.GetForeignKeys().Should().ContainSingle(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(Tenant)
            && foreignKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(SalaryBenchmark.TenantId) })
            && foreignKey.DeleteBehavior == DeleteBehavior.Restrict);
    }

    [Fact]
    public void Migration_CreatesOnlySalaryBenchmarks()
    {
        var migration = Migration();
        migration.UpOperations.OfType<CreateTableOperation>().Should().ContainSingle()
            .Which.Name.Should().Be("salary_benchmarks");
        migration.UpOperations.Where(operation => operation is not CreateTableOperation)
            .Should().OnlyContain(operation => operation is CreateIndexOperation);
        migration.UpOperations.Where(operation =>
                operation is DropTableOperation or DropColumnOperation or AlterColumnOperation or SqlOperation)
            .Should().BeEmpty();
    }

    private static void AssertLength(IEntityType entity, string property, int length) =>
        entity.FindProperty(property)!.GetMaxLength().Should().Be(length);

    private static void AssertMoney(IEntityType entity, string property)
    {
        entity.FindProperty(property)!.GetPrecision().Should().Be(10);
        entity.FindProperty(property)!.GetScale().Should().Be(2);
    }

    private static void AssertIndex(IEntityType entity, params string[] properties) =>
        entity.GetIndexes().Should().Contain(index =>
            index.Properties.Select(property => property.Name).SequenceEqual(properties));

    private static Migration Migration()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var match = migrations.Migrations.Single(pair =>
            pair.Key.EndsWith(MigrationSuffix, StringComparison.Ordinal));
        return migrations.CreateMigration(match.Value, db.Database.ProviderName!);
    }

    private static IEntityType Entity(NexusDbContext db) => db.Model.FindEntityType(typeof(SalaryBenchmark))!;

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
