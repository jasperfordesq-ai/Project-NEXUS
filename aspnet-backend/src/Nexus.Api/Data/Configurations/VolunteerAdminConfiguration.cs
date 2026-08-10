// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Volunteer admin extras — courses, completions, guardian consents,
/// per-tenant policy. Pairs with <see cref="VolunteerLongTailConfiguration"/>.
/// </summary>
public class VolunteerAdminConfiguration : TenantScopedConfiguration
{
    public VolunteerAdminConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<VolunteerTrainingCourse>(entity =>
        {
            entity.ToTable("volunteer_training_courses");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.Active);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerTrainingCompletion>(entity =>
        {
            entity.ToTable("volunteer_training_completions");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.UserId, e.CourseId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Course).WithMany().HasForeignKey(e => e.CourseId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerGuardianConsent>(entity =>
        {
            entity.ToTable("volunteer_guardian_consents");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.MinorUserId);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.ConsentTokenHash)
                .IsUnique()
                .HasFilter("\"ConsentTokenHash\" IS NOT NULL");
            entity.HasIndex(e => new { e.TenantId, e.MinorUserId, e.Id });
            entity.HasIndex(e => new { e.TenantId, e.Status, e.Id });
            entity.HasIndex(e => new { e.TenantId, e.MinorUserId, e.Status, e.OpportunityId, e.ExpiresAt });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Minor).WithMany().HasForeignKey(e => e.MinorUserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Opportunity).WithMany().HasForeignKey(e => e.OpportunityId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerTenantPolicy>(entity =>
        {
            entity.ToTable("volunteer_tenant_policies");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.HoursRequiredForCertificate).HasPrecision(10, 2);
            // Singleton per tenant.
            entity.HasIndex(e => e.TenantId).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
