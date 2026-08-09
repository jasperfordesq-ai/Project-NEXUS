// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for tenant hierarchy and insurance:
/// TenantHierarchy (not tenant-scoped), InsuranceCertificate.
/// </summary>
public class TenantHierarchyInsuranceConfiguration : TenantScopedConfiguration
{
    public TenantHierarchyInsuranceConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // TenantHierarchy is NOT tenant-scoped — it represents relationships between tenants
        modelBuilder.Entity<TenantHierarchy>(entity =>
        {
            entity.ToTable("tenant_hierarchies");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.InheritanceMode).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => new { e.ParentTenantId, e.ChildTenantId }).IsUnique();
            entity.HasIndex(e => e.ChildTenantId).IsUnique();
            entity.HasOne(e => e.ParentTenant).WithMany().HasForeignKey(e => e.ParentTenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.ChildTenant).WithMany().HasForeignKey(e => e.ChildTenantId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<InsuranceCertificate>(entity =>
        {
            entity.ToTable("insurance_certificates");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Type).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Provider).HasMaxLength(200);
            entity.Property(e => e.PolicyNumber).HasMaxLength(100);
            entity.Property(e => e.DocumentUrl).HasMaxLength(1000);
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.VerifiedBy).WithMany().HasForeignKey(e => e.VerifiedById).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
