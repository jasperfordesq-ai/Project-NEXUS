// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for organisation entities:
/// Organisation, OrganisationMember.
/// </summary>
public class OrganisationConfiguration : TenantScopedConfiguration
{
    public OrganisationConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Organisation
        modelBuilder.Entity<Organisation>(entity =>
        {
            entity.ToTable("organisations");
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Name).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(2000);
            entity.Property(e => e.LogoUrl).HasMaxLength(1000);
            entity.Property(e => e.WebsiteUrl).HasMaxLength(1000);
            entity.Property(e => e.Email).HasMaxLength(255);
            entity.Property(e => e.Phone).HasMaxLength(50);
            entity.Property(e => e.Address).HasMaxLength(500);
            entity.Property(e => e.Type).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Industry).HasMaxLength(200);
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Owner)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OwnerId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // OrganisationMember
        modelBuilder.Entity<OrganisationMember>(entity =>
        {
            entity.ToTable("organisation_members", table => table.HasCheckConstraint(
                "CK_organisation_members_Role",
                "\"Role\" IN ('owner', 'admin', 'member', 'volunteer')"));
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Role).HasMaxLength(50).IsRequired();
            entity.Property(e => e.JobTitle).HasMaxLength(200);
            entity.HasIndex(e => new { e.TenantId, e.OrganisationId, e.UserId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Organisation)
                .WithMany(o => o.Members)
                .HasForeignKey(e => new { e.TenantId, e.OrganisationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.UserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
