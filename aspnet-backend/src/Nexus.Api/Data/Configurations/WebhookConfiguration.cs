// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configuration for WebhookEvent with tenant-scoped global query filter.
/// </summary>
public class WebhookConfiguration : TenantScopedConfiguration
{
    public WebhookConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<WebhookEvent>(entity =>
        {
            entity.ToTable("webhook_events");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EventType).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Source).HasMaxLength(50).HasDefaultValue("php-platform");
            entity.Property(e => e.PayloadJson).HasColumnType("text");
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("processed");
            entity.Property(e => e.ErrorMessage).HasColumnType("text");
            entity.Property(e => e.Provider).HasMaxLength(50);
            entity.Property(e => e.ExternalEventId).HasMaxLength(200);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.EventType);
            entity.HasIndex(e => e.ReceivedAt);
            entity.HasIndex(e => e.Status);
            // Filtered-unique index on (TenantId, Provider, ExternalEventId)
            // for idempotent dedup of inbound webhook retries (HIGH audit fix).
            entity.HasIndex(e => new { e.TenantId, e.Provider, e.ExternalEventId })
                .IsUnique()
                .HasFilter("\"ExternalEventId\" IS NOT NULL");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
