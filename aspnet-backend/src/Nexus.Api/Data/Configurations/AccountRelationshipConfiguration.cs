// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for the carer relationship model:
/// AccountRelationship and its append-only AccountRelationshipEvent trail
/// (Laravel account_relationships / account_relationship_events parity).
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
    }
}
