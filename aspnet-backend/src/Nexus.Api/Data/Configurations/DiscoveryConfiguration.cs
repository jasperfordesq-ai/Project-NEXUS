// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for discovery and personalisation:
/// Hashtag, HashtagUsage, PersonalInsight, SavedSearch, SubAccount.
/// </summary>
public class DiscoveryConfiguration : TenantScopedConfiguration
{
    public DiscoveryConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Hashtag>(entity =>
        {
            entity.ToTable("hashtags");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Tag).HasMaxLength(100).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.Tag }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.UsageCount }).IsDescending(false, true);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<HashtagUsage>(entity =>
        {
            entity.ToTable("hashtag_usages");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TargetType).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => new { e.HashtagId, e.TargetType, e.TargetId }).IsUnique();
            entity.HasOne(e => e.Hashtag).WithMany(h => h.Usages).HasForeignKey(e => e.HashtagId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PersonalInsight>(entity =>
        {
            entity.ToTable("personal_insights");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.InsightType).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Value).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.InsightType, e.Period });
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SavedSearch>(entity =>
        {
            entity.ToTable("saved_searches");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.SearchType).HasMaxLength(50).IsRequired();
            entity.Property(e => e.QueryJson).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SubAccount>(entity =>
        {
            entity.ToTable("sub_accounts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Relationship).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.PrimaryUserId, e.SubUserId }).IsUnique();
            entity.HasOne(e => e.PrimaryUser).WithMany().HasForeignKey(e => e.PrimaryUserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.SubUser).WithMany().HasForeignKey(e => e.SubUserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
