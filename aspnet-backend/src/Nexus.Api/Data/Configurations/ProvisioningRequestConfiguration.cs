// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configuration for ProvisioningRequest — new-tenant onboarding queue.
/// </summary>
public class ProvisioningRequestConfiguration : TenantScopedConfiguration
{
    public ProvisioningRequestConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ProvisioningRequest>(entity =>
        {
            entity.ToTable("provisioning_requests");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.OrgName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.RequestedSubdomain).HasMaxLength(64).IsRequired();
            entity.Property(e => e.ContactName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.ContactEmail).HasMaxLength(255).IsRequired();
            entity.Property(e => e.ContactPhone).HasMaxLength(64);
            entity.Property(e => e.Plan).HasMaxLength(64);
            entity.Property(e => e.Country).HasMaxLength(2);
            entity.Property(e => e.Notes).HasMaxLength(4000);
            entity.Property(e => e.FailureReason).HasMaxLength(1000);
            entity.Property(e => e.Status).HasConversion<int>();
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => e.RequestedSubdomain);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
