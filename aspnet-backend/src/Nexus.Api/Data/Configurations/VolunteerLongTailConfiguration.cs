// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Phase 65 — entity configurations for the volunteer long-tail subsystem:
/// VolunteerExpense, VolunteerWellbeing, VolunteerCertificate,
/// VolunteerEmergencyAlert.
/// </summary>
public class VolunteerLongTailConfiguration : TenantScopedConfiguration
{
    public VolunteerLongTailConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<VolunteerExpense>(entity =>
        {
            entity.ToTable("volunteer_expenses");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Amount).HasPrecision(10, 2);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.ShiftId);
            entity.HasIndex(e => e.Status);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerWellbeing>(entity =>
        {
            entity.ToTable("volunteer_wellbeing");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.ShiftId);
            entity.HasIndex(e => e.RequiresFollowUp);
            entity.HasIndex(e => e.IsResolved);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerWellbeingAlert>(entity =>
        {
            entity.ToTable("vol_wellbeing_alerts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.RiskLevel).HasColumnName("risk_level").HasMaxLength(20).HasDefaultValue("moderate");
            entity.Property(e => e.RiskScore).HasColumnName("risk_score").HasPrecision(5, 2).HasDefaultValue(0m);
            entity.Property(e => e.Indicators).HasColumnName("indicators").HasColumnType("jsonb").HasDefaultValueSql("'{}'::jsonb");
            entity.Property(e => e.CoordinatorNotified).HasColumnName("coordinator_notified").HasDefaultValue(false);
            entity.Property(e => e.CoordinatorNotes).HasColumnName("coordinator_notes").HasColumnType("text");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("active");
            entity.Property(e => e.ResolvedAt).HasColumnName("resolved_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.HasIndex(e => new { e.TenantId, e.UserId }).HasDatabaseName("idx_vol_wellbeing_alerts_tenant_user");
            entity.HasIndex(e => new { e.TenantId, e.Status }).HasDatabaseName("idx_vol_wellbeing_alerts_tenant_status");
            entity.HasIndex(e => new { e.RiskLevel, e.Status }).HasDatabaseName("idx_vol_wellbeing_alerts_risk_level_status");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerCertificate>(entity =>
        {
            entity.ToTable("volunteer_certificates");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.HoursRecognised).HasPrecision(10, 2);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.VerificationCode).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerEmergencyAlert>(entity =>
        {
            entity.ToTable("volunteer_emergency_alerts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Severity).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.OpportunityId);
            entity.HasIndex(e => e.ShiftId);
            entity.HasIndex(e => e.IsActive);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
