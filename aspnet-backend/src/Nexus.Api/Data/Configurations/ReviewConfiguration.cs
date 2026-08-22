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
            entity.HasIndex(e => e.TransactionId);

            // 🔴 Laravel's duplicate rule is one review per reviewer per TRANSACTION
            // (ReviewService::create, app/Services/GroupService.php's sibling at
            // app/Services/ReviewService.php:428-451), NOT one per person. This used to
            // be a unique index on (TenantId, ReviewerId, TargetUserId), which is
            // strictly harsher: two members who complete a second exchange together can
            // legitimately review each other again, and that index rejected it at the
            // database with no message a client could show. A review with no transaction
            // is rate-limited in code instead (a 24-hour window on the same receiver),
            // exactly as Laravel does — a unique index cannot express a time window.
            entity.HasIndex(e => new { e.TenantId, e.ReviewerId, e.TransactionId })
                .IsUnique()
                .HasFilter("\"TransactionId\" IS NOT NULL");
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

            // SetNull, not Restrict: a deleted transaction must not make its reviews
            // undeletable, and the review itself is still a true statement about the
            // person. Laravel's reviews.transaction_id is nullable for the same reason.
            entity.HasOne(e => e.Transaction)
                .WithMany()
                .HasForeignKey(e => e.TransactionId)
                .OnDelete(DeleteBehavior.SetNull);

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
