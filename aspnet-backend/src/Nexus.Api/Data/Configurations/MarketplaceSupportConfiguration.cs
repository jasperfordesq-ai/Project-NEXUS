// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

public sealed class MarketplaceSupportConfiguration(TenantContext tenantContext) : IEntityGroupConfiguration
{
    public void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MarketplaceCategoryTemplate>(entity =>
        {
            entity.ToTable("marketplace_category_templates");
            entity.HasKey(template => template.Id);
            entity.Property(template => template.Id).HasColumnName("id");
            entity.Property(template => template.TenantId).HasColumnName("tenant_id");
            entity.Property(template => template.CategoryId).HasColumnName("category_id");
            entity.Property(template => template.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
            entity.Property(template => template.FieldsJson).HasColumnName("fields").HasColumnType("jsonb").IsRequired();
            entity.Property(template => template.CreatedAt).HasColumnName("created_at");
            entity.Property(template => template.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(template => template.TenantId)
                .HasDatabaseName("marketplace_category_templates_tenant_id_index");
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(template => template.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MarketplaceCategory>()
                .WithMany()
                .HasForeignKey(template => template.CategoryId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(template =>
                !tenantContext.TenantId.HasValue || template.TenantId == tenantContext.TenantId.Value);
        });

        modelBuilder.Entity<MarketplaceReportNotification>(entity =>
        {
            entity.ToTable("marketplace_report_notifications", table =>
            {
                table.HasCheckConstraint("CK_marketplace_report_notifications_channel",
                    "channel IN ('bell', 'email')");
                table.HasCheckConstraint("CK_marketplace_report_notifications_status",
                    "status IN ('pending', 'processing', 'sent', 'failed')");
                table.HasCheckConstraint("CK_marketplace_report_notifications_attempts", "attempts >= 0");
            });
            entity.HasKey(notification => notification.Id);
            entity.Property(notification => notification.Id).HasColumnName("id");
            entity.Property(notification => notification.TenantId).HasColumnName("tenant_id");
            entity.Property(notification => notification.MarketplaceReportId).HasColumnName("marketplace_report_id");
            entity.Property(notification => notification.RecipientUserId).HasColumnName("recipient_user_id");
            entity.Property(notification => notification.EventType).HasColumnName("event_type").HasMaxLength(40).IsRequired();
            entity.Property(notification => notification.Channel).HasColumnName("channel").HasMaxLength(20).IsRequired();
            entity.Property(notification => notification.DedupeKey).HasColumnName("dedupe_key").HasMaxLength(191).IsRequired();
            entity.Property(notification => notification.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("pending").IsRequired();
            entity.Property(notification => notification.Attempts).HasColumnName("attempts").HasDefaultValue(0);
            entity.Property(notification => notification.LastError).HasColumnName("last_error").HasColumnType("text");
            entity.Property(notification => notification.LastAttemptedAt).HasColumnName("last_attempted_at");
            entity.Property(notification => notification.SentAt).HasColumnName("sent_at");
            entity.Property(notification => notification.NextRetryAt).HasColumnName("next_retry_at");
            entity.Property(notification => notification.PayloadJson).HasColumnName("payload").HasColumnType("jsonb");
            entity.Property(notification => notification.CreatedAt).HasColumnName("created_at");
            entity.Property(notification => notification.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(notification => new { notification.TenantId, notification.DedupeKey, notification.Channel })
                .IsUnique()
                .HasDatabaseName("mrn_tenant_dedupe_channel_unique");
            entity.HasIndex(notification => new { notification.TenantId, notification.Status, notification.NextRetryAt })
                .HasDatabaseName("mrn_tenant_status_retry_idx");
            entity.HasIndex(notification => new { notification.TenantId, notification.MarketplaceReportId })
                .HasDatabaseName("mrn_tenant_report_idx");

            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(notification => notification.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MarketplaceReport>()
                .WithMany()
                .HasForeignKey(notification => new { notification.TenantId, notification.MarketplaceReportId })
                .HasPrincipalKey(report => new { report.TenantId, report.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<User>()
                .WithMany()
                .HasForeignKey(notification => new { notification.TenantId, notification.RecipientUserId })
                .HasPrincipalKey(user => new { user.TenantId, user.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
