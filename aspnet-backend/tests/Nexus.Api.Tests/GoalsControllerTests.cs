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
public class GoalsControllerTests : IntegrationTestBase
{
    public GoalsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ListGoals_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/goals");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task CreateGoal_WithMilestones_ReturnsCreated()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/goals", new
        {
            title = "Complete 10 exchanges",
            description = "My goal for this quarter",
            goal_type = "count",
            target_value = 10,
            category = "timebanking",
            milestones = new[] { "First exchange", "5th exchange", "10th exchange" }
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task UpdateProgress_AutoCompletes_WhenTargetReached()
    {
        await AuthenticateAsMemberAsync();
        var createResp = await Client.PostAsJsonAsync("/api/goals", new
        {
            title = "Quick goal",
            goal_type = "count",
            target_value = 5
        });
        var goal = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var goalId = goal.GetProperty("id").GetInt32();

        // Update to target
        var response = await Client.PutAsJsonAsync($"/api/goals/{goalId}/progress", new { value = 5.0 });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = await response.Content.ReadFromJsonAsync<JsonElement>();
        updated.GetProperty("status").GetString().Should().Be("completed");
    }

    [Fact]
    public async Task AbandonGoal_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var createResp = await Client.PostAsJsonAsync("/api/goals", new
        {
            title = "Abandon test",
            goal_type = "custom"
        });
        var goal = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var goalId = goal.GetProperty("id").GetInt32();

        var response = await Client.PutAsync($"/api/goals/{goalId}/abandon", null);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Goals_Unauthenticated_ReturnsUnauthorized()
    {
        var response = await Client.GetAsync("/api/goals");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
