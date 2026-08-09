// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for system-level entities:
/// SystemSetting, ScheduledTask, PlatformAnnouncement.
/// </summary>
public class SystemConfiguration : TenantScopedConfiguration
{
    public SystemConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SystemSetting>(entity =>
        {
            entity.ToTable("system_settings");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Value).HasColumnType("text").IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.Property(e => e.Category).HasMaxLength(50);
            entity.HasIndex(e => e.Key).IsUnique();
        });

        modelBuilder.Entity<ScheduledTask>(entity =>
        {
            entity.ToTable("scheduled_tasks");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TaskName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(e => e.CronExpression).HasMaxLength(50);
            entity.Property(e => e.Parameters).HasColumnType("text");
            entity.Property(e => e.ErrorMessage).HasMaxLength(2000);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.TaskName);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PlatformAnnouncement>(entity =>
        {
            entity.ToTable("platform_announcements");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();
            entity.Property(e => e.Type).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.IsActive);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
