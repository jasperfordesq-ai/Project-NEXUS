// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for vetting and verification badges:
/// VettingRecord, VerificationBadgeType (not tenant-scoped), UserVerificationBadge.
/// </summary>
public class VettingVerificationConfiguration : TenantScopedConfiguration
{
    public VettingVerificationConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<VettingRecord>(entity =>
        {
            entity.ToTable("vetting_records");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.VettingType).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(30).IsRequired();
            entity.Property(e => e.LegacySensitiveMetadataRedacted)
                .HasColumnName("legacy_sensitive_metadata_redacted")
                .HasDefaultValue(false);
            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.VerifiedBy).WithMany().HasForeignKey(e => e.VerifiedById).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // VerificationBadgeType is NOT tenant-scoped — it represents global badge type definitions
        modelBuilder.Entity<VerificationBadgeType>(entity =>
        {
            entity.ToTable("verification_badge_types");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.HasIndex(e => e.Key).IsUnique();
        });

        modelBuilder.Entity<UserVerificationBadge>(entity =>
        {
            entity.ToTable("user_verification_badges");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.UserId, e.BadgeTypeId }).IsUnique();
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.BadgeType).WithMany().HasForeignKey(e => e.BadgeTypeId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.AwardedBy).WithMany().HasForeignKey(e => e.AwardedById).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
