// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for member activity, FAQs, and sessions:
/// MemberActivityLog, Faq, UserSession.
/// </summary>
public class MemberActivityFaqConfiguration : TenantScopedConfiguration
{
    public MemberActivityFaqConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MemberActivityLog>(entity =>
        {
            entity.ToTable("member_activity_logs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ActivityType).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => new { e.UserId, e.OccurredAt });
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<Faq>(entity =>
        {
            entity.ToTable("faqs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Question).IsRequired();
            entity.Property(e => e.Answer).IsRequired();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<UserSession>(entity =>
        {
            entity.ToTable("user_sessions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SessionToken).HasMaxLength(500).IsRequired();
            entity.HasIndex(e => e.SessionToken);
            entity.HasIndex(e => new { e.UserId, e.IsActive });
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
