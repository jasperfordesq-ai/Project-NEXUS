// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

public sealed class HealthCheckHistoryConfiguration(TenantContext tenantContext)
    : TenantScopedConfiguration(tenantContext)
{
    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<HealthCheckHistory>(entity =>
        {
            entity.ToTable("health_check_history", table =>
            {
                table.HasCheckConstraint("CK_health_check_history_status",
                    "status IN ('healthy', 'degraded', 'unhealthy')");
                table.HasCheckConstraint("CK_health_check_history_latency_ms",
                    "latency_ms IS NULL OR latency_ms >= 0");
            });
            entity.HasKey(history => history.Id);
            entity.Property(history => history.Id).HasColumnName("id");
            entity.Property(history => history.TenantId).HasColumnName("tenant_id");
            entity.Property(history => history.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
            entity.Property(history => history.ChecksJson).HasColumnName("checks").HasColumnType("jsonb").IsRequired();
            entity.Property(history => history.LatencyMs).HasColumnName("latency_ms");
            entity.Property(history => history.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("CURRENT_TIMESTAMP");

            entity.HasIndex(history => history.TenantId);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(history => history.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
