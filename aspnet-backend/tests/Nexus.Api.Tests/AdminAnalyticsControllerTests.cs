// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminAnalyticsControllerTests : IntegrationTestBase
{
    public AdminAnalyticsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetOverview_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/analytics/overview");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        // DTO uses [JsonPropertyName("total_users")] so property is snake_case
        content.GetProperty("total_users").GetInt32().Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task GetGrowth_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/analytics/growth?days=30");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetRetention_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/analytics/retention");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("total_users").GetInt32().Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task GetTopUsers_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/analytics/top-users?metric=xp&limit=5");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetSroi_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/analytics/sroi?hourValue=15&socialMultiplier=2.5");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("hour_value_in_currency").GetDecimal().Should().Be(15.0m);
    }

    [Fact]
    public async Task GetInactiveMembers_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/analytics/inactive-members?days=90");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetExchangeHealth_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/analytics/exchange-health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Analytics_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/admin/analytics/overview");
        response.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);
    }
}
