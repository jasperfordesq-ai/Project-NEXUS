// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Phase 68 — entity configuration for federated hour transfers.
/// </summary>
public class FederationProtocolsConfiguration : TenantScopedConfiguration
{
    public FederationProtocolsConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FederatedHourTransfer>(entity =>
        {
            entity.ToTable("federated_hour_transfers");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Amount).HasPrecision(10, 2);
            entity.Property(e => e.Direction).HasConversion<string>().HasMaxLength(20);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.PartnerId);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => new { e.Status, e.LastReconcileAttemptAt });
            entity.HasIndex(e => e.ExternalReference);
            entity.HasIndex(e => e.LocalTransactionId)
                .IsUnique()
                .HasFilter("\"LocalTransactionId\" IS NOT NULL");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Partner).WithMany().HasForeignKey(e => e.PartnerId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>()
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.LocalUserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Transaction>()
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.LocalTransactionId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
