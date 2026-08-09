// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for group entities:
/// Group, GroupMember, GroupAnnouncement, GroupPolicy, GroupFile, GroupDiscussion,
/// GroupDiscussionReply, GroupExchange, GroupExchangeParticipant.
/// </summary>
public class GroupConfiguration : TenantScopedConfiguration
{
    public GroupConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Group configuration with tenant filter
        modelBuilder.Entity<Group>(entity =>
        {
            entity.ToTable("groups");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnType("text");
            entity.Property(e => e.ImageUrl).HasMaxLength(500);
            entity.Property(e => e.CoverImageUrl).HasMaxLength(500);
            entity.Property(e => e.Visibility).HasMaxLength(20).HasDefaultValue("public");
            entity.Property(e => e.Location).HasMaxLength(255);
            entity.Property(e => e.Latitude).HasPrecision(10, 8);
            entity.Property(e => e.Longitude).HasPrecision(11, 8);
            entity.Property(e => e.PrimaryColor).HasMaxLength(7);
            entity.Property(e => e.AccentColor).HasMaxLength(7);
            entity.Property(e => e.Status).HasMaxLength(30).HasDefaultValue("active");

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.CreatedById);
            entity.HasIndex(e => e.Name);
            entity.HasIndex(e => new { e.TenantId, e.ParentId });
            entity.HasIndex(e => new { e.TenantId, e.IsActive });

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.CreatedBy)
                .WithMany()
                .HasForeignKey(e => e.CreatedById)
                .OnDelete(DeleteBehavior.Restrict);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<GroupType>().HasQueryFilter(e =>
            !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        modelBuilder.Entity<GroupTemplate>().HasQueryFilter(e =>
            !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);

        modelBuilder.Entity<GroupAutoAssignRule>(entity =>
        {
            entity.ToTable("group_auto_assign_rules", table =>
            {
                table.HasCheckConstraint(
                    "CK_group_auto_assign_rules_rule_type",
                    "rule_type IN ('location', 'interest', 'role', 'attribute')");
                table.HasCheckConstraint(
                    "CK_group_auto_assign_rules_rule_value",
                    "length(btrim(rule_value)) > 0");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.GroupId).HasColumnName("group_id");
            entity.Property(e => e.RuleType).HasColumnName("rule_type").HasMaxLength(20).IsRequired();
            entity.Property(e => e.RuleValue).HasColumnName("rule_value").HasMaxLength(255).IsRequired();
            entity.Property(e => e.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(e => new { e.TenantId, e.IsActive }).HasDatabaseName("IX_group_auto_assign_rules_tenant_active");
            entity.HasIndex(e => e.GroupId).HasDatabaseName("IX_group_auto_assign_rules_group_id");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Group).WithMany().HasForeignKey(e => e.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GroupMember configuration with tenant filter
        modelBuilder.Entity<GroupMember>(entity =>
        {
            entity.ToTable("group_members");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Role).HasMaxLength(20).IsRequired();

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.GroupId);
            entity.HasIndex(e => e.UserId);
            // Unique constraint: one membership per user per group
            entity.HasIndex(e => new { e.TenantId, e.GroupId, e.UserId }).IsUnique();

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Group)
                .WithMany(g => g.Members)
                .HasForeignKey(e => e.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GroupAnnouncement
        modelBuilder.Entity<GroupAnnouncement>(entity =>
        {
            entity.ToTable("group_announcements");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.GroupId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Group).WithMany().HasForeignKey(e => e.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Author).WithMany().HasForeignKey(e => e.AuthorId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GroupPolicy
        modelBuilder.Entity<GroupPolicy>(entity =>
        {
            entity.ToTable("group_policies");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Value).HasColumnType("text").IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.GroupId, e.Key }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Group).WithMany().HasForeignKey(e => e.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GroupFile
        modelBuilder.Entity<GroupFile>(entity =>
        {
            entity.ToTable("group_files");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(255).IsRequired();
            entity.Property(e => e.FileUrl).HasMaxLength(1000).IsRequired();
            entity.Property(e => e.ContentType).HasMaxLength(100);
            entity.Property(e => e.Description).HasMaxLength(1000);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.GroupId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Group).WithMany().HasForeignKey(e => e.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.UploadedBy).WithMany().HasForeignKey(e => e.UploadedById).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GroupDiscussion
        modelBuilder.Entity<GroupDiscussion>(entity =>
        {
            entity.ToTable("group_discussions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.GroupId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Group).WithMany().HasForeignKey(e => e.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Author).WithMany().HasForeignKey(e => e.AuthorId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GroupDiscussionReply
        modelBuilder.Entity<GroupDiscussionReply>(entity =>
        {
            entity.ToTable("group_discussion_replies");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.DiscussionId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Discussion).WithMany(d => d.Replies).HasForeignKey(e => e.DiscussionId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Author).WithMany().HasForeignKey(e => e.AuthorId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GroupExchange
        modelBuilder.Entity<GroupExchange>(entity =>
        {
            entity.ToTable("group_exchanges");
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_group_exchanges_Status",
                    "\"Status\" IN ('draft', 'pending_participants', 'pending_broker', 'active', 'pending_confirmation', 'completed', 'cancelled', 'disputed')");
                table.HasCheckConstraint(
                    "CK_group_exchanges_SplitType",
                    "\"SplitType\" IN ('equal', 'custom', 'weighted')");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(30).IsRequired();
            entity.Property(e => e.SplitType).HasMaxLength(20).HasDefaultValue("equal").IsRequired();
            entity.Property(e => e.TotalHours).HasPrecision(10, 2);
            entity.Property(e => e.BrokerNotes).HasColumnType("text");
            entity.HasIndex(e => new { e.TenantId, e.CreatedById });
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasOne(e => e.Group).WithMany().HasForeignKey(e => e.GroupId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.ApprovedBy).WithMany().HasForeignKey(e => e.ApprovedById).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GroupExchangeParticipant - NO tenant query filter
        modelBuilder.Entity<GroupExchangeParticipant>(entity =>
        {
            entity.ToTable("group_exchange_participants");
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_group_exchange_participants_Role",
                "\"Role\" IN ('provider', 'receiver')"));
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Role).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Hours).HasPrecision(10, 2);
            entity.Property(e => e.Weight)
                .HasPrecision(5, 2)
                .HasDefaultValue(1m)
                // Zero is meaningful to Laravel's weighted-split algorithm. EF's
                // decimal sentinel is normally zero, which caused an explicit 0
                // to be omitted from INSERTs and replaced by the database default.
                .HasSentinel(decimal.MinValue);
            entity.Property(e => e.Notes).HasColumnType("text");
            // A user may participate once per role (provider and receiver are
            // intentionally allowed for the same user).
            entity.HasIndex(e => new { e.GroupExchangeId, e.UserId, e.Role }).IsUnique();
            entity.HasOne(e => e.GroupExchange).WithMany(g => g.Participants).HasForeignKey(e => e.GroupExchangeId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
