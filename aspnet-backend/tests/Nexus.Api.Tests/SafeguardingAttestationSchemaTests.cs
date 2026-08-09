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

public sealed class SafeguardingAttestationSchemaTests
{
    [Fact]
    public void CanonicalEntities_MapExactLaravelTablesColumnsAndTenantFilters()
    {
        using var db = Context(tenantId: 42);

        AssertColumns<TenantSafeguardingSetting>(db, "tenant_safeguarding_settings",
            (nameof(TenantSafeguardingSetting.TenantId), "tenant_id"),
            (nameof(TenantSafeguardingSetting.Jurisdiction), "jurisdiction"),
            (nameof(TenantSafeguardingSetting.PolicyVersion), "policy_version"),
            (nameof(TenantSafeguardingSetting.ConfiguredByUserId), "configured_by"),
            (nameof(TenantSafeguardingSetting.ConfiguredAt), "configured_at"),
            (nameof(TenantSafeguardingSetting.CreatedAt), "created_at"),
            (nameof(TenantSafeguardingSetting.UpdatedAt), "updated_at"));

        AssertColumns<MemberVettingAttestation>(db, "member_vetting_attestations",
            (nameof(MemberVettingAttestation.Id), "id"),
            (nameof(MemberVettingAttestation.TenantId), "tenant_id"),
            (nameof(MemberVettingAttestation.UserId), "user_id"),
            (nameof(MemberVettingAttestation.SchemeCode), "scheme_code"),
            (nameof(MemberVettingAttestation.AttestationCode), "attestation_code"),
            (nameof(MemberVettingAttestation.PurposeCode), "purpose_code"),
            (nameof(MemberVettingAttestation.ScopeType), "scope_type"),
            (nameof(MemberVettingAttestation.ScopeIdentifier), "scope_identifier"),
            (nameof(MemberVettingAttestation.Decision), "decision"),
            (nameof(MemberVettingAttestation.ConfirmedByUserId), "confirmed_by"),
            (nameof(MemberVettingAttestation.ConfirmedAt), "confirmed_at"),
            (nameof(MemberVettingAttestation.RevokedByUserId), "revoked_by"),
            (nameof(MemberVettingAttestation.RevokedAt), "revoked_at"),
            (nameof(MemberVettingAttestation.RevocationReasonCode), "revocation_reason_code"),
            (nameof(MemberVettingAttestation.PolicyVersion), "policy_version"),
            (nameof(MemberVettingAttestation.CreatedAt), "created_at"),
            (nameof(MemberVettingAttestation.UpdatedAt), "updated_at"));

        AssertColumns<MemberVettingAttestationEvent>(db, "member_vetting_attestation_events",
            (nameof(MemberVettingAttestationEvent.Id), "id"),
            (nameof(MemberVettingAttestationEvent.AttestationId), "attestation_id"),
            (nameof(MemberVettingAttestationEvent.TenantId), "tenant_id"),
            (nameof(MemberVettingAttestationEvent.UserId), "user_id"),
            (nameof(MemberVettingAttestationEvent.SchemeCode), "scheme_code"),
            (nameof(MemberVettingAttestationEvent.AttestationCode), "attestation_code"),
            (nameof(MemberVettingAttestationEvent.PurposeCode), "purpose_code"),
            (nameof(MemberVettingAttestationEvent.ScopeType), "scope_type"),
            (nameof(MemberVettingAttestationEvent.ScopeIdentifier), "scope_identifier"),
            (nameof(MemberVettingAttestationEvent.EventType), "event_type"),
            (nameof(MemberVettingAttestationEvent.DecisionBefore), "decision_before"),
            (nameof(MemberVettingAttestationEvent.DecisionAfter), "decision_after"),
            (nameof(MemberVettingAttestationEvent.ReasonCode), "reason_code"),
            (nameof(MemberVettingAttestationEvent.ActorUserId), "actor_user_id"),
            (nameof(MemberVettingAttestationEvent.PolicyVersion), "policy_version"),
            (nameof(MemberVettingAttestationEvent.CreatedAt), "created_at"));

        AssertColumns<SafeguardingVettingReviewRequest>(db, "safeguarding_vetting_review_requests",
            (nameof(SafeguardingVettingReviewRequest.Id), "id"),
            (nameof(SafeguardingVettingReviewRequest.TenantId), "tenant_id"),
            (nameof(SafeguardingVettingReviewRequest.UserId), "user_id"),
            (nameof(SafeguardingVettingReviewRequest.Jurisdiction), "jurisdiction"),
            (nameof(SafeguardingVettingReviewRequest.SchemeCode), "scheme_code"),
            (nameof(SafeguardingVettingReviewRequest.AttestationCode), "attestation_code"),
            (nameof(SafeguardingVettingReviewRequest.PurposeCode), "purpose_code"),
            (nameof(SafeguardingVettingReviewRequest.ScopeType), "scope_type"),
            (nameof(SafeguardingVettingReviewRequest.ScopeIdentifier), "scope_identifier"),
            (nameof(SafeguardingVettingReviewRequest.PolicyVersion), "policy_version"),
            (nameof(SafeguardingVettingReviewRequest.Status), "status"),
            (nameof(SafeguardingVettingReviewRequest.RequestSource), "request_source"),
            (nameof(SafeguardingVettingReviewRequest.RequestedByUserId), "requested_by"),
            (nameof(SafeguardingVettingReviewRequest.RequestedAt), "requested_at"),
            (nameof(SafeguardingVettingReviewRequest.HandledByUserId), "handled_by"),
            (nameof(SafeguardingVettingReviewRequest.HandledAt), "handled_at"),
            (nameof(SafeguardingVettingReviewRequest.ResolutionCode), "resolution_code"),
            (nameof(SafeguardingVettingReviewRequest.CreatedAt), "created_at"),
            (nameof(SafeguardingVettingReviewRequest.UpdatedAt), "updated_at"));

        AssertColumns<SafeguardingPolicyRotationEvent>(db, "safeguarding_policy_rotation_events",
            (nameof(SafeguardingPolicyRotationEvent.Id), "id"),
            (nameof(SafeguardingPolicyRotationEvent.TenantId), "tenant_id"),
            (nameof(SafeguardingPolicyRotationEvent.Jurisdiction), "jurisdiction"),
            (nameof(SafeguardingPolicyRotationEvent.SchemeCode), "scheme_code"),
            (nameof(SafeguardingPolicyRotationEvent.AttestationCode), "attestation_code"),
            (nameof(SafeguardingPolicyRotationEvent.PurposeCode), "purpose_code"),
            (nameof(SafeguardingPolicyRotationEvent.ScopeType), "scope_type"),
            (nameof(SafeguardingPolicyRotationEvent.ScopeIdentifier), "scope_identifier"),
            (nameof(SafeguardingPolicyRotationEvent.PreviousPolicyVersion), "previous_policy_version"),
            (nameof(SafeguardingPolicyRotationEvent.NewPolicyVersion), "new_policy_version"),
            (nameof(SafeguardingPolicyRotationEvent.ReasonCode), "reason_code"),
            (nameof(SafeguardingPolicyRotationEvent.ActorUserId), "actor_user_id"),
            (nameof(SafeguardingPolicyRotationEvent.AffectedMemberCount), "affected_member_count"),
            (nameof(SafeguardingPolicyRotationEvent.CreatedAt), "created_at"));
    }

    [Fact]
    public void CanonicalEntities_PreserveLaravelNullabilityLengthsDefaultsAndIndexes()
    {
        using var db = Context(tenantId: 42);

        var settings = Entity<TenantSafeguardingSetting>(db);
        settings.FindPrimaryKey()!.Properties.Select(property => property.Name)
            .Should().Equal(nameof(TenantSafeguardingSetting.TenantId));
        settings.FindProperty(nameof(TenantSafeguardingSetting.TenantId))!.ValueGenerated
            .Should().Be(ValueGenerated.Never);
        AssertProperty(settings, nameof(TenantSafeguardingSetting.Jurisdiction), 40);
        AssertProperty(settings, nameof(TenantSafeguardingSetting.PolicyVersion), 64, defaultValue: "1");
        settings.FindProperty(nameof(TenantSafeguardingSetting.ConfiguredAt))!.IsNullable.Should().BeFalse();
        settings.FindProperty(nameof(TenantSafeguardingSetting.CreatedAt))!.IsNullable.Should().BeTrue();
        settings.FindProperty(nameof(TenantSafeguardingSetting.UpdatedAt))!.IsNullable.Should().BeTrue();

        var attestation = Entity<MemberVettingAttestation>(db);
        AssertProperty(attestation, nameof(MemberVettingAttestation.SchemeCode), 64);
        AssertProperty(attestation, nameof(MemberVettingAttestation.AttestationCode), 64);
        AssertProperty(attestation, nameof(MemberVettingAttestation.PurposeCode), 64);
        AssertProperty(attestation, nameof(MemberVettingAttestation.ScopeType), 32, defaultValue: "tenant");
        AssertProperty(attestation, nameof(MemberVettingAttestation.ScopeIdentifier), 191, defaultValue: string.Empty);
        AssertProperty(attestation, nameof(MemberVettingAttestation.Decision), 20);
        AssertProperty(attestation, nameof(MemberVettingAttestation.RevocationReasonCode), 64);
        AssertProperty(attestation, nameof(MemberVettingAttestation.PolicyVersion), 64, defaultValue: "1");
        attestation.FindProperty(nameof(MemberVettingAttestation.CreatedAt))!.IsNullable.Should().BeTrue();
        attestation.FindProperty(nameof(MemberVettingAttestation.UpdatedAt))!.IsNullable.Should().BeTrue();
        AssertIndex(attestation, "uq_member_vetting_attestation_scope", unique: true,
            nameof(MemberVettingAttestation.TenantId),
            nameof(MemberVettingAttestation.UserId),
            nameof(MemberVettingAttestation.SchemeCode),
            nameof(MemberVettingAttestation.AttestationCode),
            nameof(MemberVettingAttestation.PurposeCode),
            nameof(MemberVettingAttestation.ScopeType),
            nameof(MemberVettingAttestation.ScopeIdentifier));
        AssertIndex(attestation, "idx_member_vetting_policy_status", unique: false,
            nameof(MemberVettingAttestation.TenantId),
            nameof(MemberVettingAttestation.UserId),
            nameof(MemberVettingAttestation.AttestationCode),
            nameof(MemberVettingAttestation.PurposeCode),
            nameof(MemberVettingAttestation.Decision));

        var auditEvent = Entity<MemberVettingAttestationEvent>(db);
        AssertProperty(auditEvent, nameof(MemberVettingAttestationEvent.EventType), 32);
        AssertProperty(auditEvent, nameof(MemberVettingAttestationEvent.DecisionBefore), 20);
        AssertProperty(auditEvent, nameof(MemberVettingAttestationEvent.DecisionAfter), 20);
        AssertProperty(auditEvent, nameof(MemberVettingAttestationEvent.ScopeIdentifier), 191, defaultValue: string.Empty);
        auditEvent.FindProperty(nameof(MemberVettingAttestationEvent.CreatedAt))!.IsNullable.Should().BeFalse();
        AssertIndex(auditEvent, "idx_vetting_event_member_history", unique: false,
            nameof(MemberVettingAttestationEvent.TenantId),
            nameof(MemberVettingAttestationEvent.UserId),
            nameof(MemberVettingAttestationEvent.CreatedAt));
        AssertIndex(auditEvent, "idx_vetting_event_actor_history", unique: false,
            nameof(MemberVettingAttestationEvent.TenantId),
            nameof(MemberVettingAttestationEvent.ActorUserId),
            nameof(MemberVettingAttestationEvent.CreatedAt));

        var review = Entity<SafeguardingVettingReviewRequest>(db);
        AssertProperty(review, nameof(SafeguardingVettingReviewRequest.Jurisdiction), 40);
        AssertProperty(review, nameof(SafeguardingVettingReviewRequest.ScopeType), 32, defaultValue: "tenant");
        AssertProperty(review, nameof(SafeguardingVettingReviewRequest.ScopeIdentifier), 191, defaultValue: string.Empty);
        AssertProperty(review, nameof(SafeguardingVettingReviewRequest.Status), 20,
            defaultValue: SafeguardingVettingReviewRequest.PendingStatus);
        AssertProperty(review, nameof(SafeguardingVettingReviewRequest.RequestSource), 32,
            defaultValue: SafeguardingVettingReviewRequest.MemberRequestSource);
        review.FindProperty(nameof(SafeguardingVettingReviewRequest.RequestedAt))!.IsNullable.Should().BeFalse();
        review.FindProperty(nameof(SafeguardingVettingReviewRequest.CreatedAt))!.IsNullable.Should().BeTrue();
        review.FindProperty(nameof(SafeguardingVettingReviewRequest.UpdatedAt))!.IsNullable.Should().BeTrue();
        AssertIndex(review, "idx_vetting_review_queue", unique: false,
            nameof(SafeguardingVettingReviewRequest.TenantId),
            nameof(SafeguardingVettingReviewRequest.Status),
            nameof(SafeguardingVettingReviewRequest.RequestedAt));
        AssertIndex(review, "idx_vetting_review_member", unique: false,
            nameof(SafeguardingVettingReviewRequest.TenantId),
            nameof(SafeguardingVettingReviewRequest.UserId),
            nameof(SafeguardingVettingReviewRequest.PurposeCode));
        AssertIndex(review, "uq_vetting_review_member_scope", unique: true,
            nameof(SafeguardingVettingReviewRequest.TenantId),
            nameof(SafeguardingVettingReviewRequest.UserId),
            nameof(SafeguardingVettingReviewRequest.PurposeCode),
            nameof(SafeguardingVettingReviewRequest.ScopeType),
            nameof(SafeguardingVettingReviewRequest.ScopeIdentifier));

        var rotation = Entity<SafeguardingPolicyRotationEvent>(db);
        AssertProperty(rotation, nameof(SafeguardingPolicyRotationEvent.AffectedMemberCount), defaultValue: 0);
        rotation.FindProperty(nameof(SafeguardingPolicyRotationEvent.CreatedAt))!.IsNullable.Should().BeFalse();
        AssertIndex(rotation, "idx_safeguarding_policy_rotation_tenant", unique: false,
            nameof(SafeguardingPolicyRotationEvent.TenantId),
            nameof(SafeguardingPolicyRotationEvent.CreatedAt));
    }

    [Fact]
    public void CanonicalEntities_MatchLaravelForeignKeyDeleteActions()
    {
        using var db = Context(tenantId: 42);

        AssertForeignKey<TenantSafeguardingSetting, Tenant>(db, DeleteBehavior.Cascade,
            nameof(TenantSafeguardingSetting.TenantId));
        AssertForeignKey<TenantSafeguardingSetting, User>(db, DeleteBehavior.SetNull,
            nameof(TenantSafeguardingSetting.ConfiguredByUserId));

        AssertForeignKey<MemberVettingAttestation, Tenant>(db, DeleteBehavior.Cascade,
            nameof(MemberVettingAttestation.TenantId));
        AssertForeignKey<MemberVettingAttestation, User>(db, DeleteBehavior.Cascade,
            nameof(MemberVettingAttestation.UserId));
        AssertForeignKey<MemberVettingAttestation, User>(db, DeleteBehavior.SetNull,
            nameof(MemberVettingAttestation.ConfirmedByUserId));
        AssertForeignKey<MemberVettingAttestation, User>(db, DeleteBehavior.SetNull,
            nameof(MemberVettingAttestation.RevokedByUserId));

        AssertForeignKey<MemberVettingAttestationEvent, MemberVettingAttestation>(db, DeleteBehavior.Cascade,
            nameof(MemberVettingAttestationEvent.AttestationId));
        AssertForeignKey<MemberVettingAttestationEvent, Tenant>(db, DeleteBehavior.Cascade,
            nameof(MemberVettingAttestationEvent.TenantId));
        AssertForeignKey<MemberVettingAttestationEvent, User>(db, DeleteBehavior.Cascade,
            nameof(MemberVettingAttestationEvent.UserId));
        AssertForeignKey<MemberVettingAttestationEvent, User>(db, DeleteBehavior.SetNull,
            nameof(MemberVettingAttestationEvent.ActorUserId));

        AssertForeignKey<SafeguardingVettingReviewRequest, Tenant>(db, DeleteBehavior.Cascade,
            nameof(SafeguardingVettingReviewRequest.TenantId));
        AssertForeignKey<SafeguardingVettingReviewRequest, User>(db, DeleteBehavior.Cascade,
            nameof(SafeguardingVettingReviewRequest.UserId));
        AssertForeignKey<SafeguardingVettingReviewRequest, User>(db, DeleteBehavior.SetNull,
            nameof(SafeguardingVettingReviewRequest.RequestedByUserId));
        AssertForeignKey<SafeguardingVettingReviewRequest, User>(db, DeleteBehavior.SetNull,
            nameof(SafeguardingVettingReviewRequest.HandledByUserId));

        AssertForeignKey<SafeguardingPolicyRotationEvent, Tenant>(db, DeleteBehavior.Cascade,
            nameof(SafeguardingPolicyRotationEvent.TenantId));
        AssertForeignKey<SafeguardingPolicyRotationEvent, User>(db, DeleteBehavior.SetNull,
            nameof(SafeguardingPolicyRotationEvent.ActorUserId));
    }

    [Fact]
    public void LegacyEntities_AddOnlyContentFreeLifecycleMarkers()
    {
        using var db = Context(tenantId: 42);

        var preference = Entity<UserSafeguardingPreference>(db);
        AssertProperty(preference, nameof(UserSafeguardingPreference.SelectedValue), 255);
        preference.FindProperty(nameof(UserSafeguardingPreference.ConsentGivenAt))!
            .IsNullable.Should().BeFalse();
        Column(preference, nameof(UserSafeguardingPreference.PolicyReviewRequiredAt))
            .Should().Be("policy_review_required_at");
        preference.FindProperty(nameof(UserSafeguardingPreference.PolicyReviewRequiredAt))!
            .IsNullable.Should().BeTrue();
        Column(preference, nameof(UserSafeguardingPreference.PolicyReviewReasonCode))
            .Should().Be("policy_review_reason_code");
        AssertProperty(preference, nameof(UserSafeguardingPreference.PolicyReviewReasonCode), 64);
        AssertIndex(preference, "IX_user_safeguarding_preferences_TenantId_UserId_OptionId", unique: true,
            nameof(UserSafeguardingPreference.TenantId),
            nameof(UserSafeguardingPreference.UserId),
            nameof(UserSafeguardingPreference.OptionId));
        AssertForeignKey<UserSafeguardingPreference, Tenant>(db, DeleteBehavior.Cascade,
            nameof(UserSafeguardingPreference.TenantId));
        AssertForeignKey<UserSafeguardingPreference, User>(db, DeleteBehavior.Cascade,
            nameof(UserSafeguardingPreference.UserId));
        AssertForeignKey<UserSafeguardingPreference, SafeguardingOption>(db, DeleteBehavior.Cascade,
            nameof(UserSafeguardingPreference.OptionId));

        var legacy = Entity<VettingRecord>(db);
        Column(legacy, nameof(VettingRecord.LegacySensitiveMetadataRedacted))
            .Should().Be("legacy_sensitive_metadata_redacted");
        var marker = legacy.FindProperty(nameof(VettingRecord.LegacySensitiveMetadataRedacted))!;
        marker.IsNullable.Should().BeFalse();
        marker.GetDefaultValue().Should().Be(false);
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
        typeof(ITenantEntity).IsAssignableFrom(typeof(TEntity)).Should().BeTrue();

        entity.GetProperties().Select(property => property.Name)
            .Should().BeEquivalentTo(mappings.Select(mapping => mapping.Property));
        foreach (var (property, column) in mappings)
        {
            Column(entity, property).Should().Be(column);
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
        index.IsUnique.Should().Be(unique);
        index.GetDatabaseName().Should().Be(databaseName);
    }

    private static void AssertForeignKey<TEntity, TPrincipal>(
        NexusDbContext db,
        DeleteBehavior deleteBehavior,
        params string[] properties)
        where TEntity : class, ITenantEntity
        where TPrincipal : class
    {
        var foreignKey = Entity<TEntity>(db).GetForeignKeys().Single(candidate =>
            candidate.Properties.Select(property => property.Name).SequenceEqual(properties));
        foreignKey.PrincipalEntityType.ClrType.Should().Be(typeof(TPrincipal));
        foreignKey.DeleteBehavior.Should().Be(deleteBehavior);
    }

    private static IEntityType Entity<TEntity>(NexusDbContext db) where TEntity : class
    {
        return db.Model.FindEntityType(typeof(TEntity))
            ?? throw new InvalidOperationException($"Missing EF mapping for {typeof(TEntity).Name}.");
    }

    private static string? Column(IEntityType entity, string propertyName)
    {
        var table = StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema());
        return entity.FindProperty(propertyName)?.GetColumnName(table);
    }

    private static NexusDbContext Context(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql(
                "Host=127.0.0.1;Port=1;Database=nexus_model_only;Username=postgres;Password=postgres;Timeout=1")
            .Options;
        return new NexusDbContext(options, tenant);
    }
}
