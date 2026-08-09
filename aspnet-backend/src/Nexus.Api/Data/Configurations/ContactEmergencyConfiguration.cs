// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for contact forms and emergency alerts:
/// ContactSubmission, EmergencyAlert.
/// </summary>
public class ContactEmergencyConfiguration : TenantScopedConfiguration
{
    public ContactEmergencyConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ContactSubmission>(entity =>
        {
            entity.ToTable("contact_submissions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Email).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Subject).HasMaxLength(500).IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EmergencyAlert>(entity =>
        {
            entity.ToTable("emergency_alerts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Urgency).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.IsActive });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
