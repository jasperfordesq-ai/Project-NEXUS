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

public sealed class MemberResidencyVerificationSchemaParityTests
{
    private const string MigrationSuffix = "MemberResidencyVerificationStorageParity";

    [Fact]
    public void Entity_MapsExactLaravelColumnsAndTenantFilter()
    {
        using var db = Context(42);
        var entity = Entity(db);
        var mappings = new[]
        {
            (nameof(MemberResidencyVerification.Id), "id"),
            (nameof(MemberResidencyVerification.TenantId), "tenant_id"),
            (nameof(MemberResidencyVerification.UserId), "user_id"),
            (nameof(MemberResidencyVerification.DeclaredMunicipality), "declared_municipality"),
            (nameof(MemberResidencyVerification.DeclaredPostcode), "declared_postcode"),
            (nameof(MemberResidencyVerification.DeclaredAddress), "declared_address"),
            (nameof(MemberResidencyVerification.EvidenceNote), "evidence_note"),
            (nameof(MemberResidencyVerification.Status), "status"),
            (nameof(MemberResidencyVerification.AttestedBy), "attested_by"),
            (nameof(MemberResidencyVerification.AttestedAt), "attested_at"),
            (nameof(MemberResidencyVerification.RejectionReason), "rejection_reason"),
            (nameof(MemberResidencyVerification.CreatedAt), "created_at"),
            (nameof(MemberResidencyVerification.UpdatedAt), "updated_at"),
        };

        entity.GetTableName().Should().Be("member_residency_verifications");
        entity.GetQueryFilter().Should().NotBeNull();
        entity.GetProperties().Select(property => property.Name)
            .Should().BeEquivalentTo(mappings.Select(mapping => mapping.Item1));
        var table = StoreObjectIdentifier.Table("member_residency_verifications", entity.GetSchema());
        foreach (var (property, column) in mappings)
        {
            entity.FindProperty(property)!.GetColumnName(table).Should().Be(column);
        }
    }

    [Fact]
    public void Entity_PreservesLaravelLengthsDefaultsIndexesAndTenantSafeUsers()
    {
        using var db = Context(42);
        var entity = Entity(db);
        AssertLength(entity, nameof(MemberResidencyVerification.DeclaredMunicipality), 120);
        AssertLength(entity, nameof(MemberResidencyVerification.DeclaredPostcode), 24);
        AssertLength(entity, nameof(MemberResidencyVerification.DeclaredAddress), 255);
        AssertLength(entity, nameof(MemberResidencyVerification.Status), 16);
        AssertLength(entity, nameof(MemberResidencyVerification.RejectionReason), 255);
        entity.FindProperty(nameof(MemberResidencyVerification.EvidenceNote))!.GetColumnType().Should().Be("text");
        entity.FindProperty(nameof(MemberResidencyVerification.Status))!.GetDefaultValue().Should().Be("pending");

        AssertIndex(entity, nameof(MemberResidencyVerification.TenantId));
        AssertIndex(entity, nameof(MemberResidencyVerification.UserId));
        AssertIndex(entity, nameof(MemberResidencyVerification.Status));
        AssertIndex(entity, nameof(MemberResidencyVerification.AttestedBy));
        AssertIndex(entity, nameof(MemberResidencyVerification.TenantId), nameof(MemberResidencyVerification.UserId), nameof(MemberResidencyVerification.Status));
        entity.GetForeignKeys().Should().Contain(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(User)
            && foreignKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(MemberResidencyVerification.TenantId), nameof(MemberResidencyVerification.UserId) }));
        entity.GetForeignKeys().Should().Contain(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(User)
            && foreignKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(MemberResidencyVerification.TenantId), nameof(MemberResidencyVerification.AttestedBy) }));
    }

    [Fact]
    public void Migration_CreatesOnlyMemberResidencyVerifications()
    {
        var migration = Migration();
        migration.UpOperations.OfType<CreateTableOperation>().Should().ContainSingle()
            .Which.Name.Should().Be("member_residency_verifications");
        migration.UpOperations.Where(operation => operation is not CreateTableOperation)
            .Should().OnlyContain(operation => operation is CreateIndexOperation);
        migration.UpOperations.Where(operation =>
                operation is DropTableOperation or DropColumnOperation or AlterColumnOperation or SqlOperation)
            .Should().BeEmpty();
    }

    private static void AssertLength(IEntityType entity, string property, int length) =>
        entity.FindProperty(property)!.GetMaxLength().Should().Be(length);

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

    private static IEntityType Entity(NexusDbContext db) => db.Model.FindEntityType(typeof(MemberResidencyVerification))!;

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
