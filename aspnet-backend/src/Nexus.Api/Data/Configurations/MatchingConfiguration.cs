// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for smart matching and collaborative filtering:
/// MatchPreference, MatchResult, MatchFeedback, UserInteraction, UserSimilarity.
/// </summary>
public class MatchingConfiguration : TenantScopedConfiguration
{
    public MatchingConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MatchPreference>(entity =>
        {
            entity.ToTable("match_preferences");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.PreferredCategories).HasColumnType("text");
            entity.Property(e => e.AvailableDays).HasColumnType("text");
            entity.Property(e => e.AvailableTimeSlots).HasMaxLength(500);
            entity.Property(e => e.SkillsOffered).HasColumnType("text");
            entity.Property(e => e.SkillsWanted).HasColumnType("text");
            entity.Property(e => e.NotificationFrequency).HasColumnName("notification_frequency").HasMaxLength(20).HasDefaultValue("monthly");
            entity.Property(e => e.NotifyHotMatches).HasColumnName("notify_hot_matches").HasDefaultValue(true);
            entity.Property(e => e.NotifyMutualMatches).HasColumnName("notify_mutual_matches").HasDefaultValue(true);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.UserId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MatchResult>(entity =>
        {
            entity.ToTable("match_results");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Score).HasPrecision(5, 4);
            entity.Property(e => e.Reasons).HasColumnType("text");
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.MatchedUserId);
            entity.HasIndex(e => e.Score);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.MatchedUser).WithMany().HasForeignKey(e => e.MatchedUserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.MatchedListing).WithMany().HasForeignKey(e => e.MatchedListingId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<UserInteraction>(entity =>
        {
            entity.ToTable("user_interactions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.InteractionType).HasMaxLength(50).IsRequired();
            entity.Property(e => e.TargetType).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.TargetType, e.TargetId });
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<UserSimilarity>(entity =>
        {
            entity.ToTable("user_similarities");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Algorithm).HasMaxLength(50);
            entity.HasIndex(e => new { e.TenantId, e.UserAId, e.UserBId }).IsUnique();
            entity.HasOne(e => e.UserA).WithMany().HasForeignKey(e => e.UserAId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.UserB).WithMany().HasForeignKey(e => e.UserBId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MatchFeedback>(entity =>
        {
            entity.ToTable("match_feedbacks");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FeedbackType).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => new { e.MatchResultId, e.UserId }).IsUnique();
            entity.HasOne(e => e.MatchResult).WithMany().HasForeignKey(e => e.MatchResultId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
