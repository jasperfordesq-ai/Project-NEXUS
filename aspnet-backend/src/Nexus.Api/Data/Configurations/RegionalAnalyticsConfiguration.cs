// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configuration for paid Regional Analytics parity tables.
/// </summary>
public class RegionalAnalyticsConfiguration : TenantScopedConfiguration
{
    public RegionalAnalyticsConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RegionalAnalyticsSubscription>(entity =>
        {
            entity.ToTable("regional_analytics_subscriptions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.PartnerName).HasColumnName("partner_name").HasMaxLength(191).IsRequired();
            entity.Property(e => e.PartnerType)
                .HasColumnName("partner_type")
                .HasMaxLength(32)
                .HasDefaultValue("municipality")
                .IsRequired();
            entity.Property(e => e.ContactEmail).HasColumnName("contact_email").HasMaxLength(191).IsRequired();
            entity.Property(e => e.ContactLanguage).HasColumnName("contact_language").HasMaxLength(10);
            entity.Property(e => e.BillingEmail).HasColumnName("billing_email").HasMaxLength(191);
            entity.Property(e => e.PlanTier)
                .HasColumnName("plan_tier")
                .HasMaxLength(32)
                .HasDefaultValue("basic")
                .IsRequired();
            entity.Property(e => e.Status)
                .HasColumnName("status")
                .HasMaxLength(32)
                .HasDefaultValue("trialing")
                .IsRequired();
            entity.Property(e => e.StripeSubscriptionId).HasColumnName("stripe_subscription_id").HasMaxLength(100);
            entity.Property(e => e.SubscriptionToken).HasColumnName("subscription_token").HasMaxLength(80).IsRequired();
            entity.Property(e => e.SubscriptionTokenHash).HasColumnName("subscription_token_hash").HasMaxLength(64);
            entity.Property(e => e.TrialEndsAt).HasColumnName("trial_ends_at");
            entity.Property(e => e.CurrentPeriodStart).HasColumnName("current_period_start");
            entity.Property(e => e.CurrentPeriodEnd).HasColumnName("current_period_end");
            entity.Property(e => e.MonthlyPriceCents).HasColumnName("monthly_price_cents").HasDefaultValue(0);
            entity.Property(e => e.Currency).HasColumnName("currency").HasMaxLength(3).HasDefaultValue("CHF").IsRequired();
            entity.Property(e => e.EnabledModules).HasColumnName("enabled_modules").HasColumnType("jsonb");
            entity.Property(e => e.CreatedByAdminId).HasColumnName("created_by_admin_id");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => e.SubscriptionToken).IsUnique();
            entity.HasIndex(e => e.SubscriptionTokenHash)
                .IsUnique()
                .HasDatabaseName("regional_analytics_token_hash_unique");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<RegionalAnalyticsReport>(entity =>
        {
            entity.ToTable("regional_analytics_reports");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SubscriptionId).HasColumnName("subscription_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.ReportType)
                .HasColumnName("report_type")
                .HasMaxLength(32)
                .HasDefaultValue("monthly_summary")
                .IsRequired();
            entity.Property(e => e.PeriodStart).HasColumnName("period_start").HasColumnType("date");
            entity.Property(e => e.PeriodEnd).HasColumnName("period_end").HasColumnType("date");
            entity.Property(e => e.GeneratedAt).HasColumnName("generated_at");
            entity.Property(e => e.FileUrl).HasColumnName("file_url").HasMaxLength(500);
            entity.Property(e => e.PayloadJson).HasColumnName("payload_json").HasColumnType("jsonb");
            entity.Property(e => e.RecipientEmails).HasColumnName("recipient_emails").HasColumnType("jsonb");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("queued").IsRequired();
            entity.Property(e => e.ErrorMessage).HasColumnName("error_message").HasColumnType("text");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.SubscriptionId);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.SubscriptionId, e.PeriodStart });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Subscription)
                .WithMany(e => e.Reports)
                .HasForeignKey(e => e.SubscriptionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<RegionalAnalyticsAccessLog>(entity =>
        {
            entity.ToTable("regional_analytics_access_log");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SubscriptionId).HasColumnName("subscription_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.AccessedEndpoint).HasColumnName("accessed_endpoint").HasMaxLength(255).IsRequired();
            entity.Property(e => e.AccessedAt).HasColumnName("accessed_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(e => e.IpHash).HasColumnName("ip_hash").HasMaxLength(64);
            entity.Property(e => e.UserAgent).HasColumnName("user_agent").HasMaxLength(255);

            entity.HasIndex(e => e.SubscriptionId);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.SubscriptionId, e.AccessedAt });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Subscription)
                .WithMany(e => e.AccessLogs)
                .HasForeignKey(e => e.SubscriptionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<RegionalAnalyticsCache>(entity =>
        {
            entity.ToTable("regional_analytics_cache");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.ReportType).HasColumnName("report_type").HasMaxLength(100).IsRequired();
            entity.Property(e => e.Period).HasColumnName("period").HasMaxLength(20).IsRequired();
            entity.Property(e => e.Payload).HasColumnName("payload").HasColumnType("text").IsRequired();
            entity.Property(e => e.ComputedAt).HasColumnName("computed_at");
            entity.Property(e => e.ExpiresAt).HasColumnName("expires_at");

            entity.HasIndex(new[] { nameof(RegionalAnalyticsCache.TenantId), nameof(RegionalAnalyticsCache.ReportType), nameof(RegionalAnalyticsCache.Period) }, "rac_tenant_type_period");
            entity.HasIndex(new[] { nameof(RegionalAnalyticsCache.TenantId), nameof(RegionalAnalyticsCache.ReportType), nameof(RegionalAnalyticsCache.Period) }, "rac_unique")
                .IsUnique();

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
