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
public sealed class LaravelReactFeedSidebarCompatibilityTests : IntegrationTestBase
{
    public LaravelReactFeedSidebarCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task FeedSidebarV2_ReturnsLaravelReactSidebarWidgetShape()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/feed/sidebar");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();

        var data = json.GetProperty("data");
        var stats = data.GetProperty("community_stats");
        stats.GetProperty("members").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        stats.GetProperty("listings").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        stats.GetProperty("events").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        stats.GetProperty("groups").GetInt32().Should().BeGreaterThanOrEqualTo(0);

        data.GetProperty("top_categories").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("upcoming_events").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("popular_groups").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("suggested_listings").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("friends").ValueKind.Should().Be(JsonValueKind.Array);

        var profileStats = data.GetProperty("profile_stats");
        profileStats.ValueKind.Should().Be(JsonValueKind.Object);
        profileStats.GetProperty("total_listings").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        profileStats.GetProperty("offers").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        profileStats.GetProperty("requests").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        profileStats.GetProperty("hours_given").GetDecimal().Should().BeGreaterThanOrEqualTo(0m);
        profileStats.GetProperty("hours_received").GetDecimal().Should().BeGreaterThanOrEqualTo(0m);
    }
}
