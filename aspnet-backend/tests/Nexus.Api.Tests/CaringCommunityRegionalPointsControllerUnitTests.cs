// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityRegionalPointsControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityRegionalPointsController, Nexus.Api";
    private const string MemberControllerTypeName = "Nexus.Api.Controllers.CaringCommunityMemberController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.CaringRegionalPointService, Nexus.Api";
    private const string AccountTypeName = "Nexus.Api.Entities.CaringRegionalPointAccount, Nexus.Api";
    private const string TransactionTypeName = "Nexus.Api.Entities.CaringRegionalPointTransaction, Nexus.Api";
    private const string SellerSettingTypeName = "Nexus.Api.Entities.MarketplaceSellerRegionalPointSetting, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelRegionalPointsConfigRoutes()
    {
        var controllerType = Resolve(ControllerTypeName);

        controllerType.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/regional-points");

        controllerType.GetMethod("Config")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("config");

        controllerType.GetMethod("UpdateConfig")
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("config");

        controllerType.GetMethod("Ledger")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("ledger");

        controllerType.GetMethod("Issue")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("issue");

        controllerType.GetMethod("Adjust")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("adjust");

        controllerType.GetMethod("GetSellerSettings")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("seller-settings/{userId:int}");

        controllerType.GetMethod("UpdateSellerSettings")
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("seller-settings");
    }

    [Fact]
    public void MemberActions_ExposeLaravelRegionalPointsRoutes()
    {
        var controllerType = Resolve(MemberControllerTypeName);

        controllerType.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community");

        controllerType.GetMethod("RegionalPointsSummary")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("regional-points/summary");

        controllerType.GetMethod("RegionalPointsHistory")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("regional-points/history");

        controllerType.GetMethod("RegionalPointsTransfer")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("regional-points/transfer");

        controllerType.GetMethod("RegionalPointsMarketplaceQuote")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("regional-points/marketplace/quote");

        controllerType.GetMethod("RegionalPointsMarketplaceRedeem")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("regional-points/marketplace/redeem");
    }

    [Fact]
    public async Task Config_ReturnsLaravelDefaultsAndTenantScopedStoredValues()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.AddRange(
            Setting(42, "enabled", "true"),
            Setting(42, "label", "  Neighbour Credits  "),
            Setting(42, "symbol", "  KISS  "),
            Setting(42, "auto_issue_enabled", "1"),
            Setting(42, "points_per_approved_hour", "12.345"),
            Setting(42, "member_transfers_enabled", "yes"),
            Setting(42, "marketplace_redemption_enabled", "on"),
            Setting(7, "label", "Other Tenant Points"),
            Setting(7, "enabled", "false"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await InvokeConfig(controller));

        data.GetProperty("enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("label").GetString().Should().Be("Neighbour Credits");
        data.GetProperty("symbol").GetString().Should().Be("KISS");
        data.GetProperty("auto_issue_enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("points_per_approved_hour").GetDecimal().Should().Be(12.35m);
        data.GetProperty("member_transfers_enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("marketplace_redemption_enabled").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Config_WhenNoRegionalSettings_ReturnsLaravelDefaults()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await InvokeConfig(controller));

        data.GetProperty("enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("label").GetString().Should().Be("Regional Points");
        data.GetProperty("symbol").GetString().Should().Be("pts");
        data.GetProperty("auto_issue_enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("points_per_approved_hour").GetDecimal().Should().Be(0m);
        data.GetProperty("member_transfers_enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("marketplace_redemption_enabled").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task UpdateConfig_NormalizesPersistsAndReturnsLaravelConfig()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await InvokeUpdateConfig(controller, Json("""
        {
          "enabled": true,
          "label": "  Very Local Caring Region Credits  ",
          "symbol": "  REGIONAL-POINT-SYMBOL  ",
          "auto_issue_enabled": true,
          "points_per_approved_hour": 10000.999,
          "member_transfers_enabled": true,
          "marketplace_redemption_enabled": true,
          "unknown_field": "ignored"
        }
        """)));

        data.GetProperty("enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("label").GetString().Should().Be("Very Local Caring Region Credits");
        data.GetProperty("symbol").GetString().Should().Be("REGIONAL-POI");
        data.GetProperty("auto_issue_enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("points_per_approved_hour").GetDecimal().Should().Be(10000m);
        data.GetProperty("member_transfers_enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("marketplace_redemption_enabled").GetBoolean().Should().BeTrue();

        var rows = await db.TenantConfigs.IgnoreQueryFilters()
            .Where(config => config.TenantId == 42 && config.Key.StartsWith("caring_community.regional_points."))
            .ToDictionaryAsync(config => config.Key, config => config.Value);
        rows["caring_community.regional_points.enabled"].Should().Be("1");
        rows["caring_community.regional_points.label"].Should().Be("Very Local Caring Region Credits");
        rows["caring_community.regional_points.symbol"].Should().Be("REGIONAL-POI");
        rows["caring_community.regional_points.auto_issue_enabled"].Should().Be("1");
        rows["caring_community.regional_points.points_per_approved_hour"].Should().Be("10000");
        rows["caring_community.regional_points.member_transfers_enabled"].Should().Be("1");
        rows["caring_community.regional_points.marketplace_redemption_enabled"].Should().Be("1");
        rows.Keys.Should().NotContain("caring_community.regional_points.unknown_field");
    }

    [Fact]
    public async Task UpdateConfig_WhenDisabled_ClearsDependentTogglesAndUsesFallbackNames()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await InvokeUpdateConfig(controller, Json("""
        {
          "enabled": false,
          "label": "   ",
          "symbol": "",
          "auto_issue_enabled": true,
          "points_per_approved_hour": -25,
          "member_transfers_enabled": true,
          "marketplace_redemption_enabled": true
        }
        """)));

        data.GetProperty("enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("label").GetString().Should().Be("Regional Points");
        data.GetProperty("symbol").GetString().Should().Be("pts");
        data.GetProperty("auto_issue_enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("points_per_approved_hour").GetDecimal().Should().Be(0m);
        data.GetProperty("member_transfers_enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("marketplace_redemption_enabled").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task Config_WhenCaringCommunityDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        AssertSingleError(await InvokeConfig(controller), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
        AssertSingleError(await InvokeUpdateConfig(controller, Json("{}")), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
    }

    [Fact]
    public async Task Ledger_ReturnsTenantStatsAndNewestLaravelTransactions()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        SeedUser(db, 42, 9, "admin@example.test", "Admin", "User", Role.Names.Admin);
        SeedUser(db, 42, 10, "ada@example.test", "Ada", "Lovelace");
        SeedUser(db, 42, 20, "grace@example.test", "Grace", "Hopper");
        SeedUser(db, 7, 710, "other@example.test", "Other", "Tenant");
        db.Add(Entity(AccountTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("Balance", 12m),
            ("LifetimeEarned", 30m), ("LifetimeSpent", 18m)));
        db.Add(Entity(AccountTypeName,
            ("Id", 1002L), ("TenantId", 42), ("UserId", 20), ("Balance", 5m),
            ("LifetimeEarned", 5m), ("LifetimeSpent", 0m)));
        db.Add(Entity(AccountTypeName,
            ("Id", 9001L), ("TenantId", 7), ("UserId", 710), ("Balance", 999m),
            ("LifetimeEarned", 999m), ("LifetimeSpent", 0m)));
        db.Add(Entity(TransactionTypeName,
            ("Id", 501L), ("TenantId", 42), ("AccountId", 1001L), ("UserId", 10), ("ActorUserId", 9),
            ("Type", "admin_issue"), ("Direction", "credit"), ("Points", 30m), ("BalanceAfter", 30m),
            ("Description", "Issued"), ("CreatedAt", new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(TransactionTypeName,
            ("Id", 502L), ("TenantId", 42), ("AccountId", 1001L), ("UserId", 10), ("ActorUserId", 9),
            ("Type", "admin_adjustment"), ("Direction", "debit"), ("Points", 18m), ("BalanceAfter", 12m),
            ("Description", "Correction"), ("CreatedAt", new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(TransactionTypeName,
            ("Id", 503L), ("TenantId", 42), ("AccountId", 1002L), ("UserId", 20), ("ActorUserId", 9),
            ("Type", "admin_issue"), ("Direction", "credit"), ("Points", 5m), ("BalanceAfter", 5m),
            ("Description", "Bonus"), ("CreatedAt", new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(TransactionTypeName,
            ("Id", 990L), ("TenantId", 7), ("AccountId", 9001L), ("UserId", 710), ("ActorUserId", null),
            ("Type", "admin_issue"), ("Direction", "credit"), ("Points", 999m), ("BalanceAfter", 999m),
            ("Description", "Other tenant"), ("CreatedAt", new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc))));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        var data = ReadDataObject(await InvokeLedger(controller, limit: 1));

        data.GetProperty("stats").GetProperty("accounts_count").GetInt32().Should().Be(2);
        data.GetProperty("stats").GetProperty("circulating_points").GetDecimal().Should().Be(17m);
        data.GetProperty("stats").GetProperty("total_issued").GetDecimal().Should().Be(35m);
        data.GetProperty("stats").GetProperty("total_spent").GetDecimal().Should().Be(18m);

        var items = data.GetProperty("items");
        items.GetArrayLength().Should().Be(1);
        var item = items[0];
        item.GetProperty("id").GetInt64().Should().Be(502);
        item.GetProperty("user_id").GetInt32().Should().Be(10);
        item.GetProperty("actor_user_id").GetInt32().Should().Be(9);
        item.GetProperty("type").GetString().Should().Be("admin_adjustment");
        item.GetProperty("direction").GetString().Should().Be("debit");
        item.GetProperty("points").GetDecimal().Should().Be(18m);
        item.GetProperty("balance_after").GetDecimal().Should().Be(12m);
        item.GetProperty("description").GetString().Should().Be("Correction");
        item.GetProperty("user_name").GetString().Should().Be("Ada Lovelace");
        item.GetProperty("user_email").GetString().Should().Be("ada@example.test");
        item.GetProperty("actor_name").GetString().Should().Be("Admin User");
    }

    [Fact]
    public async Task MemberRegionalPointsSummaryAndHistory_ReturnLaravelMemberPayloads()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        db.TenantConfigs.AddRange(
            Setting(42, "label", "Neighbour Credits"),
            Setting(42, "symbol", "KISS"),
            Setting(42, "member_transfers_enabled", "1"),
            Setting(42, "marketplace_redemption_enabled", "1"));
        SeedUser(db, 42, 10, "ada@example.test", "Ada", "Lovelace");
        SeedUser(db, 42, 20, "grace@example.test", "Grace", "Hopper");
        SeedUser(db, 7, 710, "other@example.test", "Other", "Tenant");
        db.Add(Entity(AccountTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("Balance", 12.345m),
            ("LifetimeEarned", 40m), ("LifetimeSpent", 27.655m)));
        db.Add(Entity(AccountTypeName,
            ("Id", 9001L), ("TenantId", 7), ("UserId", 710), ("Balance", 999m),
            ("LifetimeEarned", 999m), ("LifetimeSpent", 0m)));
        db.Add(Entity(TransactionTypeName,
            ("Id", 501L), ("TenantId", 42), ("AccountId", 1001L), ("UserId", 10), ("ActorUserId", 20),
            ("Type", "admin_issue"), ("Direction", "credit"), ("Points", 30.123m), ("BalanceAfter", 30.123m),
            ("Description", "Issued"), ("CreatedAt", new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(TransactionTypeName,
            ("Id", 502L), ("TenantId", 42), ("AccountId", 1001L), ("UserId", 10), ("ActorUserId", null),
            ("Type", "redemption"), ("Direction", "debit"), ("Points", 17.778m), ("BalanceAfter", 12.345m),
            ("Description", "Redeemed"), ("CreatedAt", new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(TransactionTypeName,
            ("Id", 503L), ("TenantId", 42), ("AccountId", 1001L), ("UserId", 20), ("ActorUserId", null),
            ("Type", "admin_issue"), ("Direction", "credit"), ("Points", 5m), ("BalanceAfter", 5m),
            ("Description", "Other member"), ("CreatedAt", new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(TransactionTypeName,
            ("Id", 990L), ("TenantId", 7), ("AccountId", 9001L), ("UserId", 710), ("ActorUserId", null),
            ("Type", "admin_issue"), ("Direction", "credit"), ("Points", 999m), ("BalanceAfter", 999m),
            ("Description", "Other tenant"), ("CreatedAt", new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc))));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        var summary = ReadDataObject(await InvokeMember(controller, "RegionalPointsSummary", CancellationToken.None));

        summary.GetProperty("enabled").GetBoolean().Should().BeTrue();
        summary.GetProperty("config").GetProperty("label").GetString().Should().Be("Neighbour Credits");
        summary.GetProperty("config").GetProperty("symbol").GetString().Should().Be("KISS");
        summary.GetProperty("config").GetProperty("member_transfers_enabled").GetBoolean().Should().BeTrue();
        summary.GetProperty("config").GetProperty("marketplace_redemption_enabled").GetBoolean().Should().BeTrue();
        summary.GetProperty("config").TryGetProperty("auto_issue_enabled", out _).Should().BeFalse();
        summary.GetProperty("account").GetProperty("user_id").GetInt32().Should().Be(10);
        summary.GetProperty("account").GetProperty("balance").GetDecimal().Should().Be(12.35m);
        summary.GetProperty("account").GetProperty("lifetime_earned").GetDecimal().Should().Be(40m);
        summary.GetProperty("account").GetProperty("lifetime_spent").GetDecimal().Should().Be(27.66m);

        var history = ReadDataObject(await InvokeMember(controller, "RegionalPointsHistory", 1, CancellationToken.None));
        var items = history.GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(1);
        items[0].GetProperty("id").GetInt64().Should().Be(502);
        items[0].GetProperty("user_id").GetInt32().Should().Be(10);
        items[0].GetProperty("actor_user_id").ValueKind.Should().Be(JsonValueKind.Null);
        items[0].GetProperty("type").GetString().Should().Be("redemption");
        items[0].GetProperty("direction").GetString().Should().Be("debit");
        items[0].GetProperty("points").GetDecimal().Should().Be(17.78m);
        items[0].GetProperty("balance_after").GetDecimal().Should().Be(12.35m);
        items[0].GetProperty("description").GetString().Should().Be("Redeemed");
        items[0].GetProperty("created_at").GetDateTime().Should().Be(new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc));
        items[0].TryGetProperty("user_name", out _).Should().BeFalse();
    }

    [Fact]
    public async Task MemberRegionalPointsMarketplaceQuote_ReturnsLaravelDiscountEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        db.TenantConfigs.Add(Setting(42, "marketplace_redemption_enabled", "1"));
        SeedUser(db, 42, 10, "ada@example.test", "Ada", "Member");
        SeedUser(db, 42, 20, "seller@example.test", "Seller", "One");
        db.Add(Entity(AccountTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("Balance", 80m),
            ("LifetimeEarned", 80m), ("LifetimeSpent", 0m)));
        db.Add(Entity(SellerSettingTypeName,
            ("Id", 3001L), ("TenantId", 42), ("SellerUserId", 20), ("AcceptsRegionalPoints", true),
            ("RegionalPointsPerChf", 10m), ("RegionalPointsMaxDiscountPct", 25)));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        var data = ReadDataObject(await InvokeMember(
            controller,
            "RegionalPointsMarketplaceQuote",
            20,
            null,
            20m,
            CancellationToken.None));

        data.GetProperty("accepts").GetBoolean().Should().BeTrue();
        data.GetProperty("member_points").GetDecimal().Should().Be(80m);
        data.GetProperty("regional_points_per_chf").GetDecimal().Should().Be(10m);
        data.GetProperty("max_discount_pct").GetInt32().Should().Be(25);
        data.GetProperty("max_points_usable").GetDecimal().Should().Be(50m);
        data.GetProperty("max_discount_chf").GetDecimal().Should().Be(5m);
        data.TryGetProperty("reason", out _).Should().BeFalse();
    }

    [Fact]
    public async Task MemberRegionalPointsMarketplaceRedeem_DebitsWalletAndReturnsLaravelCreatedEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        db.TenantConfigs.Add(Setting(42, "marketplace_redemption_enabled", "1"));
        SeedUser(db, 42, 10, "ada@example.test", "Ada", "Member");
        SeedUser(db, 42, 20, "seller@example.test", "Seller", "One");
        db.Add(Entity(AccountTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("Balance", 80m),
            ("LifetimeEarned", 80m), ("LifetimeSpent", 5m)));
        db.Add(Entity(SellerSettingTypeName,
            ("Id", 3001L), ("TenantId", 42), ("SellerUserId", 20), ("AcceptsRegionalPoints", true),
            ("RegionalPointsPerChf", 10m), ("RegionalPointsMaxDiscountPct", 25)));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        var data = ReadDataObject(await InvokeMember(
            controller,
            "RegionalPointsMarketplaceRedeem",
            Json("""
            {
              "seller_id": 20,
              "points_to_use": 40,
              "order_total_chf": 20
            }
            """),
            CancellationToken.None), StatusCodes.Status201Created);

        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("transaction_id").GetInt64().Should().BeGreaterThan(0);
        data.GetProperty("seller_user_id").GetInt32().Should().Be(20);
        data.GetProperty("marketplace_listing_id").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("points_used").GetDecimal().Should().Be(40m);
        data.GetProperty("discount_chf").GetDecimal().Should().Be(4m);
        data.GetProperty("new_regional_point_balance").GetDecimal().Should().Be(40m);

        var account = await Set(AccountTypeName, db).SingleAsync();
        Get<decimal>(account, "Balance").Should().Be(40m);
        Get<decimal>(account, "LifetimeSpent").Should().Be(45m);

        var transaction = await Set(TransactionTypeName, db).SingleAsync();
        Get<int>(transaction, "TenantId").Should().Be(42);
        Get<long>(transaction, "AccountId").Should().Be(1001L);
        Get<int>(transaction, "UserId").Should().Be(10);
        Get<int?>(transaction, "ActorUserId").Should().Be(10);
        Get<string>(transaction, "Type").Should().Be("redemption");
        Get<string>(transaction, "Direction").Should().Be("debit");
        Get<decimal>(transaction, "Points").Should().Be(40m);
        Get<decimal>(transaction, "BalanceAfter").Should().Be(40m);
        Get<string>(transaction, "ReferenceType").Should().Be("marketplace_seller");
        Get<long?>(transaction, "ReferenceId").Should().Be(20L);

        using var metadata = JsonDocument.Parse(Get<string>(transaction, "Metadata")!);
        metadata.RootElement.GetProperty("seller_user_id").GetInt32().Should().Be(20);
        metadata.RootElement.GetProperty("marketplace_listing_id").ValueKind.Should().Be(JsonValueKind.Null);
        metadata.RootElement.GetProperty("order_total_chf").GetDecimal().Should().Be(20m);
        metadata.RootElement.GetProperty("discount_chf").GetDecimal().Should().Be(4m);
        metadata.RootElement.GetProperty("regional_points_per_chf").GetDecimal().Should().Be(10m);
        metadata.RootElement.GetProperty("max_discount_pct").GetInt32().Should().Be(25);
    }

    [Fact]
    public async Task MemberRegionalPointsTransfer_MovesPointsAndReturnsLaravelCreatedEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        db.TenantConfigs.Add(Setting(42, "member_transfers_enabled", "1"));
        SeedUser(db, 42, 10, "sender@example.test", "Sender", "One");
        SeedUser(db, 42, 20, "recipient@example.test", "Recipient", "Two");
        db.Add(Entity(AccountTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("Balance", 80m),
            ("LifetimeEarned", 90m), ("LifetimeSpent", 10m)));
        db.Add(Entity(AccountTypeName,
            ("Id", 1002L), ("TenantId", 42), ("UserId", 20), ("Balance", 5m),
            ("LifetimeEarned", 5m), ("LifetimeSpent", 0m)));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        var data = ReadDataObject(await InvokeMember(
            controller,
            "RegionalPointsTransfer",
            Json("""
            {
              "recipient_user_id": 20,
              "points": 12.345,
              "message": "  Thanks for the lift  "
            }
            """),
            CancellationToken.None), StatusCodes.Status201Created);

        data.GetProperty("sender_transaction_id").GetInt64().Should().BeGreaterThan(0);
        data.GetProperty("recipient_transaction_id").GetInt64().Should().BeGreaterThan(0);
        data.GetProperty("sender_user_id").GetInt32().Should().Be(10);
        data.GetProperty("recipient_user_id").GetInt32().Should().Be(20);
        data.GetProperty("points").GetDecimal().Should().Be(12.35m);
        data.GetProperty("sender_balance").GetDecimal().Should().Be(67.65m);
        data.GetProperty("recipient_balance").GetDecimal().Should().Be(17.35m);

        var accounts = (await Set(AccountTypeName, db).ToListAsync()).ToDictionary(row => Get<int>(row, "UserId"));
        Get<decimal>(accounts[10], "Balance").Should().Be(67.65m);
        Get<decimal>(accounts[10], "LifetimeSpent").Should().Be(22.35m);
        Get<decimal>(accounts[20], "Balance").Should().Be(17.35m);
        Get<decimal>(accounts[20], "LifetimeEarned").Should().Be(17.35m);

        var transactions = await Set(TransactionTypeName, db).ToListAsync();
        transactions.Should().HaveCount(2);
        var debit = transactions.Single(row => Get<string>(row, "Type") == "transfer_out");
        var credit = transactions.Single(row => Get<string>(row, "Type") == "transfer_in");

        Get<int>(debit, "UserId").Should().Be(10);
        Get<int?>(debit, "ActorUserId").Should().Be(10);
        Get<string>(debit, "Direction").Should().Be("debit");
        Get<decimal>(debit, "Points").Should().Be(12.35m);
        Get<decimal>(debit, "BalanceAfter").Should().Be(67.65m);
        Get<string>(debit, "Description").Should().Be("Thanks for the lift");
        Get<string>(debit, "ReferenceType").Should().Be("regional_point_transfer");
        Get<long?>(debit, "ReferenceId").Should().Be(Get<long>(credit, "Id"));

        Get<int>(credit, "UserId").Should().Be(20);
        Get<int?>(credit, "ActorUserId").Should().Be(10);
        Get<string>(credit, "Direction").Should().Be("credit");
        Get<decimal>(credit, "Points").Should().Be(12.35m);
        Get<decimal>(credit, "BalanceAfter").Should().Be(17.35m);
        Get<string>(credit, "Description").Should().Be("Thanks for the lift");
        Get<string>(credit, "ReferenceType").Should().Be("regional_point_transfer");
        Get<long?>(credit, "ReferenceId").Should().Be(Get<long>(debit, "Id"));

        using var debitMetadata = JsonDocument.Parse(Get<string>(debit, "Metadata")!);
        debitMetadata.RootElement.GetProperty("recipient_user_id").GetInt32().Should().Be(20);
        using var creditMetadata = JsonDocument.Parse(Get<string>(credit, "Metadata")!);
        creditMetadata.RootElement.GetProperty("sender_user_id").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task MemberRegionalPointsTransfer_WhenBalanceTooLow_ReturnsLaravelTransferFailedError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        db.TenantConfigs.Add(Setting(42, "member_transfers_enabled", "1"));
        SeedUser(db, 42, 10, "sender@example.test", "Sender", "One");
        SeedUser(db, 42, 20, "recipient@example.test", "Recipient", "Two");
        db.Add(Entity(AccountTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("Balance", 5m),
            ("LifetimeEarned", 5m), ("LifetimeSpent", 0m)));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        AssertSingleError(await InvokeMember(
                controller,
                "RegionalPointsTransfer",
                Json("""
                {
                  "recipient_user_id": 20,
                  "points": 10
                }
                """),
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "REGIONAL_POINTS_TRANSFER_FAILED");
    }

    [Fact]
    public async Task MemberRegionalPointsMarketplaceRedeem_WhenBalanceTooLow_ReturnsLaravelInsufficientError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        db.TenantConfigs.Add(Setting(42, "marketplace_redemption_enabled", "1"));
        SeedUser(db, 42, 10, "ada@example.test", "Ada", "Member");
        SeedUser(db, 42, 20, "seller@example.test", "Seller", "One");
        db.Add(Entity(AccountTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("Balance", 10m),
            ("LifetimeEarned", 10m), ("LifetimeSpent", 0m)));
        db.Add(Entity(SellerSettingTypeName,
            ("Id", 3001L), ("TenantId", 42), ("SellerUserId", 20), ("AcceptsRegionalPoints", true),
            ("RegionalPointsPerChf", 10m), ("RegionalPointsMaxDiscountPct", 100)));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        AssertSingleError(await InvokeMember(
                controller,
                "RegionalPointsMarketplaceRedeem",
                Json("""
                {
                  "seller_id": 20,
                  "points_to_use": 40,
                  "order_total_chf": 20
                }
                """),
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INSUFFICIENT_REGIONAL_POINTS");
    }

    [Fact]
    public async Task MemberRegionalPointsRoutes_WhenRegionalPointsDisabled_ReturnFeatureDisabledOrDisabledQuote()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUser(db, 42, 10, "ada@example.test", "Ada", "Member");
        SeedUser(db, 42, 20, "seller@example.test", "Seller", "One");
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        AssertSingleError(await InvokeMember(controller, "RegionalPointsSummary", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(await InvokeMember(controller, "RegionalPointsHistory", null, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");

        var quote = ReadDataObject(await InvokeMember(
            controller,
            "RegionalPointsMarketplaceQuote",
            20,
            null,
            20m,
            CancellationToken.None));
        quote.GetProperty("accepts").GetBoolean().Should().BeFalse();
        quote.GetProperty("reason").GetString().Should().Be("feature_disabled");
    }

    [Fact]
    public async Task Issue_CreatesAccountTransactionAndReturnsLaravelCreatedEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        SeedUser(db, 42, 9, "admin@example.test", "Admin", "User", Role.Names.Admin);
        SeedUser(db, 42, 10, "ada@example.test", "Ada", "Lovelace");
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        var data = ReadDataObject(await InvokeIssue(controller, Json("""
        {
          "user_id": 10,
          "points": 12.345,
          "description": "  Pilot bonus  "
        }
        """)), StatusCodes.Status201Created);

        data.GetProperty("transaction_id").GetInt64().Should().BeGreaterThan(0);
        data.GetProperty("user_id").GetInt32().Should().Be(10);
        data.GetProperty("points").GetDecimal().Should().Be(12.35m);
        data.GetProperty("balance").GetDecimal().Should().Be(12.35m);

        var account = await Set(AccountTypeName, db).SingleAsync();
        Get<int>(account, "TenantId").Should().Be(42);
        Get<int>(account, "UserId").Should().Be(10);
        Get<decimal>(account, "Balance").Should().Be(12.35m);
        Get<decimal>(account, "LifetimeEarned").Should().Be(12.35m);
        Get<decimal>(account, "LifetimeSpent").Should().Be(0m);

        var tx = await Set(TransactionTypeName, db).SingleAsync();
        Get<int>(tx, "TenantId").Should().Be(42);
        Get<long>(tx, "AccountId").Should().Be(Get<long>(account, "Id"));
        Get<int>(tx, "UserId").Should().Be(10);
        Get<int?>(tx, "ActorUserId").Should().Be(9);
        Get<string>(tx, "Type").Should().Be("admin_issue");
        Get<string>(tx, "Direction").Should().Be("credit");
        Get<decimal>(tx, "Points").Should().Be(12.35m);
        Get<decimal>(tx, "BalanceAfter").Should().Be(12.35m);
        Get<string?>(tx, "Description").Should().Be("Pilot bonus");
    }

    [Fact]
    public async Task Adjust_DebitsBalanceAndReturnsLaravelErrorWhenInsufficient()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        SeedUser(db, 42, 9, "admin@example.test", "Admin", "User", Role.Names.Admin);
        SeedUser(db, 42, 10, "ada@example.test", "Ada", "Lovelace");
        db.Add(Entity(AccountTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("Balance", 20m),
            ("LifetimeEarned", 20m), ("LifetimeSpent", 0m)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        var data = ReadDataObject(await InvokeAdjust(controller, Json("""
        {
          "user_id": 10,
          "points_delta": -6.789,
          "description": "Balance correction"
        }
        """)));

        data.GetProperty("user_id").GetInt32().Should().Be(10);
        data.GetProperty("points").GetDecimal().Should().Be(-6.79m);
        data.GetProperty("balance").GetDecimal().Should().Be(13.21m);
        var account = await Set(AccountTypeName, db).SingleAsync();
        Get<decimal>(account, "Balance").Should().Be(13.21m);
        Get<decimal>(account, "LifetimeSpent").Should().Be(6.79m);
        var tx = await Set(TransactionTypeName, db).SingleAsync();
        Get<string>(tx, "Type").Should().Be("admin_adjustment");
        Get<string>(tx, "Direction").Should().Be("debit");
        Get<decimal>(tx, "Points").Should().Be(6.79m);
        Get<decimal>(tx, "BalanceAfter").Should().Be(13.21m);

        AssertSingleError(
            await InvokeAdjust(controller, Json("""{ "user_id": 10, "points_delta": -99, "description": "Too much" }""")),
            StatusCodes.Status422UnprocessableEntity,
            "REGIONAL_POINTS_FAILED");
    }

    [Fact]
    public async Task SellerSettings_ReturnDefaultsThenUpsertLaravelSettings()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedRegionalPointsEnabled(db, 42);
        SeedUser(db, 42, 9, "admin@example.test", "Admin", "User", Role.Names.Admin);
        SeedUser(db, 42, 10, "seller@example.test", "Seller", "One");
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        var defaults = ReadDataObject(await InvokeGetSellerSettings(controller, 10));
        defaults.GetProperty("seller_user_id").GetInt32().Should().Be(10);
        defaults.GetProperty("accepts_regional_points").GetBoolean().Should().BeFalse();
        defaults.GetProperty("regional_points_per_chf").GetDecimal().Should().Be(10m);
        defaults.GetProperty("regional_points_max_discount_pct").GetInt32().Should().Be(25);

        var updated = ReadDataObject(await InvokeUpdateSellerSettings(controller, Json("""
        {
          "seller_user_id": 10,
          "accepts_regional_points": true,
          "regional_points_per_chf": 12.345,
          "regional_points_max_discount_pct": 40
        }
        """)));

        updated.GetProperty("seller_user_id").GetInt32().Should().Be(10);
        updated.GetProperty("accepts_regional_points").GetBoolean().Should().BeTrue();
        updated.GetProperty("regional_points_per_chf").GetDecimal().Should().Be(12.35m);
        updated.GetProperty("regional_points_max_discount_pct").GetInt32().Should().Be(40);

        var row = await Set(SellerSettingTypeName, db).SingleAsync();
        Get<int>(row, "TenantId").Should().Be(42);
        Get<int>(row, "SellerUserId").Should().Be(10);
        Get<bool>(row, "AcceptsRegionalPoints").Should().BeTrue();
        Get<decimal>(row, "RegionalPointsPerChf").Should().Be(12.35m);
        Get<int>(row, "RegionalPointsMaxDiscountPct").Should().Be(40);

        AssertSingleError(
            await InvokeUpdateSellerSettings(controller, Json("""{ "accepts_regional_points": true }""")),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");
    }

    [Fact]
    public async Task RegionalPointAdminRoutes_WhenRegionalPointsDisabled_ReturnFeatureDisabled()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUser(db, 42, 9, "admin@example.test", "Admin", "User", Role.Names.Admin);
        SeedUser(db, 42, 10, "seller@example.test", "Seller", "One");
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        AssertSingleError(await InvokeLedger(controller, limit: 100), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
        AssertSingleError(await InvokeIssue(controller, Json("""{ "user_id": 10, "points": 1 }""")), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
        AssertSingleError(await InvokeAdjust(controller, Json("""{ "user_id": 10, "points_delta": 1 }""")), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
        AssertSingleError(await InvokeGetSellerSettings(controller, 10), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
        AssertSingleError(await InvokeUpdateSellerSettings(controller, Json("""{ "seller_user_id": 10 }""")), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"Laravel parity type {typeName} should exist");
        return type!;
    }

    private static object CreateController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var service = Activator.CreateInstance(Resolve(ServiceTypeName), db)!;
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(ControllerTypeName), service, tenant)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
        return controller;
    }

    private static object CreateMemberController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var controller = (ControllerBase)Activator.CreateInstance(
            Resolve(MemberControllerTypeName),
            new CaringSupportRelationshipService(db),
            new CaringSafeguardingService(db),
            new CaringCommunityDataExportService(db),
            new CaringCommunityAhvPensionExportService(db),
            new CaringCommunityFutureCareFundService(db),
            new CaringRegionalPointService(db),
            new CaringResearchPartnershipService(db),
            new CaringCommunityVereineAdminService(db),
            tenant,
            db)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
        return controller;
    }

    private static async Task<IActionResult> InvokeMember(object controller, string method, params object?[] args)
    {
        var info = Resolve(MemberControllerTypeName).GetMethod(method);
        info.Should().NotBeNull();
        var task = (Task<IActionResult>)info!.Invoke(controller, args)!;
        return await task;
    }

    private static async Task<IActionResult> InvokeConfig(object controller)
    {
        var method = Resolve(ControllerTypeName).GetMethod("Config");
        method.Should().NotBeNull();
        var task = (Task<IActionResult>)method!.Invoke(controller, new object[] { CancellationToken.None })!;
        return await task;
    }

    private static async Task<IActionResult> InvokeUpdateConfig(object controller, JsonElement payload)
    {
        var method = Resolve(ControllerTypeName).GetMethod("UpdateConfig");
        method.Should().NotBeNull();
        var task = (Task<IActionResult>)method!.Invoke(controller, new object[] { payload, CancellationToken.None })!;
        return await task;
    }

    private static async Task<IActionResult> InvokeLedger(object controller, int? limit)
    {
        var method = Resolve(ControllerTypeName).GetMethod("Ledger");
        method.Should().NotBeNull();
        var task = (Task<IActionResult>)method!.Invoke(controller, new object?[] { limit, CancellationToken.None })!;
        return await task;
    }

    private static async Task<IActionResult> InvokeIssue(object controller, JsonElement payload)
    {
        var method = Resolve(ControllerTypeName).GetMethod("Issue");
        method.Should().NotBeNull();
        var task = (Task<IActionResult>)method!.Invoke(controller, new object[] { payload, CancellationToken.None })!;
        return await task;
    }

    private static async Task<IActionResult> InvokeAdjust(object controller, JsonElement payload)
    {
        var method = Resolve(ControllerTypeName).GetMethod("Adjust");
        method.Should().NotBeNull();
        var task = (Task<IActionResult>)method!.Invoke(controller, new object[] { payload, CancellationToken.None })!;
        return await task;
    }

    private static async Task<IActionResult> InvokeGetSellerSettings(object controller, int userId)
    {
        var method = Resolve(ControllerTypeName).GetMethod("GetSellerSettings");
        method.Should().NotBeNull();
        var task = (Task<IActionResult>)method!.Invoke(controller, new object[] { userId, CancellationToken.None })!;
        return await task;
    }

    private static async Task<IActionResult> InvokeUpdateSellerSettings(object controller, JsonElement payload)
    {
        var method = Resolve(ControllerTypeName).GetMethod("UpdateSellerSettings");
        method.Should().NotBeNull();
        var task = (Task<IActionResult>)method!.Invoke(controller, new object[] { payload, CancellationToken.None })!;
        return await task;
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static JsonElement ReadDataObject(IActionResult result, int expectedStatus = StatusCodes.Status200OK)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.GetValueOrDefault(StatusCodes.Status200OK).Should().Be(expectedStatus);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(code);
    }

    private static JsonElement Json(string raw)
    {
        using var document = JsonDocument.Parse(raw);
        return document.RootElement.Clone();
    }

    private static TenantConfig Setting(int tenantId, string key, string value)
    {
        return new TenantConfig
        {
            TenantId = tenantId,
            Key = "caring_community.regional_points." + key,
            Value = value,
            UpdatedAt = new DateTime(2026, 7, 4, 8, 0, 0, DateTimeKind.Utc)
        };
    }

    private static object Entity(string typeName, params (string Name, object? Value)[] values)
    {
        var type = Resolve(typeName);
        var entity = Activator.CreateInstance(type)!;
        foreach (var (name, value) in values)
        {
            type.GetProperty(name).Should().NotBeNull($"property {name} should exist on {typeName}");
            type.GetProperty(name)!.SetValue(entity, value);
        }

        return entity;
    }

    private static IQueryable<object> Set(string typeName, NexusDbContext db)
    {
        var set = db.GetType()
            .GetMethod(nameof(DbContext.Set), Type.EmptyTypes)!
            .MakeGenericMethod(Resolve(typeName))
            .Invoke(db, null)
            .Should().BeAssignableTo<IQueryable>().Subject;

        return set.Cast<object>();
    }

    private static T? Get<T>(object entity, string property)
    {
        entity.GetType().GetProperty(property).Should().NotBeNull();
        return (T?)entity.GetType().GetProperty(property)!.GetValue(entity);
    }

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static void SeedRegionalPointsEnabled(NexusDbContext db, int tenantId)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "caring_community.regional_points.enabled",
            Value = "true"
        });
    }

    private static void SeedUser(
        NexusDbContext db,
        int tenantId,
        int userId,
        string email,
        string firstName,
        string lastName,
        string role = Role.Names.Member)
    {
        db.Users.Add(new User
        {
            Id = userId,
            TenantId = tenantId,
            Email = email,
            PasswordHash = "test",
            FirstName = firstName,
            LastName = lastName,
            Role = role,
            IsActive = true
        });
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
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim("tenant_id", tenantId.ToString()),
                        new Claim(ClaimTypes.Role, Role.Names.Admin)
                    },
                    "TestAuth"))
            }
        };
    }
}
