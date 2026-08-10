// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class RegionalAnalyticsSchemaTests
{
    [Fact]
    public void RegionalAnalyticsSubscription_MapsLaravelSubscriptionsTable()
    {
        var type = Resolve("Nexus.Api.Entities.RegionalAnalyticsSubscription, Nexus.Api");
        typeof(ITenantEntity).IsAssignableFrom(type).Should().BeTrue();

        using var db = CreateDbContext(CreateTenantContext(42));
        var entity = db.Model.FindEntityType(type);

        entity.Should().NotBeNull("regional_analytics_subscriptions is a Laravel schema parity table");
        var mappedEntity = entity!;
        mappedEntity.GetTableName().Should().Be("regional_analytics_subscriptions");
        mappedEntity.GetQueryFilter().Should().NotBeNull("regional analytics subscriptions must stay tenant isolated");

        Column(mappedEntity, "Id").Should().Be("id");
        Column(mappedEntity, "TenantId").Should().Be("tenant_id");
        Column(mappedEntity, "PartnerName").Should().Be("partner_name");
        Column(mappedEntity, "PartnerType").Should().Be("partner_type");
        Column(mappedEntity, "ContactEmail").Should().Be("contact_email");
        Column(mappedEntity, "ContactLanguage").Should().Be("contact_language");
        Column(mappedEntity, "BillingEmail").Should().Be("billing_email");
        Column(mappedEntity, "PlanTier").Should().Be("plan_tier");
        Column(mappedEntity, "Status").Should().Be("status");
        Column(mappedEntity, "StripeSubscriptionId").Should().Be("stripe_subscription_id");
        Column(mappedEntity, "SubscriptionToken").Should().Be("subscription_token");
        Column(mappedEntity, "SubscriptionTokenHash").Should().Be("subscription_token_hash");
        Column(mappedEntity, "TrialEndsAt").Should().Be("trial_ends_at");
        Column(mappedEntity, "CurrentPeriodStart").Should().Be("current_period_start");
        Column(mappedEntity, "CurrentPeriodEnd").Should().Be("current_period_end");
        Column(mappedEntity, "MonthlyPriceCents").Should().Be("monthly_price_cents");
        Column(mappedEntity, "Currency").Should().Be("currency");
        Column(mappedEntity, "EnabledModules").Should().Be("enabled_modules");
        Column(mappedEntity, "CreatedByAdminId").Should().Be("created_by_admin_id");
        Column(mappedEntity, "CreatedAt").Should().Be("created_at");
        Column(mappedEntity, "UpdatedAt").Should().Be("updated_at");

        mappedEntity.FindProperty("PartnerName")!.GetMaxLength().Should().Be(191);
        mappedEntity.FindProperty("PartnerType")!.GetMaxLength().Should().Be(32);
        mappedEntity.FindProperty("PartnerType")!.GetDefaultValue().Should().Be("municipality");
        mappedEntity.FindProperty("ContactEmail")!.GetMaxLength().Should().Be(191);
        mappedEntity.FindProperty("ContactLanguage")!.GetMaxLength().Should().Be(10);
        mappedEntity.FindProperty("BillingEmail")!.GetMaxLength().Should().Be(191);
        mappedEntity.FindProperty("PlanTier")!.GetMaxLength().Should().Be(32);
        mappedEntity.FindProperty("PlanTier")!.GetDefaultValue().Should().Be("basic");
        mappedEntity.FindProperty("Status")!.GetMaxLength().Should().Be(32);
        mappedEntity.FindProperty("Status")!.GetDefaultValue().Should().Be("trialing");
        mappedEntity.FindProperty("StripeSubscriptionId")!.GetMaxLength().Should().Be(100);
        mappedEntity.FindProperty("SubscriptionToken")!.GetMaxLength().Should().Be(80);
        mappedEntity.FindProperty("SubscriptionTokenHash")!.GetMaxLength().Should().Be(64);
        mappedEntity.FindProperty("MonthlyPriceCents")!.GetDefaultValue().Should().Be(0);
        mappedEntity.FindProperty("Currency")!.GetMaxLength().Should().Be(3);
        mappedEntity.FindProperty("Currency")!.GetDefaultValue().Should().Be("CHF");
        mappedEntity.FindProperty("EnabledModules")!.GetColumnType().Should().Be("jsonb");

        HasIndex(mappedEntity, unique: false, "TenantId").Should().BeTrue();
        HasIndex(mappedEntity, unique: false, "TenantId", "Status").Should().BeTrue();
        HasIndex(mappedEntity, unique: true, "SubscriptionToken").Should().BeTrue();
        HasIndex(mappedEntity, unique: true, "SubscriptionTokenHash").Should().BeTrue();
    }

    [Fact]
    public void RegionalAnalyticsReport_MapsLaravelReportsTable()
    {
        var type = Resolve("Nexus.Api.Entities.RegionalAnalyticsReport, Nexus.Api");
        typeof(ITenantEntity).IsAssignableFrom(type).Should().BeTrue();

        using var db = CreateDbContext(CreateTenantContext(42));
        var entity = db.Model.FindEntityType(type);

        entity.Should().NotBeNull("regional_analytics_reports is a Laravel schema parity table");
        var mappedEntity = entity!;
        mappedEntity.GetTableName().Should().Be("regional_analytics_reports");
        mappedEntity.GetQueryFilter().Should().NotBeNull("regional analytics reports must stay tenant isolated");

        Column(mappedEntity, "Id").Should().Be("id");
        Column(mappedEntity, "SubscriptionId").Should().Be("subscription_id");
        Column(mappedEntity, "TenantId").Should().Be("tenant_id");
        Column(mappedEntity, "ReportType").Should().Be("report_type");
        Column(mappedEntity, "PeriodStart").Should().Be("period_start");
        Column(mappedEntity, "PeriodEnd").Should().Be("period_end");
        Column(mappedEntity, "GeneratedAt").Should().Be("generated_at");
        Column(mappedEntity, "FileUrl").Should().Be("file_url");
        Column(mappedEntity, "PayloadJson").Should().Be("payload_json");
        Column(mappedEntity, "RecipientEmails").Should().Be("recipient_emails");
        Column(mappedEntity, "Status").Should().Be("status");
        Column(mappedEntity, "ErrorMessage").Should().Be("error_message");
        Column(mappedEntity, "CreatedAt").Should().Be("created_at");
        Column(mappedEntity, "UpdatedAt").Should().Be("updated_at");

        mappedEntity.FindProperty("ReportType")!.GetMaxLength().Should().Be(32);
        mappedEntity.FindProperty("ReportType")!.GetDefaultValue().Should().Be("monthly_summary");
        mappedEntity.FindProperty("PeriodStart")!.GetColumnType().Should().Be("date");
        mappedEntity.FindProperty("PeriodEnd")!.GetColumnType().Should().Be("date");
        mappedEntity.FindProperty("FileUrl")!.GetMaxLength().Should().Be(500);
        mappedEntity.FindProperty("PayloadJson")!.GetColumnType().Should().Be("jsonb");
        mappedEntity.FindProperty("RecipientEmails")!.GetColumnType().Should().Be("jsonb");
        mappedEntity.FindProperty("Status")!.GetMaxLength().Should().Be(32);
        mappedEntity.FindProperty("Status")!.GetDefaultValue().Should().Be("queued");
        mappedEntity.FindProperty("ErrorMessage")!.GetColumnType().Should().Be("text");

        HasIndex(mappedEntity, unique: false, "SubscriptionId").Should().BeTrue();
        HasIndex(mappedEntity, unique: false, "TenantId").Should().BeTrue();
        HasIndex(mappedEntity, unique: false, "SubscriptionId", "PeriodStart").Should().BeTrue();
    }

    [Fact]
    public void RegionalAnalyticsAccessLog_MapsLaravelAccessLogTable()
    {
        var type = Resolve("Nexus.Api.Entities.RegionalAnalyticsAccessLog, Nexus.Api");
        typeof(ITenantEntity).IsAssignableFrom(type).Should().BeTrue();

        using var db = CreateDbContext(CreateTenantContext(42));
        var entity = db.Model.FindEntityType(type);

        entity.Should().NotBeNull("regional_analytics_access_log is a Laravel schema parity table");
        var mappedEntity = entity!;
        mappedEntity.GetTableName().Should().Be("regional_analytics_access_log");
        mappedEntity.GetQueryFilter().Should().NotBeNull("regional analytics access logs must stay tenant isolated");

        Column(mappedEntity, "Id").Should().Be("id");
        Column(mappedEntity, "SubscriptionId").Should().Be("subscription_id");
        Column(mappedEntity, "TenantId").Should().Be("tenant_id");
        Column(mappedEntity, "AccessedEndpoint").Should().Be("accessed_endpoint");
        Column(mappedEntity, "AccessedAt").Should().Be("accessed_at");
        Column(mappedEntity, "IpHash").Should().Be("ip_hash");
        Column(mappedEntity, "UserAgent").Should().Be("user_agent");

        mappedEntity.FindProperty("AccessedEndpoint")!.GetMaxLength().Should().Be(255);
        mappedEntity.FindProperty("AccessedAt")!.GetDefaultValueSql().Should().Be("CURRENT_TIMESTAMP");
        mappedEntity.FindProperty("IpHash")!.GetMaxLength().Should().Be(64);
        mappedEntity.FindProperty("UserAgent")!.GetMaxLength().Should().Be(255);

        HasIndex(mappedEntity, unique: false, "SubscriptionId").Should().BeTrue();
        HasIndex(mappedEntity, unique: false, "TenantId").Should().BeTrue();
        HasIndex(mappedEntity, unique: false, "SubscriptionId", "AccessedAt").Should().BeTrue();
    }

    [Fact]
    public void RegionalAnalyticsCache_MapsLaravelCacheTable()
    {
        var type = Resolve("Nexus.Api.Entities.RegionalAnalyticsCache, Nexus.Api");
        typeof(ITenantEntity).IsAssignableFrom(type).Should().BeTrue();

        using var db = CreateDbContext(CreateTenantContext(42));
        var entity = db.Model.FindEntityType(type);

        entity.Should().NotBeNull("regional_analytics_cache is a Laravel schema parity table");
        var mappedEntity = entity!;
        mappedEntity.GetTableName().Should().Be("regional_analytics_cache");
        mappedEntity.GetQueryFilter().Should().NotBeNull("regional analytics cache entries must stay tenant isolated");

        Column(mappedEntity, "Id").Should().Be("id");
        Column(mappedEntity, "TenantId").Should().Be("tenant_id");
        Column(mappedEntity, "ReportType").Should().Be("report_type");
        Column(mappedEntity, "Period").Should().Be("period");
        Column(mappedEntity, "Payload").Should().Be("payload");
        Column(mappedEntity, "ComputedAt").Should().Be("computed_at");
        Column(mappedEntity, "ExpiresAt").Should().Be("expires_at");

        mappedEntity.FindProperty("ReportType")!.GetMaxLength().Should().Be(100);
        mappedEntity.FindProperty("Period")!.GetMaxLength().Should().Be(20);
        mappedEntity.FindProperty("Payload")!.GetColumnType().Should().Be("text");

        HasIndex(mappedEntity, unique: false, "TenantId", "ReportType", "Period").Should().BeTrue();
        HasIndex(mappedEntity, unique: true, "TenantId", "ReportType", "Period").Should().BeTrue();
    }

    private static bool HasIndex(
        Microsoft.EntityFrameworkCore.Metadata.IEntityType entity,
        bool unique,
        params string[] propertyNames)
    {
        return entity.GetIndexes().Any(index =>
            index.IsUnique == unique
            && index.Properties.Select(property => property.Name).SequenceEqual(propertyNames));
    }

    private static string? Column(Microsoft.EntityFrameworkCore.Metadata.IEntityType entity, string propertyName)
    {
        var table = StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema());
        return entity.FindProperty(propertyName)?.GetColumnName(table);
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql("Host=localhost;Database=nexus_schema_metadata;Username=nexus;Password=nexus")
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"{typeName} should exist for Laravel schema parity");
        return type!;
    }
}
