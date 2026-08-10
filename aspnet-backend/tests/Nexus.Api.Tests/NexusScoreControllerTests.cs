// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class NexusScoreControllerTests : IntegrationTestBase
{
    public NexusScoreControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetMyScore_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/nexus-score/me");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetMyScore_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/nexus-score/me");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetUserScore_AsMember_ReturnsOkOrNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync($"/api/nexus-score/{TestData.MemberUser.Id}");
        // Returns NotFound when no NexusScore record exists for the user
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RecalculateMyScore_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsync("/api/nexus-score/recalculate", null);
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetGamificationNexusScoreAlias_AsMember_ReturnsReactShape()
    {
        await AuthenticateAsMemberAsync();
        await Client.PostAsync("/api/nexus-score/recalculate", null);

        var r = await Client.GetAsync("/api/gamification/nexus-score");

        r.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await r.Content.ReadFromJsonAsync<JsonElement>();
        var data = content.GetProperty("data");
        data.GetProperty("total_score").GetInt32().Should().BeGreaterOrEqualTo(0);
        data.GetProperty("tier").GetProperty("name").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("breakdown").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task GetLeaderboard_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/nexus-score/leaderboard");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetHistory_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/nexus-score/history");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetDistribution_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/nexus-score/distribution");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetDistribution_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/nexus-score/distribution");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AdminRecalculate_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsync($"/api/nexus-score/admin/recalculate/{TestData.MemberUser.Id}", null);
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminRecalculate_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsync($"/api/nexus-score/admin/recalculate/{TestData.MemberUser.Id}", null);
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
