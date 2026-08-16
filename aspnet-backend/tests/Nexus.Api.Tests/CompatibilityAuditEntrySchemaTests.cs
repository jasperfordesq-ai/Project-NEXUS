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

/// <summary>
/// Focused source/runtime pin for migration 163
/// (20260715184200_AddCompatibilityAuditEntriesTable) — the fresh-chain repair
/// recorded in CURRENT_SCHEMA_READINESS.md. The EF model and snapshot carried
/// compatibility_audit_entries while the runtime migration chain did not
/// create it, so the model, the migration id, and the table's constraints and
/// indexes are pinned here together. The disposable-database replay evidence
/// (zero-to-163 and populated 162-to-163) lives in the schema readiness
/// document; this class keeps the source side from drifting.
/// </summary>
public sealed class CompatibilityAuditEntrySchemaTests
{
    private const string RepairMigrationId = "20260715184200_AddCompatibilityAuditEntriesTable";

    [Fact]
    public void CompatibilityAuditEntry_MapsTheRepairedTableWithConstraintsAndIndexes()
    {
        typeof(ITenantEntity).IsAssignableFrom(typeof(CompatibilityAuditEntry)).Should().BeTrue();

        using var db = CreateDbContext(CreateTenantContext(42));
        var entity = db.Model.FindEntityType(typeof(CompatibilityAuditEntry));

        entity.Should().NotBeNull("compatibility_audit_entries is the migration-163 repair table");
        var mapped = entity!;
        mapped.GetTableName().Should().Be("compatibility_audit_entries");
        mapped.GetQueryFilter().Should().NotBeNull("audit entries must stay tenant isolated");

        mapped.FindPrimaryKey()!.Properties.Select(p => p.Name).Should().Equal("Id");

        mapped.FindProperty("Endpoint")!.GetMaxLength().Should().Be(500);
        mapped.FindProperty("Endpoint")!.IsNullable.Should().BeFalse();
        mapped.FindProperty("HttpMethod")!.GetMaxLength().Should().Be(10);
        mapped.FindProperty("HttpMethod")!.IsNullable.Should().BeFalse();
        mapped.FindProperty("Action")!.GetMaxLength().Should().Be(20);
        mapped.FindProperty("RequestBody")!.GetColumnType().Should().Be("jsonb");
        mapped.FindProperty("RequestBody")!.IsNullable.Should().BeFalse();
        mapped.FindProperty("ResponseBody")!.GetColumnType().Should().Be("jsonb");
        mapped.FindProperty("ResponseBody")!.IsNullable.Should().BeFalse();
        mapped.FindProperty("UserId")!.IsNullable.Should().BeTrue(
            "the user foreign key is SetNull, so the column must accept null");

        HasIndex(mapped, "TenantId").Should().BeTrue();
        HasIndex(mapped, "TenantId", "Endpoint").Should().BeTrue();
        HasIndex(mapped, "OccurredAt").Should().BeTrue();

        var tenantFk = mapped.GetForeignKeys()
            .Single(fk => fk.PrincipalEntityType.ClrType == typeof(Tenant));
        tenantFk.DeleteBehavior.Should().Be(DeleteBehavior.Restrict,
            "a tenant with audit history must not be silently deletable");
        var userFk = mapped.GetForeignKeys()
            .Single(fk => fk.PrincipalEntityType.ClrType == typeof(User));
        userFk.DeleteBehavior.Should().Be(DeleteBehavior.SetNull,
            "deleting a member keeps the audit row but detaches the user");
    }

    [Fact]
    public void RepairMigration_IsPresentInTheRuntimeChain()
    {
        using var db = CreateDbContext(CreateTenantContext(42));
        var migrations = db.Database.GetMigrations().ToArray();

        migrations.Should().Contain(RepairMigrationId,
            "the fresh-chain hole was that the model had the table while the runtime chain did not create it");
        migrations.Last().Should().Be("20260816144805_AddVolunteerProjectSupporters",
            "the chain currently ends with vol_community_project_supporters — backing a "
            + "project wrote to a config blob and the project list carried no supporter_count, "
            + "so the whole feature was cosmetic; "
            + "adding a migration is fine but must be deliberate — update this pin in the same commit. "
            + "Note migrations sort by TIMESTAMP, not authoring order: AddTenantHierarchy "
            + "(20260815125256) was written after AddGuardianConsentMutationGuard (20260815131500) "
            + "but sorts before it, so check the sorted order rather than assuming the newest file wins");
    }

    private static bool HasIndex(IEntityType entity, params string[] propertyNames)
    {
        return entity.GetIndexes().Any(index =>
            index.Properties.Select(property => property.Name).SequenceEqual(propertyNames));
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
            .UseNpgsql("Host=localhost;Database=nexus_schema_metadata;Username=nexus;Password=nexus")
            .Options;

        return new NexusDbContext(options, tenant);
    }
}
