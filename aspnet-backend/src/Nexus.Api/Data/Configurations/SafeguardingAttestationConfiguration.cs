// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Canonical Laravel safeguarding jurisdiction, attestation, review, and audit schema.
/// </summary>
public sealed class SafeguardingAttestationConfiguration : TenantScopedConfiguration
{
    public SafeguardingAttestationConfiguration(TenantContext tenantContext)
        : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        ConfigureTenantSetting(modelBuilder);
        ConfigureAttestation(modelBuilder);
        ConfigureAttestationEvent(modelBuilder);
        ConfigureReviewRequest(modelBuilder);
        ConfigurePolicyRotationEvent(modelBuilder);
    }

    private void ConfigureTenantSetting(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TenantSafeguardingSetting>(entity =>
        {
            entity.ToTable("tenant_safeguarding_settings");
            entity.HasKey(e => e.TenantId);

            entity.Property(e => e.TenantId)
                .HasColumnName("tenant_id")
                .ValueGeneratedNever();
            entity.Property(e => e.Jurisdiction)
                .HasColumnName("jurisdiction")
                .HasMaxLength(40)
                .IsRequired();
            entity.Property(e => e.PolicyVersion)
                .HasColumnName("policy_version")
                .HasMaxLength(64)
                .HasDefaultValue("1")
                .IsRequired();
            entity.Property(e => e.ConfiguredByUserId)
                .HasColumnName("configured_by");
            entity.Property(e => e.ConfiguredAt)
                .HasColumnName("configured_at");
            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt)
                .HasColumnName("updated_at");

            entity.HasOne(e => e.Tenant)
                .WithOne()
                .HasForeignKey<TenantSafeguardingSetting>(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Configurer)
                .WithMany()
                .HasForeignKey(e => e.ConfiguredByUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }

    private void ConfigureAttestation(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MemberVettingAttestation>(entity =>
        {
            entity.ToTable("member_vetting_attestations");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.SchemeCode)
                .HasColumnName("scheme_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.AttestationCode)
                .HasColumnName("attestation_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.PurposeCode)
                .HasColumnName("purpose_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.ScopeType)
                .HasColumnName("scope_type")
                .HasMaxLength(32)
                .HasDefaultValue("tenant")
                .IsRequired();
            entity.Property(e => e.ScopeIdentifier)
                .HasColumnName("scope_identifier")
                .HasMaxLength(191)
                .HasDefaultValue(string.Empty)
                .IsRequired();
            entity.Property(e => e.Decision)
                .HasColumnName("decision")
                .HasMaxLength(20)
                .IsRequired();
            entity.Property(e => e.ConfirmedByUserId).HasColumnName("confirmed_by");
            entity.Property(e => e.ConfirmedAt).HasColumnName("confirmed_at");
            entity.Property(e => e.RevokedByUserId).HasColumnName("revoked_by");
            entity.Property(e => e.RevokedAt).HasColumnName("revoked_at");
            entity.Property(e => e.RevocationReasonCode)
                .HasColumnName("revocation_reason_code")
                .HasMaxLength(64);
            entity.Property(e => e.PolicyVersion)
                .HasColumnName("policy_version")
                .HasMaxLength(64)
                .HasDefaultValue("1")
                .IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new
                {
                    e.TenantId,
                    e.UserId,
                    e.SchemeCode,
                    e.AttestationCode,
                    e.PurposeCode,
                    e.ScopeType,
                    e.ScopeIdentifier
                })
                .IsUnique()
                .HasDatabaseName("uq_member_vetting_attestation_scope");
            entity.HasIndex(e => new
                {
                    e.TenantId,
                    e.UserId,
                    e.AttestationCode,
                    e.PurposeCode,
                    e.Decision
                })
                .HasDatabaseName("idx_member_vetting_policy_status");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Member)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Confirmer)
                .WithMany()
                .HasForeignKey(e => e.ConfirmedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Revoker)
                .WithMany()
                .HasForeignKey(e => e.RevokedByUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }

    private void ConfigureAttestationEvent(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MemberVettingAttestationEvent>(entity =>
        {
            entity.ToTable("member_vetting_attestation_events");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AttestationId).HasColumnName("attestation_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.SchemeCode)
                .HasColumnName("scheme_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.AttestationCode)
                .HasColumnName("attestation_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.PurposeCode)
                .HasColumnName("purpose_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.ScopeType)
                .HasColumnName("scope_type")
                .HasMaxLength(32)
                .IsRequired();
            entity.Property(e => e.ScopeIdentifier)
                .HasColumnName("scope_identifier")
                .HasMaxLength(191)
                .HasDefaultValue(string.Empty)
                .IsRequired();
            entity.Property(e => e.EventType)
                .HasColumnName("event_type")
                .HasMaxLength(32)
                .IsRequired();
            entity.Property(e => e.DecisionBefore)
                .HasColumnName("decision_before")
                .HasMaxLength(20);
            entity.Property(e => e.DecisionAfter)
                .HasColumnName("decision_after")
                .HasMaxLength(20)
                .IsRequired();
            entity.Property(e => e.ReasonCode)
                .HasColumnName("reason_code")
                .HasMaxLength(64);
            entity.Property(e => e.ActorUserId).HasColumnName("actor_user_id");
            entity.Property(e => e.PolicyVersion)
                .HasColumnName("policy_version")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasIndex(e => new { e.TenantId, e.UserId, e.CreatedAt })
                .HasDatabaseName("idx_vetting_event_member_history");
            entity.HasIndex(e => new { e.TenantId, e.ActorUserId, e.CreatedAt })
                .HasDatabaseName("idx_vetting_event_actor_history");

            entity.HasOne(e => e.Attestation)
                .WithMany(e => e.Events)
                .HasForeignKey(e => e.AttestationId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Member)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Actor)
                .WithMany()
                .HasForeignKey(e => e.ActorUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }

    private void ConfigureReviewRequest(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SafeguardingVettingReviewRequest>(entity =>
        {
            entity.ToTable("safeguarding_vetting_review_requests");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.Jurisdiction)
                .HasColumnName("jurisdiction")
                .HasMaxLength(40)
                .IsRequired();
            entity.Property(e => e.SchemeCode)
                .HasColumnName("scheme_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.AttestationCode)
                .HasColumnName("attestation_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.PurposeCode)
                .HasColumnName("purpose_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.ScopeType)
                .HasColumnName("scope_type")
                .HasMaxLength(32)
                .HasDefaultValue("tenant")
                .IsRequired();
            entity.Property(e => e.ScopeIdentifier)
                .HasColumnName("scope_identifier")
                .HasMaxLength(191)
                .HasDefaultValue(string.Empty)
                .IsRequired();
            entity.Property(e => e.PolicyVersion)
                .HasColumnName("policy_version")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.Status)
                .HasColumnName("status")
                .HasMaxLength(20)
                .HasDefaultValue(SafeguardingVettingReviewRequest.PendingStatus)
                .IsRequired();
            entity.Property(e => e.RequestSource)
                .HasColumnName("request_source")
                .HasMaxLength(32)
                .HasDefaultValue(SafeguardingVettingReviewRequest.MemberRequestSource)
                .IsRequired();
            entity.Property(e => e.RequestedByUserId).HasColumnName("requested_by");
            entity.Property(e => e.RequestedAt).HasColumnName("requested_at");
            entity.Property(e => e.HandledByUserId).HasColumnName("handled_by");
            entity.Property(e => e.HandledAt).HasColumnName("handled_at");
            entity.Property(e => e.ResolutionCode)
                .HasColumnName("resolution_code")
                .HasMaxLength(64);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Status, e.RequestedAt })
                .HasDatabaseName("idx_vetting_review_queue");
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.PurposeCode })
                .HasDatabaseName("idx_vetting_review_member");
            entity.HasIndex(e => new
                {
                    e.TenantId,
                    e.UserId,
                    e.PurposeCode,
                    e.ScopeType,
                    e.ScopeIdentifier
                })
                .IsUnique()
                .HasDatabaseName("uq_vetting_review_member_scope");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Member)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Requester)
                .WithMany()
                .HasForeignKey(e => e.RequestedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Handler)
                .WithMany()
                .HasForeignKey(e => e.HandledByUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }

    private void ConfigurePolicyRotationEvent(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SafeguardingPolicyRotationEvent>(entity =>
        {
            entity.ToTable("safeguarding_policy_rotation_events");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Jurisdiction)
                .HasColumnName("jurisdiction")
                .HasMaxLength(40)
                .IsRequired();
            entity.Property(e => e.SchemeCode)
                .HasColumnName("scheme_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.AttestationCode)
                .HasColumnName("attestation_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.PurposeCode)
                .HasColumnName("purpose_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.ScopeType)
                .HasColumnName("scope_type")
                .HasMaxLength(32)
                .IsRequired();
            entity.Property(e => e.ScopeIdentifier)
                .HasColumnName("scope_identifier")
                .HasMaxLength(191)
                .HasDefaultValue(string.Empty)
                .IsRequired();
            entity.Property(e => e.PreviousPolicyVersion)
                .HasColumnName("previous_policy_version")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.NewPolicyVersion)
                .HasColumnName("new_policy_version")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.ReasonCode)
                .HasColumnName("reason_code")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(e => e.ActorUserId).HasColumnName("actor_user_id");
            entity.Property(e => e.AffectedMemberCount)
                .HasColumnName("affected_member_count")
                .HasDefaultValue(0);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasIndex(e => new { e.TenantId, e.CreatedAt })
                .HasDatabaseName("idx_safeguarding_policy_rotation_tenant");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Actor)
                .WithMany()
                .HasForeignKey(e => e.ActorUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
