// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for listing-related entities:
/// Listing, Category, ListingAnalytics, ListingFavorite, ListingTag.
/// </summary>
public class ListingConfiguration : TenantScopedConfiguration
{
    public ListingConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Listing configuration with tenant filter (merged from two blocks)
        modelBuilder.Entity<Listing>(entity =>
        {
            entity.ToTable("listings");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnType("text");
            entity.Property(e => e.Location).HasMaxLength(255);
            entity.Property(e => e.ImageUrl).HasMaxLength(2000);
            entity.Property(e => e.EstimatedHours).HasPrecision(10, 2);

            // Enum conversions stored as strings for readability
            entity.Property(e => e.Type)
                .HasConversion<string>()
                .HasMaxLength(20);

            entity.Property(e => e.Status)
                .HasConversion<string>()
                .HasMaxLength(20);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => new { e.TenantId, e.Latitude, e.Longitude });

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // Category relationship (previously in separate block)
            entity.HasOne(e => e.Category)
                .WithMany(c => c.Listings)
                .HasForeignKey(e => e.CategoryId)
                .OnDelete(DeleteBehavior.SetNull);

            // ReviewedByUser relationship (previously in separate block)
            entity.HasOne(e => e.ReviewedByUser)
                .WithMany()
                .HasForeignKey(e => e.ReviewedByUserId)
                .OnDelete(DeleteBehavior.SetNull);

            // CRITICAL: Global query filter for tenant isolation + soft delete
            entity.HasQueryFilter(e =>
                (!TenantContext.IsResolved || e.TenantId == TenantContext.TenantId)
                && e.DeletedAt == null);
        });

        // Category configuration with tenant filter
        modelBuilder.Entity<Category>(entity =>
        {
            entity.ToTable("categories");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(1000);
            entity.Property(e => e.Slug).HasMaxLength(100).IsRequired();
            entity.Property(e => e.SubstitutionCoefficient)
                .HasColumnName("substitution_coefficient")
                .HasPrecision(3, 2)
                .HasDefaultValue(1.00m);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.Slug);
            entity.HasIndex(e => e.ParentCategoryId);
            entity.HasIndex(e => e.IsActive);
            // Unique constraint: slug per tenant
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.ParentCategory)
                .WithMany(c => c.ChildCategories)
                .HasForeignKey(e => e.ParentCategoryId)
                .OnDelete(DeleteBehavior.Restrict);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ListingAnalytics
        modelBuilder.Entity<ListingAnalytics>(entity =>
        {
            entity.ToTable("listing_analytics");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.ListingId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Listing).WithMany().HasForeignKey(e => e.ListingId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ListingFavorite
        modelBuilder.Entity<ListingFavorite>(entity =>
        {
            entity.ToTable("listing_favorites");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.ListingId, e.UserId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Listing).WithMany().HasForeignKey(e => e.ListingId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ListingTag
        modelBuilder.Entity<ListingTag>(entity =>
        {
            entity.ToTable("listing_tags");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Tag).HasMaxLength(100).IsRequired();
            entity.Property(e => e.TagType).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.ListingId, e.Tag }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Listing).WithMany().HasForeignKey(e => e.ListingId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
