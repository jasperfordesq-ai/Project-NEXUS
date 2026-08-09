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

public sealed class PilotInquirySchemaParityTests
{
    private const string MigrationSuffix = "PilotInquiryStorageParity";

    [Fact]
    public void Entity_MapsExactLaravelTableColumnsAndTenantFilter()
    {
        using var db = Context(42);
        var entity = Entity(db);
        var mappings = new[]
        {
            (nameof(PilotInquiry.Id), "id"),
            (nameof(PilotInquiry.TenantId), "tenant_id"),
            (nameof(PilotInquiry.MunicipalityName), "municipality_name"),
            (nameof(PilotInquiry.Region), "region"),
            (nameof(PilotInquiry.Country), "country"),
            (nameof(PilotInquiry.Population), "population"),
            (nameof(PilotInquiry.ContactName), "contact_name"),
            (nameof(PilotInquiry.ContactEmail), "contact_email"),
            (nameof(PilotInquiry.ContactPhone), "contact_phone"),
            (nameof(PilotInquiry.ContactRole), "contact_role"),
            (nameof(PilotInquiry.HasKissCooperative), "has_kiss_cooperative"),
            (nameof(PilotInquiry.HasExistingDigitalTool), "has_existing_digital_tool"),
            (nameof(PilotInquiry.ExistingToolName), "existing_tool_name"),
            (nameof(PilotInquiry.TimelineMonths), "timeline_months"),
            (nameof(PilotInquiry.InterestModulesJson), "interest_modules"),
            (nameof(PilotInquiry.BudgetIndication), "budget_indication"),
            (nameof(PilotInquiry.Notes), "notes"),
            (nameof(PilotInquiry.FitScore), "fit_score"),
            (nameof(PilotInquiry.FitBreakdownJson), "fit_breakdown"),
            (nameof(PilotInquiry.Stage), "stage"),
            (nameof(PilotInquiry.AssignedTo), "assigned_to"),
            (nameof(PilotInquiry.ProposalSentAt), "proposal_sent_at"),
            (nameof(PilotInquiry.PilotAgreedAt), "pilot_agreed_at"),
            (nameof(PilotInquiry.WentLiveAt), "went_live_at"),
            (nameof(PilotInquiry.RejectionReason), "rejection_reason"),
            (nameof(PilotInquiry.InternalNotes), "internal_notes"),
            (nameof(PilotInquiry.Source), "source"),
            (nameof(PilotInquiry.CreatedAt), "created_at"),
            (nameof(PilotInquiry.UpdatedAt), "updated_at"),
        };

        entity.GetTableName().Should().Be("pilot_inquiries");
        entity.GetQueryFilter().Should().NotBeNull();
        entity.GetProperties().Select(property => property.Name)
            .Should().BeEquivalentTo(mappings.Select(mapping => mapping.Item1));
        var table = StoreObjectIdentifier.Table("pilot_inquiries", entity.GetSchema());
        foreach (var (property, column) in mappings)
        {
            entity.FindProperty(property)!.GetColumnName(table).Should().Be(column);
        }
    }

    [Fact]
    public void Entity_PreservesLaravelTypesDefaultsIndexesAndTenantSafeAssignee()
    {
        using var db = Context(42);
        var entity = Entity(db);

        AssertLength(entity, nameof(PilotInquiry.MunicipalityName), 255);
        AssertLength(entity, nameof(PilotInquiry.Region), 255);
        AssertLength(entity, nameof(PilotInquiry.Country), 2);
        AssertLength(entity, nameof(PilotInquiry.ContactName), 255);
        AssertLength(entity, nameof(PilotInquiry.ContactEmail), 255);
        AssertLength(entity, nameof(PilotInquiry.ContactPhone), 50);
        AssertLength(entity, nameof(PilotInquiry.ContactRole), 100);
        AssertLength(entity, nameof(PilotInquiry.ExistingToolName), 255);
        AssertLength(entity, nameof(PilotInquiry.BudgetIndication), 50);
        AssertLength(entity, nameof(PilotInquiry.Stage), 20);
        AssertLength(entity, nameof(PilotInquiry.Source), 50);
        entity.FindProperty(nameof(PilotInquiry.Country))!.GetDefaultValue().Should().Be("CH");
        entity.FindProperty(nameof(PilotInquiry.HasKissCooperative))!.GetDefaultValue().Should().Be((short)0);
        entity.FindProperty(nameof(PilotInquiry.HasExistingDigitalTool))!.GetDefaultValue().Should().Be((short)0);
        entity.FindProperty(nameof(PilotInquiry.Stage))!.GetDefaultValue().Should().Be("new");
        entity.FindProperty(nameof(PilotInquiry.InterestModulesJson))!.GetColumnType().Should().Be("jsonb");
        entity.FindProperty(nameof(PilotInquiry.FitBreakdownJson))!.GetColumnType().Should().Be("jsonb");
        var fitScore = entity.FindProperty(nameof(PilotInquiry.FitScore))!;
        fitScore.GetPrecision().Should().Be(4);
        fitScore.GetScale().Should().Be(1);

        AssertIndex(entity, false, nameof(PilotInquiry.TenantId));
        AssertIndex(entity, false, nameof(PilotInquiry.TenantId), nameof(PilotInquiry.Stage));
        AssertIndex(entity, false, nameof(PilotInquiry.ContactEmail));
        entity.GetForeignKeys().Should().Contain(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(User)
            && foreignKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(PilotInquiry.TenantId), nameof(PilotInquiry.AssignedTo) })
            && foreignKey.PrincipalKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(User.TenantId), nameof(User.Id) })
            && foreignKey.DeleteBehavior == DeleteBehavior.Restrict);
    }

    [Fact]
    public void Migration_CreatesOnlyPilotInquiries()
    {
        var migration = Migration();
        migration.UpOperations.OfType<CreateTableOperation>().Should().ContainSingle()
            .Which.Name.Should().Be("pilot_inquiries");
        migration.UpOperations.Where(operation => operation is not CreateTableOperation)
            .Should().OnlyContain(operation => operation is CreateIndexOperation);
        migration.UpOperations.Where(operation =>
                operation is DropTableOperation or DropColumnOperation or AlterColumnOperation or SqlOperation)
            .Should().BeEmpty();
    }

    private static void AssertLength(IEntityType entity, string property, int length) =>
        entity.FindProperty(property)!.GetMaxLength().Should().Be(length);

    private static void AssertIndex(IEntityType entity, bool unique, params string[] properties)
    {
        var index = entity.GetIndexes().Single(candidate =>
            candidate.Properties.Select(property => property.Name).SequenceEqual(properties));
        index.IsUnique.Should().Be(unique);
    }

    private static Migration Migration()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var match = migrations.Migrations.Single(pair =>
            pair.Key.EndsWith(MigrationSuffix, StringComparison.Ordinal));
        return migrations.CreateMigration(match.Value, db.Database.ProviderName!);
    }

    private static IEntityType Entity(NexusDbContext db) => db.Model.FindEntityType(typeof(PilotInquiry))!;

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
