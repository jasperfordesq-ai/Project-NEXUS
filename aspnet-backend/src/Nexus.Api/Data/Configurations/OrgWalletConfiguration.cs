// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for organisation wallets:
/// OrgWallet, OrgWalletTransaction.
/// </summary>
public class OrgWalletConfiguration : TenantScopedConfiguration
{
    public OrgWalletConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OrgWallet>(entity =>
        {
            entity.ToTable("org_wallets");
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.HasIndex(e => new { e.TenantId, e.OrganisationId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Organisation)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OrganisationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<OrgWalletTransaction>(entity =>
        {
            entity.ToTable("org_wallet_transactions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Type).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Category).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.HasIndex(e => new { e.TenantId, e.OrgWalletId, e.CreatedAt });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.OrgWallet)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OrgWalletId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.InitiatedBy)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.InitiatedById })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.FromUser)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.FromUserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.ToUser)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.ToUserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
