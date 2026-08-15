// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configuration for platform capability overrides — deliberately NOT
/// tenant-scoped: one row per capability for the whole installation.
/// (EventAttendanceCreditClaim is configured by its original schema slice.)
/// </summary>
public class PlatformOpsConfiguration : TenantScopedConfiguration
{
    public PlatformOpsConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PlatformCapabilityOverride>(entity =>
        {
            entity.ToTable("platform_capability_overrides");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Capability).HasColumnName("capability").HasMaxLength(64).IsRequired();
            entity.Property(e => e.Value).HasColumnName("value").HasMaxLength(64).IsRequired();
            entity.Property(e => e.UpdatedByUserId).HasColumnName("updated_by_user_id");
            entity.Property(e => e.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => e.Capability).IsUnique();
        });

        modelBuilder.Entity<RevokedToken>(entity =>
        {
            entity.ToTable("revoked_tokens");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.Jti).HasColumnName("jti").HasMaxLength(64).IsRequired();
            entity.Property(e => e.RevokedAt).HasColumnName("revoked_at");
            entity.Property(e => e.ExpiresAt).HasColumnName("expires_at");
            // The UNIQUE jti is the single-use guarantee: the exchange consumes
            // a proof by inserting its jti; a duplicate insert means already
            // spent. Not tenant-scoped — the anonymous exchange has no tenant.
            entity.HasIndex(e => e.Jti).IsUnique();
            entity.HasIndex(e => e.ExpiresAt);
        });
    }
}
