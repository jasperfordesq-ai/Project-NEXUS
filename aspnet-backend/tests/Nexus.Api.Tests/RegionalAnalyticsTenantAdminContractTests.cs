// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class RegionalAnalyticsTenantAdminContractTests : IntegrationTestBase
{
    public RegionalAnalyticsTenantAdminContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task LaravelReactRegionalAnalyticsTenantAdmin_DashboardEndpointsUseSectionPayloads()
    {
        await AuthenticateAsAdminAsync();

        var overview = await GetDataAsync("/api/v2/admin/regional-analytics/overview");
        overview.GetProperty("active_members").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        overview.GetProperty("vol_hours_this_month").GetDouble().Should().BeGreaterThanOrEqualTo(0);
        overview.GetProperty("help_requests_this_month").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        overview.GetProperty("most_needed_category").GetString().Should().NotBeNull();

        var heatmap = await GetDataAsync("/api/v2/admin/regional-analytics/heatmap?period=last_90d");
        heatmap.ValueKind.Should().Be(JsonValueKind.Array);

        var demandSupply = await GetDataAsync("/api/v2/admin/regional-analytics/demand-supply?period=last_30d");
        demandSupply.ValueKind.Should().Be(JsonValueKind.Array);
        demandSupply.EnumerateArray().Should().OnlyContain(row =>
            HasProperties(row, "category_id", "category_name", "request_count", "offer_count", "ratio", "trend"));

        var demographics = await GetDataAsync("/api/v2/admin/regional-analytics/demographics");
        demographics.GetProperty("age_groups").ValueKind.Should().Be(JsonValueKind.Object);
        demographics.GetProperty("languages").ValueKind.Should().Be(JsonValueKind.Array);
        demographics.GetProperty("monthly_growth").ValueKind.Should().Be(JsonValueKind.Array);

        var engagement = await GetDataAsync("/api/v2/admin/regional-analytics/engagement-trends?period=last_12m");
        engagement.ValueKind.Should().Be(JsonValueKind.Array);
        engagement.EnumerateArray().Should().OnlyContain(row =>
            HasProperties(row, "month", "active_members", "vol_hours", "new_listings", "new_events", "help_requests"));

        var volunteer = await GetDataAsync("/api/v2/admin/regional-analytics/volunteer-breakdown?period=last_90d");
        volunteer.GetProperty("top_orgs").ValueKind.Should().Be(JsonValueKind.Array);
        volunteer.GetProperty("avg_hours_per_volunteer").GetDouble().Should().BeGreaterThanOrEqualTo(0);
        volunteer.GetProperty("total_hours").GetDouble().Should().BeGreaterThanOrEqualTo(0);
        volunteer.GetProperty("reciprocity_ratio").GetDouble().Should().BeGreaterThanOrEqualTo(0);

        var help = await GetDataAsync("/api/v2/admin/regional-analytics/help-requests?period=last_30d");
        help.GetProperty("by_category").ValueKind.Should().Be(JsonValueKind.Array);
        help.GetProperty("resolution_trend").ValueKind.Should().Be(JsonValueKind.Array);

        var export = await GetDataAsync("/api/v2/admin/regional-analytics/export?period=last_30d");
        export.GetProperty("period").GetString().Should().Be("last_30d");
        export.GetProperty("overview").GetProperty("active_members").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        export.GetProperty("generated_at").GetString().Should().NotBeNullOrWhiteSpace();

        var invalidate = await Client.PostAsync("/api/v2/admin/regional-analytics/invalidate-cache", null);
        invalidate.StatusCode.Should().Be(HttpStatusCode.OK);
        var invalidateJson = await invalidate.Content.ReadFromJsonAsync<JsonElement>();
        invalidateJson.GetProperty("data").GetProperty("invalidated").GetBoolean().Should().BeTrue();
    }

    private async Task<JsonElement> GetDataAsync(string path)
    {
        var response = await Client.GetAsync(path);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
        return json.GetProperty("data");
    }

    private static bool HasProperties(JsonElement row, params string[] names) =>
        names.All(name => row.TryGetProperty(name, out _));
}
