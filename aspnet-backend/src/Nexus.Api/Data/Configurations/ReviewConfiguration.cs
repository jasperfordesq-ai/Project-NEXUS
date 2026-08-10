// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for review entities:
/// Review (with check constraint), ExchangeRating (with check constraint).
/// </summary>
public class ReviewConfiguration : TenantScopedConfiguration
{
    public ReviewConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Review configuration with tenant filter
        modelBuilder.Entity<Review>(entity =>
        {
            entity.ToTable("reviews");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Comment).HasMaxLength(2000);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.ReviewerId);
            entity.HasIndex(e => e.TargetUserId);
            entity.HasIndex(e => e.TargetListingId);
            entity.HasIndex(e => e.CreatedAt);
            // Prevent duplicate reviews: one review per reviewer per target
            entity.HasIndex(e => new { e.TenantId, e.ReviewerId, e.TargetUserId })
                .IsUnique()
                .HasFilter("\"TargetUserId\" IS NOT NULL");
            entity.HasIndex(e => new { e.TenantId, e.ReviewerId, e.TargetListingId })
                .IsUnique()
                .HasFilter("\"TargetListingId\" IS NOT NULL");

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Reviewer)
                .WithMany()
                .HasForeignKey(e => e.ReviewerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.TargetUser)
                .WithMany()
                .HasForeignKey(e => e.TargetUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.TargetListing)
                .WithMany()
                .HasForeignKey(e => e.TargetListingId)
                .OnDelete(DeleteBehavior.Restrict);

            // Ensure a review targets at least one entity (user or listing)
            entity.ToTable(t => t.HasCheckConstraint(
                "CK_reviews_has_target",
                "\"TargetUserId\" IS NOT NULL OR \"TargetListingId\" IS NOT NULL"));

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ExchangeRating configuration with tenant filter
        modelBuilder.Entity<ExchangeRating>(entity =>
        {
            entity.ToTable("exchange_ratings");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Comment).HasMaxLength(2000);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.ExchangeId);
            entity.HasIndex(e => e.RaterId);
            entity.HasIndex(e => e.RatedUserId);
            // One rating per rater per exchange
            entity.HasIndex(e => new { e.TenantId, e.ExchangeId, e.RaterId }).IsUnique();

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Exchange)
                .WithMany(ex => ex.Ratings)
                .HasForeignKey(e => e.ExchangeId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Rater)
                .WithMany()
                .HasForeignKey(e => e.RaterId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.RatedUser)
                .WithMany()
                .HasForeignKey(e => e.RatedUserId)
                .OnDelete(DeleteBehavior.Restrict);

            // Rating must be 1-5
            entity.ToTable(t => t.HasCheckConstraint(
                "CK_exchange_ratings_valid_range",
                "\"Rating\" >= 1 AND \"Rating\" <= 5"));

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
