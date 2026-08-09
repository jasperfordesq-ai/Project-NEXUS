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

public sealed class VereinSchemaParityTests
{
    private const string MigrationSuffix = "VereinDuesAndFederationSchemaParity";

    [Fact]
    public void VereinEntities_MapExactLaravelTablesColumnsAndTenantFilters()
    {
        using var db = Context(tenantId: 42);

        AssertColumns<VereinMembershipFee>(db, "verein_membership_fees",
            (nameof(VereinMembershipFee.Id), "id"),
            (nameof(VereinMembershipFee.OrganizationId), "organization_id"),
            (nameof(VereinMembershipFee.TenantId), "tenant_id"),
            (nameof(VereinMembershipFee.FeeAmountCents), "fee_amount_cents"),
            (nameof(VereinMembershipFee.Currency), "currency"),
            (nameof(VereinMembershipFee.BillingCycle), "billing_cycle"),
            (nameof(VereinMembershipFee.GracePeriodDays), "grace_period_days"),
            (nameof(VereinMembershipFee.LateFeeCents), "late_fee_cents"),
            (nameof(VereinMembershipFee.IsActive), "is_active"),
            (nameof(VereinMembershipFee.CreatedAt), "created_at"),
            (nameof(VereinMembershipFee.UpdatedAt), "updated_at"));

        AssertColumns<VereinMemberDue>(db, "verein_member_dues",
            (nameof(VereinMemberDue.Id), "id"),
            (nameof(VereinMemberDue.OrganizationId), "organization_id"),
            (nameof(VereinMemberDue.TenantId), "tenant_id"),
            (nameof(VereinMemberDue.UserId), "user_id"),
            (nameof(VereinMemberDue.MembershipYear), "membership_year"),
            (nameof(VereinMemberDue.AmountCents), "amount_cents"),
            (nameof(VereinMemberDue.Currency), "currency"),
            (nameof(VereinMemberDue.Status), "status"),
            (nameof(VereinMemberDue.DueDate), "due_date"),
            (nameof(VereinMemberDue.PaidAt), "paid_at"),
            (nameof(VereinMemberDue.StripePaymentIntentId), "stripe_payment_intent_id"),
            (nameof(VereinMemberDue.ReminderCount), "reminder_count"),
            (nameof(VereinMemberDue.LastReminderAt), "last_reminder_at"),
            (nameof(VereinMemberDue.ReminderEmailFailedAt), "reminder_email_failed_at"),
            (nameof(VereinMemberDue.ReminderEmailLastError), "reminder_email_last_error"),
            (nameof(VereinMemberDue.GeneratedEmailSentAt), "generated_email_sent_at"),
            (nameof(VereinMemberDue.GeneratedEmailFailedAt), "generated_email_failed_at"),
            (nameof(VereinMemberDue.PaidEmailSentAt), "paid_email_sent_at"),
            (nameof(VereinMemberDue.PaidEmailFailedAt), "paid_email_failed_at"),
            (nameof(VereinMemberDue.WaivedByAdminId), "waived_by_admin_id"),
            (nameof(VereinMemberDue.WaivedReason), "waived_reason"),
            (nameof(VereinMemberDue.RefundedAt), "refunded_at"),
            (nameof(VereinMemberDue.CreatedAt), "created_at"),
            (nameof(VereinMemberDue.UpdatedAt), "updated_at"));

        AssertColumns<VereinDuesPayment>(db, "verein_dues_payments",
            (nameof(VereinDuesPayment.Id), "id"),
            (nameof(VereinDuesPayment.DuesId), "dues_id"),
            (nameof(VereinDuesPayment.TenantId), "tenant_id"),
            (nameof(VereinDuesPayment.StripePaymentIntentId), "stripe_payment_intent_id"),
            (nameof(VereinDuesPayment.AmountCents), "amount_cents"),
            (nameof(VereinDuesPayment.Currency), "currency"),
            (nameof(VereinDuesPayment.PaidAt), "paid_at"),
            (nameof(VereinDuesPayment.PaymentMethod), "payment_method"),
            (nameof(VereinDuesPayment.ReceiptUrl), "receipt_url"),
            (nameof(VereinDuesPayment.CreatedAt), "created_at"),
            (nameof(VereinDuesPayment.UpdatedAt), "updated_at"));

        AssertColumns<VereinEventShare>(db, "verein_event_shares",
            (nameof(VereinEventShare.Id), "id"),
            (nameof(VereinEventShare.SourceOrganizationId), "source_organization_id"),
            (nameof(VereinEventShare.TargetOrganizationId), "target_organization_id"),
            (nameof(VereinEventShare.EventId), "event_id"),
            (nameof(VereinEventShare.TenantId), "tenant_id"),
            (nameof(VereinEventShare.SharedAt), "shared_at"),
            (nameof(VereinEventShare.Status), "status"),
            (nameof(VereinEventShare.CreatedAt), "created_at"),
            (nameof(VereinEventShare.UpdatedAt), "updated_at"));

        AssertColumns<VereinCrossInvitation>(db, "verein_cross_invitations",
            (nameof(VereinCrossInvitation.Id), "id"),
            (nameof(VereinCrossInvitation.SourceOrganizationId), "source_organization_id"),
            (nameof(VereinCrossInvitation.TargetOrganizationId), "target_organization_id"),
            (nameof(VereinCrossInvitation.TenantId), "tenant_id"),
            (nameof(VereinCrossInvitation.InviterUserId), "inviter_user_id"),
            (nameof(VereinCrossInvitation.InviteeUserId), "invitee_user_id"),
            (nameof(VereinCrossInvitation.Message), "message"),
            (nameof(VereinCrossInvitation.Status), "status"),
            (nameof(VereinCrossInvitation.SentAt), "sent_at"),
            (nameof(VereinCrossInvitation.RespondedAt), "responded_at"),
            (nameof(VereinCrossInvitation.ExpiresAt), "expires_at"),
            (nameof(VereinCrossInvitation.CreatedAt), "created_at"),
            (nameof(VereinCrossInvitation.UpdatedAt), "updated_at"));
    }

    [Fact]
    public void VereinEntities_PreserveLaravelDefaultsLengthsIndexesAndTenantRelationships()
    {
        using var db = Context(tenantId: 42);

        var fee = Entity<VereinMembershipFee>(db);
        AssertProperty(fee, nameof(VereinMembershipFee.Currency), 3, "CHF");
        AssertProperty(fee, nameof(VereinMembershipFee.BillingCycle), 16, "annual");
        AssertProperty(fee, nameof(VereinMembershipFee.GracePeriodDays), defaultValue: 30);
        AssertProperty(fee, nameof(VereinMembershipFee.IsActive), defaultValue: true);
        AssertIndex(fee, "verein_fees_org_unique", true, nameof(VereinMembershipFee.OrganizationId));
        AssertIndex(fee, "verein_fees_tenant_active_idx", false,
            nameof(VereinMembershipFee.TenantId), nameof(VereinMembershipFee.IsActive));
        AssertCompositeForeignKey<VereinMembershipFee, VolunteerOrganisation>(db, DeleteBehavior.Restrict,
            nameof(VereinMembershipFee.TenantId), nameof(VereinMembershipFee.OrganizationId));

        var due = Entity<VereinMemberDue>(db);
        AssertProperty(due, nameof(VereinMemberDue.Currency), 3, "CHF");
        AssertProperty(due, nameof(VereinMemberDue.Status), 16, "pending");
        AssertProperty(due, nameof(VereinMemberDue.StripePaymentIntentId), 191);
        AssertProperty(due, nameof(VereinMemberDue.ReminderCount), defaultValue: 0);
        AssertProperty(due, nameof(VereinMemberDue.WaivedReason), 500);
        due.FindProperty(nameof(VereinMemberDue.DueDate))!.GetColumnType().Should().Be("date");
        AssertIndex(due, "verein_dues_org_user_year_unique", true,
            nameof(VereinMemberDue.OrganizationId), nameof(VereinMemberDue.UserId), nameof(VereinMemberDue.MembershipYear));
        AssertIndex(due, "verein_dues_tenant_status_idx", false,
            nameof(VereinMemberDue.TenantId), nameof(VereinMemberDue.Status));
        AssertCompositeForeignKey<VereinMemberDue, VolunteerOrganisation>(db, DeleteBehavior.Restrict,
            nameof(VereinMemberDue.TenantId), nameof(VereinMemberDue.OrganizationId));
        AssertCompositeForeignKey<VereinMemberDue, User>(db, DeleteBehavior.Restrict,
            nameof(VereinMemberDue.TenantId), nameof(VereinMemberDue.UserId));
        AssertCompositeForeignKey<VereinMemberDue, User>(db, DeleteBehavior.Restrict,
            nameof(VereinMemberDue.TenantId), nameof(VereinMemberDue.WaivedByAdminId));

        var payment = Entity<VereinDuesPayment>(db);
        AssertProperty(payment, nameof(VereinDuesPayment.StripePaymentIntentId), 191);
        AssertProperty(payment, nameof(VereinDuesPayment.Currency), 3, "CHF");
        AssertProperty(payment, nameof(VereinDuesPayment.PaymentMethod), 50);
        AssertProperty(payment, nameof(VereinDuesPayment.ReceiptUrl), 500);
        AssertIndex(payment, "verein_dues_pmts_pi_unique", true,
            nameof(VereinDuesPayment.StripePaymentIntentId));
        AssertCompositeForeignKey<VereinDuesPayment, VereinMemberDue>(db, DeleteBehavior.Restrict,
            nameof(VereinDuesPayment.TenantId), nameof(VereinDuesPayment.DuesId));

        var share = Entity<VereinEventShare>(db);
        AssertProperty(share, nameof(VereinEventShare.Status), 16, "active");
        share.FindProperty(nameof(VereinEventShare.SharedAt))!.GetDefaultValueSql().Should().Be("CURRENT_TIMESTAMP");
        AssertIndex(share, "verein_event_shares_unique_target", true,
            nameof(VereinEventShare.TenantId), nameof(VereinEventShare.EventId), nameof(VereinEventShare.TargetOrganizationId));
        AssertCompositeForeignKey<VereinEventShare, Event>(db, DeleteBehavior.Restrict,
            nameof(VereinEventShare.TenantId), nameof(VereinEventShare.EventId));

        var invitation = Entity<VereinCrossInvitation>(db);
        AssertProperty(invitation, nameof(VereinCrossInvitation.Status), 16, "sent");
        invitation.FindProperty(nameof(VereinCrossInvitation.SentAt))!.GetDefaultValueSql().Should().Be("CURRENT_TIMESTAMP");
        AssertIndex(invitation, "verein_cross_inv_expiry_idx", false,
            nameof(VereinCrossInvitation.TenantId), nameof(VereinCrossInvitation.Status), nameof(VereinCrossInvitation.ExpiresAt));
        AssertCompositeForeignKey<VereinCrossInvitation, User>(db, DeleteBehavior.Restrict,
            nameof(VereinCrossInvitation.TenantId), nameof(VereinCrossInvitation.InviterUserId));
        AssertCompositeForeignKey<VereinCrossInvitation, User>(db, DeleteBehavior.Restrict,
            nameof(VereinCrossInvitation.TenantId), nameof(VereinCrossInvitation.InviteeUserId));

        Entity<Event>(db).GetKeys().Should().Contain(key =>
            key.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(Event.TenantId), nameof(Event.Id) }));
    }

    [Fact]
    public void Migration_CreatesOnlyTheFiveVereinTablesAndEventTenantKey()
    {
        var migration = Migration();
        var creates = migration.UpOperations.OfType<CreateTableOperation>().ToArray();

        creates.Select(table => table.Name).Should().BeEquivalentTo(
            "verein_membership_fees",
            "verein_member_dues",
            "verein_dues_payments",
            "verein_event_shares",
            "verein_cross_invitations");
        migration.UpOperations.OfType<AddUniqueConstraintOperation>()
            .Should().ContainSingle(operation => operation.Table == "events"
                && operation.Name == "AK_events_TenantId_Id"
                && operation.Columns.SequenceEqual(new[] { "TenantId", "Id" }));
        migration.UpOperations.Where(operation =>
                operation is DropTableOperation or DropColumnOperation or AlterColumnOperation or SqlOperation)
            .Should().BeEmpty();

        var eventShares = creates.Single(table => table.Name == "verein_event_shares");
        eventShares.ForeignKeys.Should().Contain(foreignKey =>
            foreignKey.PrincipalTable == "events"
            && foreignKey.Columns.SequenceEqual(new[] { "tenant_id", "event_id" })
            && foreignKey.PrincipalColumns!.SequenceEqual(new[] { "TenantId", "Id" })
            && foreignKey.OnDelete == ReferentialAction.Restrict);

        var memberDues = creates.Single(table => table.Name == "verein_member_dues");
        memberDues.ForeignKeys.Should().Contain(foreignKey =>
            foreignKey.PrincipalTable == "users"
            && foreignKey.Columns.SequenceEqual(new[] { "tenant_id", "waived_by_admin_id" })
            && foreignKey.OnDelete == ReferentialAction.Restrict);
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
        where TEntity : class, ITenantEntity
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

    private static void AssertProperty(
        IEntityType entity,
        string propertyName,
        int? maxLength = null,
        object? defaultValue = null)
    {
        var property = entity.FindProperty(propertyName);
        property.Should().NotBeNull();
        property!.GetMaxLength().Should().Be(maxLength);
        if (defaultValue is not null)
        {
            property.GetDefaultValue().Should().Be(defaultValue);
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

    private static void AssertCompositeForeignKey<TEntity, TPrincipal>(
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
