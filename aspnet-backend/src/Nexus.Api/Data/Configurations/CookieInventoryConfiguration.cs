// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

public sealed class CookieInventoryConfiguration : IEntityGroupConfiguration
{
    public void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CookieInventoryItem>(entity =>
        {
            entity.ToTable("cookie_inventory", table =>
                table.HasCheckConstraint("CK_cookie_inventory_category",
                    "category IN ('essential', 'functional', 'analytics', 'marketing')"));
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id");
            entity.Property(item => item.CookieName).HasColumnName("cookie_name").HasMaxLength(255).IsRequired();
            entity.Property(item => item.Category).HasColumnName("category").HasMaxLength(20).IsRequired();
            entity.Property(item => item.Purpose).HasColumnName("purpose").HasColumnType("text").IsRequired();
            entity.Property(item => item.Duration).HasColumnName("duration").HasMaxLength(100).IsRequired();
            entity.Property(item => item.ThirdParty).HasColumnName("third_party").HasMaxLength(255);
            entity.Property(item => item.TenantId).HasColumnName("tenant_id");
            entity.Property(item => item.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(item => item.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("CURRENT_TIMESTAMP");

            entity.HasIndex(item => new { item.CookieName, item.TenantId })
                .IsUnique()
                .HasDatabaseName("unique_cookie_tenant");
            entity.HasIndex(item => item.Category).HasDatabaseName("idx_category");
            entity.HasIndex(item => item.TenantId).HasDatabaseName("idx_tenant_id");
            entity.HasIndex(item => item.IsActive).HasDatabaseName("idx_is_active");
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            // NULL tenant_id denotes a platform-wide cookie. Consumers must
            // combine global rows with the resolved tenant explicitly.
        });
    }
}
