// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for resources and threaded comments:
/// Resource, ResourceCategory, ThreadedComment.
/// </summary>
public class ResourcesCommentsConfiguration : TenantScopedConfiguration
{
    public ResourcesCommentsConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Resource>(entity =>
        {
            entity.ToTable("resources");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(500).IsRequired();
            entity.Property(e => e.ResourceType).HasMaxLength(50).IsRequired();
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Category).WithMany(c => c.Resources).HasForeignKey(e => e.CategoryId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<ResourceCategory>(entity =>
        {
            entity.ToTable("resource_categories");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.HasOne(e => e.Parent).WithMany(c => c.Children).HasForeignKey(e => e.ParentId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<ThreadedComment>(entity =>
        {
            entity.ToTable("threaded_comments");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TargetType).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Content).IsRequired();
            entity.HasIndex(e => new { e.TargetType, e.TargetId });
            entity.HasOne(e => e.Author).WithMany().HasForeignKey(e => e.AuthorId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Parent).WithMany(c => c.Replies).HasForeignKey(e => e.ParentId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<ContentMention>(entity =>
        {
            entity.ToTable("mentions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EntityType).HasMaxLength(30).HasDefaultValue("comment");
            entity.HasIndex(e => new { e.CommentId, e.MentionedUserId })
                .IsUnique()
                .HasDatabaseName("unique_mention");
            entity.HasIndex(e => e.MentioningUserId);
            entity.HasIndex(e => e.MentionedUserId).HasDatabaseName("idx_mentioned_user");
            entity.HasIndex(e => e.CommentId).HasDatabaseName("idx_comment");
            entity.HasIndex(e => e.TenantId).HasDatabaseName("idx_tenant");
            entity.HasIndex(e => new { e.MentionedUserId, e.SeenAt }).HasDatabaseName("idx_unseen");
            entity.HasIndex(e => new { e.TenantId, e.MentionedUserId }).HasDatabaseName("idx_tenant_mentioned");
            entity.HasIndex(e => new { e.TenantId, e.EntityType, e.EntityId }).HasDatabaseName("idx_tenant_entity");
            entity.HasOne(e => e.Comment).WithMany().HasForeignKey(e => e.CommentId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.MentionedUser)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.MentionedUserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.MentioningUser)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.MentioningUserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CommentReaction>(entity =>
        {
            entity.ToTable("comment_reactions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ReactionType).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.CommentId, e.UserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.CommentId, e.ReactionType });
            entity.HasOne(e => e.Comment).WithMany().HasForeignKey(e => e.CommentId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<ContentReaction>(entity =>
        {
            entity.ToTable("reactions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TargetType).HasMaxLength(50).IsRequired();
            entity.Property(e => e.ReactionType).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.TargetType, e.TargetId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.TargetType, e.TargetId, e.ReactionType });
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<ContentLike>(entity =>
        {
            entity.ToTable("likes");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TargetType).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.TargetType, e.TargetId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.TargetType, e.TargetId });
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
