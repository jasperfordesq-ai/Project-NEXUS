// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for the carer relationship model:
/// AccountRelationship, its append-only AccountRelationshipEvent trail, and
/// the SupportPendingAction consent workflow (Laravel account_relationships /
/// account_relationship_events / support_pending_actions parity).
/// The events table's UPDATE-refusing trigger is raw SQL in the migration.
/// </summary>
public class AccountRelationshipConfiguration : TenantScopedConfiguration
{
    public AccountRelationshipConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AccountRelationship>(entity =>
        {
            entity.ToTable("account_relationships", table =>
            {
                table.HasCheckConstraint("CK_AccountRelationships_Status",
                    "\"status\" IN ('active', 'pending', 'revoked')");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.ParentUserId).HasColumnName("parent_user_id");
            entity.Property(e => e.ChildUserId).HasColumnName("child_user_id");
            entity.Property(e => e.RelationshipType).HasColumnName("relationship_type")
                .HasMaxLength(50).HasDefaultValue("family").IsRequired();
            entity.Property(e => e.Permissions).HasColumnName("permissions").HasColumnType("text");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20)
                .HasDefaultValue(AccountRelationship.StatusPending).IsRequired();
            entity.Property(e => e.ProposedByUserId).HasColumnName("proposed_by_user_id");
            entity.Property(e => e.StaffNotes).HasColumnName("staff_notes").HasMaxLength(500);
            entity.Property(e => e.ApprovedAt).HasColumnName("approved_at");
            entity.Property(e => e.MessageAccessGrantedAt).HasColumnName("message_access_granted_at");
            entity.Property(e => e.DeclinedAt).HasColumnName("declined_at");
            entity.Property(e => e.WithdrawnAt).HasColumnName("withdrawn_at");
            entity.Property(e => e.ResponseReason).HasColumnName("response_reason").HasMaxLength(500);
            entity.Property(e => e.SafeguardingAssignmentId).HasColumnName("safeguarding_assignment_id");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.ParentUserId, e.ChildUserId, e.TenantId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.ChildUserId, e.MessageAccessGrantedAt });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.ParentUser).WithMany().HasForeignKey(e => e.ParentUserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.ChildUser).WithMany().HasForeignKey(e => e.ChildUserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<AccountRelationshipEvent>(entity =>
        {
            entity.ToTable("account_relationship_events", table =>
            {
                table.HasCheckConstraint("CK_AccountRelationshipEvents_Action",
                    "\"action\" IN ('requested', 'proposed', 'approved', 'declined', 'withdrawn', 'revoked', 'permissions_changed')");
                table.HasCheckConstraint("CK_AccountRelationshipEvents_ActorRole",
                    "\"actor_role\" IN ('member', 'staff', 'system')");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.RelationshipId).HasColumnName("relationship_id");
            entity.Property(e => e.ParentUserId).HasColumnName("parent_user_id");
            entity.Property(e => e.ChildUserId).HasColumnName("child_user_id");
            entity.Property(e => e.Action).HasColumnName("action").HasMaxLength(24).IsRequired();
            entity.Property(e => e.ActorRole).HasColumnName("actor_role").HasMaxLength(16).IsRequired();
            entity.Property(e => e.ActorUserId).HasColumnName("actor_user_id");
            entity.Property(e => e.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(e => e.Details).HasColumnName("details").HasColumnType("text");
            entity.Property(e => e.IpAddress).HasColumnName("ip_address").HasMaxLength(45);
            entity.Property(e => e.UserAgent).HasColumnName("user_agent").HasMaxLength(255);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasIndex(e => new { e.TenantId, e.RelationshipId, e.CreatedAt });
            entity.HasIndex(e => new { e.TenantId, e.ChildUserId, e.CreatedAt });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SupportPendingAction>(entity =>
        {
            entity.ToTable("support_pending_actions", table =>
            {
                table.HasCheckConstraint("CK_SupportPendingActions_Status",
                    "\"status\" IN ('pending', 'confirmed', 'declined', 'expired', 'cancelled')");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.RelationshipId).HasColumnName("relationship_id");
            entity.Property(e => e.SupportedUserId).HasColumnName("supported_user_id");
            entity.Property(e => e.SupporterUserId).HasColumnName("supporter_user_id");
            entity.Property(e => e.ActionType).HasColumnName("action_type").HasMaxLength(40).IsRequired();
            entity.Property(e => e.Payload).HasColumnName("payload").HasColumnType("text").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20)
                .HasDefaultValue(SupportPendingAction.StatusPending).IsRequired();
            entity.Property(e => e.TokenHash).HasColumnName("token_hash").HasMaxLength(64).IsRequired();
            entity.Property(e => e.TokenConsumedAt).HasColumnName("token_consumed_at");
            entity.Property(e => e.ExpiresAt).HasColumnName("expires_at");
            entity.Property(e => e.ConfirmedAt).HasColumnName("confirmed_at");
            entity.Property(e => e.DeclinedAt).HasColumnName("declined_at");
            entity.Property(e => e.CancelledAt).HasColumnName("cancelled_at");
            entity.Property(e => e.ConfirmedVia).HasColumnName("confirmed_via").HasMaxLength(20);
            entity.Property(e => e.AttestedByUserId).HasColumnName("attested_by_user_id");
            entity.Property(e => e.AttestedChannel).HasColumnName("attested_channel").HasMaxLength(20);
            entity.Property(e => e.AttestedWitness).HasColumnName("attested_witness").HasMaxLength(160);
            entity.Property(e => e.DeclineReason).HasColumnName("decline_reason").HasColumnType("text");
            entity.Property(e => e.ResponseIp).HasColumnName("response_ip").HasMaxLength(45);
            entity.Property(e => e.ResponseUserAgent).HasColumnName("response_user_agent").HasMaxLength(255);
            entity.Property(e => e.ResultId).HasColumnName("result_id");
            entity.Property(e => e.PendingMessageRelationshipId)
                .HasColumnName("pending_message_relationship_id");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.TokenHash).IsUnique();
            // One open message-access ask per relationship, enforced by the
            // database: nullable unique — multiple NULLs allowed, one value.
            entity.HasIndex(e => e.PendingMessageRelationshipId).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.SupportedUserId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.SupporterUserId, e.Status });
            entity.HasIndex(e => new { e.Status, e.ExpiresAt });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Relationship).WithMany().HasForeignKey(e => e.RelationshipId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.SupportedUser).WithMany().HasForeignKey(e => e.SupportedUserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.SupporterUser).WithMany().HasForeignKey(e => e.SupporterUserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
