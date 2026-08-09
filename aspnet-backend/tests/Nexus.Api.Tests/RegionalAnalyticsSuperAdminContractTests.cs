// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class RegionalAnalyticsSuperAdminContractTests : IntegrationTestBase
{
    public RegionalAnalyticsSuperAdminContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task LaravelReactRegionalAnalyticsSuperAdmin_SubscriptionCrudReportAndAccessLogUseLaravelShape()
    {
        await AuthenticateAsPlatformSuperAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/super-admin/regional-analytics/subscriptions", new
        {
            tenant_id = TestData.Tenant1.Id,
            partner_name = "Regional contract partner",
            partner_type = "municipality",
            contact_email = "regional-contract@example.test",
            billing_email = "billing-regional@example.test",
            plan_tier = "pro",
            monthly_price_cents = 49900,
            currency = "CHF",
            enabled_modules = new[] { "trends", "demand_supply", "demographics" }
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var createData = createJson.GetProperty("data");
        var subscriptionId = createData.GetProperty("subscription_id").GetInt64();
        createData.GetProperty("subscription_token").GetString().Should().NotBeNullOrWhiteSpace();

        await SeedRegionalAnalyticsAccessLogAsync(subscriptionId);

        var list = await Client.GetAsync("/api/super-admin/regional-analytics/subscriptions");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var listed = listJson.GetProperty("data").GetProperty("subscriptions").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt64() == subscriptionId);
        listed.GetProperty("partner_name").GetString().Should().Be("Regional contract partner");
        listed.GetProperty("partner_type").GetString().Should().Be("municipality");
        listed.GetProperty("plan_tier").GetString().Should().Be("pro");
        listed.GetProperty("status").GetString().Should().Be("trialing");
        listed.GetProperty("enabled_modules").EnumerateArray().Select(item => item.GetString())
            .Should().Contain(["trends", "demand_supply", "demographics"]);

        var update = await Client.PutAsJsonAsync($"/api/super-admin/regional-analytics/subscriptions/{subscriptionId}", new
        {
            status = "past_due"
        });
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("data").GetProperty("subscription_id").GetInt64().Should().Be(subscriptionId);

        var generate = await Client.PostAsync($"/api/super-admin/regional-analytics/subscriptions/{subscriptionId}/generate-report", null);
        generate.StatusCode.Should().Be(HttpStatusCode.OK);
        var generateJson = await generate.Content.ReadFromJsonAsync<JsonElement>();
        generateJson.GetProperty("data").GetProperty("subscription_id").GetInt64().Should().Be(subscriptionId);
        generateJson.GetProperty("data").GetProperty("queued").GetBoolean().Should().BeTrue();

        var accessLog = await Client.GetAsync("/api/super-admin/regional-analytics/access-log?per_page=100");
        accessLog.StatusCode.Should().Be(HttpStatusCode.OK);
        var accessLogJson = await accessLog.Content.ReadFromJsonAsync<JsonElement>();
        var accessRows = accessLogJson.GetProperty("data").GetProperty("items").EnumerateArray();
        accessRows.Should().Contain(row =>
            row.GetProperty("subscription_id").GetInt64() == subscriptionId &&
            row.GetProperty("accessed_endpoint").GetString() == "/partner-analytics/me/dashboard");
        accessLogJson.GetProperty("data").GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(100);
    }

    [Fact]
    public async Task LaravelReactRegionalAnalyticsSuperAdmin_RejectsOrdinaryTenantAdmin()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/super-admin/regional-analytics/subscriptions");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    private async Task SeedRegionalAnalyticsAccessLogAsync(long subscriptionId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.RegionalAnalyticsAccessLogs.Add(new RegionalAnalyticsAccessLog
        {
            TenantId = TestData.Tenant1.Id,
            SubscriptionId = subscriptionId,
            AccessedEndpoint = "/partner-analytics/me/dashboard",
            AccessedAt = DateTime.UtcNow,
            IpHash = "contract-hash",
            UserAgent = "regional-contract-test"
        });
        await db.SaveChangesAsync();
    }
}
