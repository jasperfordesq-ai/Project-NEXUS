// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for GDPR and compliance entities:
/// DataExportRequest, DataDeletionRequest, ConsentRecord, CookieConsent,
/// CookiePolicy, GdprBreach, GdprConsentType.
/// </summary>
public class GdprConfiguration : TenantScopedConfiguration
{
    public GdprConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // DataExportRequest
        modelBuilder.Entity<DataExportRequest>(entity =>
        {
            entity.ToTable("data_export_requests");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(e => e.Format).HasMaxLength(20);
            entity.Property(e => e.FileUrl).HasMaxLength(1000);
            entity.Property(e => e.ErrorMessage).HasMaxLength(1000);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // DataDeletionRequest
        modelBuilder.Entity<DataDeletionRequest>(entity =>
        {
            entity.ToTable("data_deletion_requests");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(e => e.Reason).HasMaxLength(2000);
            entity.Property(e => e.DataRetainedReason).HasMaxLength(1000);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.ReviewedBy).WithMany().HasForeignKey(e => e.ReviewedById).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ConsentRecord
        modelBuilder.Entity<ConsentRecord>(entity =>
        {
            entity.ToTable("consent_records");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ConsentType).HasMaxLength(100).IsRequired();
            entity.Property(e => e.IpAddress).HasMaxLength(50);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.ConsentType }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // CookieConsent
        modelBuilder.Entity<CookieConsent>(entity =>
        {
            entity.ToTable("cookie_consents");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SessionId).HasMaxLength(100);
            entity.Property(e => e.IpAddress).HasMaxLength(50);
            entity.Property(e => e.UserAgent).HasMaxLength(500);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.SessionId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // CookiePolicy
        modelBuilder.Entity<CookiePolicy>(entity =>
        {
            entity.ToTable("cookie_policies");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Version).HasMaxLength(20).IsRequired();
            entity.Property(e => e.ContentHtml).HasColumnType("text").IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.Version }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GdprBreach
        modelBuilder.Entity<GdprBreach>(entity =>
        {
            entity.ToTable("gdpr_breaches");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Severity).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(30).IsRequired();
            entity.HasOne(e => e.ReportedBy).WithMany().HasForeignKey(e => e.ReportedById).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // GdprConsentType
        modelBuilder.Entity<GdprConsentType>(entity =>
        {
            entity.ToTable("gdpr_consent_types");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
