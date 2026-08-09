// Copyright © 2024–2026 Jasper Ford
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

/// <summary>
/// Fix 2: server-side filters + pagination for
/// /api/v2/admin/federation/activity. Verifies filter narrowing, pagination,
/// totals, server-side severity classification, and DESC default order.
/// </summary>
[Collection("Integration")]
public class AdminFederationActivityFilterTests : IntegrationTestBase
{
    public AdminFederationActivityFilterTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task SeedActivityAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var tenantId = TestData.Tenant1.Id;
        var baseTime = DateTime.UtcNow.AddMinutes(-60);

        db.FederationAuditLogs.AddRange(
            new FederationAuditLog { TenantId = tenantId, Action = "listing.shared.ok", EntityType = "Listing", EntityId = 1, PartnerTenantId = 999, CreatedAt = baseTime.AddMinutes(1) },
            new FederationAuditLog { TenantId = tenantId, Action = "exchange.completed.fail", EntityType = "Exchange", EntityId = 2, PartnerTenantId = 999, CreatedAt = baseTime.AddMinutes(2) },
            new FederationAuditLog { TenantId = tenantId, Action = "partner.retry.cancel", EntityType = "Partner", EntityId = 3, PartnerTenantId = 888, CreatedAt = baseTime.AddMinutes(3) }
        );

        db.FederationApiLogs.AddRange(
            new FederationApiLog { TenantId = tenantId, HttpMethod = "POST", Path = "/api/federation/listings", StatusCode = 200, Direction = "outbound", CreatedAt = baseTime.AddMinutes(4) },
            new FederationApiLog { TenantId = tenantId, HttpMethod = "POST", Path = "/api/federation/exchanges", StatusCode = 500, Direction = "outbound", CreatedAt = baseTime.AddMinutes(5) },
            new FederationApiLog { TenantId = tenantId, HttpMethod = "POST", Path = "/api/federation/listings", StatusCode = 404, Direction = "outbound", CreatedAt = baseTime.AddMinutes(6) }
        );

        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task DefaultRequest_AdminGet_ReturnsPaginationWrapper()
    {
        await SeedActivityAsync();
        await AuthenticateAsAdminAsync();

        var resp = await Client.GetAsync("/api/v2/admin/federation/activity");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        body.TryGetProperty("page", out var page).Should().BeTrue();
        page.GetInt32().Should().Be(1);
        body.TryGetProperty("page_size", out _).Should().BeTrue();
        body.TryGetProperty("total", out _).Should().BeTrue();
        body.TryGetProperty("total_pages", out _).Should().BeTrue();
        body.TryGetProperty("items", out var items).Should().BeTrue();
        items.GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task PartnerFilter_NarrowsResults_ToMatchingPartnerOnly()
    {
        await SeedActivityAsync();
        await AuthenticateAsAdminAsync();

        var resp = await Client.GetAsync("/api/v2/admin/federation/activity?partner=888");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items");
        items.GetArrayLength().Should().BeGreaterThanOrEqualTo(1);
        foreach (var item in items.EnumerateArray())
        {
            item.GetProperty("partnerTenantId").GetInt32().Should().Be(888);
        }
    }

    [Fact]
    public async Task SourceFilter_OnlyAuditEntries_ReturnedWhenSourceIsAudit()
    {
        await SeedActivityAsync();
        await AuthenticateAsAdminAsync();

        var resp = await Client.GetAsync("/api/v2/admin/federation/activity?source=audit&page_size=50");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items");
        foreach (var item in items.EnumerateArray())
        {
            item.GetProperty("source").GetString().Should().Be("audit");
        }
    }

    [Fact]
    public async Task SeverityClassification_ServerSide_AssignsErrorWarningInfo()
    {
        await SeedActivityAsync();
        await AuthenticateAsAdminAsync();

        var errorResp = await Client.GetAsync("/api/v2/admin/federation/activity?severity=error&page_size=200");
        errorResp.EnsureSuccessStatusCode();
        var errorBody = await errorResp.Content.ReadFromJsonAsync<JsonElement>();
        foreach (var item in errorBody.GetProperty("items").EnumerateArray())
        {
            item.GetProperty("severity").GetString().Should().Be("error");
        }

        var warningResp = await Client.GetAsync("/api/v2/admin/federation/activity?severity=warning&page_size=200");
        warningResp.EnsureSuccessStatusCode();
        var warningBody = await warningResp.Content.ReadFromJsonAsync<JsonElement>();
        foreach (var item in warningBody.GetProperty("items").EnumerateArray())
        {
            item.GetProperty("severity").GetString().Should().Be("warning");
        }
    }

    [Fact]
    public async Task Pagination_SecondPage_DoesNotRepeatFirstPageItems()
    {
        await SeedActivityAsync();
        await AuthenticateAsAdminAsync();

        var page1 = await Client.GetAsync("/api/v2/admin/federation/activity?page_size=2&page=1");
        page1.EnsureSuccessStatusCode();
        var body1 = await page1.Content.ReadFromJsonAsync<JsonElement>();

        var page2 = await Client.GetAsync("/api/v2/admin/federation/activity?page_size=2&page=2");
        page2.EnsureSuccessStatusCode();
        var body2 = await page2.Content.ReadFromJsonAsync<JsonElement>();

        var items1 = body1.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("source").GetString() + ":" + i.GetProperty("id").GetInt32())
            .ToHashSet();
        var items2 = body2.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("source").GetString() + ":" + i.GetProperty("id").GetInt32())
            .ToHashSet();
        items1.Intersect(items2).Should().BeEmpty("paged results must not overlap");
    }

    [Fact]
    public async Task DefaultOrder_IsDescending_ByCreatedAt()
    {
        await SeedActivityAsync();
        await AuthenticateAsAdminAsync();

        var resp = await Client.GetAsync("/api/v2/admin/federation/activity?page_size=50");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("createdAt").GetDateTime())
            .ToList();
        items.Should().BeInDescendingOrder();
    }
}
