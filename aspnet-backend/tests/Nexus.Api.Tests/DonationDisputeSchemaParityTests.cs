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

public sealed class DonationDisputeSchemaParityTests
{
    private const string MigrationSuffix = "DonationDisputeStorageParity";

    [Fact]
    public void Entity_MapsExactLaravelTableColumnsAndTenantFilter()
    {
        using var db = Context(42);
        var entity = Entity(db);
        entity.GetTableName().Should().Be("donation_disputes");
        entity.GetQueryFilter().Should().NotBeNull();

        var mappings = new[]
        {
            (nameof(DonationDispute.Id), "id"),
            (nameof(DonationDispute.TenantId), "tenant_id"),
            (nameof(DonationDispute.VolDonationId), "vol_donation_id"),
            (nameof(DonationDispute.StripeDisputeId), "stripe_dispute_id"),
            (nameof(DonationDispute.PaymentIntentId), "payment_intent_id"),
            (nameof(DonationDispute.ChargeId), "charge_id"),
            (nameof(DonationDispute.Amount), "amount"),
            (nameof(DonationDispute.Currency), "currency"),
            (nameof(DonationDispute.Status), "status"),
            (nameof(DonationDispute.Reason), "reason"),
            (nameof(DonationDispute.EvidenceDueAt), "evidence_due_at"),
            (nameof(DonationDispute.PaymentRoute), "payment_route"),
            (nameof(DonationDispute.StripeAccountId), "stripe_account_id"),
            (nameof(DonationDispute.PayloadJson), "payload"),
            (nameof(DonationDispute.CreatedAt), "created_at"),
            (nameof(DonationDispute.UpdatedAt), "updated_at"),
        };
        entity.GetProperties().Select(property => property.Name)
            .Should().BeEquivalentTo(mappings.Select(mapping => mapping.Item1));
        var table = StoreObjectIdentifier.Table("donation_disputes", entity.GetSchema());
        foreach (var (property, column) in mappings)
        {
            entity.FindProperty(property)!.GetColumnName(table).Should().Be(column);
        }
    }

    [Fact]
    public void Entity_PreservesLaravelLengthsDefaultsJsonAndIndexes()
    {
        using var db = Context(42);
        var entity = Entity(db);

        AssertProperty(entity, nameof(DonationDispute.StripeDisputeId), 120);
        AssertProperty(entity, nameof(DonationDispute.PaymentIntentId), 120);
        AssertProperty(entity, nameof(DonationDispute.ChargeId), 120);
        AssertProperty(entity, nameof(DonationDispute.Currency), 3, "gbp");
        AssertProperty(entity, nameof(DonationDispute.Status), 64, "needs_response");
        AssertProperty(entity, nameof(DonationDispute.Reason), 120);
        AssertProperty(entity, nameof(DonationDispute.PaymentRoute), 50, "platform_default");
        AssertProperty(entity, nameof(DonationDispute.StripeAccountId), 100);
        entity.FindProperty(nameof(DonationDispute.Amount))!.GetDefaultValue().Should().Be(0);
        entity.FindProperty(nameof(DonationDispute.PayloadJson))!.GetColumnType().Should().Be("jsonb");

        AssertIndex(entity, true, nameof(DonationDispute.StripeDisputeId));
        AssertIndex(entity, false, nameof(DonationDispute.TenantId), nameof(DonationDispute.Status));
        AssertIndex(entity, false, nameof(DonationDispute.TenantId), nameof(DonationDispute.CreatedAt));
        AssertIndex(entity, false, nameof(DonationDispute.PaymentIntentId));
        entity.GetForeignKeys().Should().ContainSingle(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(Tenant)
            && foreignKey.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(DonationDispute.TenantId) })
            && foreignKey.DeleteBehavior == DeleteBehavior.Restrict);
    }

    [Fact]
    public void Migration_CreatesOnlyDonationDisputes()
    {
        var migration = Migration();
        var create = migration.UpOperations.OfType<CreateTableOperation>().Should().ContainSingle().Subject;
        create.Name.Should().Be("donation_disputes");
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

    private static void AssertProperty(IEntityType entity, string name, int? length = null, object? defaultValue = null)
    {
        var property = entity.FindProperty(name)!;
        property.GetMaxLength().Should().Be(length);
        if (defaultValue is not null)
        {
            property.GetDefaultValue().Should().Be(defaultValue);
        }
    }

    private static void AssertIndex(IEntityType entity, bool unique, params string[] properties)
    {
        var index = entity.GetIndexes().Single(candidate =>
            candidate.Properties.Select(property => property.Name).SequenceEqual(properties));
        index.IsUnique.Should().Be(unique);
    }

    private static IEntityType Entity(NexusDbContext db) => db.Model.FindEntityType(typeof(DonationDispute))!;

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
