// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Canonical Laravel <c>feed_activity</c> projection and hot-path indexes.
/// Source rows are intentionally polymorphic, so source and group identifiers
/// remain scalar evidence rather than unsafe cross-table foreign keys.
/// </summary>
public sealed class FeedActivityConfiguration : TenantScopedConfiguration
{
    public FeedActivityConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FeedActivity>(entity =>
        {
            entity.ToTable("feed_activity");
            entity.HasKey(activity => activity.Id);

            entity.Property(activity => activity.Id)
                .HasColumnName("id")
                .ValueGeneratedOnAdd();
            entity.Property(activity => activity.TenantId)
                .HasColumnName("tenant_id")
                .IsRequired();
            entity.Property(activity => activity.UserId)
                .HasColumnName("user_id")
                .IsRequired();
            entity.Property(activity => activity.SourceType)
                .HasColumnName("source_type")
                .HasMaxLength(20)
                .IsRequired();
            entity.Property(activity => activity.SourceId)
                .HasColumnName("source_id")
                .IsRequired();
            entity.Property(activity => activity.GroupId)
                .HasColumnName("group_id");
            entity.Property(activity => activity.Title)
                .HasColumnName("title")
                .HasMaxLength(500);
            entity.Property(activity => activity.Content)
                .HasColumnName("content")
                .HasColumnType("text");
            entity.Property(activity => activity.ImageUrl)
                .HasColumnName("image_url")
                .HasMaxLength(500);
            entity.Property(activity => activity.Metadata)
                .HasColumnName("metadata")
                .HasColumnType("jsonb");
            entity.Property(activity => activity.IsVisible)
                .HasColumnName("is_visible")
                .HasDefaultValue(true)
                .IsRequired();
            entity.Property(activity => activity.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .IsRequired();
            entity.Property(activity => activity.IsHidden)
                .HasColumnName("is_hidden")
                .HasDefaultValue(false)
                .IsRequired();

            entity.HasIndex(activity => new
                {
                    activity.TenantId,
                    activity.SourceType,
                    activity.SourceId
                })
                .IsUnique()
                .HasDatabaseName("uq_tenant_source");
            entity.HasIndex(activity => new
                {
                    activity.TenantId,
                    activity.IsVisible,
                    activity.CreatedAt,
                    activity.Id
                })
                .IsDescending(false, false, true, true)
                .HasDatabaseName("idx_main_feed");
            entity.HasIndex(activity => new
                {
                    activity.TenantId,
                    activity.UserId,
                    activity.IsVisible,
                    activity.CreatedAt,
                    activity.Id
                })
                .IsDescending(false, false, false, true, true)
                .HasDatabaseName("idx_user_feed");
            entity.HasIndex(activity => new
                {
                    activity.TenantId,
                    activity.GroupId,
                    activity.IsVisible,
                    activity.CreatedAt,
                    activity.Id
                })
                .IsDescending(false, false, false, true, true)
                .HasDatabaseName("idx_group_feed");
            entity.HasIndex(activity => new
                {
                    activity.TenantId,
                    activity.SourceType,
                    activity.IsVisible,
                    activity.CreatedAt,
                    activity.Id
                })
                .IsDescending(false, false, false, true, true)
                .HasDatabaseName("idx_type_feed");
            entity.HasIndex(activity => new { activity.SourceType, activity.SourceId })
                .HasDatabaseName("idx_source_lookup");
            entity.HasIndex(activity => new
                {
                    activity.TenantId,
                    activity.CreatedAt,
                    activity.Id
                })
                .HasDatabaseName("idx_feed_activity_cursor");

            entity.HasQueryFilter(activity =>
                !TenantContext.IsResolved || activity.TenantId == TenantContext.TenantId);
        });
    }
}
